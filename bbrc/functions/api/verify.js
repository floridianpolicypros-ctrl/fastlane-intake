const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
export async function onRequestPost(context) {
  const { request, env } = context;
  let b; try { b = await request.json(); } catch { return j({ ok:false, error:"Bad JSON" }); }
  const provider = String(b.provider||"pbso").toLowerCase();
  if (provider !== "pbso") return j({ ok:false, error:"No automatic lookup for this jail yet" });
  const lastName = clean(b.lastName), firstName = clean(b.firstName);
  if (!lastName) return j({ ok:false, error:"lastName required" });
  try { return j({ ok:true, source:"PBSO Booking Blotter", ...(await pbso(lastName, firstName, Number(b.days)||45, !!b.debug, env, !!b.probe)) }); }
  catch(e) { return j({ ok:false, source:"PBSO Booking Blotter", error:String(e&&e.message||e) }); }
}
export const onRequestOptions = () => new Response(null,{headers:{ "Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type" }});
const j = o => new Response(JSON.stringify(o), { headers:{ "content-type":"application/json","Access-Control-Allow-Origin":"*" } });
const clean = v => String(v||"").replace(/[^a-zA-Z\-'. ]/g,"").trim().slice(0,40);
const money = v => Number(String(v).replace(/[^0-9.]/g,""))||0;
const pad = n => String(n).padStart(2,"0");
const mdy = d => pad(d.getMonth()+1)+"/"+pad(d.getDate())+"/"+d.getFullYear();

async function pbso(lastName, firstName, days, debug, env, probe) {
  /* PBSO sits behind an F5 firewall that rejects server-side clients. Proven:
     it hands out a TS… session cookie and then returns "Request Rejected" with
     a support ID. Headers cannot fix it — F5 fingerprints the TLS handshake,
     and a Worker's handshake is not Chrome's.
     If a ScrapingBee key is configured we go through a REAL browser on a
     RESIDENTIAL ip, which addresses both possible causes at once. */
  if (env && env.SCRAPINGBEE_KEY) return pbsoViaBee(lastName, firstName, days, debug, env, probe);
  const base = "https://www3.pbso.org/blotter/";
  /* A bare user-agent is itself a fingerprint. Real Chrome sends a specific
     header set in a specific order; F5 checks for it. Free to try before
     paying for a headless browser. */
  const BH = {
    "user-agent": UA,
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "accept-encoding": "gzip, deflate, br",
    "upgrade-insecure-requests": "1",
    "sec-ch-ua": '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "cache-control": "max-age=0"
  };
  const g = await fetch(base+"index.cfm", { headers: BH });
  if (!g.ok) throw new Error("Blotter form unreachable ("+g.status+")");
  const html = await g.text();
  // Cookie harvest. In the Workers runtime the correct API is getSetCookie();
  // getAll() does not exist there, which is why the handshake was silently
  // dropping the session and every search came back with zero rows.
  let jar = [];
  try { if (typeof g.headers.getSetCookie === "function") jar = g.headers.getSetCookie() || []; } catch(_) {}
  if (!jar.length) { try { if (typeof g.headers.getAll === "function") jar = g.headers.getAll("set-cookie") || []; } catch(_) {} }
  if (!jar.length) { const c = g.headers.get("set-cookie"); if (c) jar = c.split(/,(?=[^;,]+=)/); }
  const cookies = jar.map(c => String(c).split(";")[0].trim()).filter(Boolean).join("; ");

  const hidden = {};
  const re = /<input[^>]*type=["']?hidden["']?[^>]*>/gi; let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const n = (tag.match(/name=["']([^"']+)["']/i)||[])[1];
    const v = (tag.match(/value=["']([^"']*)["']/i)||[])[1] || "";
    if (n) hidden[n] = v;
  }
  const end = new Date(), start = new Date(end.getTime()-days*864e5);
  const form = new URLSearchParams();
  for (const k in hidden) form.set(k, hidden[k]);
  form.set("start_date", mdy(start)); form.set("end_date", mdy(end));
  form.set("lastName", lastName); form.set("firstName", firstName||"");
  form.set("Address1",""); form.set("City",""); form.set("Statute",""); form.set("arrestingAgency","");

  const r = await fetch(base+"searchresults.cfm", { method:"POST",
    headers:{ ...BH,
              "content-type":"application/x-www-form-urlencoded",
              "sec-fetch-site":"same-origin",
              referer: base+"index.cfm", origin:"https://www3.pbso.org",
              ...(cookies?{cookie:cookies}:{}) },
    body: form.toString() });
  if (!r.ok) throw new Error("Search failed ("+r.status+")");
  const text = strip(await r.text());
  const out = parse(text);
  // Diagnostics so a zero-result run can be told apart from a broken handshake
  // without having to guess. Only returned when the caller asks for it.
  if (debug) {
    out.debug = {
      cookiesSent: cookies || "(none)",
      hiddenFields: hidden,
      dateRange: mdy(start) + " - " + mdy(end),
      responseChars: text.length,
      responseHead: text.slice(0, 1200)
    };
  }
  return out;
}
async function pbsoViaBee(lastName, firstName, days, debug, env, probe){
  const base = "https://www3.pbso.org/blotter/";
  const end = new Date(), start = new Date(end.getTime()-days*864e5);
  // Drive the real form in a real browser: fill, submit, wait for results.
  /* PROVEN CONFIGURATION — do not "improve" without measuring.
     This exact shape returned a correct live record (SMITH, JAMIE L with
     per-charge bonds) in 41s. Two later attempts to control the date range
     broke it: driving the datepicker stopped the submit from firing, and the
     heavier scenarios blew past Cloudflare's ~100s request limit.

     The date window is therefore left at the blotter's own default, which is
     the right trade for this app: we are pricing a bond for someone who was
     just arrested, not researching a year of history. Arrest history is a
     separate job for a records provider, not this scraper. */
  const scenario = { instructions: [
    { wait: 1500 },
    { fill: ["input[name=lastName]", lastName] },
    ...(firstName ? [{ fill: ["input[name=firstName]", firstName] }] : []),
    { click: "input[type=submit]" },
    { wait: 2500 }
  ]};
  const u = new URL("https://app.scrapingbee.com/api/v1/");
  u.searchParams.set("api_key", env.SCRAPINGBEE_KEY);
  u.searchParams.set("url", base + "index.cfm");
  u.searchParams.set("premium_proxy", "true");   // residential ip
  u.searchParams.set("country_code", "us");
  /* PROBE MODE: just fetch the page, no JS, no form driving. This answers the
     only question that matters first — can a residential IP reach PBSO at all?
     The full scenario costs ~25 credits and 2+ minutes; this costs ~10 and a
     few seconds. Diagnose cheap before diagnosing expensive. */
  if (probe) {
    u.searchParams.set("render_js", "false");
  } else {
    u.searchParams.set("render_js", "true");
    u.searchParams.set("js_scenario", JSON.stringify(scenario));
  }

  const r = await fetch(u.toString());
  const body = await r.text();
  if (probe) {
    const t = strip(body);
    const blocked = /Request Rejected|support ID/i.test(t);
    return { matches: [], via: "scrapingbee-probe",
      note: !r.ok ? ("probe HTTP " + r.status)
           : blocked ? "REACHED but PBSO still rejected the request"
           : "PBSO ALLOWED the request — automation is possible",
      debug: { status: r.status, blocked, chars: t.length, head: t.slice(0, 500) } };
  }
  if (!r.ok) {
    return { matches: [], note: "Lookup service error " + r.status,
             debug: debug ? { via:"scrapingbee", status:r.status, body: body.slice(0,600) } : undefined };
  }
  const text = strip(body);
  const out = parse(text);
  out.via = "scrapingbee";
  out.window = "blotter default (recent bookings)";
  if (debug) out.debug = { via:"scrapingbee", requestedWindow: out.window, responseChars:text.length, responseHead:text.slice(0,1200) };
  return out;
}
function strip(h){ return h
  .replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ")
  .replace(/<br\s*\/?>/gi,"\n").replace(/<\/(tr|div|p|td|h\d)>/gi,"\n")
  .replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&")
  .replace(/[ \t]+/g," ").replace(/\n\s*\n+/g,"\n").trim(); }
function parse(text){
  if (/0 matches retrieved/i.test(text) || /no\s+(records|matches)\s+(found|retrieved)/i.test(text))
    return { matches:[], note:"No booking records found in that date range." };
  /* Require evidence this is an actual booking record. Without this, the
     search form's own labels parse as people. */
  const blocks = text.split(/(?=Name:\s)/g)
    .filter(b => /Name:\s/.test(b) && /(Booking Date\/Time|Facility:)/i.test(b));
  const matches = [];
  for (const b of blocks) {
    const get = re => (b.match(re)||[])[1] || "";
    const name = get(/Name:\s*([^\n]+)/), facility = get(/Facility:\s*([^\n]+)/);
    const bookingDate = get(/Booking Date\/Time:\s*([^\n]+)/), holdsRaw = get(/Holds For Other Agencies:\s*([^\n]+)/);
    const charges = []; const cre = /Current Bond:\s*\$([\d,]+(?:\.\d+)?)/gi;
    let idx = 0, cm;
    while ((cm = cre.exec(b))) {
      const seg = b.slice(idx, cm.index); idx = cre.lastIndex;
      const lines = seg.split("\n").map(x=>x.trim()).filter(Boolean)
        .filter(x=>!/^Original Bond:/i.test(x) && !/^Charges$/i.test(x) && !/^Booking (Number|Date)/i.test(x));
      charges.push({ desc:(lines.slice(-2).join(" - ").slice(0,160)||"(charge)"), bond:money(cm[1]) });
    }
    const bondTotal = charges.reduce((a,c)=>a+c.bond,0);
    const zero = charges.filter(c=>c.bond===0).length;
    matches.push({ name:name.trim(), facility:facility.trim(), bookingDate:bookingDate.trim(),
      holds: /yes/i.test(holdsRaw) ? "Yes" : (holdsRaw.trim()||"Unknown"),
      charges, bondTotal, zeroBondCount:zero,
      needsReview: /yes/i.test(holdsRaw) || zero>0 || bondTotal===0 });
  }
  return { matches, note: matches.length
    ? "Bond amounts are as published by PBSO and may not be current. Confirm with the jail before posting."
    : "No booking records found." };
}
