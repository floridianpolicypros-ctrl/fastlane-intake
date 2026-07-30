/* ============================================================
   SEQUENTIAL RECEIPT / COLLATERAL NUMBERS
   ------------------------------------------------------------
   Florida Administrative Code 69B-221.120 expects collateral
   receipts to be CONSECUTIVELY PRE-NUMBERED. Random-unique is
   not the same thing and will not answer an audit question.

   Uses D1 (SQLite) rather than KV on purpose: KV has no atomic
   increment, so two clients submitting at the same moment can
   read the same value and both write n+1 — producing DUPLICATE
   receipt numbers. A duplicate is far worse than a gap. The
   single UPDATE ... RETURNING statement below is atomic, so
   every caller is guaranteed a distinct, increasing number.

   Binding required on the Pages project:  DB  ->  D1 database
   Schema:
     CREATE TABLE IF NOT EXISTS counters (
       name TEXT PRIMARY KEY,
       n    INTEGER NOT NULL
     );
     INSERT OR IGNORE INTO counters (name,n) VALUES ('receipt',1000),('collateral',1000);

   POST { kind: "receipt" | "collateral" }
   ->   { ok:true, kind:"receipt", n:1001, number:"BBRC-1001" }
   ============================================================ */

/* Matches the prefixes already preprinted on the Sun Surety forms:
   premium receipt = PR-042268, collateral receipt = CR-006848.
   Numbers are zero padded to six digits to sit naturally alongside them. */
const PREFIX = { receipt: "PR", collateral: "CR" };
const pad6 = n => String(n).padStart(6, "0");

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DB) return j({ ok: false, error: "D1 binding 'DB' not configured" });

  let b;
  try { b = await request.json(); } catch { b = {}; }

  const kind = String(b.kind || "receipt").toLowerCase();
  if (!PREFIX[kind]) return j({ ok: false, error: "Unknown counter: " + kind });

  try {
    // Atomic: increment and read back in one statement.
    let row = await env.DB
      .prepare("UPDATE counters SET n = n + 1 WHERE name = ? RETURNING n")
      .bind(kind)
      .first();

    // First ever call for this counter — create the row, then retry once.
    if (!row) {
      await env.DB
        .prepare("INSERT OR IGNORE INTO counters (name, n) VALUES (?, 1000)")
        .bind(kind)
        .run();
      row = await env.DB
        .prepare("UPDATE counters SET n = n + 1 WHERE name = ? RETURNING n")
        .bind(kind)
        .first();
    }

    if (!row) return j({ ok: false, error: "Counter row missing after insert" });

    const n = Number(row.n);
    return j({ ok: true, kind, n, number: PREFIX[kind] + "-" + pad6(n) });

  } catch (e) {
    return j({ ok: false, error: String((e && e.message) || e) });
  }
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
