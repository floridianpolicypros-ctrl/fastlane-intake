#!/usr/bin/env python3
"""Builds the static Floridian Policy Pros site into fpp/.

Every page is plain HTML: all text, titles, descriptions and structured data
are in the file itself, so search engines and AI assistants that do not run
JavaScript can read everything. Run: python3 build_fpp.py
"""
import json, html, datetime, pathlib

OUT = pathlib.Path(__file__).parent / "fpp"
SITE = "https://floridianpolicypros.com"
TODAY = datetime.date.today().isoformat()
PHONE = "561-777-0777"
TEL = "tel:+15617770777"
QUOTE_URL = "https://www.agentinsure.com/compare/auto-insurance-home-insurance/floridianpolicypros/quote.aspx"
LOGIN_URL = "https://customerservice.agentinsure.com/EzlynxCustomerService/floridianpolicypros/Account/LogIn"
EMAIL = "carlos@floridianpolicypros.com"
ADDRESS = "800 S Congress Ave, West Palm Beach, FL 33406"
LICENSE = "Florida agency license L110695"
HOURS = "Open 7 days, 9 AM to 5 PM"

ORG_ID = SITE + "/#agency"
ORG = {
    "@type": ["InsuranceAgency", "LocalBusiness"],
    "@id": ORG_ID,
    "name": "Floridian Policy Pros",
    "slogan": "Shining light on all your insurance needs.",
    "description": "Independent insurance agency in West Palm Beach, Florida. We shop 30+ A-rated carriers for homeowners, flood, auto and business insurance across Palm Beach County. Se habla español.",
    "url": SITE + "/",
    "logo": SITE + "/img/logo.png",
    "image": SITE + "/img/og.jpg",
    "telephone": "+1-561-777-0777",
    "email": EMAIL,
    "foundingDate": "2020",
    "address": {"@type": "PostalAddress", "streetAddress": "800 S Congress Ave", "addressLocality": "West Palm Beach",
                "addressRegion": "FL", "postalCode": "33406", "addressCountry": "US"},
    "openingHoursSpecification": [{"@type": "OpeningHoursSpecification",
        "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
        "opens": "09:00", "closes": "17:00"}],
    "areaServed": [{"@type": "AdministrativeArea", "name": "Palm Beach County, Florida"},
                   {"@type": "City", "name": "West Palm Beach"}, {"@type": "City", "name": "Wellington"},
                   {"@type": "City", "name": "Lake Worth Beach"}, {"@type": "City", "name": "Boynton Beach"},
                   {"@type": "City", "name": "Delray Beach"}, {"@type": "City", "name": "Boca Raton"},
                   {"@type": "City", "name": "Palm Beach Gardens"}, {"@type": "City", "name": "Jupiter"},
                   {"@type": "City", "name": "Royal Palm Beach"}, {"@type": "City", "name": "Greenacres"}],
    "knowsLanguage": ["en", "es"],
    "priceRange": "Free quotes",
    "identifier": {"@type": "PropertyValue", "name": "Florida DFS agency license", "value": "L110695"},
    "founder": {"@type": "Person", "name": "Carlos Sevilla", "jobTitle": "Licensed Florida insurance agent"},
    "sameAs": ["https://www.instagram.com/floridianpolicypros/"],
    "hasOfferCatalog": {"@type": "OfferCatalog", "name": "Insurance", "itemListElement": [
        {"@type": "Offer", "itemOffered": {"@type": "Service", "name": n}} for n in
        ["Homeowners insurance", "Flood insurance", "Auto insurance", "Condo insurance", "Renters insurance",
         "Business insurance", "Commercial auto insurance", "General liability insurance", "Workers' compensation insurance",
         "Boat, motorcycle and RV insurance", "Life insurance"]]},
}

NAV = [("/", "Home"), ("/homeowners-insurance", "Homeowners"), ("/flood-insurance", "Flood"),
       ("/auto-insurance", "Auto"), ("/business-insurance", "Business"), ("/faq", "FAQ"),
       ("/about", "About"), ("/contact-us", "Contact"), ("/seguro-en-espanol", "Español")]

