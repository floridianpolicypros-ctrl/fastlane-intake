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
   12:30 and 2:30" everywhere it appears.

   THE CO-SIGNER IS THE POINT

   A defendant cannot indemnify their own bond. If the booking
   carries a co-signer's email, that person is emailed the
   indemnitor application and the defendant is pointed at the
   defendant application — two different packets against one file.
   Without a co-signer the booking still stands, because turning
   someone away at this stage loses them entirely; the office sorts
   the co-signer when they arrive.

   DOCUMENTS ARRIVE WITH THE BOOKING

   The court event form, licence and selfie are attached to the
   agency email rather than requested afterwards. "Email us your
   paperwork" is where these files go to die.

   WHY THE CALENDAR ENTRY IS AN .ics ATTACHMENT

   Writing to Google Calendar from here would need an OAuth client,
   a refresh token in Cloudflare, and a refresh path that silently
   rots the first time the grant is revoked. A standard .ics gets
   the same event onto the same calendar with one tap in Gmail, and
   there is nothing to expire.

   THE DATE IS RE-CHECKED HERE

   The page only offers valid days, but the page is the client's
   copy and anyone can post whatever they like to this URL. A
   Sunday, a past date, or one six months out is refused on the
   server, where it cannot be edited away.
   ============================================================ */

const TZ = "America/New_York";
const WINDOW = "12:30 PM to 2:30 PM";
const OFFICE = "800 S. Congress Ave, West Palm Beach, FL 33406";
const OFFICE_TEL = "(561) 833-4388";
const MAX_AHEAD = 60;                 // days; beyond this it is a wish, not a booking
const MAX_DOC = 6 * 1024 * 1024;      // per file, before base64 inflation
const MAX_TOTAL = 14 * 1024 * 1024;   // Resend rejects oversized payloads outright

