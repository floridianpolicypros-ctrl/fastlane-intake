/* ============================================================
   BOLDSIGN E-SIGN — send the full executed packet
   ------------------------------------------------------------
   Florida requires the client to hold a copy of what they
   actually signed, so the whole packet goes out as one envelope
   and comes back signed.

   ARCHITECTURE — WHY IT LOOKS LIKE THIS
   1. Fields are positioned by explicit bounds, authored in PDF
      POINTS and converted to BoldSign's 96-DPI pixels on the way
      out (see THE COORDINATE FIX). A text-tag version was built
      first as a way to dodge the unknown unit; once the unit was
      measured, bounds became simpler — values ride inline in the
      same call, so there is no second prefill request to fail.
      The packet PDFs still carry the invisible tags; without
      UseTextTags BoldSign ignores them, and they cost nothing.
   2. The RECEIPT is not in the packet. It is the agency's
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
  standard:        { file: "BBRC-Tagged-standard.pdf",        label: "Bail Bond Packet",
                     pages: [4, 5, 6, 7, 8, 9, 10, 11, 12] },
  collateral:      { file: "BBRC-Tagged-collateral.pdf",      label: "Bail Bond Packet — Collateral",
                     pages: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  plan:            { file: "BBRC-Tagged-plan.pdf",            label: "Bail Bond Packet — Payment Plan",
                     pages: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13] },
  collateral_plan: { file: "BBRC-Tagged-collateral_plan.pdf", label: "Bail Bond Packet — Collateral + Payment Plan",
                     pages: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] }
  /* Real-property collateral is deliberately absent. A recordable
     Florida mortgage needs two witnesses and a notary (Fla. Stat.
     689.01, 695.03); e-signing one produces an instrument the
     Clerk will not record, so it must not be sendable by accident. */
};

/* ---------- THE COORDINATE FIX ----------
   BoldSign's bounds are PIXELS AT 96 DPI with a top-left origin. Their
   docs never say so. Measured on the first signed packet: a signature
   sent at y=602 landed at ~456pt down the page, and 456/602 = 0.757,
   i.e. 72/96. Everything we had was rendering at three-quarters scale,
   which is why placement looked close but always high and left.

   All geometry below is authored in PDF POINTS — the same units as
   lines-map.json, which is what we can actually measure and render —
   and converted on the way out. Never hand-convert a coordinate; put
   points in the table and let px() do it. */
const PT_TO_PX = 96 / 72;
const px = v => Math.round(v * PT_TO_PX * 100) / 100;

/* ---------- VERTICAL ALIGNMENT ----------
   BoldSign TOP-aligns text inside the field box. With a 22pt box whose
   bottom sat on the printed rule, every value rendered ~12pt above its
   line — measured on the live document, consistently across all 15
   application fields. So text boxes are short and sit just above the
   rule, which puts the baseline on the line the way a pen would.

   Signatures are different: the image is scaled to fill the box, so it
   wants the taller box and was already landing correctly. */
const TEXT_H  = 14;   // text / date box height, points
const TEXT_UP = 12;   // text box top, points above the rule
const SIG_H   = 22;   // signature box height, points
const SIG_UP  = 22;   // signature box top, points above the rule

/* Keyed by SOURCE page of sunsurety-packet.pdf. Field position is the
   TOP of the box in points from the page top; each box is parked just
   above its printed rule so ink sits on the line. */
const FIELDS = {
  4: [
    { id: "def_name",       x: 40,  ruleTop: 227, w: 430 },
    { id: "bond_amount",    x: 100, ruleTop: 265, w: 160 },
    { id: "court_name",     x: 275, ruleTop: 265, w: 260 },
    { id: "county",         x: 55,  ruleTop: 285, w: 280 },
    { id: "relationship",   x: 215, ruleTop: 341, w: 300 },
    { id: "indem_name",     x: 90,  ruleTop: 361, w: 260 },
    { id: "nickname",       x: 395, ruleTop: 361, w: 165 },
    { id: "phone_home",     x: 168, ruleTop: 388, w: 110 },
    { id: "phone_work",     x: 320, ruleTop: 388, w: 110 },
    { id: "phone_mobile",   x: 480, ruleTop: 388, w: 85  },
    { id: "email",          x: 84,  ruleTop: 408, w: 300 },
    { id: "address",        x: 165, ruleTop: 428, w: 350 },
    { id: "how_long",       x: 528, ruleTop: 428, w: 45  },
    { id: "landlord",       x: 265, ruleTop: 449, w: 300 },
    { id: "former_address", x: 170, ruleTop: 469, w: 340 }
  ],
  8: [
    { id: "indem_sig_1",   x: 145, ruleTop: 624, w: 250, type: "Signature",  required: true },
    { id: "indem_print_1", x: 163, ruleTop: 647, w: 250, fillName: true },
    { id: "indem_date_1",  x: 312, ruleTop: 601, w: 150, type: "DateSigned", required: true }
  ],
  9: [
    { id: "indem_sig_2",   x: 385, ruleTop: 372, w: 190, type: "Signature",  required: true },
    { id: "indem_print_2", x: 385, ruleTop: 393, w: 190, fillName: true },
    { id: "indem_date_2",  x: 341, ruleTop: 332, w: 150, type: "DateSigned", required: true }
  ]
};

/* Source page -> 1-based position inside this packet variant. The offset is
   real: the Florida Addendum is source page 8 but page 5 of the no-collateral
   packet, and hardcoding page numbers would put signatures on Fraud Warnings. */
function pageIn(packet, sourcePage) {
  const i = PACKETS[packet].pages.indexOf(sourcePage);
  return i < 0 ? null : i + 1;
}

function buildFields(packet, data, signerName) {
  const out = [];
  for (const src of Object.keys(FIELDS)) {
    const pageNumber = pageIn(packet, Number(src));
    if (!pageNumber) continue;
    for (const f of FIELDS[src]) {
      const isSig = f.type === "Signature";
      const h  = isSig ? SIG_H  : TEXT_H;
      const up = isSig ? SIG_UP : TEXT_UP;
      const fld = {
        id: f.id,
        name: f.id,
        fieldType: f.type || "TextBox",
        pageNumber,
        bounds: { x: px(f.x), y: px(f.ruleTop - up), width: px(f.w), height: px(h) },
        isRequired: !!f.required
      };
      const v = f.fillName ? signerName : (data && data[f.id]);
      /* Signature and DateSigned cannot carry a value — only the signer
         produces those, and BoldSign rejects the field if you try. */
      if (!f.type && v !== undefined && v !== null && String(v).trim() !== "") {
        fld.value = String(v);
      }
      out.push(fld);
    }
  }
  return out;
}

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
    const f = buildFields(packet, b.data || {}, "Preview Name");
    return j({ ok: true, packet, file: PACKETS[packet].file, pages: PACKETS[packet].pages.length,
               fieldCount: f.length, fields: f });
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

  const signer = { name, signerType: "Signer", locale: "EN",
                   formFields: buildFields(packet, b.data || {}, name) };
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

  /* Values ride along inside formFields, so there is no second prefill call
     to fail. BoldSign's prefillFields endpoint returned 500 on every attempt. */
  const prefill = { inline: true };

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