CSS = """
:root{--navy:#0D2458;--gold:#F1B80B;--sky:#2E8BD8;--ink:#1b2533;--muted:#5b6b82;--line:#dfe6f0;--bg:#f6f8fc}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:Montserrat,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:var(--ink);background:#fff;line-height:1.6;font-size:16.5px}
a{color:var(--sky)}
.bar{background:var(--navy);color:#fff;font-size:13.5px}
.bar .in{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;max-width:1080px;margin:0 auto;padding:7px 18px}
.bar a{color:#fff;text-decoration:none;font-weight:700}
header.site{border-bottom:1px solid var(--line);background:#fff}
header.site .in{max-width:1080px;margin:0 auto;padding:10px 18px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--navy);font-weight:800;font-size:19px}
.brand img{height:60px;width:auto}
nav.main{display:flex;flex-wrap:wrap;gap:2px}
nav.main a{color:var(--navy);text-decoration:none;font-weight:600;font-size:14px;padding:7px 10px;border-radius:8px}
nav.main a:hover,nav.main a.on{background:#eef3fb}
.hero{background:linear-gradient(135deg,#0D2458 0%,#173a80 60%,#2E8BD8 100%);color:#fff}
.hero .in{max-width:1080px;margin:0 auto;padding:46px 18px 42px}
.kicker{color:var(--gold);font-weight:800;letter-spacing:.08em;font-size:13px;text-transform:uppercase;margin:0 0 8px}
h1{font-size:clamp(28px,4.6vw,44px);line-height:1.15;margin:0 0 14px;font-weight:800}
.hero p.lead{font-size:18px;max-width:720px;margin:0 0 22px;color:#e3ecfa}
.btns{display:flex;flex-wrap:wrap;gap:10px}
.btn{display:inline-block;text-decoration:none;font-weight:800;border-radius:10px;padding:13px 20px;font-size:15.5px}
.btn.gold{background:var(--gold);color:#1a1400}.btn.white{background:#fff;color:var(--navy)}.btn.line{border:2px solid #fff;color:#fff}
.btn.navy{background:var(--navy);color:#fff}
.trust{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:20px;font-size:14px;color:#cfe0f7;padding:0;list-style:none}
.trust li:before{content:"\\2713  ";color:var(--gold);font-weight:800}
main .in{max-width:1080px;margin:0 auto;padding:34px 18px}
h2{color:var(--navy);font-size:clamp(22px,3vw,28px);line-height:1.25;margin:34px 0 12px}
h3{color:var(--navy);font-size:18px;margin:22px 0 6px}
.answer{background:#f1f6fe;border-left:5px solid var(--sky);padding:14px 18px;border-radius:8px;font-size:17px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;margin:16px 0}
.card{border:1px solid var(--line);border-radius:14px;padding:18px;background:#fff;text-decoration:none;color:inherit;display:block}
a.card:hover{border-color:var(--sky);box-shadow:0 4px 14px rgba(13,36,88,.08)}
.card h3{margin:0 0 6px}.card p{margin:0;color:var(--muted);font-size:15px}
.facts{width:100%;border-collapse:collapse;margin:12px 0;font-size:15px}
.facts th,.facts td{border:1px solid var(--line);padding:9px 11px;text-align:left;vertical-align:top}
.facts th{background:var(--bg);color:var(--navy);width:34%}
.faq details{border:1px solid var(--line);border-radius:10px;padding:12px 16px;margin:8px 0;background:#fff}
.faq summary{font-weight:700;color:var(--navy);cursor:pointer}
.faq details p{margin:8px 0 0}
.cta{background:var(--navy);color:#fff;border-radius:16px;padding:26px;margin:36px 0 10px}
.cta h2{color:#fff;margin-top:0}.cta p{color:#d9e5f7}
.note{font-size:13.5px;color:var(--muted)}
ul.checks{padding-left:20px}ul.checks li{margin:5px 0}
footer.site{background:#0a1b44;color:#c9d6ee;font-size:14.5px;margin-top:30px}
footer.site .in{max-width:1080px;margin:0 auto;padding:30px 18px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px}
footer.site a{color:#fff}footer.site h4{color:var(--gold);margin:0 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:.06em}
footer.site ul{list-style:none;padding:0;margin:0}footer.site li{margin:4px 0}
.legal{border-top:1px solid #1f3266;text-align:center;padding:14px 18px;font-size:12.5px;color:#9fb0d0}
.callfab{position:fixed;right:14px;bottom:14px;background:var(--gold);color:#1a1400;font-weight:800;text-decoration:none;border-radius:999px;padding:13px 18px;box-shadow:0 6px 18px rgba(0,0,0,.25);z-index:9}
@media(min-width:900px){.callfab{display:none}}
@media(max-width:700px){nav.main{width:100%;overflow-x:auto;flex-wrap:nowrap}nav.main a{white-space:nowrap}.brand img{height:48px}}
"""


def esc(s):
    return html.escape(s, quote=True)


def faq_schema(faqs, url):
    return {"@type": "FAQPage", "@id": url + "#faq", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faqs]}


def faq_html(faqs, heading="Frequently asked questions"):
    items = "".join(f"<details><summary>{esc(q)}</summary><p>{esc(a)}</p></details>" for q, a in faqs)
    return f'<h2 id="faq">{esc(heading)}</h2><div class="faq">{items}</div>'


def cta_block(lang="en"):
    if lang == "es":
        return (f'<section class="cta"><h2>Cotice gratis hoy</h2><p>Comparamos más de 30 aseguradoras con calificación A. '
                f'Llame al {PHONE} o pida su cotización en línea. Se habla español.</p><div class="btns">'
                f'<a class="btn gold" href="{TEL}">Llamar {PHONE}</a><a class="btn white" href="{QUOTE_URL}" rel="noopener">Cotización en línea</a></div></section>')
    return (f'<section class="cta"><h2>Get a free quote today</h2><p>We shop 30+ A-rated carriers for you. '
            f'Call {PHONE} or start your quote online. Se habla español.</p><div class="btns">'
            f'<a class="btn gold" href="{TEL}">Call {PHONE}</a><a class="btn white" href="{QUOTE_URL}" rel="noopener">Instant online quote</a></div></section>')


