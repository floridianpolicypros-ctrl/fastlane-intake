/* ============================================================
   BOLDSIGN WEBHOOK
   ------------------------------------------------------------
   This is the piece that closes the loop. Without it /api/esign
   only ever reports "accepted" — nobody learns the envelope was
   delivered, and the executed PDF sits in BoldSign until someone
   remembers to log in and fetch it. Florida requires the client
   to hold a copy of what they signed, so "someone remembers" is
   not an acceptable delivery mechanism.

   Handles: Sent · SendFailed · Completed · Declined

   SECURITY — WHY THIS ENDPOINT IS PARANOID
   The URL is public. Anyone who finds it can POST to it. If we
   trusted the body, a stranger could forge a "Completed" event
   and make the system believe an unsigned bail packet was
   executed. So:

     1. Every request must carry a valid HMAC-SHA256 signature in
        X-BoldSign-Signature, computed over "<timestamp>.<rawBody>"
        with the endpoint's signing secret.
     2. Signatures are compared in constant time.
     3. Events older than 5 minutes are rejected, so a captured
        request cannot be replayed later.
     4. If BOLDSIGN_WEBHOOK_SECRET is missing we refuse everything
        rather than falling back to trusting the caller.

   The raw body must be hashed exactly as received. Parsing to
   JSON and re-stringifying changes whitespace and breaks the
   signature, so we read text() first and only parse afterwards.
   ============================================================ */

const API       = "https://api.boldsign.com";
const TOLERANCE = 300;                  // seconds; matches BoldSign's guidance

export async function onRequestPost(context) {
  const { request, env } = context;

  /* BoldSign pings the endpoint once when you save it in the dashboard.
     That ping carries no signature, so it has to be answered before any
     verification runs or the endpoint can never be registered. */
  if (request.headers.get("x-boldsign-event") === "Verification") {
    return new Response("ok", { status: 200 });
  }

  if (!env.BOLDSIGN_WEBHOOK_SECRET) {
    /* Fail closed. An unauthenticated webhook is worse than none. */
    return new Response("Webhook secret not configured", { status: 503 });
  }

  const raw = await request.text();
  const sigHeader = request.headers.get("x-boldsign-signature") || "";

  const check = await verify(raw, sigHeader, env.BOLDSIGN_WEBHOOK_SECRET);
  if (!check.ok) return new Response(check.why, { status: 403 });

  let body = {};
  try { body = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }

  const ev        = body.event || {};
  const data      = body.data  || {};
  const eventType = String(ev.eventType || "");
  const documentId = data.documentId || "";
  const signer    = (data.signerDetails && data.signerDetails[0]) || {};
  const receiptNo = (data.labels && data.labels[0]) || "";

  await log(env, { documentId, eventType, receiptNo,
                   email: signer.signerEmail || "", status: data.status || "",
                   environment: ev.environment || "" });

  /* Answer BoldSign immediately. Downloading a 2 MB packet and emailing
     it takes seconds, and a slow webhook gets retried or marked failed —
     so the heavy work runs after the response goes out. */
  /* The packet going out starts the clock on "paperwork not done".
     Recording it here, rather than at submission, means a row exists for
     exactly the files that are actually waiting on a signature - which is
     what the overdue chaser looks for. */
  if (eventType === "Sent") {
    context.waitUntil(markFile(env, receiptNo || documentId,
      { document_id: documentId, client_email: signer.signerEmail || "", submitted_at: Date.now() }));
  }

  if (eventType === "Completed") {
    context.waitUntil(deliverSigned(env, documentId, signer.signerEmail || "", receiptNo, new URL(request.url).origin));
    context.waitUntil(onSigned(env, documentId, receiptNo, signer.signerEmail || "",
                               signer.signerName || ""));
  }

  if (eventType === "SendFailed" || eventType === "Declined") {
    context.waitUntil(alertAgency(env, eventType, documentId, receiptNo, signer.signerEmail || "",
                                  data.errorMessage || data.declineMessage || ""));
  }

  return new Response("ok", { status: 200 });
}

