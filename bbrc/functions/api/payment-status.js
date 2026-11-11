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
    const newest = good.reduce((a, p) => Math.max(a, Number(p.createdTime) || 0), 0);
    if (!newest || (Date.now() - newest) < NOTIFY_WINDOW_MS) {
      const last = good[good.length - 1] || {};
      const ct = last.cardTransaction || {};
      await notify(env,
        "PAYMENT RECEIVED — " + money(paidCents) + " — Bail Bond Release Center",
        "A Clover payment has been confirmed directly with Clover.\n\n" +
        "Amount:   " + money(paidCents) + "\n" +
        "Card:     " + (ct.cardType || "card") + " ending " + (ct.last4 || "----") + "\n" +
        "Order:    " + raw + "\n" +
        "Note:     " + (order.note || "not recorded") + "\n\n" +
        "Verified against the Clover API, not the client's browser. " +
        "Confirm the amount matches the premium before posting the bond.");
    }
  }

  /* The client gets only what the receipt page needs to render. */
  return j({ ok: true, paid, found: true, amount: paid ? paidCents : 0 });
}

export const onRequestOptions = () => new Response(null, {
  headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }
});

async function notify(env, subject, text) {
  if (!env.RESEND_API_KEY) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.FROM_ADDRESS || "Bail Bond Release Center <onboarding@resend.dev>",
        to: [String(env.AGENCY_BCC || "bailbondreleasecenter@gmail.com").trim()],
        subject, text
      })
    });
  } catch { /* never let a mail failure turn into a 500 for the client */ }
}

function money(c) {
  const n = Number(c);
  return isFinite(n) ? "$" + (n / 100).toFixed(2) : "unknown";
}

const j = (o, s) => new Response(JSON.stringify(o), {
  status: s || 200,
  headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" }
});