def page(path, title, desc, h1, lead, body, faqs=None, kicker="Floridian Policy Pros", crumbs=None,
         lang="en", extra_schema=None, article=None, hero_buttons=True, sitemap_priority="0.8"):
    url = SITE + (path if path != "/" else "/")
    graph = [ORG, {"@type": "WebSite", "@id": SITE + "/#website", "url": SITE + "/", "name": "Floridian Policy Pros",
                   "publisher": {"@id": ORG_ID}, "inLanguage": ["en-US", "es-US"]},
             {"@type": "WebPage", "@id": url + "#webpage", "url": url, "name": title, "description": desc,
              "isPartOf": {"@id": SITE + "/#website"}, "about": {"@id": ORG_ID},
              "inLanguage": "es-US" if lang == "es" else "en-US", "dateModified": TODAY}]
    if crumbs:
        graph.append({"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": n, "item": SITE + p} for i, (p, n) in enumerate(crumbs)]})
    if faqs:
        graph.append(faq_schema(faqs, url))
    if article:
        graph.append({"@type": "Article", "@id": url + "#article", "headline": h1, "description": desc,
                      "datePublished": article, "dateModified": TODAY, "author": {"@type": "Person", "name": "Carlos Sevilla",
                      "jobTitle": "Licensed Florida insurance agent", "worksFor": {"@id": ORG_ID}},
                      "publisher": {"@id": ORG_ID}, "mainEntityOfPage": url, "image": SITE + "/img/og.jpg"})
    if extra_schema:
        graph.extend(extra_schema)
    ld = json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False, separators=(",", ":"))
    nav = "".join(f'<a href="{p}"{" class=on" if p == path else ""}>{n}</a>' for p, n in NAV)
    buttons = ""
    if hero_buttons:
        if lang == "es":
            buttons = (f'<div class="btns"><a class="btn gold" href="{TEL}">Llamar {PHONE}</a>'
                       f'<a class="btn white" href="{QUOTE_URL}" rel="noopener">Cotización en línea</a></div>')
        else:
            buttons = (f'<div class="btns"><a class="btn gold" href="{TEL}">Call {PHONE}</a>'
                       f'<a class="btn white" href="{QUOTE_URL}" rel="noopener">Instant online quote</a>'
                       f'<a class="btn line" href="/contact-us">Contact us</a></div>')
    trust = ("<ul class=trust><li>Agencia con licencia en Florida</li><li>Más de 30 aseguradoras con calificación A</li><li>Agente local</li><li>Abierto 7 días</li></ul>"
             if lang == "es" else
             "<ul class=trust><li>Licensed Florida agency</li><li>30+ A-rated carriers</li><li>Local West Palm Beach agent</li><li>Open 7 days</li><li>Se habla español</li></ul>")
    faq_block = faq_html(faqs, "Preguntas frecuentes" if lang == "es" else "Frequently asked questions") if faqs else ""
    year = datetime.date.today().year
    doc = f"""<!DOCTYPE html>
<html lang="{'es' if lang == 'es' else 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{url}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="{'article' if article else 'website'}">
<meta property="og:site_name" content="Floridian Policy Pros">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE}/img/og.jpg">
<meta property="og:locale" content="{'es_US' if lang == 'es' else 'en_US'}">
<meta name="twitter:card" content="summary">
<link rel="icon" href="/favicon.png" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="alternate" hreflang="en-us" href="{SITE}/">
<link rel="alternate" hreflang="es-us" href="{SITE}/seguro-en-espanol">
<style>{CSS}</style>
<script type="application/ld+json">{ld}</script>
</head>
<body>
<div class="bar"><div class="in"><span>{'Agencia de seguros independiente en West Palm Beach' if lang == 'es' else 'Independent insurance agency in West Palm Beach'} · Se habla español</span><span><a href="{TEL}">{PHONE}</a> · <a href="{LOGIN_URL}" rel="noopener">{'Acceso clientes' if lang == 'es' else 'Client login'}</a></span></div></div>
<header class="site"><div class="in"><a class="brand" href="/"><img src="/img/logo.webp" width="121" height="144" alt="Floridian Policy Pros logo"><span>Floridian Policy Pros</span></a><nav class="main" aria-label="Main">{nav}</nav></div></header>
<section class="hero"><div class="in"><p class="kicker">{esc(kicker)}</p><h1>{esc(h1)}</h1><p class="lead">{lead}</p>{buttons}{trust if hero_buttons else ''}</div></section>
<main><div class="in">
{body}
{faq_block}
{cta_block(lang)}
</div></main>
<footer class="site"><div class="in">
<div><h4>Floridian Policy Pros</h4><p>Shining light on all your insurance needs.</p><p>{LICENSE}. Licensed agent Carlos Sevilla.</p></div>
<div><h4>{'Contacto' if lang == 'es' else 'Contact'}</h4><ul><li><a href="{TEL}">{PHONE}</a></li><li><a href="mailto:{EMAIL}">{EMAIL}</a></li><li>{ADDRESS}</li><li>{'Abierto 7 días, 9 AM a 5 PM' if lang == 'es' else HOURS}</li><li>Se habla español</li></ul></div>
<div><h4>Insurance</h4><ul><li><a href="/homeowners-insurance">Homeowners insurance</a></li><li><a href="/flood-insurance">Flood insurance</a></li><li><a href="/auto-insurance">Auto insurance</a></li><li><a href="/business-insurance">Business insurance</a></li><li><a href="/our-services">All coverage</a></li></ul></div>
<div><h4>Company</h4><ul><li><a href="/about">About us</a></li><li><a href="/insurance-providers">Our carriers</a></li><li><a href="/blog">Insurance guides</a></li><li><a href="/faq">FAQ</a></li><li><a href="{LOGIN_URL}" rel="noopener">Client login</a></li><li><a href="/privacy">Privacy policy</a></li></ul></div>
</div><div class="legal">&copy; {year} Floridian Policy Pros. {LICENSE}. Coverage is subject to the terms, conditions and availability of each insurance company.</div></footer>
<a class="callfab" href="{TEL}">{'Llamar' if lang == 'es' else 'Call'} {PHONE}</a>
</body>
</html>
"""
    fname = "index.html" if path == "/" else path.strip("/") + ".html"
    f = OUT / fname
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(doc, encoding="utf-8")
    PAGES.append((path, title, desc, sitemap_priority))


PAGES = []

# ---------------------------------------------------------------- Home
HOME_FAQ = [
    ("Who is the best insurance agent in West Palm Beach?",
     "Floridian Policy Pros is a licensed, independent insurance agency at 800 S Congress Ave in West Palm Beach. Owner Carlos Sevilla and his team shop 30+ A-rated carriers for homeowners, flood, auto and business insurance, answer the phone 7 days a week, and help clients in English and Spanish. Call 561-777-0777."),
    ("What is an independent insurance agency?",
     "An independent agency is not tied to one insurance company. Floridian Policy Pros compares quotes from more than 30 A-rated carriers, so you see several options side by side instead of one company's price."),
    ("Does homeowners insurance in Florida cover flood?",
     "No. Standard Florida homeowners policies do not cover flood damage from rising water or storm surge. Flood coverage is a separate policy from the National Flood Insurance Program (NFIP) or a private flood insurer. We quote both."),
    ("How fast can I get a quote?",
     "Most homeowners, flood and auto quotes are ready the same day. Same-day binding is available for many flood policies. Call 561-777-0777 or use the instant online quote."),
    ("Do you speak Spanish?",
     "Yes. Se habla español. You can call, visit or get your quote entirely in Spanish."),
    ("What areas do you serve?",
     "All of Palm Beach County, including West Palm Beach, Wellington, Royal Palm Beach, Greenacres, Lake Worth Beach, Lantana, Boynton Beach, Delray Beach, Boca Raton, Palm Beach Gardens and Jupiter, plus clients across Florida."),
]
page("/", "West Palm Beach Insurance Agency | Home, Flood & Auto | Floridian Policy Pros",
     "Independent insurance agency in West Palm Beach. We shop 30+ A-rated carriers for homeowners, flood, auto and business insurance. Se habla español. Call 561-777-0777.",
     "West Palm Beach Homeowners & Flood Insurance Agency",
     "Insurance isn't just about policies, it's about peace of mind. Floridian Policy Pros is a local, licensed independent agency that shops 30+ A-rated carriers to find the right coverage at the right price for Palm Beach County homes, cars and businesses.",
     f"""
<p class="answer"><strong>In short:</strong> Floridian Policy Pros is an independent insurance agency at 800 S Congress Ave, West Palm Beach, FL 33406. We compare 30+ A-rated insurance companies for homeowners, flood, auto and business coverage, we're open 7 days from 9 AM to 5 PM, and we speak English and Spanish. Call {PHONE} for a free quote.</p>
<h2>Insurance we place in Palm Beach County</h2>
<div class="grid">
<a class="card" href="/homeowners-insurance"><h3>Homeowners insurance</h3><p>Wind, hurricane and replacement-cost coverage for Florida homes, plus wind mitigation discounts.</p></a>
<a class="card" href="/flood-insurance"><h3>Flood insurance</h3><p>NFIP and private flood quotes, LiDAR elevation discounts and same-day binding available.</p></a>
<a class="card" href="/auto-insurance"><h3>Auto insurance</h3><p>Florida PIP and property damage plus the liability and uninsured motorist coverage that protects you.</p></a>
<a class="card" href="/business-insurance"><h3>Business insurance</h3><p>General liability, commercial auto, workers' comp and more for contractors and small businesses.</p></a>
</div>
<h2>Why Palm Beach County chooses Floridian Policy Pros</h2>
<ul class="checks">
<li><strong>We shop 30+ A-rated carriers.</strong> One call, several quotes, and a plain-English comparison.</li>
<li><strong>A real local agent.</strong> You talk to a licensed agent in West Palm Beach, not an 800 number.</li>
<li><strong>Flood specialists.</strong> We quote NFIP and private flood, and use LiDAR elevation data to look for discounts.</li>
<li><strong>Open 7 days.</strong> 9 AM to 5 PM, Monday through Sunday.</li>
<li><strong>Se habla español.</strong> Full service in Spanish.</li>
<li><strong>Licensed and local since 2020.</strong> {LICENSE}.</li>
</ul>
<h2>Quick facts</h2>
<table class="facts">
<tr><th>Agency</th><td>Floridian Policy Pros, independent insurance agency</td></tr>
<tr><th>Address</th><td>{ADDRESS}</td></tr>
<tr><th>Phone</th><td><a href="{TEL}">{PHONE}</a></td></tr>
<tr><th>Hours</th><td>{HOURS}</td></tr>
<tr><th>Languages</th><td>English, Spanish</td></tr>
<tr><th>Carriers</th><td>30+ A-rated insurance companies</td></tr>
<tr><th>License</th><td>{LICENSE}</td></tr>
<tr><th>Service area</th><td>Palm Beach County and all of Florida</td></tr>
</table>
<h2>Already a client?</h2>
<p>Log in to your client center to view policies, download ID cards, request changes and certificates, and make payments. <a href="{LOGIN_URL}" rel="noopener">Client login</a>.</p>
""", faqs=HOME_FAQ, kicker="Shining light on all your insurance needs", sitemap_priority="1.0")