/* BoldSign only ever POSTs. Answer GET so a human can confirm the route
   exists without seeing a Cloudflare 404 and assuming it wasn't deployed. */
export const onRequestGet = () =>
  new Response(JSON.stringify({ ok: true, endpoint: "esign-hook", note: "POST only; BoldSign delivers events here." }),
    { headers: { "content-type": "application/json" } });

/* ============================================================
   Signature verification
   ============================================================ */

async function verify(raw, header, secret) {
  if (!header) return { ok: false, why: "Missing signature header" };

  let t = -1; const sigs = [];
  for (const part of header.split(",")) {
    const [k, v] = part.trim().split("=");
    if (k === "t") t = parseInt(v, 10);
    else if (k === "s0" || k === "s1") sigs.push(v);
  }
  if (t < 0)        return { ok: false, why: "No timestamp in signature header" };
  if (!sigs.length) return { ok: false, why: "No signatures in header" };

  /* Replay window. A signature stays valid forever otherwise. */
  const age = Math.floor(Date.now() / 1000) - t;
  if (age > TOLERANCE) return { ok: false, why: "Event outside tolerance window" };

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(t + "." + raw));
  const expected = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, "0")).join("");

  /* s1 appears while a rolled secret is still inside its grace period,
     so any match is acceptable — but each comparison is constant time. */
  for (const s of sigs) if (constantTimeEqual(expected, s)) return { ok: true };
  return { ok: false, why: "Signature mismatch" };
}

/* Comparing with === leaks how many characters matched via timing. */
function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ============================================================
   Side effects
   ============================================================ */

async function log(env, row) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS esign_events (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id TEXT, " +
      "event_type TEXT, receipt_no TEXT, email TEXT, status TEXT, environment TEXT, at INTEGER)"
    ).run();
    await env.DB.prepare(
      "INSERT INTO esign_events (document_id,event_type,receipt_no,email,status,environment,at) VALUES (?,?,?,?,?,?,?)"
    ).bind(row.documentId, row.eventType, row.receiptNo, row.email, row.status, row.environment, Date.now()).run();
  } catch (_) { /* logging must never break event handling */ }
}

/* The executed packet goes to the client and to the agency automatically.
   This is the Florida requirement — a copy of what they actually signed,
   not a summary of it. */
