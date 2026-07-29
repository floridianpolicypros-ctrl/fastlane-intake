export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.RESEND_API_KEY) return j({ ok:false, error:"RESEND_API_KEY not set" });
  let b; try { b = await request.json(); } catch { return j({ ok:false, error:"Bad JSON" }); }

  const to  = (b.to||[]).filter(Boolean);
  const cc  = (b.cc||[]).filter(Boolean);
  let  bcc  = (b.bcc||[]).filter(Boolean);
  if (env.AGENCY_BCC && !bcc.includes(env.AGENCY_BCC) && !to.includes(env.AGENCY_BCC)) bcc.push(env.AGENCY_BCC);
  if (!to.length && !bcc.length) return j({ ok:false, error:"No recipients" });

  const attachments = (b.attachments||[])
    .filter(a=>a && a.filename && a.contentBase64)
    .map(a=>({ filename:a.filename, content:a.contentBase64 }));

  const payload = {
    from: env.FROM_ADDRESS || "Bail Bond Release Center <onboarding@resend.dev>",
    to: to.length ? to : [env.AGENCY_BCC].filter(Boolean),
    subject: b.subject || "Bail documents",
    reply_to: env.REPLY_TO || undefined
  };
  if (cc.length) payload.cc = cc;
  if (bcc.length) payload.bcc = bcc;
  if (b.text) payload.text = b.text;
  if (b.html) payload.html = b.html;
  if (attachments.length) payload.attachments = attachments;

  const r = await fetch("https://api.resend.com/emails", { method:"POST",
    headers:{ "Authorization":"Bearer "+env.RESEND_API_KEY, "Content-Type":"application/json" },
    body: JSON.stringify(payload) });
  const out = await r.json().catch(()=>({}));
  if (!r.ok) return j({ ok:false, error:(out.message||"Send failed"), detail:out });
  return j({ ok:true, id:out.id });
}
export const onRequestOptions = () => new Response(null,{headers:{ "Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type" }});
const j = o => new Response(JSON.stringify(o), { headers:{ "content-type":"application/json","Access-Control-Allow-Origin":"*" } });
