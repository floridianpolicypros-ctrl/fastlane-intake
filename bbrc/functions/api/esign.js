/* ============================================================
   BOLDSIGN E-SIGN — send the full executed packet
   ------------------------------------------------------------
   Florida requires the client to hold a copy of what they
   actually signed, so the whole packet goes out as one envelope
   and comes back signed.

   ARCHITECTURE — WHY IT LOOKS LIKE THIS
   1. Fields are positioned by INVISIBLE TEXT TAGS baked into the
      packet PDFs offline (BBRC-WEBSITE/bake_tags.py). BoldSign
      builds each field where its tag sits, so placement is
      controlled in a renderer we can look at. An earlier version
      used bounds{x,y} and put the signature on the wrong line —
      BoldSign stored the numbers verbatim but interprets them in
      units its docs never state. Tags remove that guess entirely.
   2. The RECEIPT is not in the tagged packet. It is the agency's
      numbered financial record under Fla. Admin. Code 69B-221.120
      and a client must not be able to edit the premium or the
      receipt number. The site already renders a fully stamped
      receipt with receiptPDF(); that PDF is passed as the FIRST
      file and BoldSign concatenates the envelope.
   3. APPLICATION data is prefilled into Textbox fields, not
      burned in, because page 4 has the indemnitor warranting the
      declarations are true. If we mis-read an address off a
      scanned licence they must be able to correct it before
      swearing to it.
   Consequence: this Worker never manipulates a PDF, so it needs
   no PDF library and no build step.

   POST /api/esign
     { action:"ping" }                      -> auth check
     { action:"preview", packet }           -> page count + field ids
     { action:"inspect", documentId }       -> what BoldSign stored
     { action:"signlink", documentId,email} -> re-issue signing link
     { action:"send", packet, signer, mode, data, receiptPdf }

   BOLDSIGN_KEY is a Cloudflare Secret, never logged or returned.
   ============================================================ */

const API = "https://api.boldsign.com";

const PACKETS = {
  standard:        { file: "BBRC-Tagged-standard.pdf",        label: "Bail Bond Packet" },
  collateral:      { file: "BBRC-Tagged-collateral.pdf",      label: "Bail Bond Packet — Collateral" },
  plan:            { file: "BBRC-Tagged-plan.pdf",            label: "Bail Bond Packet — Payment Plan" },
  collateral_plan: { file: "BBRC-Tagged-collateral_plan.pdf", label: "Bail Bond Packet — Collateral + Payment Plan" }
  /* Real-property collateral is deliberately absent. A recordable
     Florida mortgage needs two witnesses and a notary (Fla. Stat.
     689.01, 695.03); e-signing one produces an instrument the
     Clerk will not record, so it must not be sendable by accident. */
};

/* Tag ids baked into the PDFs. Anything not on this list is ignored
   rather than sent to BoldSign, so a stray form key cannot 400 the
   whole submission. */
const DATA_FIELDS = [
  "def_name", "bond_amount", "court_name", "county", "relationship",
  "indem_name", "nickname", "phone_home", "phone_work", "phone_mobile",
  "email", "address", "how_long", "landlord", "former_address"
];

