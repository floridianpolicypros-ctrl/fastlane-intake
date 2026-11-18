/* ============================================================
   INVITE VALIDATION  —  /api/invite-check
   ------------------------------------------------------------
   The intake form asks this endpoint whether the ?inv= token in the
   URL is a real, live invite issued by the office. The form itself
   decides nothing: it starts locked to premium-in-full, and only a
   positive answer here unlocks the exception.

   Everything about this endpoint fails closed. A token that is
   missing, malformed, unknown, expired, or cancelled produces the
   same flat negative, and the form then behaves like any other
   public application. That matters more than it looks: the whole
   point is that a client cannot grant themselves a payment plan,
   or a "no payment needed" link, by editing a URL.

   WHAT IT RETURNS, AND WHAT IT DELIBERATELY DOES NOT

   It returns the terms the office authorized and the fields the
   office already typed, so the client is not retyping their own
   name. It does not return the issuing passcode, other invites, or
   anything about any other file — a leaked link must expose exactly
   one client's own terms and nothing else.

   WHY REPEAT CHECKS ARE ALLOWED

   People reload, lose signal halfway through, and come back the
   next morning. Burning the token on first view would strand them
   mid-application with no way back in. So first open is recorded
   (opened_at) and later opens are allowed until the expiry date.
   /api/esign marks used_at when the packet actually goes out.
   ============================================================ */

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DB) return j({ ok: false, reason: "unavailable" });

  let b; try { b = await request.json(); } catch { return j({ ok: false, reason: "bad-request" }); }

  /* Shape is checked before the database is touched, so a crafted value
     never reaches a query at all. */
  const token = String(b.token || "").trim();
  if (!/^[0-9a-f]{64}$/.test(token)) return j({ ok: false, reason: "invalid" });

  let row;
  try {
    row = await env.DB.prepare(
      "SELECT token,kind,def_name,client_name,email,phone,bond,premium,down,pay_method,pay_ref," +
      "note,issued_by,prefill,expires_at,opened_at,used_at,cancelled FROM plan_invites WHERE token=?"
    ).bind(token).first();
  } catch (_) {
    /* A missing table means no invite has ever been issued on this
       deployment, which is a negative answer, not an error worth
       showing a client in the middle of a bail application. */
    return j({ ok: false, reason: "invalid" });
  }

  if (!row)                                  return j({ ok: false, reason: "invalid" });
  if (Number(row.cancelled) === 1)           return j({ ok: false, reason: "cancelled" });
  if (Number(row.expires_at) < Date.now())   return j({ ok: false, reason: "expired" });

  /* Recorded once, best effort. This is an audit trail, not a gate — a
     write failure must never cost a client their authorized terms. */
  if (!row.opened_at) {
    try {
      await env.DB.prepare("UPDATE plan_invites SET opened_at=? WHERE token=? AND opened_at IS NULL")
        .bind(Date.now(), token).run();
    } catch (_) {}
  }

  let prefill = {};
  try { prefill = JSON.parse(row.prefill || "{}") || {}; } catch (_) { prefill = {}; }

  const kind    = String(row.kind || "plan");
  const premium = Number(row.premium) || 0;
  const down    = Number(row.down) || 0;

  return j({
    ok: true,
    kind,                                   // "plan" | "paid"
    plan: {
      down,
      balance: Math.max(0, premium - down),
      premium,
      bond:   Number(row.bond) || 0,
      by:     String(row.issued_by || ""),
      note:   String(row.note || ""),
      method: String(row.pay_method || ""),
      ref:    String(row.pay_ref || "")
    },
    prefill,
    alreadySubmitted: !!row.used_at         // lets the form warn instead of silently duplicating
  });
}

export const onRequestGet = () =>
  j({ ok: true, endpoint: "invite-check", note: "POST {token}. Returns the terms the office authorized." });

export const onRequestOptions = () => new Response(null, {
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  }
});

const j = (o, s) => new Response(JSON.stringify(o), {
  status: s || 200,
  headers: { "content-type": "application/json", "cache-control": "no-store", "Access-Control-Allow-Origin": "*" }
});
