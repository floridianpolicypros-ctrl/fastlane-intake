/* ============================================================
   PAYMENT VERIFICATION  —  /api/payment-status
   ------------------------------------------------------------
   WHY THIS EXISTS
   /api/pay hands the client a Clover checkout URL and that is the
   last our code hears about the money. Clover then bounces the
   client back to SUCCESS_URL with an order id in the query string.

   The trap is treating that redirect as proof of payment. It is
   not. Anyone can type /paid?orderId=anything into a browser. A
   query parameter is a claim, not evidence.

   So this endpoint ignores what the browser says happened and
   asks Clover what actually happened, using the merchant token
   already configured for /api/pay. Clover is the only party that
   knows whether the card cleared, so Clover is the only party we
   believe.

   WHY NOT A WEBHOOK
   Clover webhooks require a developer App installed on the
   merchant account. This agency runs on a merchant API token with
   the hosted Invoicing Checkout Service, which does not expose
   merchant webhooks. /api/clover-hook is in place for the day an
   App exists; until then this is the path that actually works.

   WHAT IT DELIBERATELY DOES NOT DO
   It does not tell the browser anything the browser could use to
   fake a result elsewhere, and it does not return card data
   beyond the last four digits, which keeps this out of PCI scope.

   KNOWN LIMITATION, STATED PLAINLY
   There is no storage bound to this project, so "already
   notified" cannot be recorded. A client who reloads the receipt
   page inside the notification window will generate a second
   email for the same payment. Duplicate emails are a nuisance;
   a missed payment is a loss, so the trade is made deliberately
   in that direction. A KV namespace would fix it properly and is
   a few lines on either side.
   ============================================================ */

const NOTIFY_WINDOW_MS = 2 * 60 * 60 * 1000;   // only mail on recent payments

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.CLOVER_TOKEN || !env.CLOVER_MID) {
    return j({ ok: false, error: "Payments are not configured" }, 503);
  }

  let b; try { b = await request.json(); } catch { return j({ ok: false, error: "Bad JSON" }, 400); }

  /* Accept whichever identifier Clover appended, but never trust its
     shape — a crafted id must not be able to steer the API path. */
  const raw = String(b.orderId || b.checkoutSessionId || b.id || "").trim();
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(raw)) {
    return j({ ok: false, error: "A valid order reference is required" }, 400);
  }

  const base = String(env.CLOVER_ENV || "sandbox").toLowerCase() === "production"
    ? "https://api.clover.com"
    : "https://apisandbox.dev.clover.com";

  let order;
  try {
    const r = await fetch(
      base + "/v3/merchants/" + encodeURIComponent(env.CLOVER_MID) +
      "/orders/" + encodeURIComponent(raw) + "?expand=payments",
      { headers: { Authorization: "Bearer " + env.CLOVER_TOKEN, Accept: "application/json" } });
    if (r.status === 404) return j({ ok: true, paid: false, found: false });
    if (!r.ok) return j({ ok: false, error: "Could not reach Clover" }, 502);
    order = await r.json();
  } catch {
    return j({ ok: false, error: "Could not reach Clover" }, 502);
  }

  const payments = (order && order.payments && order.payments.elements) || [];
  /* Only payments Clover itself marks successful count. A payment
     row exists for declines too, and treating one as settled money
     is exactly the mistake this endpoint is here to prevent. */
  const good = payments.filter(p => {
    const res = String((p && p.result) || "").toUpperCase();
    return res === "SUCCESS" || res === "APPROVED";
  });

  const paidCents = good.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const paid = paidCents > 0;

  if (paid) {
    /* The Clover order note is written by /api/pay as
         "Receipt <no> | Defendant: <name>"
       which makes it the only place the receipt number and the money
       meet. Parsing it is how a payment gets joined to the paperwork
       half of the same file. */
    const note = String(order.note || "");
    const m    = /Receipt\s+([^|]+?)\s*(?:\||$)/.exec(note);
    const dm   = /Defendant:\s*(.+)$/.exec(note);
    const ref  = (m ? m[1].trim() : "") || ("clover-" + raw);
    const defN = dm ? dm[1].trim() : "";
    const last = good[good.length - 1] || {};
    const ct   = last.cardTransaction || {};
    const newest = good.reduce((acc, q) => Math.max(acc, Number(q.createdTime) || 0), 0);

    const row = await markFile(env, ref, {
      order_id: raw, def_name: defN,
      amount_paid: paidCents / 100,
      paid_at: newest || Date.now()
    });

    /* The old version used a two-hour window to avoid mailing twice,
       because there was nowhere to record that it had already mailed.
       There is now - the flag on the row. A client reloading the receipt
       page next week no longer generates a second payment alert, and a
       payment confirmed later than two hours is no longer silently
       unreported. The window survives only as a fallback for when the
       database is unreachable, where mailing twice beats not mailing. */
    const alreadyTold    = row ? Number(row.paid_notified) === 1 : false;
    const fallbackWindow = !row && (!newest || (Date.now() - newest) < NOTIFY_WINDOW_MS);

    if (!alreadyTold && (row || fallbackWindow)) {
      await notify(env,
        "PAYMENT VERIFIED \u2014 " + money(paidCents) + (defN ? " \u2014 " + defN : ""),
        "A Clover payment has been confirmed directly with Clover.\n\n" +
        "Amount:    " + money(paidCents) + "\n" +
        "Card:      " + (ct.cardType || "card") + " ending " + (ct.last4 || "----") + "\n" +
        "Defendant: " + (defN || "not recorded") + "\n" +
        "Receipt:   " + ref + "\n" +
        "Order:     " + raw + "\n\n" +
        "Verified against the Clover API, not the client's browser. " +
        "Confirm the amount matches the premium before posting the bond.\n\n" +
        (row && row.signed_at
          ? "The paperwork on this file is already signed. See READY TO POST."
          : "The paperwork on this file is NOT signed yet. Do not post the bond on a payment alone."));
      if (row) { try { await env.DB.prepare("UPDATE bond_files SET paid_notified=1 WHERE ref=?").bind(ref).run(); } catch (_) {} }
    }

    await readyCheck(env, ref);
  }

  /* The client gets only what the receipt page needs to render. */
  return j({ ok: true, paid, found: true, amount: paid ? paidCents : 0 });
}

