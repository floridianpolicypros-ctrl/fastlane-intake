/* Fast Lane Traffic School: on-site class request  ->  POST /api/lead

   The website's own lead form posts here. Every lead goes to the agency two
   ways, so one failure never loses it:
     1. an email to the agency inbox with every field and the page it came from
     2. a one-line text via the email-to-SMS bridge (ALERT_SMS_TO), if set
   If LEADS (a KV namespace) is bound, the lead is also stored, so nothing is
   lost even if email is down.

   Environment (Cloudflare Pages > fastlane-traffic-school > Settings > Variables):
     RESEND_API_KEY  secret, Resend API key for a verified sender domain
     ALERT_TO        optional, defaults to palmbeachtrafficschool@gmail.com
     ALERT_SMS_TO    optional, email address that forwards to a phone as a text
     FROM_ADDRESS    required with RESEND_API_KEY: "Fast Lane Traffic School <leads@VERIFIED-DOMAIN>"

   The form tells the visitor it failed (and to call) whenever no channel
   accepted the lead, so a silent loss is impossible. */

export async function onRequestPost({ request, env, waitUntil }) {
  let b;
  try {
    const ct = request.headers.get("content-type") || "";
    b = ct.includes("application/json") ? await request.json()
      : Object.fromEntries(await request.formData());
  } catch { return j({ ok: false, error: "Bad request" }, 400); }

  // Bots fill the hidden "company" field; pretend success and drop it.
  if (clean(b.company, 80)) return j({ ok: true });

  const lead = {
    name: clean(b.name, 80),
    phone: clean(b.phone, 20).replace(/[^\d+()\-. ]/g, ""),
    email: clean(b.email, 120).toLowerCase(),
    zip: clean(b.zip, 5).replace(/\D/g, ""),
    coverage: clean(b.coverage, 40),
    time: clean(b.time, 30),
    note: clean(b.note, 600),
    lang: clean(b.lang, 2) === "es" ? "Spanish" : "English",
    source: clean(b.source, 60),
    page: clean(b.page, 120),
    ref: clean(b.ref, 200),
    consent: b.consent === "yes" || b.consent === true,
    at: new Date().toLocaleString("en-US", { timeZone: "America/New_York" }) + " ET",
  };
  const digits = lead.phone.replace(/\D/g, "");
  if (!lead.name || digits.length < 10) return j({ ok: false, error: "Name and a 10-digit phone number are required." }, 400);
  if (!lead.consent) return j({ ok: false, error: "Please check the consent box." }, 400);

  const subject = `NEW CLASS REQUEST ${lead.coverage || "class"}: ${lead.name} ${fmtPhone(digits)}${lead.zip ? " " + lead.zip : ""} (from ${lead.page || lead.source})`;
  const text =
    `New class request from westpalmbeachtrafficschool.com\n\n` +
    `Name ........ ${lead.name}\n` +
    `Phone ....... ${fmtPhone(digits)}\n` +
    `Email ....... ${lead.email || "(not given)"}\n` +
    `ZIP ......... ${lead.zip || "(not given)"}\n` +
    `Class ....... ${lead.coverage}\n` +
    `Best time ... ${lead.time}\n` +
    `Language .... ${lead.lang}\n` +
    `Note ........ ${lead.note || "(none)"}\n\n` +
    `Came from page: ${lead.page} (form: ${lead.source})\n` +
    `Referrer: ${lead.ref || "(direct)"}\n` +
    `Consent to call/text/email: ${lead.consent ? "yes" : "no"}\n` +
    `Received: ${lead.at}`;

  const results = await Promise.allSettled([
    sendEmail(env, env.ALERT_TO || "palmbeachtrafficschool@gmail.com", subject, text, lead.email || undefined),
    env.ALERT_SMS_TO ? sendEmail(env, String(env.ALERT_SMS_TO).trim(), subject.slice(0, 150), text.slice(0, 900)) : Promise.resolve(false),
    env.LEADS ? env.LEADS.put(`lead:${Date.now()}:${digits}`, JSON.stringify(lead), { expirationTtl: 60 * 60 * 24 * 365 }).then(() => true) : Promise.resolve(false),
  ]);
  const delivered = results.some(r => r.status === "fulfilled" && r.value === true);
  return delivered ? j({ ok: true }) : j({ ok: false, error: "Not delivered" }, 502);
}

export async function onRequestGet() {
  return j({ ok: true, endpoint: "lead", method: "POST" });
}

async function sendEmail(env, to, subject, text, replyTo) {
  if (!env.RESEND_API_KEY || !env.FROM_ADDRESS || !to) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.FROM_ADDRESS,
      to: [to], subject, text, ...(replyTo ? { reply_to: replyTo } : {}),
    }),
    signal: AbortSignal.timeout(8000),
  });
  return r.ok;
}

function clean(v, max) { return String(v ?? "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, max); }
function fmtPhone(d) { const x = d.slice(-10); return x.length === 10 ? `${x.slice(0, 3)}-${x.slice(3, 6)}-${x.slice(6)}` : d; }
function j(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } }); }
