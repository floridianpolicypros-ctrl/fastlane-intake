/* ============================================================
   OFFICE-ISSUED INTAKE INVITES  —  /api/agent-invite
   ------------------------------------------------------------
   WHY THIS EXISTS

   Until now the application let the client decide what to pay.
   The "Amount you're paying today" box pre-filled with the full
   premium but stayed editable, so people deleted it, typed a few
   hundred dollars, and the form quietly produced a promissory-note
   packet nobody at the agency had approved — on bonds that were
   already being posted. The same hole existed on the payment
   method: anyone could pick "Already Paid", skip checkout, and the
   form believed them.

   The public form now takes the premium in full through Clover and
   offers nothing else. Both exceptions are the agency's decision,
   so both start here. Carlos opens /agent.html, fills in the
   defendant and the indemnitor, and picks one:

     kind = "plan"  A payment plan he is authorizing. The client's
                    form shows the down payment he set, locked, and
                    the packet carries the promissory note.

     kind = "paid"  Already settled outside the website — Zelle,
                    Cash App, cash at the office, money order. No
                    checkout, no card, no amount for the client to
                    pick. Paperwork only, straight to signing, and
                    the method and reference are recorded on the
                    file so there is no argument later about how the
                    money arrived.

   Either way the client gets a link, and only that link unlocks the
   exception. The plain public link always means premium in full.

   WHY A RANDOM TOKEN IN D1 AND NOT A SIGNED ONE

   A signed (HMAC) token needs a new signing secret in Cloudflare,
   and it cannot be revoked or spent once issued. A 256-bit random
   token stored in D1 needs no new secret, can be cancelled, expires
   on a date, and records who opened it and when. The row IS the
   authorization record — which is also what you want in a file the
   Department could ask to see.

   ACCESS CONTROL, STATED PLAINLY

   The passcode is checked here, on the server, in constant time,
   against AGENT_PASSCODE. /agent.html is a public static file and
   is useless without it — nothing on that page can mint anything.
   If AGENT_PASSCODE is not set this endpoint refuses every request
   rather than defaulting to open.
   ============================================================ */