/* ============================================================ */

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.BOLDSIGN_KEY) return j({ ok: false, error: "BOLDSIGN_KEY is not configured" }, 500);

  let b; try { b = await request.json(); } catch { return j({ ok: false, error: "Bad JSON" }, 400); }
  const action = String(b.action || "send");

  if (action === "ping") {
    const r = await fetch(API + "/v1/document/list?page=1", { headers: { "X-API-KEY": env.BOLDSIGN_KEY } });
    const t = await r.text();
    if (!r.ok) return j({ ok: false, status: r.status, error: shorten(t) }, 502);
    let d = {}; try { d = JSON.parse(t); } catch {}
    return j({ ok: true, documents: (d.result && d.result.length) || 0 });
  }

  if (action === "inspect") {
    if (!b.documentId) return j({ ok: false, error: "documentId is required" }, 400);
    const r = await fetch(API + "/v1/document/properties?documentId=" + encodeURIComponent(b.documentId),
      { headers: { "X-API-KEY": env.BOLDSIGN_KEY } });
    const t = await r.text();
    if (!r.ok) return j({ ok: false, status: r.status, error: shorten(t) }, 502);
    let d = {}; try { d = JSON.parse(t); } catch {}
    const fields = [];
    for (const s of (d.signerDetails || [])) {
      for (const f of (s.formFields || [])) {
        const v = f.value;
        fields.push({ id: f.id, type: f.fieldType, page: f.pageNumber, bounds: f.bounds,
                      filled: !(v === null || v === undefined || v === ""),
                      value: (typeof v === "string" && v.length > 60) ? "<" + v.length + " bytes>" : v });
      }
    }
    return j({ ok: true, status: d.status, count: fields.length, fields });
  }

  if (action === "signlink") {
    if (!b.documentId) return j({ ok: false, error: "documentId is required" }, 400);
    const v = await isVerified(env, b.email || b.phone);
    if (!v.ok) return j({ ok: false, error: v.why, needsVerification: true }, 403);
    const link = await embedLink(env, request, b.documentId, b.email, b.phone);
    return link.ok ? j(link) : j(link, 502);
  }

  const packet = String(b.packet || "standard");
  if (!PACKETS[packet]) return j({ ok: false, error: "Unknown packet '" + packet + "'" }, 400);

  if (action === "preview") {
    return j({ ok: true, packet, file: PACKETS[packet].file, dataFields: DATA_FIELDS });
  }

  /* ---------------- send ---------------- */
  const mode  = String(b.mode || "email").toLowerCase();
  const name  = String(b.signer && b.signer.name || "").trim();
  const email = String(b.signer && b.signer.email || "").trim().toLowerCase();
  const phone = String(b.signer && b.signer.phone || "").replace(/\D/g, "");
  if (!name) return j({ ok: false, error: "Signer name is required" }, 400);

  if (mode === "sms") {
    if (phone.replace(/^1/, "").length !== 10) return j({ ok: false, error: "A 10-digit US mobile number is required for SMS" }, 400);
  } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return j({ ok: false, error: "A valid signer email is required" }, 400);
  }

  /* Gate embedded links BEFORE creating anything: checking afterwards
     would burn a document credit on a request we intend to refuse and
     leave an orphan envelope behind. */
  if (mode === "embedded") {
    const v = await isVerified(env, email);
    if (!v.ok) return j({ ok: false, error: v.why, needsVerification: true }, 403);
  }

  const url = new URL("/assets/packets/" + PACKETS[packet].file, request.url);
  const pdf = await fetch(url.toString());
  if (!pdf.ok) return j({ ok: false, error: "Packet not found at " + url.pathname + " (" + pdf.status + ")" }, 500);
  const packetB64 = toBase64(new Uint8Array(await pdf.arrayBuffer()));

  /* Receipt first so the executed PDF opens on the statement of charges,
     the way the paper packet does. */
  const files = [];
  if (b.receiptPdf) {
    const rb = String(b.receiptPdf).replace(/^data:[^,]*,/, "");
    if (rb.length > 40) files.push("data:application/pdf;base64," + rb);
  }
  files.push("data:application/pdf;base64," + packetB64);

  const signer = { name, signerType: "Signer", locale: "EN" };
  if (mode === "sms") {
    /* BoldSign sends the text itself — no Twilio account and no A2P 10DLC
       carrier registration, which would otherwise be a multi-week wait. */
    signer.deliveryMode = "SMS";
    signer.phoneNumber = { countryCode: "+1", number: phone.replace(/^1/, "") };
    if (email) signer.emailAddress = email;
  } else {
    signer.emailAddress = email;
  }

  const agencyCC = String(env.AGENCY_BCC || "bailbondreleasecenter@gmail.com").trim().toLowerCase();
  const payload = {
    Title: PACKETS[packet].label + (b.defendant ? " — " + b.defendant : ""),
    Message: "Please review the full packet and sign. A signed copy is sent to you automatically.",
    Files: files,
    Signers: [signer],
    /* BoldSign rejects the entire request if a CC address is also a signer,
       which is exactly what happens when the agency tests on itself. */
    CC: agencyCC && agencyCC !== email ? [{ emailAddress: agencyCC }] : undefined,
    EnableSigningOrder: false,
    Labels: [b.receiptNo || "no-receipt-no"]
  };

  const r = await fetch(API + "/v1/document/send", {
    method: "POST",
    headers: { "X-API-KEY": env.BOLDSIGN_KEY, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload)
  });
  const t = await r.text();
  if (!r.ok) return j({ ok: false, status: r.status, error: shorten(t) }, 502);
  let d = {}; try { d = JSON.parse(t); } catch {}
  const documentId = d.documentId;

  /* Prefill the application. Signature, DateSigned, Name and Title cannot be
     prefilled by design — only the client can produce those. */
  let prefill = null;
  if (documentId && b.data) {
    prefill = await prefillFields(env, documentId, b.data, name);
  }

  if (mode === "embedded" && documentId) {
    const link = await embedLink(env, request, documentId, email, null);
    return j({ ok: true, documentId, signLink: link.signLink, linkError: link.error, prefill });
  }

  /* A documentId means accepted, not delivered. Only the Sent / SendFailed
     webhook confirms it actually went out. */
  return j({ ok: true, documentId, mode, prefill,
             note: "Accepted. Await the Sent webhook before telling the client it went out." });
}

