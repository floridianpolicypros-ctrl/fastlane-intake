/* ============================================================
   UNSIGNED-PAPERWORK CHASER  —  /api/overdue
   ------------------------------------------------------------
   WHY THIS EXISTS

   This is the gap that already cost money once. A client finishes
   the application, the bond gets posted on a phone call, and the
   BoldSign packet is never signed. Nothing in the system was
   watching, so the file sat unexecuted and nobody found out until
   somebody went looking. An indemnity agreement that was never
   signed is not an indemnity agreement.

   So: anything whose packet went out more than two hours ago and
   still has no Completed event gets reported, once, by email and by
   the SMS gateway. Two hours is long enough that a client who is
   simply slow at paperwork is not chased mid-signature, and short
   enough to catch it the same night.

   WHY THIS ENDPOINT IS OPEN

   It takes no input, returns no client data, and alerts only the
   agency's own addresses - and each file is reported at most once,
   recorded by a flag on the row. Someone hitting it repeatedly
   therefore achieves nothing, which is a better defence than a
   shared secret that would have to live in a scheduled job.

   HOW IT GETS CALLED

   Cloudflare Pages has no cron, so something external has to poke
   it - a scheduled task, or a Worker with a cron trigger pointed at
   this URL. A Worker cron is the sturdier of the two and is the
   right answer if these alerts ever become load-bearing.
   ============================================================ */

const OVERDUE_MS = 2 * 60 * 60 * 1000;      // two hours
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000; // ignore ancient rows; they are a reconciliation job, not an alert

export async function onRequest(context) {
  const { env } = context;

  if (!env.DB) return j({ ok: false, error: "The file database is unavailable." }, 503);

  const now = Date.now();
  let rows = [];
  try {
    rows = (await env.DB.prepare(
      "SELECT ref,def_name,client_name,client_email,document_id,amount_paid,submitted_at,paid_at " +
      "FROM bond_files WHERE signed_at IS NULL AND overdue_notified=0 " +
      "AND submitted_at IS NOT NULL AND submitted_at < ? AND submitted_at > ? " +
      "ORDER BY submitted_at ASC LIMIT 50"
    ).bind(now - OVERDUE_MS, now - LOOKBACK_MS).all()).results || [];
  } catch (_) {
    /* No table means no packet has ever been sent on this deployment.
       That is "nothing to chase", not an error. */
    return j({ ok: true, checked: 0, reported: 0 });
  }

  if (!rows.length) return j({ ok: true, checked: 0, reported: 0 });

  /* One message listing everything outstanding, rather than one per file.
     A single clear list gets read; six separate alerts at 2am get swiped
     away together. */
  const lines = rows.map(r => {
    const hrs = Math.floor((now - Number(r.submitted_at)) / 3600000);
    return "  " + (r.def_name || r.client_name || r.client_email || r.ref) + "\n" +
           "    Receipt ... " + r.ref + "\n" +
           "    Sent ...... " + stamp(r.submitted_at) + "  (" + hrs + "h ago)\n" +
           "    Payment ... " + (r.paid_at
              ? usd(r.amount_paid) + " confirmed " + stamp(r.paid_at) + "  <-- MONEY TAKEN, PAPER NOT SIGNED"
              : "none confirmed") + "\n" +
           "    Contact ... " + (r.client_email || "(no email on file)");
  });

  const paidButUnsigned = rows.filter(r => r.paid_at).length;

  await notify(env,
    "PAPERWORK NOT SIGNED — " + rows.length + " file" + (rows.length === 1 ? "" : "s") +
    (paidButUnsigned ? " (" + paidButUnsigned + " already paid)" : ""),
    "These packets went out more than two hours ago and have not been signed.\n\n" +
    lines.join("\n\n") + "\n\n" +
    (paidButUnsigned
      ? "The files marked MONEY TAKEN, PAPER NOT SIGNED are the urgent ones. The premium is\n" +
        "in hand and there is no executed indemnity agreement behind it. Chase those first.\n\n"
      : "") +
    "Each file is reported here once. If you want BoldSign to keep nudging them as well,\n" +
    "turn on automatic reminders on the account.\n\n" +
    "Anyone who cannot do it on a phone can come to the office: 800 S. Congress Ave,\n" +
    "West Palm Beach, FL 33406.");

  /* Flagged after the alert is away, so a mail failure means it is tried
     again next run rather than being marked handled and forgotten. */
  let flagged = 0;
  for (const r of rows) {
    try {
      await env.DB.prepare("UPDATE bond_files SET overdue_notified=1 WHERE ref=?").bind(r.ref).run();
      flagged++;
    } catch (_) {}
  }

  return j({ ok: true, checked: rows.length, reported: rows.length, flagged, paidButUnsigned });
}

/* ============================================================ */

function alertTo(env) {
  return [env.AGENCY_BCC || "bailbondreleasecenter@gmail.com", env.ALERT_SMS_TO]
    .filter(Boolean).map(s => String(s).trim())
    .filter((v, i, a) => a.indexOf(v) === i);
}

/* Telegram. Goes quiet if either variable is unset rather than
   erroring, so a half-finished setup costs nothing. */
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

async function notify(env, subject, text) {
  /* Telegram first: it is the copy that actually wakes someone, and it
     must not be lost if Resend is unconfigured or down. */
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

const stamp = t => t ? new Date(Number(t)).toLocaleString("en-US", { timeZone: "America/New_York" }) : "(unknown)";
const usd = v => (v === null || v === undefined || v === "") ? "(amount not recorded)"
  : "$" + (Number(v) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const j = (o, s) => new Response(JSON.stringify(o), {
  status: s || 200,
  headers: { "content-type": "application/json", "cache-control": "no-store" }
});