async function deliverSigned(env, documentId, signerEmail, receiptNo, origin) {
  /* Reconcile with Clover first, so the packet email reports the money as it
     stands right now rather than as it stood whenever something last looked.
     Clover has no webhooks on this account, so the only way to know a payment
     happened is to ask - and the moment somebody signs is exactly when the
     answer matters. Failure is ignored on purpose: a slow or unreachable
     Clover must never stop the executed packet going out. */
  if (origin) {
    try { await fetch(origin + "/api/clover-sweep?hours=24"); } catch (_) {}
  }
  try {
    const r = await fetch(API + "/v1/document/download?documentId=" + encodeURIComponent(documentId),
      { headers: { "X-API-KEY": env.BOLDSIGN_KEY } });
    if (!r.ok) { await log(env, { documentId, eventType: "DownloadFailed", receiptNo, email: signerEmail, status: String(r.status), environment: "" }); return; }

    const b64 = toBase64(new Uint8Array(await r.arrayBuffer()));

    /* The defendant's name is not on the webhook payload, but it IS on the
       document title, which /api/esign builds as "<packet label> — <defendant>".
       Pulling it back out is cheaper and more reliable than threading it
       through BoldSign's metadata, and if the lookup fails we fall back to
       the signer rather than losing the email. */
    let defName = "";
    try {
      const pr = await fetch(API + "/v1/document/properties?documentId=" + encodeURIComponent(documentId),
        { headers: { "X-API-KEY": env.BOLDSIGN_KEY } });
      if (pr.ok) {
        const pd = await pr.json();
        const title = String((pd && pd.messageTitle) || (pd && pd.documentTitle) || "");
        const parts = title.split("\u2014");
        if (parts.length > 1) defName = parts[parts.length - 1].trim();
      }
    } catch (_) {}

    /* The agency copy is a separate email on purpose. Carlos was logging into
       BoldSign to fetch the packet for printing, which is an extra step on
       every single bond. The subject now says whose it is and what to do with
       it, so it is findable in a search and actionable from the inbox. */
    const agency = (env.AGENCY_BCC || "bailbondreleasecenter@gmail.com").trim();

    /* Carlos asked for one email that shows the whole file rather than two
       that each show half. The payment lives on the bond_files row, put
       there either by the receipt page or by the Clover sweep, and the
       payer's name on the clover_payments row. If neither is there yet the
       email says so plainly - a packet that is silent about payment reads
       as paid, which is the assumption that gets a bond posted for free. */
    const pay = await paymentFor(env, receiptNo);
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: env.FROM_ADDRESS || "Bail Bond Release Center <onboarding@resend.dev>",
          to: [agency],
          subject: (defName || signerEmail || receiptNo || "Bail bond") + " indemnitor paperwork to print"
                   + (pay.paid ? " \u2014 PAID " + pay.amount : " \u2014 PAYMENT NOT CONFIRMED"),
          text: "The signed indemnitor packet is attached, ready to print.\n\n"
              + "Defendant .. " + (defName || "(not on the document title)") + "\n"
              + "Signer ..... " + (signerEmail || "(unknown)") + "\n"
              + "Receipt .... " + (receiptNo || "(none)") + "\n"
              + "Signed ..... " + stamp(Date.now()) + "\n\n"
              + "PAYMENT\n" + pay.block + "\n\n"
              + (pay.paid
                  ? "Both halves of this file are in. Nothing is outstanding.\n\n"
                  : "No payment is confirmed against this file. Do not post the bond on signatures alone - check Clover, or the Zelle, Cash App or cash it was written against.\n\n")
              + "Document ... " + documentId + "\n"
              + "No need to log into BoldSign for this one.",
          attachments: [{ filename: (defName ? defName.replace(/[^A-Za-z0-9]+/g, "-") : "Signed")
              + "-indemnitor-packet" + (receiptNo ? "-" + receiptNo : "") + ".pdf", content: b64 }]
        })
      });
    } catch (_) { /* the client copy must still go out */ }

    const to  = [signerEmail].filter(Boolean);
    if (!to.length) return;   // client copy only; the agency already has it

    const send = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.FROM_ADDRESS || "Bail Bond Release Center <onboarding@resend.dev>",
        to,
        reply_to: env.REPLY_TO || undefined,
        subject: "Your signed bail bond packet" + (receiptNo ? " — " + receiptNo : ""),
        text: "Attached is the complete bail bond packet you signed, including every page and your signature.\n\n"
            + "Keep this for your records.\n\n"
            + "Bail Bond Release Center of the Palm Beaches\n"
            + "800 S. Congress Ave, West Palm Beach, FL 33406\n"
            + "(561) 833-4388\n"
            + "Carlos Sevilla · FL Bail Agent Lic. #P204302",
        attachments: [{ filename: "Signed-Bail-Packet" + (receiptNo ? "-" + receiptNo : "") + ".pdf", content: b64 }]
      })
    });
    await log(env, { documentId, eventType: send.ok ? "DeliveredToClient" : "DeliveryFailed",
                     receiptNo, email: signerEmail, status: String(send.status), environment: "" });
  } catch (_) {
    await log(env, { documentId, eventType: "DeliveryError", receiptNo, email: signerEmail, status: "", environment: "" });
  }
}

/* A declined or undeliverable packet means a bond that is not papered.
   Carlos needs to hear about that without watching a dashboard. */