# ---------------------------------------------------------------- Homeowners
HO_FAQ = [
    ("How much is homeowners insurance in West Palm Beach?",
     "It depends on the home's age, roof, construction, wind mitigation features, distance to the coast, deductible and claims history. The fastest way to know is a side-by-side quote. We compare 30+ A-rated carriers at no cost: call 561-777-0777."),
    ("What is a hurricane deductible?",
     "Florida homeowners policies usually have a separate hurricane deductible, often 2%, 5% or 10% of the dwelling coverage amount. On a $400,000 dwelling limit, a 2% hurricane deductible is $8,000. We show you the trade-off between deductible and premium."),
    ("What is a wind mitigation inspection?",
     "A wind mitigation inspection documents features that help a home resist wind, such as roof-to-wall connections, roof shape and opening protection. Florida insurers must offer discounts for these features, so a current inspection can lower your premium."),
    ("What is a 4-point inspection?",
     "A 4-point inspection checks the roof, electrical, plumbing and HVAC. Insurers often ask for one on older homes before they will write a policy."),
    ("Does homeowners insurance cover flood or storm surge?",
     "No. Flood and storm surge need a separate flood policy. See our flood insurance page or call 561-777-0777."),
    ("Can I switch from Citizens?",
     "Often, yes. When a private carrier offers comparable coverage we can help you compare it with your Citizens renewal. Ask us for a review before your renewal date."),
]
page("/homeowners-insurance", "Homeowners Insurance West Palm Beach FL | Compare 30+ Carriers",
     "Homeowners insurance quotes in West Palm Beach and Palm Beach County. Hurricane coverage, wind mitigation discounts, Citizens alternatives. Call 561-777-0777.",
     "Homeowners Insurance in West Palm Beach, Florida",
     "Florida homes need the right hurricane deductible, replacement cost coverage and every discount you qualify for. We compare 30+ A-rated carriers so you don't have to.",
     f"""
<p class="answer"><strong>In short:</strong> Floridian Policy Pros quotes homeowners insurance for West Palm Beach and all of Palm Beach County from 30+ A-rated carriers. Bring your declarations page and any wind mitigation or 4-point inspection, and we'll compare coverage and price side by side. Call {PHONE}.</p>
<h2>What a Florida homeowners policy covers</h2>
<ul class="checks">
<li><strong>Dwelling:</strong> the structure of your home, ideally insured to full replacement cost.</li>
<li><strong>Other structures:</strong> fences, sheds and detached garages.</li>
<li><strong>Personal property:</strong> furniture, clothing and electronics.</li>
<li><strong>Loss of use:</strong> extra living costs if a covered loss forces you out.</li>
<li><strong>Personal liability and medical payments:</strong> if someone is hurt on your property.</li>
<li><strong>Wind and hurricane:</strong> usually included, with a separate hurricane deductible.</li>
</ul>
<p>Flood is <strong>not</strong> covered by a homeowners policy. <a href="/flood-insurance">Get a flood quote</a>.</p>
<h2>How to lower your Florida homeowners premium</h2>
<ul class="checks">
<li>Get a current <strong>wind mitigation inspection</strong>; Florida insurers must offer credits for qualifying features.</li>
<li>Compare <strong>hurricane deductible</strong> options (often 2%, 5% or 10%).</li>
<li>Update the <strong>roof</strong> age and type on file; newer roofs usually rate better.</li>
<li><strong>Bundle</strong> home, flood and auto where it saves money.</li>
<li>Shop at every renewal. That's our job: we compare 30+ carriers for you.</li>
</ul>
<h2>Condo, renters and landlord policies</h2>
<p>We also quote condo unit-owner (HO-6), renters (HO-4) and landlord dwelling policies across Palm Beach County.</p>
""", faqs=HO_FAQ, kicker="Homeowners insurance", crumbs=[("/", "Home"), ("/homeowners-insurance", "Homeowners insurance")])