export async function onRequestPost(context) {
  const { request, env } = context;

  let b; try { b = await request.json(); } catch { return j({ ok: false, error: "Bad JSON" }, 400); }

  const name     = clean(b.name, 120);
  const phone    = digits(b.phone, 15);
  const email    = clean(b.email, 160).toLowerCase();
  const date     = clean(b.date, 10);
  const note     = clean(b.note, 600);
  const dobIn    = clean(b.dob, 12);
  const caseType = clean(b.caseType, 8).toUpperCase();
  const ref      = clean(b.ref, 40);
  const indem    = clean(b.indemnitorEmail, 160).toLowerCase();

  if (!name) return j({ ok: false, error: "Please give us your full name." }, 400);
  if (phone.length < 10) return j({ ok: false, error: "Please give us a phone number we can reach you on." }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return j({ ok: false, error: "Please choose a date." }, 400);
  if (indem && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(indem))
    return j({ ok: false, error: "That co-signer email does not look right." }, 400);

  /* Parsed at noon UTC so a timezone shift can never roll the date onto the
     day before and turn a Monday into a Sunday. */
  const d = new Date(date + "T12:00:00Z");
  if (isNaN(d.getTime())) return j({ ok: false, error: "That date did not make sense." }, 400);
  if (d.getUTCDay() === 0)
    return j({ ok: false, error: "We do not do walkthroughs on Sundays. Please choose Monday to Saturday, or call " + OFFICE_TEL + "." }, 400);

  const today = new Date(); today.setUTCHours(12, 0, 0, 0);
  const days = Math.round((d - today) / 86400000);
  if (days < 0) return j({ ok: false, error: "That date has already passed. Please choose another, or call " + OFFICE_TEL + "." }, 400);
  if (days > MAX_AHEAD) return j({ ok: false, error: "That is too far out to book. Please choose a date within the next two months, or call " + OFFICE_TEL + "." }, 400);

  const pretty = d.toLocaleDateString("en-US",
    { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" });

  /* THE LINE THAT HAS TO SURVIVE BEING A TEXT MESSAGE.

     A phone shows a sender and a subject and nothing else, so the subject
     has to carry enough to act on without opening anything: who is coming
     in, the date of birth that separates them from the other three men
     with that name, and the number to call if the day has to move. */
  const id = name
    + (dobIn ? " DOB " + dobIn    : "")
    + (phone ? " " + tel(phone)   : " (no phone)");

  /* ---- documents ---- */
  const attachments = [];
  let total = 0;
  const wanted = [["court", "Court-event-form"], ["dl", "Drivers-licence"], ["selfie", "Selfie"]];
  const got = [];
  for (const [key, label] of wanted) {
    const doc = b.docs && b.docs[key];
    if (!doc || !doc.data) continue;
    const size = Math.floor(String(doc.data).length * 0.75);
    if (size > MAX_DOC || total + size > MAX_TOTAL) { got.push(label + " (too large, not attached)"); continue; }
    total += size;
    attachments.push({ filename: label + "-" + safeName(name) + ext(doc.name, doc.type), content: String(doc.data) });
    got.push(label);
  }

  /* ---- what the office gets ---- */
  const body =
    "A walkthrough has been booked on the website.\n\n" +
    "Name ........... " + name + "\n" +
    "DOB ............ " + (dobIn || "(not given)") + "\n" +
    "Phone .......... " + (tel(phone) || "(not given)") + "\n" +
    "Email .......... " + (email || "(not given)") + "\n" +
    "Case type ...... " + (caseType || "(not given)") + "\n" +
    "Case/citation .. " + (ref || "(not given)") + "\n" +
    "Day ............ " + pretty + "\n" +
    "Window ......... " + WINDOW + "\n" +
    "Co-signer ...... " + (indem || "NONE GIVEN \u2014 they still need one") + "\n" +
    "Documents ...... " + (got.length ? got.join(", ") : "none attached") + "\n" +
    "Booked at ...... " + stamp(Date.now()) + "\n\n" +
    (note ? ("Warrant check at the time of booking:\n" + note + "\n\n") : "") +
    (caseType === "CF"
      ? "FELONY \u2014 confirm whether a bond was set before promising a release. A no-bond warrant needs a motion to recall.\n\n"
      : "") +
    "No time was promised \u2014 they were told to arrive inside the window.";

  await push(env, "WALKTHROUGH BOOKED \u2014 " + id + " \u2014 " + pretty, body);

  const ics = buildIcs({ name, phone, email, date, note });
  attachments.push({ filename: "walkthrough-" + date + ".ics", content: b64(ics) });

  const mailed = await mail(env, {
    to: alertTo(env),
    subject: "WALKTHROUGH BOOKED \u2014 " + name + " \u2014 " + pretty,
    text: body,
    attachments
  });

  const origin = new URL(request.url).origin;

  /* ---- the co-signer ---- */
  let indemnitorEmailed = false;
  if (indem) {
    const r = await mail(env, {
      to: [indem],
      subject: "Co-signer paperwork for " + name + "'s bond",
      text:
        "Hello,\n\n" +
        name + " has asked you to co-sign their bail bond. They are coming in to the office on " +
        pretty + ".\n\n" +
        "Please complete the co-signer application here:\n\n" +
        origin + "/indemnitor\n\n" +
        "WHAT CO-SIGNING MEANS\n" +
        "  You are guaranteeing they appear at every court date. If they do not,\n" +
        "  you are responsible for the full bond amount, not the premium.\n" +
        "  Read it before you sign it, and call us if anything is unclear.\n\n" +
        "It takes about five minutes and you can do it on your phone. You will need a\n" +
        "photo ID.\n\n" +
        "Bail Bond Release Center of the Palm Beaches\n" + OFFICE + "\n" + OFFICE_TEL + "\n" +
        "Carlos Sevilla \u00b7 FL Bail Agent Lic. #P204302"
    });
    indemnitorEmailed = r.ok;
  }

  /* ---- the client ---- */
  if (/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
    await mail(env, {
      to: [email],
      subject: "Your walkthrough is booked \u2014 " + pretty,
      text:
        "Hello " + name.split(/\s+/)[0] + ",\n\n" +
        "You are booked to come in on " + pretty + ". Arrive any time between " +
        WINDOW + " \u2014 there is no appointment time, we take you in order.\n\n" +
        "WHERE\n  " + OFFICE + "\n  " + OFFICE_TEL + "\n\n" +
        "BRING\n" +
        "  - A government photo ID\n" +
        "  - A way to pay the premium\n\n" +
        "YOUR PAPERWORK\n" +
        "  Your own application:\n  " + origin + "/defendant\n\n" +
        (indem
          ? ("  We have emailed " + indem + " the co-signer application. Both have to be\n" +
             "  signed before the bond can be posted.\n\n")
          : ("  You cannot sign your own bond, so you still need a co-signer. Call us and\n" +
             "  we will sort it out with you.\n\n")) +
        "If you cannot make that day, call us rather than simply not coming.\n" +
        "A missed walkthrough is not held against you; a missed court date is.\n\n" +
        "Bail Bond Release Center of the Palm Beaches\n" +
        "Carlos Sevilla \u00b7 FL Bail Agent Lic. #P204302",
      attachments: [{ filename: "walkthrough-" + date + ".ics", content: b64(ics) }]
    });
  }

  return j({
    ok: true, date, pretty, window: WINDOW, office: OFFICE, tel: OFFICE_TEL,
    agencyNotified: mailed.ok, indemnitorEmailed, documents: got,
    message: "You are booked for " + pretty + ". Come to " + OFFICE +
             " any time between " + WINDOW + " and bring a photo ID."
  });
}

export const onRequestGet = () =>
  j({ ok: true, endpoint: "walkthrough", days: "Monday to Saturday", window: WINDOW,
      note: "POST {name,phone,email,date,indemnitorEmail,docs}." });

export const onRequestOptions = () => new Response(null, {
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  }
});

/* ============================================================ */

/* A plain VEVENT. Folded at 74 octets with CRLF endings, because Google is
   forgiving about neither. The event spans the whole window rather than
   claiming a start time nobody promised. */
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

const safeName = s => String(s).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "client";

function ext(name, type) {
  const m = /\.([A-Za-z0-9]{2,5})$/.exec(String(name || ""));
  if (m) return "." + m[1].toLowerCase();
  if (/pdf/i.test(type || "")) return ".pdf";
  if (/png/i.test(type || "")) return ".png";
  return ".jpg";
}

function alertTo(env) {
  /* ALERT_SMS_TO is deliberately NOT here. It is a Zapier inbound address
     that turns an email into a text, and these emails carry signed
     packets and client photos - oversized inbound mail bounces there and
     the text never arrives. It gets its own small message instead. */
  return [env.AGENCY_BCC || "bailbondreleasecenter@gmail.com"]
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

/* Carrier gateways and Telegram both choke on a wall of text, and nobody
   reads one on a lock screen anyway. The phone gets the headline; the
   email carries the file. */
async function push(env, subject, text) {
  await textAlert(env, subject, text);
  await telegram(env, subject, text);
}

/* A text message, by way of a Zapier inbound address that forwards an
   email to a phone.

   Every text is labelled with the intake it came from, because a phone
   shows a sender and a subject and nothing else - "PAID $500" tells you
   nothing useful at 2am if you cannot tell a bail application from a
   warrant enquiry.

   It is deliberately its own tiny email rather than a copy of the alert.
   The alert emails carry signed packets, court forms, licences and selfies
   - 1.8 MB and up - and oversized inbound mail bounces at Zapier, so the
   text would silently never arrive. That failure mode has already cost
   weeks of submissions on another intake and is not worth repeating.

   The subject carries the whole answer because the subject-only bridge is
   all that is guaranteed to arrive; the detail block is passed through as
   the body as well, so that a Zap mapping the body gets the full picture
   without this code changing again. Both are clipped - carriers truncate
   a subject around 150 characters, and a body that runs long is the thing
   that bounces.

   Timed out at three seconds and swallowed on failure: a slow notification
   service must never delay or break the alert it is announcing. */
const ALERT_SOURCE = "WALKTHROUGH";
async function textAlert(env, subject, detail) {
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
        text: String(detail || "Full details are in the matching email.").slice(0, 900)
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

const clean  = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);
const digits = (v, n) => String(v == null ? "" : v).replace(/\D/g, "").slice(0, n);
const stamp  = t => new Date(Number(t)).toLocaleString("en-US", { timeZone: TZ });

/* A number nobody can dial is not a contact. Ten digits are formatted so
   the text can be tapped to call; anything else is passed through rather
   than mangled, because a partial number is still worth seeing. */
const tel = p => {
  const d = String(p == null ? "" : p).replace(/\D/g, "");
  if (d.length === 10) return "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6);
  if (d.length === 11 && d[0] === "1") return "(" + d.slice(1, 4) + ") " + d.slice(4, 7) + "-" + d.slice(7);
  return d ? String(p) : "";
};

const j = (o, s) => new Response(JSON.stringify(o), {
  status: s || 200,
  headers: { "content-type": "application/json", "cache-control": "no-store", "Access-Control-Allow-Origin": "*" }
});