async function alertAgency(env, eventType, documentId, receiptNo, email, message) {
  await push(env, "[ACTION NEEDED] Packet " + eventType + (receiptNo ? " - " + receiptNo : ""),
    "Signer: " + (email || "unknown") + "\nDetail: " + (message || "none") +
    "\n\nThe packet was NOT executed. Follow up before the bond is posted.");
  if (!env.RESEND_API_KEY) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.FROM_ADDRESS || "Bail Bond Release Center <onboarding@resend.dev>",
        to: [env.AGENCY_BCC || "bailbondreleasecenter@gmail.com"],
        subject: "[ACTION NEEDED] Packet " + eventType + (receiptNo ? " — " + receiptNo : ""),
        text: "Event: " + eventType + "\nDocument: " + documentId + "\nReceipt: " + (receiptNo || "(none)")
            + "\nSigner: " + (email || "(unknown)") + "\nDetail: " + (message || "(none)")
            + "\n\nThe packet was NOT executed. Follow up before the bond is posted."
      })
    });
  } catch (_) {}
}

/* What do we know about the money on this file? Returns a block of text
   for the email and a flag, never throws - a missing table or an
   unreachable database must not stop the packet being delivered. */
async function paymentFor(env, receiptNo) {
  const none = { paid: false, amount: "", block: "  Not confirmed. Nothing has been recorded against this receipt." };
  if (!env.DB || !receiptNo) return none;
  try {
    const f = await env.DB.prepare("SELECT amount_paid, paid_at FROM bond_files WHERE ref=?").bind(receiptNo).first();
    if (!f || !f.paid_at) return none;
    const c = await env.DB.prepare(
      "SELECT payer, last4, card_type, amount_cents FROM clover_payments WHERE ref=? ORDER BY created_at DESC LIMIT 1"
    ).bind(receiptNo).first().catch(() => null);
    const amount = money(f.amount_paid);
    return {
      paid: true, amount,
      block: "  Amount ..... " + amount + "\n" +
             "  Paid by .... " + ((c && c.payer) || "(name not on the transaction)") + "\n" +
             "  Card ....... " + ((c && c.card_type) ? (c.card_type + " ending " + (c.last4 || "----")) : "(not a card, or not recorded)") + "\n" +
             "  Taken at ... " + stamp(f.paid_at)
    };
  } catch (_) { return none; }
}


/* btoa() on a multi-megabyte string overflows the stack. Chunk it. */
function toBase64(bytes) {
  let s = ""; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}

/* ============================================================
   FILE STATE  —  who paid, who signed, what is safe to post
   ------------------------------------------------------------
   Payment and signatures arrive from two systems that know nothing
   about each other. Clover can confirm a card cleared while the
   packet sits unsigned. BoldSign can report an executed packet on a
   bond nobody paid for. Posting safely needs BOTH, so something has
   to hold the two halves and say when they finally meet. That is
   this table.

   The receipt number is the join key, because it is the one string
   that reaches both systems: /api/pay writes it into the Clover
   order note and /api/esign passes it to BoldSign as the document
   label. A file with no receipt number is tracked under its document
   id - imperfect, but better than losing it.

   Every write is best effort and every alert fires at most once,
   tracked by a flag on the row. A duplicate alert is a nuisance; a
   missed one is a bond posted on unsigned paper. The trade is made
   deliberately in that direction, and the flags mean it is rarely
   collected.
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

/* Upsert by hand rather than with ON CONFLICT so the column list stays
   obvious and a new field is one line, not a rewritten statement. */
async function markFile(env, ref, fields) {
  if (!env.DB) return null;
  if (!ref) return null;
  try {
    await ensureFiles(env);
    await env.DB.prepare("INSERT OR IGNORE INTO bond_files (ref) VALUES (?)").bind(ref).run();
    const keys = Object.keys(fields || {}).filter(k => fields[k] !== undefined && fields[k] !== null && fields[k] !== "");
    if (keys.length) {
      /* COALESCE on timestamps: the first time something happened is the
         true time it happened, and a retried webhook must not move it. */
      const sets = keys.map(k => /_at$/.test(k) ? (k + "=COALESCE(" + k + ",?)") : (k + "=?")).join(",");
      await env.DB.prepare("UPDATE bond_files SET " + sets + " WHERE ref=?")
        .bind(...keys.map(k => fields[k]), ref).run();
    }
    return await env.DB.prepare("SELECT * FROM bond_files WHERE ref=?").bind(ref).first();
  } catch (_) { return null; }
}

