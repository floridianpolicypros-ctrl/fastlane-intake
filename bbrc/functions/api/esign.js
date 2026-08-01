/* ============================================================
   BOLDSIGN E-SIGN — send the full executed packet
   ------------------------------------------------------------
   Florida requires the client to receive a copy of what they
   actually signed. A summary email is not enough. So the whole
   packet goes out as one envelope and comes back signed.

   WHY COORDINATES AND NOT TEMPLATES
   BoldSign's web template builder is a Syncfusion drag widget
   that ignores synthetic mouse events, and the free web plan
   caps templates at 2 — we have 5 packet variants. Placing
   fields by coordinate through the API sidesteps both, and the
   coordinates are already measured (BBRC-WEBSITE/lines-map.json,
   307 detected fill-lines across the scan).

   POST /api/esign
     { action:"ping" }
       -> { ok, env, documents } — proves the key authenticates
     { action:"preview", packet }
       -> { ok, packet, pages, fields } — no send, no credit used
     { action:"send", packet, signer:{name,email}, ... }
       -> { ok, documentId }

   BOLDSIGN_KEY is a Cloudflare Secret. It is never logged and
   never returned in a response, including on error.
   ============================================================ */

const API = "https://api.boldsign.com";

/* ---------- packet catalogue ----------
   `pages` lists the SOURCE page numbers of sunsurety-packet.pdf
   in the order they appear in that packet file. Field coordinates
   below are keyed by source page, so a field defined once lands
   correctly in every variant no matter how the numbering shifts.
   That shift is real: the Florida Addendum is source page 8 but
   sits on page 6 of the no-collateral packet.                    */
const PACKETS = {
  standard: {
    file: "BBRC-Packet-1_Standard_no-collateral_paid-in-full.pdf",
    pages: [1, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    label: "Bail Bond Packet"
  },
  collateral: {
    file: "BBRC-Packet-2_Collateral_vehicle-title-or-credit-card.pdf",
    pages: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    label: "Bail Bond Packet — Collateral"
  },
  plan: {
    file: "BBRC-Packet-3_Payment-plan_no-collateral.pdf",
    pages: [1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, "DISCLOSURE"],
    label: "Bail Bond Packet — Payment Plan"
  },
  collateral_plan: {
    file: "BBRC-Packet-4_Collateral_plus_payment-plan.pdf",
    pages: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, "DISCLOSURE"],
    label: "Bail Bond Packet — Collateral + Payment Plan"
  }
  /* 4R (real property) is deliberately absent. The mortgage must be
     wet-signed before two witnesses and a notary to be recordable
     (Fla. Stat. 689.01, 695.03). Sending it as an ordinary e-sign
     envelope produces an instrument the Clerk will not record. */
};

/* ---------- field coordinates, in PDF points ----------
   BoldSign bounds use a TOP-LEFT origin. lines-map.json stores
   PDF bottom-left y, so these were converted: yTop = height - y.
   Each box is parked just above its printed rule so the ink sits
   on the line rather than through it.                            */
/* Field types must match BoldSign's API enum, NOT the labels on the
   web app's field palette. The palette shows "Name"; the API rejects
   it with "The input was not valid." Valid types are Signature,
   Initial, TextBox, DateSigned, EditableDate, Title, Company,
   CheckBox, RadioButton, DropDown, Label, Image, Attachment.
   Printed name is a TextBox prefilled with the signer's name — we
   already know it, so there is no reason to make them type it. */
const H = 22;                                   // standard field height
const FIELDS = {
  8: [                                          // Florida Addendum — Indemnitor
    { k: "sig",   type: "Signature",  x: 145, ruleTop: 624, w: 250 },
    { k: "print", type: "TextBox",    x: 163, ruleTop: 647, w: 250, fillName: true },
    { k: "date",  type: "DateSigned", x: 312, ruleTop: 601, w: 150 }
  ],
  9: [                                          // Bail Bond Agreement, page 1 of 4
    { k: "sig2",   type: "Signature",  x: 385, ruleTop: 372, w: 190 },
    { k: "print2", type: "TextBox",    x: 385, ruleTop: 393, w: 190, fillName: true },
    { k: "date2",  type: "DateSigned", x: 341, ruleTop: 332, w: 150 }
  ]
};

/* Map a source page to its 1-based position inside a packet file. */
function pageIn(packet, sourcePage) {
  const i = PACKETS[packet].pages.indexOf(sourcePage);
  return i < 0 ? null : i + 1;
}

