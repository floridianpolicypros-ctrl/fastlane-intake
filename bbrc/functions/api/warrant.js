/* ============================================================
   PALM BEACH WARRANT / OPEN CASE CHECK  —  /api/warrant
   ------------------------------------------------------------
   Somebody who thinks they have a warrant is the most valuable
   and most skittish lead this agency gets. They will not walk
   into an office on a maybe, and they will not wait long on a
   web page. So this does two things at once: it runs the live
   Clerk lookup while they wait, and it tells Carlos who asked
   the moment they ask — before any result exists — so the lead
   survives even if they close the tab.

   WHY IT CALLS /api/verify INSTEAD OF SCRAPING ITSELF

   /api/verify already drives a full ScrapingBee session through
   eCaseView: guest entry, name search, open the case, read the
   tabs. That took real work to get right and it keeps breaking
   in new ways as the Clerk changes the site. Duplicating it here
   would mean two copies that drift, and the day one is fixed the
   other quietly starts lying. One internal call, one scraper.

   WHAT THIS CAN AND CANNOT TELL YOU — IMPORTANT

   eCaseView is the Palm Beach County Clerk's record of COURT
   CASES. A capias or bench warrant normally shows there, but:

     - a warrant issued in the last day or two may not appear yet
     - warrants from any other county or state are invisible here
     - federal and sealed matters do not appear at all
     - a common name can match somebody else entirely

   So a clean result means "no open Palm Beach County case found
   under that name", and this endpoint says exactly that. It must
   never be rendered to a client as "you have no warrant". Telling
   a person with an active capias that they are clear is how they
   get arrested at a traffic stop believing the agency checked.

   FAILING LOUDLY

   If the lookup errors, this returns checked:false with the
   reason. It never returns an empty list on failure, because an
   empty list reads as "nothing found" and the truth is "we could
   not look".
   ============================================================ */

