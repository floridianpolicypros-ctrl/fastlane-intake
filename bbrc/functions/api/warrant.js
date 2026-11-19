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
    "Phone .......... " + (phone || "(not given)") + "\n" +
    "Email .......... " + (email || "(not given)") + "\n" +
    "Situation ...... " + (situation || "(not given)") + "\n" +
    "Case type ...... " + (caseType || "(not given)") + "\n" +
    "Case/citation .. " + (ref || "(not given)") + "\n" +
    "Asked at ....... " + stamp(Date.now());

  /* A lead with no search behind it. Two routes arrive here: a new charge,
     where nothing exists in the court records for 30 to 60 days and the
     warrants department has to be phoned; and anyone who chose not to wait.
     Both need a human and a callback, so the alert says so in the subject
     rather than looking like a search that produced nothing. */
  if (b.leadOnly) {
    const isNew = situation === "new";
    await alert(env,
      "CALL REQUIRED — " + firstName + " " + lastName +
        (isNew ? " — new charge" : " — staff check"),
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
    "WARRANT CHECK STARTED — " + firstName + " " + lastName,
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
      "WARRANT CHECK FAILED — " + firstName + " " + lastName,
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
    (found ? "WARRANT CHECK — OPEN CASE FOUND — " : "WARRANT CHECK — nothing found — ")
      + firstName + " " + lastName,
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
  return [env.AGENCY_BCC || "bailbondreleasecenter@gmail.com", env.ALERT_SMS_TO]
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

const j = (o, s) => new Response(JSON.stringify(o), {
  status: s || 200,
  headers: { "content-type": "application/json", "cache-control": "no-store", "Access-Control-Allow-Origin": "*" }
});
