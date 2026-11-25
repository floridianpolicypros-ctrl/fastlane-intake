/* ============================================================
   CLOVER RECONCILIATION  —  /api/clover-sweep
   ------------------------------------------------------------
   WHY THIS EXISTS

   Until now the only thing that ever told this system a payment
   had happened was the client's own browser coming back to the
   receipt page after Clover redirected it. Close the tab, lose
   signal, or have Clover not redirect, and the money arrived and
   nothing recorded it. That is not a theoretical gap: at the time
   this was written, not one payment had ever been recorded against
   any file, for anyone.

   Webhooks would be the proper answer and are not available - they
   require a Clover developer App installed on the merchant account,
   and this agency runs on a merchant API token with the hosted
   Invoicing Checkout Service. So instead of waiting to be told,
   this asks Clover directly: what have you taken lately.

   WHAT IT ANSWERS, WHICH IS WHAT WAS ASKED FOR

   Paid, how much, and who. The amount and card come from the
   payment itself; the payer's name from the cardholder on the card
   transaction, falling back to the customer on the order; and the
   defendant and receipt number from the order note, which /api/pay
   writes as "Receipt <no> | Defendant: <name>".

   ALERTING ONCE, AND ONLY ONCE

   Every payment Clover has ever taken will come back on every
   sweep, so the Clover payment id is stored and checked. A payment
   already announced is skipped silently. Without that this would
   re-announce the same money every hour forever, and an alert that
   cries wolf is one nobody reads at 2am.

   WHY IT IS OPEN

   It takes no input, returns no card data beyond the last four, and
   alerts only the agency's own addresses. Each payment is announced
   at most once no matter who calls it, so hitting it repeatedly
   achieves nothing - a better defence than a shared secret that
   would have to live inside a scheduled job.
   ============================================================ */

const LOOKBACK_H = 72;        // hours; generous, because the dedupe makes it free
const MAX_PAGE   = 100;

export async function onRequest(context) {
  const { request, env } = context;

  if (!env.CLOVER_TOKEN || !env.CLOVER_MID) {
    return j({ ok: false, error: "Payments are not configured" }, 503);
  }
  if (!env.DB) {
    return j({ ok: false, error: "The file database is unavailable" }, 503);
  }

  const url   = new URL(request.url);
  const hours = Math.min(720, Math.max(1, Number(url.searchParams.get("hours")) || LOOKBACK_H));
  const since = Date.now() - hours * 3600000;

  const base = String(env.CLOVER_ENV || "sandbox").toLowerCase() === "production"
    ? "https://api.clover.com"
    : "https://apisandbox.dev.clover.com";

  /* expand everything needed to answer "who paid" in one call rather than
     a second request per payment. */
  const q = base + "/v3/merchants/" + encodeURIComponent(env.CLOVER_MID) + "/payments"
          + "?limit=" + MAX_PAGE
          + "&expand=order,cardTransaction,tender"
          + "&filter=" + encodeURIComponent("createdTime>=" + since);

  let payments;
  try {
    const r = await fetch(q, {
      headers: { Authorization: "Bearer " + env.CLOVER_TOKEN, Accept: "application/json" }
    });
    if (!r.ok) return j({ ok: false, error: "Clover returned " + r.status, detail: (await r.text()).slice(0, 300) }, 502);
    const d = await r.json();
    payments = (d && d.elements) || [];
  } catch (e) {
    return j({ ok: false, error: "Could not reach Clover: " + String(e && e.message || e) }, 502);
  }

  await ensure(env);

  const announced = [];
  let skipped = 0, declined = 0;

  for (const p of payments) {
    const id = String(p.id || "");
    if (!id) continue;

    /* A payment row exists for declines too. Treating one as money is
       exactly the mistake this endpoint is here to prevent. */
    const result = String((p.result || "") + (p.cardTransaction && p.cardTransaction.result ? " " + p.cardTransaction.result : "")).toUpperCase();
    if (result && !/SUCCESS|APPROVED/.test(result)) { declined++; continue; }

    const cents = Number(p.amount) || 0;
    if (cents <= 0) continue;

    /* Already told him about this one. */
    try {
      const seen = await env.DB.prepare("SELECT payment_id FROM clover_payments WHERE payment_id=?").bind(id).first();
      if (seen) { skipped++; continue; }
    } catch (_) { /* table just created; fall through and announce */ }

    const order = p.order || {};
    const note  = String(order.note || "");
    const ct    = p.cardTransaction || {};

    const m    = /Receipt\s+([^|]+?)\s*(?:\||$)/.exec(note);
    const dm   = /Defendant:\s*(.+)$/.exec(note);
    const ref  = (m ? m[1].trim() : "") || ("clover-" + id);
    const defN = dm ? dm[1].trim() : "";

    const who = cardholder(ct) || customerName(order) || "";
    const when = Number(p.createdTime) || Date.now();

    try {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO clover_payments (payment_id,order_id,ref,def_name,payer,amount_cents,last4,card_type,created_at,seen_at) " +
        "VALUES (?,?,?,?,?,?,?,?,?,?)"
      ).bind(id, String(order.id || ""), ref, defN, who, cents,
             String(ct.last4 || ""), String(ct.cardType || ""), when, Date.now()).run();
    } catch (_) {}

    /* Put it on the file too, so READY TO POST can fire when the paperwork
       lands - that alert is the one that actually answers "can I post this". */
    const row = await markFile(env, ref, {
      order_id: String(order.id || ""), def_name: defN,
      amount_paid: cents / 100, paid_at: when
    });

    await alert(env,
      "PAYMENT RECEIVED — " + money(cents) + (who ? " — " + who : "") + (defN ? " for " + defN : ""),
      "Clover has taken a payment.\n\n" +
      "Amount ....... " + money(cents) + "\n" +
      "Paid by ...... " + (who || "(name not on the transaction)") + "\n" +
      "Card ......... " + (ct.cardType || "card") + " ending " + (ct.last4 || "----") + "\n" +
      "Defendant .... " + (defN || "(not on the order note)") + "\n" +
      "Receipt ...... " + ref + "\n" +
      "Taken at ..... " + stamp(when) + "\n" +
      "Clover id .... " + id + "\n\n" +
      "Confirmed with Clover directly, not from the client's browser.\n\n" +
      (row && row.signed_at
        ? "The paperwork on this file is already signed. See READY TO POST."
        : "The paperwork on this file is NOT signed yet. Do not post the bond on a payment alone."));

    announced.push({ id, ref, amount: cents / 100, payer: who, defendant: defN });
    if (row) { try { await env.DB.prepare("UPDATE bond_files SET paid_notified=1 WHERE ref=?").bind(ref).run(); } catch (_) {} }

    await readyCheck(env, ref);
  }

  return j({
    ok: true, hours, examined: payments.length,
    announced: announced.length, alreadyKnown: skipped, declined,
    payments: announced
  });
}