export const onRequestOptions = () => new Response(null, {
  headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }
});

async function notify(env, subject, text) {
  /* Telegram first: it is the copy that actually wakes someone, and it
     must not be lost if Resend is unconfigured or down. */
  await push(env, subject, text);
  if (!env.RESEND_API_KEY) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.FROM_ADDRESS || "Bail Bond Release Center <onboarding@resend.dev>",
        to: alertTo(env),
        subject, text
      })
    });
  } catch { /* never let a mail failure turn into a 500 for the client */ }
}

/* ============================================================
   FILE STATE  —  shared with /api/esign-hook
   ------------------------------------------------------------
   Payment and signatures arrive from two systems that know nothing
   about each other. The bond_files row holds the two halves of one
   file and lets either side ask whether the other has landed. The
   receipt number is the join key: /api/pay writes it into the Clover
   order note and /api/esign passes it to BoldSign as the label.

   The schema is created here as well as in the webhook on purpose.
   Either endpoint can be the first to ever run on a fresh deployment,
   and CREATE TABLE IF NOT EXISTS costs nothing when it is already
   there - whereas a missing table at 2am costs an alert.
   ============================================================ */

async function ensureFiles(env) {
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
  if (!env.DB) return null;
  if (!ref) return null;
  try {
    await ensureFiles(env);
    await env.DB.prepare("INSERT OR IGNORE INTO bond_files (ref) VALUES (?)").bind(ref).run();
    const keys = Object.keys(fields || {}).filter(k => fields[k] !== undefined && fields[k] !== null && fields[k] !== "");
    if (keys.length) {
      /* COALESCE on timestamps: the first time something happened is the
         true time it happened, and a reloaded receipt page must not move
         it forward. */
      const sets = keys.map(k => /_at$/.test(k) ? (k + "=COALESCE(" + k + ",?)") : (k + "=?")).join(",");
      await env.DB.prepare("UPDATE bond_files SET " + sets + " WHERE ref=?")
        .bind(...keys.map(k => fields[k]), ref).run();
    }
    return await env.DB.prepare("SELECT * FROM bond_files WHERE ref=?").bind(ref).first();
  } catch (_) { return null; }
}

/* The only alert that answers the question actually being asked at 2am:
   is this one safe to post. Fires once, when both halves are in. */
async function readyCheck(env, ref) {
  if (!env.DB) return;
  if (!ref) return;
  try {
    const r = await env.DB.prepare("SELECT * FROM bond_files WHERE ref=?").bind(ref).first();
    if (!r) return;
    if (!r.paid_at) return;
    if (!r.signed_at) return;
    if (Number(r.ready_notified) === 1) return;

    await notify(env,
      "READY TO POST \u2014 " + (r.def_name || r.client_name || ref),
      "Both halves of this file are in. Payment is confirmed and the paperwork is executed.\n\n" +
      "Defendant ... " + (r.def_name || "(not recorded)") + "\n" +
      "Indemnitor .. " + (r.client_name || r.client_email || "(not recorded)") + "\n" +
      "Receipt ..... " + ref + "\n" +
      "Paid ........ " + usd(r.amount_paid) + " at " + stamp(r.paid_at) + "\n" +
      "Signed ...... " + stamp(r.signed_at) + "\n\n" +
      "Nothing is outstanding on this one.");
    await env.DB.prepare("UPDATE bond_files SET ready_notified=1 WHERE ref=?").bind(ref).run();
  } catch (_) {}
}

function alertTo(env) {
  return [env.AGENCY_BCC || "bailbondreleasecenter@gmail.com", env.ALERT_SMS_TO]
    .filter(Boolean).map(s => String(s).trim())
    .filter((v, i, a) => a.indexOf(v) === i);
}

/* Telegram. Goes quiet if either variable is unset rather than erroring,
   so a half-finished setup costs nothing. */
async function push(env, subject, text) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  if (!env.TELEGRAM_CHAT_ID) return;
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
const usd = v => (v === null || v === undefined || v === "") ? "(amount not recorded)"
  : "$" + (Number(v) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function money(c) {
  const n = Number(c);
  return isFinite(n) ? "$" + (n / 100).toFixed(2) : "unknown";
}

const j = (o, s) => new Response(JSON.stringify(o), {
  status: s || 200,
  headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" }
});
