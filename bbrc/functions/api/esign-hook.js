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
  if (eventType === "Completed") {
    context.waitUntil(deliverSigned(env, documentId, signer.signerEmail || "", receiptNo));
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
async function deliverSigned(env, documentId, signerEmail, receiptNo) {
  try {
    const r = await fetch(API + "/v1/document/download?documentId=" + encodeURIComponent(documentId),
      { headers: { "X-API-KEY": env.BOLDSIGN_KEY } });
    if (!r.ok) { await log(env, { documentId, eventType: "DownloadFailed", receiptNo, email: signerEmail, status: String(r.status), environment: "" }); return; }

    const b64 = toBase64(new Uint8Array(await r.arrayBuffer()));
    const to  = [signerEmail, env.AGENCY_BCC || "bailbondreleasecenter@gmail.com"]
                  .filter(Boolean)
                  .filter((v, i, a) => a.indexOf(v) === i);   // BoldSign rejects dupes; so does common sense

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

/* btoa() on a multi-megabyte string overflows the stack. Chunk it. */
function toBase64(bytes) {
  let s = ""; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
