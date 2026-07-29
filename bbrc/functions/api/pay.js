const BASES = { sandbox:"https://sandbox.dev.clover.com", production:"https://www.clover.com" };
const PATH = "/invoicingcheckoutservice/v1/checkouts";
const UA = "BailBondReleaseCenter/1.0 (Cloudflare Pages)";

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.CLOVER_TOKEN) return j({ ok:false, error:"CLOVER_TOKEN not set" });
  if (!env.CLOVER_MID)   return j({ ok:false, error:"CLOVER_MID not set" });

  let b; try { b = await request.json(); } catch { return j({ ok:false, error:"Bad JSON" }); }

  const premium = cents(b.premium), collateral = cents(b.collateral);
  if (premium <= 0 && collateral <= 0) return j({ ok:false, error:"No amount to charge" });

  const defendant = safe(b.defendant,60) || "Bail bond";
  const receiptNo = safe(b.receiptNo,40);

  const lineItems = [];
  if (premium > 0)    lineItems.push({ name:("Bail premium - "+defendant).slice(0,100), price:premium, unitQty:1 });
  if (collateral > 0) lineItems.push({ name:("Collateral (refundable) - "+defendant).slice(0,100), price:collateral, unitQty:1 });

  const c = b.customer || {};
  const payload = {
    customer:{ firstName:safe(c.firstName,40), lastName:safe(c.lastName,40),
               email:safe(c.email,80), phoneNumber:digits(c.phone) },
    shoppingCart:{ lineItems, note:("Receipt "+receiptNo+" | Defendant: "+defendant).slice(0,200) }
  };
  if (env.SUCCESS_URL || env.CANCEL_URL) {
    payload.redirectUrls = {};
    if (env.SUCCESS_URL) payload.redirectUrls.success = env.SUCCESS_URL;
    if (env.CANCEL_URL) { payload.redirectUrls.failure = env.CANCEL_URL; payload.redirectUrls.cancel = env.CANCEL_URL; }
  }
  if (env.CLOVER_PAGE_UUID) payload.pageConfigUuid = env.CLOVER_PAGE_UUID;

  const base = BASES[(env.CLOVER_ENV||"sandbox").toLowerCase()] || BASES.sandbox;
  try {
    const r = await fetch(base+PATH, { method:"POST",
      headers:{ "Authorization":"Bearer "+env.CLOVER_TOKEN, "Content-Type":"application/json",
                "Accept":"application/json", "X-Clover-Merchant-Id":env.CLOVER_MID, "User-Agent":UA },
      body: JSON.stringify(payload) });
    const t = await r.text(); let d={};
    try { d = JSON.parse(t); } catch(_) { d = { raw:t.slice(0,600) }; }
    if (!r.ok) return j({ ok:false, status:r.status, error:(d.message||d.error||"Clover rejected the request"), detail:d, env:(env.CLOVER_ENV||"sandbox") });
    const url = d.href || d.checkoutPageUrl || d.url || (d.checkout && (d.checkout.href||d.checkout.url)) || "";
    return j({ ok:!!url, url, checkoutId:(d.checkoutSessionId||d.id||d.checkoutId||""), amountCents:premium+collateral, raw: url?undefined:d });
  } catch(e) { return j({ ok:false, error:String(e&&e.message||e) }); }
}
export const onRequestOptions = () => new Response(null,{headers:{ "Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type" }});
const j = o => new Response(JSON.stringify(o), { headers:{ "content-type":"application/json","Access-Control-Allow-Origin":"*" } });
function cents(v){ const n = Number(String(v==null?0:v).replace(/[^0-9.]/g,""))||0; return Math.round(n*100); }
const safe = (v,n)=>String(v==null?"":v).replace(/[<>]/g,"").trim().slice(0,n||60);
const digits = v=>String(v==null?"":v).replace(/\D/g,"").slice(0,15);