const MAX_DAYS = 7;                 // an invite nobody used is a stale liability
const METHODS  = ["Zelle", "Cash App", "Cash", "Money order", "Check", "Other"];

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.AGENT_PASSCODE) {
    return j({ ok: false, error: "Agent access is not configured. Set AGENT_PASSCODE in Cloudflare and redeploy." }, 503);
  }
  if (!env.DB) return j({ ok: false, error: "The invite database is unavailable." }, 503);

  let b; try { b = await request.json(); } catch { return j({ ok: false, error: "Bad JSON" }, 400); }

  if (!eq(String(b.passcode || ""), String(env.AGENT_PASSCODE))) {
    /* Deliberately vague, and deliberately slow enough that guessing
       over the network is not worth anyone's evening. */
    await sleep(600);
    return j({ ok: false, error: "Passcode not accepted." }, 403);
  }

  const kind = String(b.kind || "").toLowerCase();
  if (kind !== "plan" && kind !== "paid") {
    return j({ ok: false, error: 'Choose what you are authorizing: "plan" or "paid".' }, 400);
  }

  /* ---- who ---- */
  const defName   = clean(b.defName, 120);
  const firstName = clean(b.firstName, 60);
  const lastName  = clean(b.lastName, 60);
  const email     = clean(b.email, 160).toLowerCase();
  const phone     = digits(b.phone, 15);
  const bond      = num(b.bond);
  const premium   = num(b.premium);
  const note      = clean(b.note, 400);
  const by        = clean(b.by, 80) || "Bail Bond Release Center";
  const days      = Math.min(MAX_DAYS, Math.max(1, Math.round(num(b.days) || 3)));

  if (!defName)                return j({ ok: false, error: "Defendant name is required." }, 400);
  if (!firstName || !lastName) return j({ ok: false, error: "The indemnitor's first and last name are required." }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email))
                               return j({ ok: false, error: "A valid email for the indemnitor is required — that is where the link goes." }, 400);
  if (!(bond > 0))             return j({ ok: false, error: "Bond amount is required." }, 400);
  if (!(premium > 0))          return j({ ok: false, error: "Premium is required." }, 400);

  /* ---- what, per kind ---- */
  let down = 0, payMethod = "", payRef = "";

  if (kind === "plan") {
    down = num(b.down);
    if (!(down >= 0))   return j({ ok: false, error: "Down payment cannot be negative." }, 400);
    if (down > premium) return j({ ok: false, error: "The down payment is more than the premium. Check the figures." }, 400);
    if (down === premium)
      return j({ ok: false, error: "That is payment in full, which needs no invite — send the normal application link." }, 400);
  } else {
    payMethod = clean(b.payMethod, 40);
    payRef    = clean(b.payRef, 80);
    if (METHODS.indexOf(payMethod) < 0)
      return j({ ok: false, error: "How was it paid? Choose one of: " + METHODS.join(", ") + "." }, 400);
    if (payMethod === "Other" && !payRef)
      return j({ ok: false, error: 'For "Other", describe how it was paid in the reference box.' }, 400);
    down = premium;                 // the premium is already in hand, in full
  }

  const token   = rnd();
  const expires = Date.now() + days * 86400000;

  const prefill = JSON.stringify({
    defName, firstName, lastName, email,
    phone: phone || "",
    bond: String(bond)
  });

  try {
    await ensure(env);
    await env.DB.prepare(
      "INSERT INTO plan_invites (token,kind,def_name,client_name,email,phone,bond,premium,down," +
      "pay_method,pay_ref,note,issued_by,prefill,created_at,expires_at,opened_at,used_at,cancelled) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,0)"
    ).bind(token, kind, defName, (firstName + " " + lastName).trim(), email, phone,
           bond, premium, down, payMethod, payRef, note, by, prefill, Date.now(), expires).run();
  } catch (e) {
    return j({ ok: false, error: "Could not record the invite: " + String(e && e.message || e) }, 500);
  }

  const origin = new URL(request.url).origin;
  const link   = origin + "/indemnitor.html?inv=" + token;
  const bal    = kind === "plan" ? (premium - down) : 0;

  /* The client is told the terms in the same message that carries the
     link, so there is no version of events where they only learned
     about the balance after signing. */
  const body = kind === "plan"
    ? "Hello " + firstName + ",\n\n" +
      "We have approved a payment plan for " + defName + "'s bond. Please complete your\n" +
      "application and signatures using the link below. It is set up for you already —\n" +
      "do not use any other link, or the plan will not be applied.\n\n" +
      link + "\n\n" +
      "YOUR APPROVED TERMS\n" +
      "  Bond amount .............. " + usd(bond) + "\n" +
      "  Premium (non-refundable) . " + usd(premium) + "\n" +
      "  Due today ................ " + usd(down) + "\n" +
      "  Balance owed ............. " + usd(bal) + "\n" +
      (note ? "  Terms .................... " + note + "\n" : "") +
      "\nThe balance is covered by a promissory note that will be part of the packet you\n" +
      "sign. Any unpaid balance remains owed after the bond is discharged and accrues\n" +
      "interest at the maximum rate allowed by Florida law.\n\n"
    : "Hello " + firstName + ",\n\n" +
      "We have received your payment for " + defName + "'s bond" +
      (payMethod ? " by " + payMethod.toLowerCase() : "") + ", so there is nothing to pay\n" +
      "on this link — it is the paperwork only. Please complete your application and\n" +
      "signatures here:\n\n" +
      link + "\n\n" +
      "ON FILE\n" +
      "  Bond amount .............. " + usd(bond) + "\n" +
      "  Premium (non-refundable) . " + usd(premium) + "\n" +
      "  Received ................. " + usd(premium) + " by " + (payMethod || "other means") +
          (payRef ? " (" + payRef + ")" : "") + "\n" +
      "  Balance owed ............. $0.00\n" +
      (note ? "  Notes .................... " + note + "\n" : "") +
      "\nYou will not be asked for a card. If the link asks you to pay, stop and call us.\n\n";

  const mail = await send(env, {
    to: [email],
    subject: kind === "plan"
      ? "Your bail bond application — payment plan approved"
      : "Your bail bond paperwork — payment already received",
    text: body +
      "This link expires in " + days + " day" + (days === 1 ? "" : "s") + ". If it stops working, call us.\n\n" +
      "Bail Bond Release Center of the Palm Beaches\n" +
      "800 S. Congress Ave, West Palm Beach, FL 33406\n" +
      "(561) 833-4388\n" +
      "Carlos Sevilla · FL Bail Agent Lic. #P204302"
  });

  /* The agency copy is the authorization record in the inbox, so it goes
     out whether or not the client's copy did. */
  const head = kind === "plan"
    ? "PLAN AUTHORIZED — " + defName + " — " + usd(down) + " down, " + usd(bal) + " balance"
    : "PAPERWORK-ONLY LINK — " + defName + " — " + usd(premium) + " already received by " + payMethod;

  await send(env, {
    to: alertTo(env),
    subject: head,
    text:
      (kind === "plan"
        ? "A payment-plan invite was issued.\n\n"
        : "A paperwork-only invite was issued. No payment will be collected on the form.\n\n") +
      "Defendant ..... " + defName + "\n" +
      "Indemnitor .... " + firstName + " " + lastName + "\n" +
      "Email ......... " + email + "\n" +
      "Phone ......... " + (phone || "(not given)") + "\n" +
      "Bond .......... " + usd(bond) + "\n" +
      "Premium ....... " + usd(premium) + "\n" +
      (kind === "plan"
        ? "Down today .... " + usd(down) + "\nBalance ....... " + usd(bal) + "\n"
        : "Received ...... " + usd(premium) + " by " + payMethod + (payRef ? " (" + payRef + ")" : "") + "\n") +
      (note ? "Notes ......... " + note + "\n" : "") +
      "Authorized by . " + by + "\n" +
      "Expires ....... " + new Date(expires).toLocaleString("en-US", { timeZone: "America/New_York" }) + "\n\n" +
      "Client link:\n" + link + "\n\n" +
      (mail.ok ? "The client's copy was sent." : "WARNING: the client's copy did NOT send (" + mail.why + "). Send the link above yourself.")
  });

  return j({
    ok: true, kind, link, expires,
    clientEmailed: mail.ok,
    clientEmailError: mail.ok ? undefined : mail.why,
    terms: { bond, premium, down, balance: bal, payMethod, payRef }
  });
}