export async function onRequestPost(context) {
  const { request, env } = context;

  let b; try { b = await request.json(); } catch { return j({ ok: false, error: "Bad JSON" }, 400); }

  const firstName = clean(b.firstName, 60);
  const lastName  = clean(b.lastName, 60);
  const dob       = clean(b.dob, 12);
  const phone     = digits(b.phone, 15);
  const email     = clean(b.email, 160).toLowerCase();
  const caseType  = clean(b.caseType, 8).toUpperCase();
  const ref       = clean(b.ref, 40);
  const situation = clean(b.situation, 20);
  const note      = clean(b.note, 600);

  if (!lastName)  return j({ ok: false, error: "Last name is required." }, 400);
  if (!firstName) return j({ ok: false, error: "First name is required." }, 400);

  /* The lead is reported before the lookup runs, not after. A slow Clerk
     site or a closed tab must never be the reason Carlos never hears that
     somebody with a warrant was asking about him at 1am. */
  const who =
    "Name ........... " + firstName + " " + lastName + "\n" +
    "DOB ............ " + (dob || "(not given)") + "\n" +
    "Phone .......... " + (tel(phone) || "(not given)") + "\n" +
    "Email .......... " + (email || "(not given)") + "\n" +
    "Situation ...... " + (situation || "(not given)") + "\n" +
    "Case type ...... " + (caseType || "(not given)") + "\n" +
    "Case/citation .. " + (ref || "(not given)") + "\n" +
    "Asked at ....... " + stamp(Date.now());

  /* THE LINE THAT HAS TO SURVIVE BEING A TEXT MESSAGE.

     A phone shows a sender and a subject and nothing else, so the subject
     has to carry enough to act on without opening anything: who it is,
     the date of birth that separates them from the other four men with
     that name, and the number to call back. A subject that says only
     "CALL REQUIRED — J. Hernandez" is a notification that somebody has
     to go and look something up; this one is the whole job. */
  const id = firstName + " " + lastName
    + (dob   ? " DOB " + dob      : "")
    + (phone ? " " + tel(phone)   : " (no phone)");

  /* A lead with no search behind it. Two routes arrive here: a new charge,
     where nothing exists in the court records for 30 to 60 days and the
     warrants department has to be phoned; and anyone who chose not to wait.
     Both need a human and a callback, so the alert says so in the subject
     rather than looking like a search that produced nothing. */
  if (b.leadOnly) {
    const isNew = situation === "new";
    await alert(env,
      "CALL REQUIRED — " + id + (isNew ? " — new charge" : " — staff check"),
      (isNew
        ? "A new charge was submitted. Nothing will be in the Clerk's records for 30 to 60 days, so this one needs the warrants department called direct.\n\n"
        : "Somebody asked for a staff check rather than waiting for the live search.\n\n") +
      who + (note ? ("\n\nWhat they told us:\n" + note) : "") +
      "\n\nThey were told the office calls back Monday to Friday, 9:00 to 4:30, excluding holidays.");
    return j({
      ok: true, checked: false, lead: true,
      message: "We have your details. The office will call you back during business hours."
    });
  }

  context.waitUntil(alert(env,
    "WARRANT CHECK STARTED — " + id,
    "Somebody just ran a warrant check on the website.\n\n" + who + "\n\n" +
    "This is a live lead. The result follows in a second message. If they close " +
    "the page before it lands, you still have their details above."));

  /* ---- the lookup itself ---- */
  let result;
  try {
    const origin = new URL(request.url).origin;
    const r = await fetch(origin + "/api/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      /* caseType is passed through because the Clerk search picks which case
         to open from the case number, and the old filter matched only -CF-
         and -MM-. Criminal traffic never matched, so the DWLS and
         no-registration cases - the ones most likely to be a walk-through -
         were skipped silently. */
      body: JSON.stringify({ provider: "clerk", lastName, firstName, caseType })
    });
    const d = await r.json();
    if (!d || d.ok !== true) throw new Error((d && d.error) || ("Lookup returned HTTP " + r.status));
    result = d;
  } catch (e) {
    const why = String((e && e.message) || e);
    context.waitUntil(alert(env,
      "WARRANT CHECK FAILED — " + id,
      who + "\n\nThe Clerk lookup did not complete: " + why +
      "\n\nCheck eCase yourself and call them back. They were told to text you."));
    return j({
      ok: true, checked: false, reason: why,
      message: "We could not reach the Palm Beach County Clerk just now. " +
               "Text your name and date of birth to (561) 531-8622 and we will check it by hand."
    });
  }

  const matches = Array.isArray(result.matches) ? result.matches : [];
  const found   = matches.length > 0;

  context.waitUntil(alert(env,
    (found ? "OPEN CASE FOUND — " : "nothing found — ") + id,
    who + "\n\n" +
    (found
      ? ("The Clerk shows " + matches.length + " open case" + (matches.length === 1 ? "" : "s") + ":\n\n" +
         matches.slice(0, 6).map(function (m) { return "  " + summarise(m); }).join("\n") +
         "\n\nThey were shown this and routed to book a walkthrough.")
      : ("No open Palm Beach County case found under that name. " +
         "That is not the same as no warrant - a new capias, another county, " +
         "or a different spelling would not show. They were told as much.")) ));

  return j({
    ok: true,
    checked: true,
    found,
    count: matches.length,
    cases: matches.slice(0, 6).map(function (m) {
      return {
        caseNumber: String(m.caseNumber || m.case || ""),
        charge:     String(m.charge || m.charges || ""),
        status:     String(m.status || ""),
        bond:       m.bond === undefined ? "" : String(m.bond),
        court:      String(m.court || "")
      };
    }),
    checkedAt: Date.now(),
    /* The wording the page shows is decided here, once, so it cannot drift
       into something that reads like legal advice. */
    message: found
      ? "We found an open Palm Beach County case under that name. Book a walkthrough below and bring a photo ID — we will confirm the details and handle the surrender with you."
      : "We did not find an open Palm Beach County case under that name. This is not a clearance: a warrant issued in the last day or two, one from another county, or a different spelling of the name would not show here. Book a walkthrough and we will check it properly with you."
  });
}

export const onRequestGet = () =>
  j({ ok: true, endpoint: "warrant", note: "POST {firstName,lastName,dob,phone,email}." });

export const onRequestOptions = () => new Response(null, {
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  }
});

/* ============================================================ */

function summarise(m) {
  return [m.caseNumber || m.case, m.charge || m.charges, m.status, m.bond ? ("bond " + m.bond) : ""]
    .filter(Boolean).join(" · ");
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

async function alert(env, subject, text) {
  await push(env, subject, text);
  if (!env.RESEND_API_KEY) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.FROM_ADDRESS || "Bail Bond Release Center <onboarding@resend.dev>",
        to: alertTo(env), subject, text
      })
    });
  } catch (_) {}
}

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
const ALERT_SOURCE = "WARRANT";
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
const stamp  = t => new Date(Number(t)).toLocaleString("en-US", { timeZone: "America/New_York" });

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