/* ============================================================ */

/* Clover puts the name in different places depending on how the payment was
   taken, so try each rather than assuming the hosted checkout shape. */
function cardholder(ct) {
  const n = ct && (ct.cardholderName || (ct.extra && ct.extra.cardholderName));
  return n ? String(n).trim() : "";
}
function customerName(order) {
  const c = order && order.customers && order.customers.elements && order.customers.elements[0];
  if (!c) return "";
  return [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
}

async function ensure(env) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS clover_payments (" +
    "payment_id TEXT PRIMARY KEY, order_id TEXT, ref TEXT, def_name TEXT, payer TEXT, " +
    "amount_cents INTEGER, last4 TEXT, card_type TEXT, created_at INTEGER, seen_at INTEGER)"
  ).run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS bond_files (" +
    "ref TEXT PRIMARY KEY, def_name TEXT, client_name TEXT, client_email TEXT, " +
    "document_id TEXT, order_id TEXT, premium REAL, amount_paid REAL, " +
    "submitted_at INTEGER, paid_at INTEGER, signed_at INTEGER, " +
    "paid_notified INTEGER DEFAULT 0, signed_notified INTEGER DEFAULT 0, " +
    "ready_notified INTEGER DEFAULT 0, overdue_notified INTEGER DEFAULT 0)"
  ).run();
}

async function markFile(env, ref, fields) {
  if (!ref) return null;
  try {
    await env.DB.prepare("INSERT OR IGNORE INTO bond_files (ref) VALUES (?)").bind(ref).run();
    const keys = Object.keys(fields || {}).filter(k => fields[k] !== undefined && fields[k] !== null && fields[k] !== "");
    if (keys.length) {
      const sets = keys.map(k => /_at$/.test(k) ? (k + "=COALESCE(" + k + ",?)") : (k + "=?")).join(",");
      await env.DB.prepare("UPDATE bond_files SET " + sets + " WHERE ref=?")
        .bind(...keys.map(k => fields[k]), ref).run();
    }
    return await env.DB.prepare("SELECT * FROM bond_files WHERE ref=?").bind(ref).first();
  } catch (_) { return null; }
}

async function readyCheck(env, ref) {
  try {
    const r = await env.DB.prepare("SELECT * FROM bond_files WHERE ref=?").bind(ref).first();
    if (!r || !r.paid_at || !r.signed_at || Number(r.ready_notified) === 1) return;
    await alert(env,
      "READY TO POST — " + (r.def_name || r.client_name || ref),
      "Both halves of this file are in. Payment is confirmed and the paperwork is executed.\n\n" +
      "Defendant ... " + (r.def_name || "(not recorded)") + "\n" +
      "Indemnitor .. " + (r.client_name || r.client_email || "(not recorded)") + "\n" +
      "Receipt ..... " + ref + "\n" +
      "Paid ........ " + usd(r.amount_paid) + " at " + stamp(r.paid_at) + "\n" +
      "Signed ...... " + stamp(r.signed_at) + "\n\n" +
      "Nothing is outstanding on this one.");
    await env.DB.prepare("UPDATE bond_files SET ready_notified=1 WHERE ref=?").bind(ref).run();
    await scheduleReviewAsk(env, r);
  } catch (_) {}
}