# ---------------------------------------------------------------- Flood
FLOOD_FAQ = [
    ("Do I need flood insurance in West Palm Beach?",
     "If your mortgage lender requires it, yes. Even if not, a large share of flood claims come from outside high-risk zones, and homeowners policies exclude flood. Citizens Property Insurance also requires flood coverage for its policyholders on a phased schedule, with all Citizens personal residential policies required to carry flood coverage by January 1, 2027."),
    ("How much damage can one inch of water cause?",
     "FEMA estimates that just one inch of floodwater can cause about $25,000 in damage to a home."),
    ("Is there a waiting period for flood insurance?",
     "NFIP flood policies generally have a 30-day waiting period before coverage starts, with some exceptions such as a loan closing. Many private flood policies have shorter waiting periods. Buy before a storm is in the forecast."),
    ("What are the NFIP coverage limits?",
     "The National Flood Insurance Program covers up to $250,000 for a home's building and up to $100,000 for contents. Private flood policies can offer higher limits; ask us about high-limit flood options."),
    ("What is LiDAR and how can it lower my flood premium?",
     "LiDAR is laser-measured elevation data. Some flood insurers use it to rate a home's elevation, which can lower the premium for homes that sit higher than the surrounding area. We check this when we quote."),
    ("Can you bind flood insurance the same day?",
     "Same-day binding is available for many flood policies, subject to the insurer's rules and waiting periods."),
]
page("/flood-insurance", "Flood Insurance West Palm Beach FL | NFIP & Private Flood Quotes",
     "Flood insurance quotes in West Palm Beach and Palm Beach County. NFIP and private flood, LiDAR elevation discounts, high-limit options, same-day binding. Call 561-777-0777.",
     "Flood Insurance in West Palm Beach & Palm Beach County",
     "Homeowners insurance does not cover flood. We quote NFIP and private flood side by side, look for LiDAR elevation discounts, and can often bind the same day.",
     f"""
<p class="answer"><strong>In short:</strong> Florida homeowners policies exclude flood, so you need a separate flood policy. Floridian Policy Pros compares NFIP and private flood insurance from multiple A-rated carriers for homes in West Palm Beach and across Palm Beach County. Call {PHONE} for a quote in minutes.</p>
<h2>What our flood quotes include</h2>
<ul class="checks">
<li>Compare 30+ A-rated insurance companies, including NFIP and private flood</li>
<li>High-limit flood options available</li>
<li>LiDAR technology for accurate elevation and possible discounts</li>
<li>Fast approval, same-day binding available</li>
<li>Bundle discounts with homeowners where available</li>
</ul>
<h2>NFIP vs. private flood insurance</h2>
<table class="facts">
<tr><th></th><td><strong>NFIP (FEMA)</strong></td><td><strong>Private flood</strong></td></tr>
<tr><th>Building limit</th><td>Up to $250,000</td><td>Often higher; high-limit options available</td></tr>
<tr><th>Contents limit</th><td>Up to $100,000</td><td>Often higher</td></tr>
<tr><th>Waiting period</th><td>Usually 30 days</td><td>Often shorter</td></tr>
<tr><th>Extra living expenses</th><td>Not included</td><td>Sometimes included</td></tr>
</table>
<p class="note">Limits and features vary by insurer and policy. Your agent will confirm the details of any quote.</p>
<h2>Citizens policyholders: the flood requirement</h2>
<p>Florida law requires Citizens Property Insurance policyholders to carry flood insurance on a phased schedule based on the home's replacement value, with every Citizens personal residential policy required to have flood coverage by January 1, 2027. If you're with Citizens, call us before your renewal.</p>
<h2>Read more</h2>
<p><a href="/blog/flood-insurance-west-palm-beach-guide">Flood Insurance in West Palm Beach: 2026 Guide</a></p>
""", faqs=FLOOD_FAQ, kicker="Flood insurance", crumbs=[("/", "Home"), ("/flood-insurance", "Flood insurance")])

# ---------------------------------------------------------------- Auto
AUTO_FAQ = [
    ("What auto insurance is required in Florida?",
     "Florida requires $10,000 of Personal Injury Protection (PIP) and $10,000 of Property Damage Liability (PDL) on registered vehicles. Most drivers should carry more, including bodily injury liability and uninsured motorist coverage."),
    ("Why is car insurance expensive in Palm Beach County?",
     "Rates reflect traffic density, accident and claim costs, theft and the number of uninsured drivers in South Florida. Comparing several carriers is the most reliable way to lower your price."),
    ("Can I bundle auto and home insurance?",
     "Yes. Many carriers discount home and auto together. We check bundled and separate prices so you see which is cheaper."),
    ("Do you insure motorcycles, boats and RVs?",
     "Yes. We quote motorcycle, boat and RV insurance as well as standard auto."),
]
page("/auto-insurance", "Auto Insurance West Palm Beach FL | Compare Car Insurance Quotes",
     "Car insurance quotes in West Palm Beach and Palm Beach County from 30+ A-rated carriers. Florida PIP, liability, uninsured motorist, bundles. Call 561-777-0777.",
     "Auto Insurance in West Palm Beach, Florida",
     "We compare car insurance from 30+ A-rated carriers so Palm Beach County drivers get the coverage Florida requires, and the protection they actually need, at a better price.",
     f"""
<p class="answer"><strong>In short:</strong> Florida requires $10,000 PIP and $10,000 property damage liability, but that rarely covers a serious accident. Floridian Policy Pros compares auto insurance from 30+ A-rated carriers for West Palm Beach drivers. Call {PHONE} or get an instant online quote.</p>
<h2>Coverage we recommend reviewing</h2>
<ul class="checks">
<li><strong>Bodily injury liability:</strong> protects your savings if you injure someone.</li>
<li><strong>Uninsured/underinsured motorist:</strong> pays you when the at-fault driver can't.</li>
<li><strong>Collision and comprehensive:</strong> repairs your car after a crash, theft, flood or storm.</li>
<li><strong>PIP and property damage:</strong> the Florida minimums.</li>
<li><strong>Roadside and rental:</strong> low-cost extras that save headaches.</li>
</ul>
<h2>Ways to save</h2>
<ul class="checks"><li>Bundle with homeowners or renters</li><li>Multi-car and good-driver discounts</li><li>Pay-in-full and paperless discounts where offered</li><li>Shop every renewal; we do it for you</li></ul>
""", faqs=AUTO_FAQ, kicker="Auto insurance", crumbs=[("/", "Home"), ("/auto-insurance", "Auto insurance")])