function buildFields(packet, signerName) {
  const out = [];
  for (const src of Object.keys(FIELDS)) {
    const pageNumber = pageIn(packet, Number(src));
    if (!pageNumber) continue;                  // page not in this variant
    for (const f of FIELDS[src]) {
      const fld = {
        id: f.k,
        name: f.k,
        fieldType: f.type,
        pageNumber,
        bounds: { x: f.x, y: f.ruleTop - H, width: f.w, height: H },
        isRequired: true
      };
      if (f.fillName && signerName) fld.value = signerName;
      out.push(fld);
    }
  }
  return out;
}

/* ============================================================ */

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.BOLDSIGN_KEY) {
    return j({ ok: false, error: "BOLDSIGN_KEY is not configured. Add it as a Secret in Cloudflare, then redeploy." }, 500);
  }

  let b;
  try { b = await request.json(); } catch { return j({ ok: false, error: "Bad JSON" }, 400); }
  const action = String(b.action || "send");

  /* ---------- ping: prove the key authenticates ---------- */
  if (action === "ping") {
    const r = await fetch(API + "/v1/document/list?page=1", { headers: { "X-API-KEY": env.BOLDSIGN_KEY } });
    const txt = await r.text();
    if (!r.ok) return j({ ok: false, status: r.status, error: shorten(txt) }, 502);
    let d = {}; try { d = JSON.parse(txt); } catch {}
    return j({ ok: true, status: r.status, documents: (d.result && d.result.length) || 0, totalRecords: d.totalRecords });
  }

  const packet = String(b.packet || "standard");
  if (!PACKETS[packet]) return j({ ok: false, error: "Unknown packet '" + packet + "'. Use one of: " + Object.keys(PACKETS).join(", ") }, 400);

  /* ---------- preview: coordinates only, costs nothing ---------- */
  if (action === "preview") {
    return j({ ok: true, packet, file: PACKETS[packet].file, pages: PACKETS[packet].pages.length, fields: buildFields(packet, "Preview Name") });
  }

  /* ---------- send ---------- */
  const name  = String(b.signer && b.signer.name || "").trim();
  const email = String(b.signer && b.signer.email || "").trim().toLowerCase();
  if (!name)  return j({ ok: false, error: "Signer name is required" }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return j({ ok: false, error: "A valid signer email is required" }, 400);

  /* The packet PDF is served as a static asset by this same Pages
     project, so fetch it off our own origin rather than bundling
     megabytes of base64 into the Worker. */
  const url = new URL("/assets/packets/" + PACKETS[packet].file, request.url);
  const pdf = await fetch(url.toString());
  if (!pdf.ok) return j({ ok: false, error: "Packet PDF not found at " + url.pathname + " (" + pdf.status + ")" }, 500);

  const bytes = new Uint8Array(await pdf.arrayBuffer());
  const b64   = toBase64(bytes);

  const agencyCC = String(env.AGENCY_BCC || "bailbondreleasecenter@gmail.com").trim().toLowerCase();

  const payload = {
    Title: PACKETS[packet].label + (b.defendant ? " — " + b.defendant : ""),
    Message: "Please review the full packet and sign. A signed copy is emailed to you automatically.",
    Files: ["data:application/pdf;base64," + b64],
    Signers: [{
      name,
      emailAddress: email,
      signerType: "Signer",
      locale: "EN",
      formFields: buildFields(packet, name)
    }],
    /* Both parties get the executed document without anyone remembering to
       forward it. BoldSign rejects the whole request if a CC address is also
       a signer ("email(s) are already specified as signers"), which happens
       whenever the agency signs its own test envelope — so drop it then. */
    CC: agencyCC && agencyCC !== email ? [{ emailAddress: agencyCC }] : undefined,
    EnableSigningOrder: false,
    /* Ties the envelope back to the receipt number so the audit trail
       and the D1 counter refer to the same transaction. */
    Labels: [b.receiptNo || "no-receipt-no"]
  };

  const r = await fetch(API + "/v1/document/send", {
    method: "POST",
    headers: { "X-API-KEY": env.BOLDSIGN_KEY, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload)
  });
  const txt = await r.text();
  if (!r.ok) return j({ ok: false, status: r.status, error: shorten(txt) }, 502);

  let d = {}; try { d = JSON.parse(txt); } catch {}
  /* Sending is asynchronous — a documentId here means accepted, not
     delivered. Only the Sent / SendFailed webhook confirms delivery,
     so do not report success to the client off this alone. */
  return j({ ok: true, documentId: d.documentId, note: "Accepted. Await the Sent webhook before telling the client it went out." });
}

export const onRequestOptions = () => new Response(null, {
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  }
});

/* ---------- helpers ---------- */

/* btoa() on a huge string blows the stack. Chunk it. */
function toBase64(bytes) {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(s);
}

/* Upstream errors can echo back request content. Cap what we surface. */
const shorten = t => String(t || "").slice(0, 600);

const j = (o, status) => new Response(JSON.stringify(o), {
  status: status || 200,
  headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" }
});
