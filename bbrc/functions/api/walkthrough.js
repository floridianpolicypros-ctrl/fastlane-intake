/* ============================================================
   WALKTHROUGH BOOKING  —  /api/walkthrough
   ------------------------------------------------------------
   Somebody turning themselves in on a warrant books a day to come
   to the office. Walkthroughs run Monday to Saturday between
   12:30 and 2:30 only, because that is the window the jail will
   process one. Anything outside it has to be a phone call, so the
   page never offers it and this endpoint refuses it.

   NO TIME SLOTS, BY CHOICE

   Carlos takes whoever turns up inside the window rather than
   handing out appointment times he then has to keep. So a booking
   is a DAY, not a time, and the confirmation says "arrive between
   12:30 and 2:30" in every place it appears.

   WHY THE CALENDAR ENTRY IS AN .ics ATTACHMENT

   Writing to Google Calendar from here would need an OAuth client,
   a refresh token in Cloudflare, and a token refresh path that
   silently rots the first time the grant is revoked. A standard
   .ics on the confirmation email gets the same event onto the same
   calendar with one tap in Gmail, and there is nothing to expire.
   The simpler mechanism is the one that will still work in a year.

   THE DATE IS RE-CHECKED HERE

   The page only offers valid days, but the page is the client's
   copy and anyone can post whatever they like to this URL. A
   Sunday, a date in the past, or one six months out is refused on
   the server, where it cannot be edited away.
   ============================================================ */

const TZ         = "America/New_York";
const WINDOW     = "12:30 PM to 2:30 PM";
const OFFICE     = "800 S. Congress Ave, West Palm Beach, FL 33406";
const OFFICE_TEL = "(561) 833-4388";
const MAX_AHEAD  = 60;                       // days; beyond this it is not a booking, it is a wish