/* Paperwork is done. Two things follow: tell Carlos in plain language,
   and check whether this was the second of the two halves. */
async function onSigned(env, documentId, receiptNo, email, name) {
  const ref = receiptNo || documentId;
  const row = await markFile(env, ref,
    { document_id: documentId, client_email: email, client_name: name, signed_at: Date.now() });

  if (!row || Number(row.signed_notified) !== 1) {
    await alert(env,
      "PAPERWORK SIGNED \u2014 " + (name || email || ref),
      "The bail packet has been signed and executed in full.\n\n" +
      "Signer ...... " + (name || "(name not reported)") + "\n" +
      "Email ....... " + (email || "(unknown)") + "\n" +
      "Receipt ..... " + (receiptNo || "(none)") + "\n" +
      "Signed ...... " + stamp(Date.now()) + "\n\n" +
      "The executed PDF is on its way to you and to the client separately.\n\n" +
      (row && row.paid_at
        ? "Payment on this file was confirmed at " + stamp(row.paid_at) + ". See READY TO POST."
        : "NOTE: no confirmed payment is recorded against this file yet. Do not post the bond on signatures alone - check Clover, or the Zelle/Cash App/cash it was written against."));
    if (row) { try { await env.DB.prepare("UPDATE bond_files SET signed_notified=1 WHERE ref=?").bind(ref).run(); } catch (_) {} }
  }

  await readyCheck(env, ref);
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

    await alert(env,
      "READY TO POST \u2014 " + (r.def_name || r.client_name || ref),
      "Both halves of this file are in. Payment is confirmed and the paperwork is executed.\n\n" +
      "Defendant ... " + (r.def_name || "(not recorded)") + "\n" +
      "Indemnitor .. " + (r.client_name || r.client_email || "(not recorded)") + "\n" +
      "Receipt ..... " + ref + "\n" +
      "Paid ........ " + money(r.amount_paid) + " at " + stamp(r.paid_at) + "\n" +
      "Signed ...... " + stamp(r.signed_at) + "\n\n" +
      "Nothing is outstanding on this one.");
    await env.DB.prepare("UPDATE bond_files SET ready_notified=1 WHERE ref=?").bind(ref).run();
  } catch (_) {}
}

/* Email and phone, independently. Email is the record and the thing that
   survives; the Telegram push is what actually wakes someone. Neither is
   allowed to fail the other, and neither is allowed to throw. */
async function alert(env, subject, text) {
  await push(env, subject, text);
  await mail(env, alertTo(env), subject, text);
}

/* One place decides who hears about anything, so an address added here
   reaches every alert in the project. ALERT_SMS_TO is a carrier
   email-to-SMS gateway address - carriers throttle and silently drop
   those, so it is a convenience copy, not the record. */
function alertTo(env) {
  /* ALERT_SMS_TO is deliberately NOT here. It is a Zapier inbound address
     that turns an email subject into a text, and these emails carry signed
     packets and client photos - oversized inbound mail bounces there and
     the text never arrives. It gets its own small message instead. */
  return [env.AGENCY_BCC || "bailbondreleasecenter@gmail.com"]
    .filter(Boolean).map(s => String(s).trim())
    .filter((v, i, a) => a.indexOf(v) === i);
}

/* Telegram. Goes quiet if either variable is unset rather than erroring,
   so a half-finished setup costs nothing. Telegram caps a message at
   4096 characters, hence the slice. */
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
const ALERT_SOURCE = "INDEM APP";
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

async function mail(env, to, subject, text) {
  if (!env.RESEND_API_KEY) return;
  if (!to) return;
  if (!to.length) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.FROM_ADDRESS || "Bail Bond Release Center <onboarding@resend.dev>",
        to, subject, text
      })
    });
  } catch (_) { /* an alert that fails must never break event handling */ }
}

const stamp = t => t ? new Date(Number(t)).toLocaleString("en-US", { timeZone: "America/New_York" }) : "(unknown)";
const money = v => (v === null || v === undefined || v === "") ? "(amount not recorded)"
  : "$" + (Number(v) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