# ---------------------------------------------------------------- Business
BIZ_FAQ = [
    ("What insurance does a Florida contractor need?",
     "Most contractors need general liability, commercial auto for work vehicles, and workers' compensation (Florida construction businesses with one or more employees generally must carry it). Many jobs also require a certificate of insurance before you start."),
    ("Can you issue certificates of insurance quickly?",
     "Yes. Existing clients can request certificates through our client center or by calling 561-777-0777."),
    ("What does general liability cover?",
     "General liability covers bodily injury and property damage that your business causes to others, plus related legal defense costs, within the policy limits."),
]
page("/business-insurance", "Business Insurance West Palm Beach | General Liability, Commercial Auto",
     "Business insurance in West Palm Beach: general liability, commercial auto, workers' comp and more for contractors and small businesses. Call 561-777-0777.",
     "Business Insurance in West Palm Beach, Florida",
     "General liability, commercial auto and workers' compensation for Palm Beach County contractors and small businesses, quoted from multiple A-rated carriers.",
     f"""
<p class="answer"><strong>In short:</strong> Floridian Policy Pros insures small businesses and contractors in West Palm Beach and Palm Beach County, including general liability, commercial auto and workers' compensation. Call {PHONE} for a quote and fast certificates of insurance.</p>
<h2>Coverage for your business</h2>
<div class="grid">
<div class="card"><h3>General liability</h3><p>Injury and property damage claims from customers and third parties.</p></div>
<div class="card"><h3>Commercial auto</h3><p>Trucks, vans and cars used for work.</p></div>
<div class="card"><h3>Workers' compensation</h3><p>Medical and wage benefits for employees hurt on the job.</p></div>
<div class="card"><h3>Commercial property</h3><p>Your building, equipment and inventory.</p></div>
</div>
""", faqs=BIZ_FAQ, kicker="Business insurance", crumbs=[("/", "Home"), ("/business-insurance", "Business insurance")])

# ---------------------------------------------------------------- Services hub (old WordPress URL)
page("/our-services", "Insurance Services | Floridian Policy Pros, West Palm Beach",
     "All the insurance Floridian Policy Pros places in Palm Beach County: home, flood, auto, condo, renters, business, boat, motorcycle, RV and life. Call 561-777-0777.",
     "Our Insurance Services",
     "One local agency for the coverage Palm Beach County families and businesses need, compared across 30+ A-rated carriers.",
     """
<div class="grid">
<a class="card" href="/homeowners-insurance"><h3>Homeowners</h3><p>Hurricane-ready coverage and wind mitigation discounts.</p></a>
<a class="card" href="/flood-insurance"><h3>Flood</h3><p>NFIP and private flood, same-day binding available.</p></a>
<a class="card" href="/auto-insurance"><h3>Auto</h3><p>Car, motorcycle, boat and RV.</p></a>
<a class="card" href="/business-insurance"><h3>Business</h3><p>General liability, commercial auto, workers' comp.</p></a>
<a class="card" href="/homeowners-insurance"><h3>Condo and renters</h3><p>HO-6 and HO-4 policies.</p></a>
<a class="card" href="/contact-us"><h3>Life</h3><p>Ask us about life insurance options.</p></a>
</div>
""", kicker="Coverage", crumbs=[("/", "Home"), ("/our-services", "Services")], sitemap_priority="0.6")

# ---------------------------------------------------------------- Carriers (old URL, no carrier names)
page("/insurance-providers", "We Shop 30+ A-Rated Insurance Carriers | Floridian Policy Pros",
     "Floridian Policy Pros is an independent agency in West Palm Beach that compares 30+ A-rated insurance carriers for home, flood, auto and business coverage.",
     "We Shop 30+ A-Rated Carriers",
     "As an independent Florida agency, we compare coverage from more than 30 A-rated insurance carriers to find the right fit for your home, flood, auto and business needs.",
     f"""
<p class="answer"><strong>In short:</strong> Floridian Policy Pros is not tied to one insurance company. We compare more than 30 A-rated carriers and show you the options side by side. Call {PHONE} for a free comparison.</p>
<h2>Why shopping many carriers matters in Florida</h2>
<p>Florida's insurance market changes fast. Carriers open and close to new business, change their rules on roof age and location, and re-rate at renewal. Working with many carriers means that when one company's price jumps, we can look for a better fit instead of leaving you stuck.</p>
<h2>Need to make a payment, file a claim or renew?</h2>
<p>Call us at <a href="{TEL}">{PHONE}</a> or use the <a href="{LOGIN_URL}" rel="noopener">client login</a>.</p>
""", kicker="Our carriers", crumbs=[("/", "Home"), ("/insurance-providers", "Our carriers")], sitemap_priority="0.6")

# ---------------------------------------------------------------- About
page("/about", "About Floridian Policy Pros | Independent Insurance Agency, West Palm Beach",
     "Floridian Policy Pros is a licensed independent insurance agency in West Palm Beach, owned by agent Carlos Sevilla. Serving Palm Beach County since 2020. Se habla español.",
     "About Floridian Policy Pros",
     "A local, licensed, owner-operated insurance agency in West Palm Beach, serving Palm Beach County since 2020.",
     f"""
<p class="answer"><strong>In short:</strong> Floridian Policy Pros is an independent insurance agency founded in 2020 and owned by licensed Florida agent Carlos Sevilla. The office is at {ADDRESS}. We shop 30+ A-rated carriers for home, flood, auto and business insurance and serve clients in English and Spanish.</p>
<h2>Our story</h2>
<p>Floridian Policy Pros was built for Florida homeowners and drivers who were tired of 800 numbers and surprise renewals. Our motto is simple: shining light on all your insurance needs. That means plain-English explanations, side-by-side quotes and a local agent who picks up the phone.</p>
<h2>Licensing</h2>
<table class="facts">
<tr><th>Agency license</th><td>Florida Department of Financial Services agency license L110695</td></tr>
<tr><th>Licensed agent</th><td>Carlos Sevilla, Florida general lines (property and casualty) agent</td></tr>
<tr><th>Founded</th><td>2020</td></tr>
<tr><th>Office</th><td>{ADDRESS}</td></tr>
<tr><th>Languages</th><td>English and Spanish</td></tr>
</table>
<p class="note">You can verify any Florida insurance license on the Florida Department of Financial Services licensee search.</p>
""", kicker="About us", crumbs=[("/", "Home"), ("/about", "About")], sitemap_priority="0.7")