export async function onRequestPost(context) {
  const { request, env } = context;

  let b; try { b = await request.json(); } catch { return j({ ok: false, error: "Bad JSON" }, 400); }

  const name  = clean(b.name, 120);
  const phone = digits(b.phone, 15);
  const email = clean(b.email, 160).toLowerCase();
  const date  = clean(b.date, 10);                       // YYYY-MM-DD
  const note  = clean(b.note, 600);                      // warrant-check summary, usually
  const dobIn = clean(b.dob, 12);

  if (!name)            return j({ ok: false, error: "Please give us your full name." }, 400);
  if (phone.length < 10) return j({ ok: false, error: "Please give us a phone number we can reach you on." }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
                        return j({ ok: false, error: "Please choose a date." }, 400);

  /* Parsed at noon UTC so a timezone shift can never roll the date onto the
     day before and turn a Monday into a Sunday. */
  const d = new Date(date + "T12:00:00Z");
  if (isNaN(d.getTime())) return j({ ok: false, error: "That date did not make sense." }, 400);

  const dow = d.getUTCDay();                             // 0 Sun ... 6 Sat
  if (dow === 0) {
    return j({ ok: false, error: "We do not do walkthroughs on Sundays. Please choose Monday to Saturday, or call " + OFFICE_TEL + "." }, 400);
  }

  const today = new Date(); today.setUTCHours(12, 0, 0, 0);
  const days  = Math.round((d - today) / 86400000);
  if (days < 0)          return j({ ok: false, error: "That date has already passed. Please choose another, or call " + OFFICE_TEL + "." }, 400);
  if (days > MAX_AHEAD)  return j({ ok: false, error: "That is too far out to book. Please choose a date within the next two months, or call " + OFFICE_TEL + "." }, 400);

  const pretty = d.toLocaleDateString("en-US",
    { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" });

  /* ---- what Carlos gets ---- */
  const body =
    "A walkthrough has been booked on the website.\n\n" +
    "Name ....... " + name + "\n" +
    "DOB ........ " + (dobIn || "(not given)") + "\n" +
    "Phone ...... " + (phone || "(not given)") + "\n" +
    "Email ...... " + (email || "(not given)") + "\n" +
    "Day ........ " + pretty + "\n" +
    "Window ..... " + WINDOW + "\n" +
    "Booked at .. " + stamp(Date.now()) + "\n\n" +
    (note ? ("Warrant check at the time of booking:\n" + note + "\n\n") : "") +
    "No time was promised - they were told to arrive inside the window.";

  await push(env, "WALKTHROUGH BOOKED \u2014 " + name + " \u2014 " + pretty, body);

  const ics = buildIcs({ name, phone, email, date, pretty, note });
  const mailed = await mail(env, {
    to: alertTo(env),
    subject: "WALKTHROUGH BOOKED \u2014 " + name + " \u2014 " + pretty,
    text: body,
    attachments: [{ filename: "walkthrough-" + date + ".ics", content: b64(ics) }]
  });

  /* ---- what the client gets, if we have an address for them ---- */
  if (/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
    await mail(env, {
      to: [email],
      subject: "Your walkthrough is booked \u2014 " + pretty,
      text:
        "Hello " + name.split(/\s+/)[0] + ",\n\n" +
        "You are booked to come in on " + pretty + ". Arrive any time between " +
        WINDOW + " - there is no appointment time, we take you in order.\n\n" +
        "WHERE\n  " + OFFICE + "\n  " + OFFICE_TEL + "\n\n" +
        "BRING\n" +
        "  - A government photo ID\n" +
        "  - Your co-signer, if you have one lined up\n" +
        "  - A way to pay the premium\n\n" +
        "If you cannot make that day, call us rather than simply not coming. " +
        "A missed walkthrough is not held against you; a missed court date is.\n\n" +
        "Bail Bond Release Center of the Palm Beaches\n" +
        "Carlos Sevilla \u00b7 FL Bail Agent Lic. #P204302",
      attachments: [{ filename: "walkthrough-" + date + ".ics", content: b64(ics) }]
    });
  }

  return j({
    ok: true, date, pretty, window: WINDOW, office: OFFICE, tel: OFFICE_TEL,
    agencyNotified: mailed.ok,
    message: "You are booked for " + pretty + ". Come to " + OFFICE +
             " any time between " + WINDOW + " and bring a photo ID."
  });
}

export const onRequestGet = () =>
  j({ ok: true, endpoint: "walkthrough", days: "Monday to Saturday", window: WINDOW, note: "POST {name,phone,email,date}." });

export const onRequestOptions = () => new Response(null, {
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  }
});

/* ============================================================ */

/* A plain VEVENT. Folded at 74 octets and CRLF line endings, because
   Google is forgiving about neither. The event spans the whole window
   rather than claiming a start time nobody promised. */
function buildIcs(o) {
  const dt = o.date.replace(/-/g, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bail Bond Release Center//Walkthrough//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:walkthrough-" + dt + "-" + Math.random().toString(36).slice(2, 10) + "@24hourbailbondsnearme.com",
    "DTSTAMP:" + utcStamp(new Date()),
    "DTSTART;TZID=" + TZ + ":" + dt + "T123000",
    "DTEND;TZID=" + TZ + ":" + dt + "T143000",
    "SUMMARY:" + esc("Walkthrough \u2014 " + o.name),
    "LOCATION:" + esc(OFFICE),
    "DESCRIPTION:" + esc(
      "Walkthrough booked on the website.\n" +
      "Phone: " + (o.phone || "not given") + "\n" +
      "Email: " + (o.email || "not given") + "\n" +
      "Arrive between " + WINDOW + "; no appointment time was promised.\n" +
      (o.note ? ("\nWarrant check at booking:\n" + o.note) : "")),
    "END:VEVENT",
    "END:VCALENDAR"
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

function fold(line) {
  if (line.length <= 74) return line;
  let out = line.slice(0, 74), rest = line.slice(74);
  while (rest.length > 73) { out += "\r\n " + rest.slice(0, 73); rest = rest.slice(73); }
  return out + "\r\n " + rest;
}

const esc = s => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

function utcStamp(d) {
  const p = n => String(n).padStart(2, "0");
  return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + "T" +
         p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + "Z";
}

function b64(s) {
  const bytes = new TextEncoder().encode(s);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return btoa(out);
}

function alertTo(env) {
  return [env.AGENCY_BCC || "bailbondreleasecenter@gmail.com", env.ALERT_SMS_TO]
    .filter(Boolean).map(s => String(s).trim())
    .filter((v, i, a) => a.indexOf(v) === i);
}

async function mail(env, m) {
  if (!env.RESEND_API_KEY) return { ok: false, why: "RESEND_API_KEY is not set" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.FROM_ADDRESS || "Bail Bond Release Center <onboarding@resend.dev>",
        reply_to: env.REPLY_TO || undefined,
        to: m.to, subject: m.subject, text: m.text,
        attachments: m.attachments
      })
    });
    if (!r.ok) return { ok: false, why: "Resend returned " + r.status };
    return { ok: true };
  } catch (e) { return { ok: false, why: String(e && e.message || e) }; }
}

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

const clean  = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);
const digits = (v, n) => String(v == null ? "" : v).replace(/\D/g, "").slice(0, n);
const stamp  = t => new Date(Number(t)).toLocaleString("en-US", { timeZone: TZ });

const j = (o, s) => new Response(JSON.stringify(o), {
  status: s || 200,
  headers: { "content-type": "application/json", "cache-control": "no-store", "Access-Control-Allow-Origin": "*" }
});
