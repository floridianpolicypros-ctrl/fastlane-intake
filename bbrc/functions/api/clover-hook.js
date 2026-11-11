/* ============================================================
   CLOVER WEBHOOK  —  /api/clover-hook
   ------------------------------------------------------------
   WHY THIS EXISTS
   /api/pay creates a Clover checkout session and hands the client
   a URL. That is the last thing our code hears about the money.
   Nothing afterwards tells us whether the card actually cleared,
   so today a client can open checkout, never pay, and still walk
   on to the signing packet. This endpoint is the other half of
   that conversation: Clover tells us the payment happened, and we
   tell the agency, in writing, with the amount and the receipt
   number attached.

   SECURITY — SAME POSTURE AS THE BOLDSIGN HOOK
   The URL is public. If we trusted the body, anyone who found it
   could forge "payment received" and make the agency believe a
   bond was paid for. So:

     1. Every event must carry X-Clover-Auth matching
        CLOVER_WEBHOOK_SECRET. Compared in constant time.
     2. If CLOVER_WEBHOOK_SECRET is missing we refuse everything
        rather than falling back to trusting the caller.
     3. The setup handshake is the one unsigned request we accept,
        and it carries no payment claim — only a code to echo.

   A NOTE ON WHAT THIS DOES NOT DO
   It notifies. It does not yet gate the signing packet, because
   that needs somewhere to persist "receipt R is paid" that both
   this endpoint and /api/esign can read. That is a KV namespace
   and a few lines on each side. Until then, treat the email as
   the record and check it before posting a bond.
   ============================================================ */

export async function onRequestPost(context) {
  const { request, env } = context;

  const raw = await request.text();
  let body = {};
  try { body = JSON.parse(raw); } catch { /* handled below */ }

  /* SETUP HANDSHAKE
     When the webhook URL is first saved, Clover POSTs an unsigned
     body containing a verification code. It has to be read out of
     the dashboard and pasted back, so we mail it rather than
     writing it to a log nobody will open. No payment is claimed
     here, which is why accepting it unsigned is safe. */
  if (body && body.verificationCode) {
    await notify(env,
      "Clover webhook verification code",
      "Clover sent this code to verify the webhook endpoint:\n\n" +
      String(body.verificationCode) +
      "\n\nPaste it into the Clover dashboard to finish setup.");
    return new Response("ok", { status: 200 });
  }

  if (!env.CLOVER_WEBHOOK_SECRET) {
    /* Fail closed. An unauthenticated payment webhook is worse
       than no webhook at all — it invents trust that isn't there. */
    return new Response("Webhook secret not configured", { status: 503 });
  }

  const auth = request.headers.get("x-clover-auth") || "";
  if (!timingSafeEqual(auth, String(env.CLOVER_WEBHOOK_SECRET))) {
    return new Response("Bad signature", { status: 403 });
  }

  /* Clover batches: one request can carry several merchants, each
     with several events. Anything we don't recognise is ignored
     rather than guessed at. */
  const merchants = (body && body.merchants) || {};
  const seen = [];

  for (const mid of Object.keys(merchants)) {
    for (const ev of (merchants[mid] || [])) {
      const type = String(ev.type || "");
      const objectId = String(ev.objectId || "");
      /* Clover prefixes objectId with the object type, e.g.
         "P:ABC123" for a payment, "O:XYZ" for an order. We only
         care about payments and the orders that carry them. */
      if (/^P:/.test(objectId) || /payment/i.test(type)) {
        seen.push({ merchantId: mid, type, objectId });
      }
    }
  }

  if (!seen.length) return new Response("ok", { status: 200 });

  /* Clover's event payload carries identifiers, not amounts. Pull
     the real figures from the API so the agency is told what was
     actually taken, not what a caller claimed. If the lookup fails
     we still notify — a payment we cannot price is far more useful
     to know about than silence. */
  const lines = [];
  for (const s of seen) {
    const paymentId = s.objectId.replace(/^P:/, "");
    const d = await lookupPayment(env, s.merchantId, paymentId);
    if (d && d.ok) {
      lines.push(
        "Amount:   " + money(d.amount) +
        (d.tipAmount ? "  (tip " + money(d.tipAmount) + ")" : "") +
        "\nCard:     " + (d.cardBrand || "card") + " ending " + (d.last4 || "----") +
        "\nResult:   " + (d.result || "unknown") +
        "\nReceipt:  " + (d.note || "not recorded") +
        "\nPayment:  " + paymentId
      );
    } else {
      lines.push(
        "A payment event arrived but the details could not be read back.\n" +
        "Payment:  " + paymentId + "\nMerchant: " + s.merchantId +
        "\nCheck the Clover dashboard directly."
      );
    }
  }

  await notify(env,
    "PAYMENT RECEIVED — Bail Bond Release Center",
    lines.join("\n\n---\n\n") +
    "\n\nThis is an automated confirmation from Clover. " +
    "Confirm the amount matches the premium before posting the bond.");

  return new Response("ok", { status: 200 });
}

/* Clover pings with GET when checking the endpoint is alive. */
export const onRequestGet = () => new Response("ok", { status: 200 });

/* ------------------------------------------------------------ */

async function lookupPayment(env, merchantId, paymentId) {
  if (!env.CLOVER_TOKEN) return null;
  const base = String(env.CLOVER_ENV || "sandbox").toLowerCase() === "production"
    ? "https://api.clover.com"
    : "https://apisandbox.dev.clover.com";
  const mid = merchantId || env.CLOVER_MID;
  if (!mid) return null;
  try {
    const r = await fetch(
      base + "/v3/merchants/" + encodeURIComponent(mid) +
      "/payments/" + encodeURIComponent(paymentId) + "?expand=cardTransaction,order",
      { headers: { Authorization: "Bearer " + env.CLOVER_TOKEN, Accept: "application/json" } });
    if (!r.ok) return null;
    const d = await r.json();
    const ct = d.cardTransaction || {};
    return {
      ok: true,
      amount: d.amount,
      tipAmount: d.tipAmount,
      result: d.result || ct.result,
      cardBrand: ct.cardType,
      last4: ct.last4,
      note: (d.order && d.order.note) || d.note || ""
    };
  } catch { return null; }
}

async function notify(env, subject, text) {
  if (!env.RESEND_API_KEY) return;
  const to = String(env.AGENCY_BCC || "bailbondreleasecenter@gmail.com").trim();
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.FROM_ADDRESS || "Bail Bond Release Center <onboarding@resend.dev>",
        to: [to],
        reply_to: env.REPLY_TO || undefined,
        subject,
        text
      })
    });
  } catch { /* a failed notification must never 500 the webhook —
                Clover would retry and we would mail twice */ }
}

function money(cents) {
  const n = Number(cents);
  if (!isFinite(n)) return "unknown";
  return "$" + (n / 100).toFixed(2);
}

/* Constant-time compare. A length-dependent early return would leak
   the secret one character at a time to anyone willing to measure. */
function timingSafeEqual(a, b) {
  const A = String(a), B = String(b);
  if (A.length !== B.length) return false;
  let diff = 0;
  for (let i = 0; i < A.length; i++) diff |= A.charCodeAt(i) ^ B.charCodeAt(i);
  return diff === 0;
}