export const onRequestOptions = () => new Response(null, {
  headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }
});

/* ============================================================ */

async function prefillFields(env, documentId, data, signerName) {
  const fields = [];
  for (const id of DATA_FIELDS) {
    const v = data[id];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      fields.push({ Id: id, Value: String(v) });
    }
  }
  /* The printed-name blocks under each signature are ours to fill — the
     client already told us their name, twice is one time too many. */
  if (signerName) {
    fields.push({ Id: "indem_print_1", Value: signerName });
    fields.push({ Id: "indem_print_2", Value: signerName });
  }
  if (!fields.length) return { attempted: 0 };

  /* Documents send asynchronously; prefill only works once the document is
     in-progress, so a first attempt can legitimately be too early. */
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await fetch(API + "/v1/document/prefillFields?documentId=" + encodeURIComponent(documentId), {
      method: "PATCH",
      headers: { "X-API-KEY": env.BOLDSIGN_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ Fields: fields })
    });
    if (r.ok) return { attempted: fields.length, ok: true, attempt };
    const txt = await r.text();
    if (attempt === 3) return { attempted: fields.length, ok: false, status: r.status, error: shorten(txt) };
    await new Promise(res => setTimeout(res, 1500 * attempt));
  }
}

const VERIFY_WINDOW_MS = 24 * 60 * 60 * 1000;

async function isVerified(env, contact) {
  if (!contact) return { ok: false, why: "No contact supplied" };
  if (env.ESIGN_SKIP_VERIFY === "true") return { ok: true, why: "gate disabled" };
  if (!env.DB) return { ok: false, why: "Verification database is unavailable" };
  try {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS verified_contacts (contact TEXT PRIMARY KEY, method TEXT, verified_at INTEGER, ip TEXT)").run();
    const row = await env.DB.prepare("SELECT method,verified_at FROM verified_contacts WHERE contact=?")
      .bind(String(contact).trim().toLowerCase()).first();
    if (!row) return { ok: false, why: "That contact has not been verified yet" };
    if (Date.now() - Number(row.verified_at) > VERIFY_WINDOW_MS) return { ok: false, why: "That verification has expired — send a new code" };
    return { ok: true, method: row.method };
  } catch {
    /* Fail closed: guessing produces an indemnity agreement nobody can
       attribute to a person. */
    return { ok: false, why: "Could not check verification" };
  }
}

async function embedLink(env, request, documentId, email, phone) {
  const q = new URLSearchParams({ documentId });
  if (email) q.set("signerEmail", email);
  if (phone) { q.set("countryCode", "+1"); q.set("phoneNumber", String(phone).replace(/\D/g, "").replace(/^1/, "")); }
  q.set("redirectUrl", new URL("/indemnitor?signed=1", request.url).toString());
  /* A link that never expires is one somebody can use six months later. */
  const till = new Date(Date.now() + 2 * 24 * 3600 * 1000);
  q.set("signLinkValidTill", (till.getMonth() + 1) + "/" + till.getDate() + "/" + till.getFullYear());

  const r = await fetch(API + "/v1/document/getEmbeddedSignLink?" + q.toString(), { headers: { "X-API-KEY": env.BOLDSIGN_KEY } });
  const t = await r.text();
  if (!r.ok) return { ok: false, status: r.status, error: shorten(t) };
  let d = {}; try { d = JSON.parse(t); } catch {}
  return { ok: true, signLink: d.signLink };
}

/* btoa() on a multi-megabyte string overflows the stack. Chunk it. */
function toBase64(bytes) {
  let s = ""; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}

const shorten = t => String(t || "").slice(0, 600);
const j = (o, status) => new Response(JSON.stringify(o), {
  status: status || 200,
  headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" }
});