export const onRequestGet = () =>
  j({ ok: true, endpoint: "agent-invite", kinds: ["plan", "paid"], methods: METHODS, note: "POST only." });

export const onRequestOptions = () => new Response(null, {
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  }
});

/* ============================================================ */

/* Kept in one place so every alert in the project reaches the same
   addresses — including the carrier email-to-SMS gateway, which is a
   convenience copy only. Carriers throttle and silently drop gateway
   messages, so email stays the system of record and nothing here
   treats a missing text as a failure. */
export function alertTo(env) {
  return [env.AGENCY_BCC || "bailbondreleasecenter@gmail.com", env.ALERT_SMS_TO]
    .filter(Boolean)
    .map(s => String(s).trim())
    .filter((v, i, a) => a.indexOf(v) === i);
}

async function ensure(env) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS plan_invites (" +
    "token TEXT PRIMARY KEY, kind TEXT, def_name TEXT, client_name TEXT, email TEXT, phone TEXT, " +
    "bond REAL, premium REAL, down REAL, pay_method TEXT, pay_ref TEXT, note TEXT, issued_by TEXT, " +
    "prefill TEXT, created_at INTEGER, expires_at INTEGER, opened_at INTEGER, used_at INTEGER, " +
    "cancelled INTEGER DEFAULT 0)"
  ).run();
  /* Older deployments created this table before "paperwork only" existed.
     ALTER fails harmlessly once the column is there, which is cheaper and
     safer than a migration file nobody will remember to run. */
  for (const col of ["kind TEXT", "pay_method TEXT", "pay_ref TEXT"]) {
    try { await env.DB.prepare("ALTER TABLE plan_invites ADD COLUMN " + col).run(); } catch (_) {}
  }
}

async function send(env, m) {
  if (!env.RESEND_API_KEY) return { ok: false, why: "RESEND_API_KEY is not set" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.FROM_ADDRESS || "Bail Bond Release Center <onboarding@resend.dev>",
        reply_to: env.REPLY_TO || undefined,
        to: m.to, subject: m.subject, text: m.text
      })
    });
    if (!r.ok) return { ok: false, why: "Resend returned " + r.status };
    return { ok: true };
  } catch (e) {
    return { ok: false, why: String(e && e.message || e) };
  }
}

/* 256 bits of real randomness, url-safe. Long enough that guessing is not
   a threat model worth discussing. */
function rnd() {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, "0")).join("");
}

/* Constant time. A plain === leaks the passcode one character at a time
   to anyone willing to measure. */
function eq(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

const sleep  = ms => new Promise(r => setTimeout(r, ms));
const clean  = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);
const digits = (v, n) => String(v == null ? "" : v).replace(/\D/g, "").slice(0, n);
const num    = v => { const x = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, "")); return isFinite(x) ? x : 0; };
const usd    = v => "$" + (Number(v) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const j = (o, s) => new Response(JSON.stringify(o), {
  status: s || 200,
  headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" }
});