# ---------------------------------------------------------------- Contact (old WordPress URL)
page("/contact-us", "Contact Floridian Policy Pros | West Palm Beach Insurance Agency",
     "Call 561-777-0777 or visit 800 S Congress Ave, West Palm Beach, FL 33406. Open 7 days, 9 AM to 5 PM. Se habla español.",
     "Contact Floridian Policy Pros",
     f"Call <a href=\"{TEL}\" style=\"color:#fff\">{PHONE}</a>, email us, or stop by the office. Open 7 days, 9 AM to 5 PM. Se habla español.",
     f"""
<table class="facts">
<tr><th>Phone</th><td><a href="{TEL}">{PHONE}</a></td></tr>
<tr><th>Email</th><td><a href="mailto:{EMAIL}">{EMAIL}</a></td></tr>
<tr><th>Office</th><td>{ADDRESS} (<a href="https://www.google.com/maps/search/?api=1&amp;query=Floridian+Policy+Pros+800+S+Congress+Ave+West+Palm+Beach+FL+33406" rel="noopener">directions</a>)</td></tr>
<tr><th>Hours</th><td>{HOURS}</td></tr>
<tr><th>Languages</th><td>English, Spanish</td></tr>
<tr><th>Online quote</th><td><a href="{QUOTE_URL}" rel="noopener">Instant online quote</a></td></tr>
<tr><th>Current clients</th><td><a href="{LOGIN_URL}" rel="noopener">Client login</a>: policies, ID cards, changes, certificates and payments</td></tr>
</table>
""", kicker="Contact", crumbs=[("/", "Home"), ("/contact-us", "Contact")], sitemap_priority="0.7")

# ---------------------------------------------------------------- FAQ hub
ALL_FAQ = HOME_FAQ[1:] + HO_FAQ[:4] + FLOOD_FAQ[:4] + AUTO_FAQ[:2] + BIZ_FAQ[:1]
page("/faq", "Florida Insurance FAQ | Home, Flood & Auto | Floridian Policy Pros",
     "Answers to common Florida insurance questions: hurricane deductibles, wind mitigation, flood waiting periods, NFIP limits, PIP and more, from a West Palm Beach agency.",
     "Florida Insurance Questions, Answered",
     "Straight answers from a licensed West Palm Beach agency. Don't see your question? Call 561-777-0777.",
     "", faqs=ALL_FAQ, kicker="FAQ", crumbs=[("/", "Home"), ("/faq", "FAQ")], sitemap_priority="0.7")

# ---------------------------------------------------------------- Spanish
ES_FAQ = [
    ("¿El seguro de casa en Florida cubre inundaciones?",
     "No. La póliza de propietario de vivienda no cubre inundaciones ni marejada ciclónica. Se necesita una póliza de inundación aparte, del NFIP o de una aseguradora privada. Cotizamos ambas."),
    ("¿Hablan español?",
     "Sí. Puede llamar, visitar la oficina o hacer toda su cotización en español. Llame al 561-777-0777."),
    ("¿Cuántas aseguradoras comparan?",
     "Comparamos más de 30 aseguradoras con calificación A para seguro de casa, inundación, auto y negocio."),
    ("¿Qué seguro de auto exige Florida?",
     "Florida exige $10,000 de Protección de Lesiones Personales (PIP) y $10,000 de responsabilidad por daños a la propiedad (PDL). Recomendamos más cobertura para proteger su patrimonio."),
]
page("/seguro-en-espanol", "Seguro de Casa, Inundación y Auto en West Palm Beach | Se Habla Español",
     "Agencia de seguros independiente en West Palm Beach. Comparamos más de 30 aseguradoras con calificación A. Seguro de casa, inundación, auto y negocio. Llame al 561-777-0777.",
     "Seguros en West Palm Beach, en Español",
     "Floridian Policy Pros es una agencia de seguros independiente con licencia en Florida. Comparamos más de 30 aseguradoras para encontrar la mejor cobertura al mejor precio. Se habla español.",
     f"""
<p class="answer"><strong>En resumen:</strong> Floridian Policy Pros está en {ADDRESS}. Cotizamos seguro de casa, inundación, auto y negocio con más de 30 aseguradoras con calificación A. Abierto 7 días, de 9 AM a 5 PM. Llame al {PHONE}.</p>
<h2>Seguros que ofrecemos</h2>
<ul class="checks">
<li><strong>Seguro de casa:</strong> cobertura contra huracanes y descuentos por inspección de mitigación de viento.</li>
<li><strong>Seguro de inundación:</strong> NFIP y privado, descuentos por elevación con LiDAR, emisión el mismo día disponible.</li>
<li><strong>Seguro de auto:</strong> PIP, responsabilidad civil, conductor sin seguro, colisión y comprensivo.</li>
<li><strong>Seguro de negocio:</strong> responsabilidad general, auto comercial y compensación de trabajadores.</li>
</ul>
""", faqs=ES_FAQ, kicker="Se habla español", crumbs=[("/", "Inicio"), ("/seguro-en-espanol", "Español")], lang="es", sitemap_priority="0.8")

# ---------------------------------------------------------------- Blog
GUIDE_FAQ = FLOOD_FAQ[:4]
page("/blog/flood-insurance-west-palm-beach-guide", "Flood Insurance in West Palm Beach: 2026 Guide | Floridian Policy Pros",
     "Do you need flood insurance in West Palm Beach? Flood zones, NFIP vs. private flood, the 30-day wait, the Citizens flood requirement and how to save, explained by a local agent.",
     "Flood Insurance in West Palm Beach: 2026 Guide",
     "Everything Palm Beach County homeowners should know before hurricane season, from a licensed local agent.",
     f"""
<p class="answer"><strong>The short answer:</strong> If you own a home in West Palm Beach, you should at least price flood insurance. Homeowners policies exclude flood, FEMA estimates one inch of water can cause about $25,000 in damage, NFIP policies usually take 30 days to start, and Citizens policyholders must carry flood coverage by January 1, 2027.</p>
<h2>1. Your homeowners policy does not cover flood</h2>
<p>Wind damage from a hurricane is usually covered by your homeowners policy. Rising water and storm surge are not. That gap is why so many Florida homeowners are surprised after a storm.</p>
<h2>2. Flood zones are not the whole story</h2>
<p>Lenders require flood insurance in high-risk zones, but flooding happens outside them too. Heavy rain, blocked drainage and king tides flood streets across Palm Beach County. Low-risk-zone policies are often affordable, so it's worth getting a price.</p>
<h2>3. NFIP or private flood?</h2>
<p>The NFIP covers up to $250,000 for the building and $100,000 for contents, usually with a 30-day wait. Private flood policies may offer higher limits, extra living expenses and shorter waits. We quote both and lay them out side by side.</p>
<h2>4. Citizens policyholders must add flood</h2>
<p>Under Florida law, Citizens Property Insurance requires its personal residential policyholders to carry flood insurance on a phased schedule tied to the home's replacement value. By January 1, 2027, every Citizens personal residential policy must have flood coverage.</p>
<h2>5. How to lower your flood premium</h2>
<ul class="checks"><li>Ask about LiDAR elevation rating</li><li>Provide an elevation certificate if you have one</li><li>Compare NFIP and private quotes</li><li>Choose a deductible you can afford</li><li>Buy early, before a storm is in the forecast</li></ul>
<p><strong>Get a flood quote:</strong> call <a href="{TEL}">{PHONE}</a>, 7 days a week, or <a href="/flood-insurance">see our flood insurance page</a>.</p>
<p class="note">Written by Carlos Sevilla, licensed Florida insurance agent, Floridian Policy Pros. Sources: FEMA FloodSmart, Florida Statutes on Citizens Property Insurance Corporation. Coverage depends on your policy.</p>
""", faqs=GUIDE_FAQ, kicker="Insurance guide", article="2026-11-25",
     crumbs=[("/", "Home"), ("/blog", "Guides"), ("/blog/flood-insurance-west-palm-beach-guide", "Flood insurance guide")],
     hero_buttons=True, sitemap_priority="0.7")

