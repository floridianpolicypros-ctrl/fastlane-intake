const MODEL = "claude-sonnet-5";
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.ANTHROPIC_API_KEY) return j({ error:"ANTHROPIC_API_KEY not set", fields:{} });
  let b; try { b = await request.json(); } catch { return j({ error:"Bad JSON", fields:{} }); }
  const { docType="document", mimeType="", dataBase64="" } = b;
  if (!dataBase64) return j({ error:"No file data", fields:{} });
  const isPdf = String(mimeType).toLowerCase().includes("pdf");
  const media = isPdf
    ? { type:"document", source:{ type:"base64", media_type:"application/pdf", data:dataBase64 } }
    : { type:"image", source:{ type:"base64", media_type:mimeType||"image/jpeg", data:dataBase64 } };
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method:"POST",
      headers:{ "content-type":"application/json","x-api-key":env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01" },
      body: JSON.stringify({ model:MODEL, max_tokens:1500,
        messages:[{ role:"user", content:[ media, { type:"text", text:prompt(docType) } ] }] }) });
    const out = await r.json();
    if (out.error) return j({ error:(out.error.message||"AI error"), fields:{} });
    const text = (out.content||[]).map(c=>c.text||"").join("");
    return j({ fields: parse(text) });
  } catch(e) { return j({ error:String(e&&e.message||e), fields:{} }); }
}
export const onRequestOptions = () => new Response(null,{headers:{ "Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type" }});
const j = o => new Response(JSON.stringify(o), { headers:{ "content-type":"application/json","Access-Control-Allow-Origin":"*" } });
function parse(t){ try { const m=t.match(/\{[\s\S]*\}/); return m?JSON.parse(m[0]):{}; } catch { return {}; } }
function prompt(docType){
return `You are reading a document a client uploaded to a bail bond intake form.
Document type: "${docType}" (id_front, id_back, selfie, blotter, booking, imm_doc, coll_doc or misc).

Extract EVERY value you can clearly read and return ONLY a JSON object using these EXACT keys.
Omit any key you cannot find - never guess. Dates as YYYY-MM-DD. Numbers digits only.

  firstName, lastName, middleName, nickname
  dob            (date of birth on the ID)
  address        (full street address, city, state, zip)
  dlNumber       (driver license number)
  dlState        (2-letter issuing state, e.g. FL)
  sex            (M or F)
  race, nationality, whereBorn
  ssn            (only if plainly printed)
  phone, email
  defName        (a defendant name, only if the document clearly names one)
  bond           (TOTAL bond/bail dollar amount, digits only)
  bondList       (ARRAY of individual bond amounts, one per charge, e.g. [500,1000])
  charges        (short text of the charge(s))
  booking        (booking number)
  alienNo        (alien number / A-number)
  immStatus      (one of: Lawful permanent resident (green card), Visa or work permit,
                  Asylum / pending case, DACA, No immigration documents)

Notes:
- A driver license (id_front) has full name, DOB, address, license number, issuing state.
  Split the name into firstName/lastName.
- id_back often has an address - pull it if visible.
- For "blotter" or "booking" (a jail booking page): read EACH charge's bond amount into
  bondList, and also return the sum in bond. Return defName if a defendant is named.
- For "imm_doc": return alienNo and immStatus if visible.
- For "selfie" there is usually no text; return {}.
- For "misc" extract any key above that appears anywhere.

Return ONLY the JSON object, no explanation.`;
}