function alertTo(env) {
  /* ALERT_SMS_TO is deliberately NOT here. It is a Zapier inbound address
     that turns an email subject into a text, and these emails carry signed
     packets and client photos - oversized inbound mail bounces there and
     the text never arrives. It gets its own small message instead. */
  return [env.AGENCY_BCC || "bailbondreleasecenter@gmail.com"]
    .filter(Boolean).map(s => String(s).trim())
    .filter((v, i, a) => a.indexOf(v) === i);
}

async function alert(env, subject, text) {
  await push(env, subject, text);
  if (!env.RESEND_API_KEY) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.FROM_ADDRESS || "Bail Bond Release Center <onboarding@resend.dev>",
        to: alertTo(env), subject, text
      })
    });
  } catch (_) {}
}

async function push(env, subject, text) {
  await textAlert(env, subject);
  await telegram(env, subject, text);
}

/* A text message, by way of a Zapier inbound address that forwards the
   SUBJECT line to a phone.

   Every text is labelled with the intake it came from, because a phone
   shows a sender and a subject and nothing else - "PAID $500" tells you
   nothing useful at 2am if you cannot tell a bail application from a
   warrant enquiry.

   It is deliberately its own tiny email rather than a copy of the alert.
   The alert emails carry signed packets, court forms, licences and selfies
   - 1.8 MB and up - and oversized inbound mail bounces at Zapier, so the
   text would silently never arrive. That failure mode has already cost
   weeks of submissions on another intake and is not worth repeating.

   Everything that matters therefore has to fit in the subject: carriers
   truncate around 150 characters, so it is clipped here rather than
   arriving cut off mid-word.

   Timed out at three seconds and swallowed on failure: a slow notification
   service must never delay or break the alert it is announcing. */
const ALERT_SOURCE = "PAYMENT";
async function textAlert(env, subject) {
  if (!env.ALERT_SMS_TO) return;
  if (!env.RESEND_API_KEY) return;
  try {
    const line = ("BBRC " + ALERT_SOURCE + ": " + String(subject || "alert"))
      .replace(/\s+/g, " ").slice(0, 150);
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.FROM_ADDRESS || "Bail Bond Release Center <onboarding@resend.dev>",
        to: [String(env.ALERT_SMS_TO).trim()],
        subject: line,
        text: "Full details are in the matching email."
      }),
      signal: AbortSignal.timeout(3000)
    });
  } catch (_) {}
}

async function telegram(env, subject, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  try {
    await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: String(env.TELEGRAM_CHAT_ID),
        text: (subject + "\n\n" + text).slice(0, 4000),
        disable_web_page_preview: true
      })
    });
  } catch (_) {}
}

const stamp = t => t ? new Date(Number(t)).toLocaleString("en-US", { timeZone: "America/New_York" }) : "(unknown)";
const money = c => "$" + ((Number(c) || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd   = v => (v === null || v === undefined || v === "") ? "(amount not recorded)"
  : "$" + (Number(v) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const j = (o, s) => new Response(JSON.stringify(o), {
  status: s || 200,
  headers: { "content-type": "application/json", "cache-control": "no-store" }
});

/* REVIEW REQUEST
   Once a file is READY TO POST (paid and signed), schedule one short
   thank-you email to the co-signer 24 hours later, by which time the
   release has normally happened. It links straight to the Google review
   form, which is what moves the Maps ranking.

   Resend holds the email and sends it at scheduled_at, so this needs no
   cron. It fires once per file because it is only called right after
   ready_notified is set. Set REVIEW_ASK=off to stop it without a deploy,
   and GOOGLE_REVIEW_URL to the profile's own "ask for reviews" link.
   A failure here is swallowed: it must never disturb the bond alerts. */
async function scheduleReviewAsk(env, r) {
  try {
    if (!env.RESEND_API_KEY) return;
    if (String(env.REVIEW_ASK || "on").toLowerCase() === "off") return;
    const to = String(r.client_email || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return;
    const link = env.GOOGLE_REVIEW_URL || "https://www.google.com/maps?cid=12684614689792198908";
    const first = String(r.client_name || "").trim().split(/\s+/)[0] || "";
    const when = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.FROM_ADDRESS || "Bail Bond Release Center <onboarding@resend.dev>",
        to: [to],
        reply_to: env.REPLY_TO || undefined,
        subject: "Thank you from Bail Bond Release Center",
        scheduled_at: when,
        text:
          "Hi" + (first ? " " + first : "") + ",\n\n" +
          "Thank you for trusting Bail Bond Release Center of the Palm Beaches. " +
          "We know this was a hard night, and we hope your family is back together.\n\n" +
          "If we did a good job for you, would you take 30 seconds to leave us a Google review? " +
          "It helps other families find a licensed agent they can trust when they need one.\n\n" +
          link + "\n\n" +
          "If anything was not right, please reply to this email or call 561-833-4388 and tell us directly.\n\n" +
          "Bail Bond Release Center of the Palm Beaches\n" +
          "800 S. Congress Ave., West Palm Beach, FL 33406\n" +
          "561-833-4388 · Florida bail bond license P204302\n\n" +
          "If you would rather not receive emails like this, reply and let us know."
      })
    });
  } catch (_) { /* never break the alert path */ }
}