page("/blog", "Florida Insurance Guides | Floridian Policy Pros",
     "Plain-English Florida insurance guides from a licensed West Palm Beach agency: flood, homeowners, hurricane deductibles and more.",
     "Florida Insurance Guides",
     "Plain-English answers from a licensed West Palm Beach agent.",
     """
<div class="grid"><a class="card" href="/blog/flood-insurance-west-palm-beach-guide"><h3>Flood Insurance in West Palm Beach: 2026 Guide</h3><p>Flood zones, NFIP vs. private, the 30-day wait and the Citizens flood requirement.</p></a></div>
""", kicker="Guides", crumbs=[("/", "Home"), ("/blog", "Guides")], sitemap_priority="0.6")

# ---------------------------------------------------------------- Privacy
page("/privacy", "Privacy Policy | Floridian Policy Pros",
     "How Floridian Policy Pros collects, uses and protects your information.",
     "Privacy Policy", "How we handle your information.",
     f"""
<p>Floridian Policy Pros collects the information you choose to give us, such as your name, contact details and the details needed to quote insurance, when you call, email, visit our office or use our online quote or client center. We use it to quote, place and service your insurance and to contact you about your policies.</p>
<p>We share your information with insurance companies and service providers only as needed to quote, place and service your coverage, or when the law requires it. We do not sell your personal information.</p>
<p>Online quotes and the client center are provided through our agency management partner and are subject to that provider's privacy terms.</p>
<p>Questions or requests about your information: call {PHONE} or email <a href="mailto:{EMAIL}">{EMAIL}</a>.</p>
<p class="note">Last updated {TODAY}.</p>
""", kicker="Privacy", hero_buttons=False, sitemap_priority="0.2")

# ---------------------------------------------------------------- 404 (not in sitemap)
page("/404", "Page Not Found | Floridian Policy Pros", "This page was not found. Call 561-777-0777 or visit our home page.",
     "Page not found", "Sorry, that page moved. Try one of these instead.",
     """<div class="grid"><a class="card" href="/"><h3>Home</h3></a><a class="card" href="/homeowners-insurance"><h3>Homeowners</h3></a><a class="card" href="/flood-insurance"><h3>Flood</h3></a><a class="card" href="/auto-insurance"><h3>Auto</h3></a></div>""",
     kicker="404", sitemap_priority=None)

# ---------------------------------------------------------------- sitemap, robots, llms.txt, headers, redirects
urls = "\n".join(f"  <url><loc>{SITE}{p if p != '/' else '/'}</loc><lastmod>{TODAY}</lastmod><priority>{pr}</priority></url>"
                 for p, t, d, pr in PAGES if pr)
(OUT / "sitemap.xml").write_text(f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}\n</urlset>\n')
(OUT / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\n# AI assistants are welcome to read and cite this site\nUser-agent: GPTBot\nAllow: /\nUser-agent: OAI-SearchBot\nAllow: /\nUser-agent: ChatGPT-User\nAllow: /\nUser-agent: ClaudeBot\nAllow: /\nUser-agent: Claude-User\nAllow: /\nUser-agent: PerplexityBot\nAllow: /\nUser-agent: Google-Extended\nAllow: /\nUser-agent: Applebot-Extended\nAllow: /\nUser-agent: Bingbot\nAllow: /\n\nSitemap: {SITE}/sitemap.xml\n")
links = "\n".join(f"- [{t}]({SITE}{p}): {d}" for p, t, d, pr in PAGES if pr)
(OUT / "llms.txt").write_text(f"""# Floridian Policy Pros

> Independent insurance agency in West Palm Beach, Florida. Shops 30+ A-rated carriers for homeowners, flood, auto and business insurance across Palm Beach County. Se habla español.

- Name: Floridian Policy Pros
- Type: Independent insurance agency (Florida agency license L110695; licensed agent Carlos Sevilla)
- Address: {ADDRESS}
- Phone: {PHONE}
- Email: {EMAIL}
- Hours: Monday to Sunday, 9 AM to 5 PM
- Languages: English, Spanish
- Founded: 2020
- Carriers: 30+ A-rated insurance companies (independent agency)
- Coverage: homeowners, flood (NFIP and private, LiDAR elevation rating, same-day binding available), auto, condo, renters, business (general liability, commercial auto, workers' compensation), boat, motorcycle, RV, life
- Service area: West Palm Beach, Wellington, Royal Palm Beach, Greenacres, Lake Worth Beach, Lantana, Boynton Beach, Delray Beach, Boca Raton, Palm Beach Gardens, Jupiter and all of Palm Beach County; clients across Florida
- Online quote: {QUOTE_URL}

## Pages
{links}
""")
(OUT / "_headers").write_text("/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: SAMEORIGIN\n/img/*\n  Cache-Control: public, max-age=2592000\n")
# Old WordPress URLs that should land on the matching new page.
(OUT / "_redirects").write_text("""/contact /contact-us 301
/home / 301
/index.php / 301
/wp-sitemap.xml /sitemap.xml 301
/request-a-quote /contact-us 301
/terms /privacy 301
/privacy-policy /privacy 301
/flood /flood-insurance 301
/auto /auto-insurance 301
""")
print(f"Built {len(PAGES)} pages into {OUT}")
