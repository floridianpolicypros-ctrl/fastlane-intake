/* ============================================================
   EMAIL VERIFICATION CODE
   ------------------------------------------------------------
   Proves the client actually controls the inbox they typed —
   a wrong email means the signed packet goes nowhere, and a
   fake one is a collection problem later.

   The code is generated and checked SERVER SIDE and stored in
   D1. Doing it in the browser would put the correct code in
   the page, where anyone could read it and "verify" an address
   they do not own, which defeats the point entirely.

   Table (created on first use):
     verify_codes(email TEXT PRIMARY KEY, code TEXT,
                  expires INTEGER, tries INTEGER)

   POST { action:"send",   email }        -> { ok:true }
   POST { action:"check",  email, code }  -> { ok:true, verified:true|false }
   ============================================================ */

const TTL_MS    = 10 * 60 * 1000;   // codes die after 10 minutes
const MAX_TRIES = 6;                // then the code is burned

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return j({ ok: false, error: "D1 binding 'DB' not configured" });

  let b; try { b = await request.json(); } catch { return j({ ok: false, error: "Bad JSON" }); }

  const email = String(b.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return j({ ok: false, error: "Enter a valid email address" });

  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS verify_codes (email TEXT PRIMARY KEY, code TEXT, expires INTEGER, tries INTEGER)"
  ).run();

  /* ---------- send ---------- */
  if (b.action === "send") {
    if (!env.RESEND_API_KEY) return j({ ok: false, error: "Email is not configured yet" });

    // Cryptographically random, not Math.random()
    const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
    const code = String(n).padStart(6, "0");

    await env.DB.prepare(
      "INSERT INTO verify_codes (email,code,expires,tries) VALUES (?,?,?,0) " +
      "ON CONFLICT(email) DO UPDATE SET code=excluded.code, expires=excluded.expires, tries=0"
    ).bind(email, code, Date.now() + TTL_MS).run();

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.FROM_ADDRESS || "Bail Bond Release Center <onboarding@resend.dev>",
        to: [email],
        reply_to: env.REPLY_TO || undefined,
        subject: code + " is your Bail Bond Release Center code",
        text: "Your verification code is " + code + "\n\n"
            + "Enter it on the bail application to confirm this email address.\n"
            + "It expires in 10 minutes. If you did not request this, ignore this email."
      })
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      return j({ ok: false, error: d.message || "Could not send the code" });
    }
    return j({ ok: true });
  }

  /* ---------- check ---------- */
  if (b.action === "check") {
    const code = String(b.code || "").replace(/\D/g, "");
    const row = await env.DB.prepare("SELECT code,expires,tries FROM verify_codes WHERE email=?")
      .bind(email).first();

    if (!row) return j({ ok: true, verified: false, error: "Send yourself a code first" });
    if (Date.now() > Number(row.expires)) return j({ ok: true, verified: false, error: "That code expired — send a new one" });
    if (Number(row.tries) >= MAX_TRIES)   return j({ ok: true, verified: false, error: "Too many attempts — send a new code" });

    await env.DB.prepare("UPDATE verify_codes SET tries=tries+1 WHERE email=?").bind(email).run();

    if (code && code === String(row.code)) {
      await env.DB.prepare("DELETE FROM verify_codes WHERE email=?").bind(email).run();

      /* Record that this address proved inbox control, and when.
         /api/esign refuses to hand out an embedded signing link to a
         contact with no verification on file — BoldSign's audit trail
         records only that an embedded link was used, not who used it,
         so this row IS our proof of identity for that signature. */
      await env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS verified_contacts (contact TEXT PRIMARY KEY, method TEXT, verified_at INTEGER, ip TEXT)"
      ).run();
      await env.DB.prepare(
        "INSERT INTO verified_contacts (contact,method,verified_at,ip) VALUES (?,?,?,?) " +
        "ON CONFLICT(contact) DO UPDATE SET method=excluded.method, verified_at=excluded.verified_at, ip=excluded.ip"
      ).bind(email, "email-code", Date.now(), request.headers.get("CF-Connecting-IP") || "").run();

      return j({ ok: true, verified: true });
    }
    return j({ ok: true, verified: false, error: "That code doesn't match" });
  }

  return j({ ok: false, error: "Unknown action" });
}

export const onRequestOptions = () => new Response(null, {
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  }
});

const j = o => new Response(JSON.stringify(o), {
  headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" }
});
