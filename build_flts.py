#!/usr/bin/env python3
"""Builds the static Fast Lane Traffic School site into flts/.

Every page is plain HTML: titles, descriptions, answers and structured data
are in the file itself, so search engines and AI assistants that do not run
JavaScript can read everything. Run: python3 build_flts.py

Facts used on every page live in the constants below. Change PHONE, HOURS
or the class list here, rebuild, commit both the script and flts/.
"""
import json, html, datetime, pathlib

OUT = pathlib.Path(__file__).parent / "flts"
SITE = "https://westpalmbeachtrafficschool.com"
TODAY = datetime.date.today().isoformat()
NAME = "Fast Lane Traffic School"
PHONE = "561-623-7777"
TEL = "tel:+15616237777"
EMAIL = "palmbeachtrafficschool@gmail.com"
STREET = "800 S. Congress Ave., Suite B"
ADDRESS = "800 S. Congress Ave., Suite B, West Palm Beach, FL 33406"
HOURS = "Open 7 days, 9 AM to 5 PM"
HOURS_ES = "Abierto 7 días, 9 AM a 5 PM"
PROVIDER = "American Safety Council"
ONLINE = "https://fas.asicourse.com/"
FACEBOOK = "https://www.facebook.com/Trafficschoolpalmbeach"
MAPS = "https://www.google.com/maps/search/?api=1&query=Fast+Lane+Traffic+School+800+S+Congress+Ave+West+Palm+Beach+FL+33406"

# Online checkout links, as on the current site (American Safety Council storefront).
BUY = {
    "bdi4": "https://fas.asicourse.com/checkout?course=erk04",
    "bdi8": "https://fas.asicourse.com/checkout?course=e736y",
    "adi12": "https://fas.asicourse.com/checkout?course=epYgp",
    "tlsae": "https://fas.asicourse.com/checkout?course=axkG3",
    "mature": "https://fas.asicourse.com/checkout?course=av2g0",
    "permitprep": "https://fas.asicourse.com/checkout?course=b686V",
    "permitexam": "https://fas.asicourse.com/checkout?course=e5y8K",
    "ftdpractice": "https://fas.asicourse.com/checkout?course=ejR2P",
    "coparent": "https://fas.asicourse.com/checkout?course=elYOg",
}

ORG_ID = SITE + "/#school"
ORG = {
    "@type": ["DrivingSchool", "LocalBusiness"],
    "@id": ORG_ID,
    "name": NAME,
    "alternateName": "West Palm Beach Traffic School",
    "description": "Traffic school in West Palm Beach, Florida. In-person 4-hour BDI, 8-hour intermediate, 12-hour ADI and 4-hour TLSAE (drug and alcohol) classes at 800 S. Congress Ave., plus online courses and the Florida permit exam. Se habla español.",
    "url": SITE + "/",
    "logo": SITE + "/img/fast-lane-traffic-school-logo.jpg",
    "image": SITE + "/img/og.jpg",
    "telephone": "+1-561-623-7777",
    "email": EMAIL,
    "address": {"@type": "PostalAddress", "streetAddress": STREET, "addressLocality": "West Palm Beach",
                "addressRegion": "FL", "postalCode": "33406", "addressCountry": "US"},
    "geo": {"@type": "GeoCoordinates", "latitude": 26.6648747, "longitude": -80.0876842},
    "hasMap": MAPS,
    "openingHoursSpecification": [{"@type": "OpeningHoursSpecification",
        "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
        "opens": "09:00", "closes": "17:00"}],
    "areaServed": [{"@type": "AdministrativeArea", "name": "Palm Beach County, Florida"}] +
                  [{"@type": "City", "name": c} for c in ["West Palm Beach", "Palm Springs", "Lake Worth Beach", "Greenacres",
                   "Lantana", "Wellington", "Royal Palm Beach", "Boynton Beach", "Riviera Beach", "Palm Beach Gardens"]],
    "knowsLanguage": ["en", "es"],
    "founder": {"@type": "Person", "name": "Carlos Sevilla"},
    "sameAs": [FACEBOOK],
}

NAV = [("/", "Home"), ("/4-hour-bdi-course", "4-Hour BDI"), ("/12-hour-adi-course", "12-Hour ADI"),
       ("/8-hour-traffic-school", "8-Hour"), ("/tlsae-drug-alcohol-course", "First-Time Driver"),
       ("/in-person-classes", "Classes"), ("/faq", "FAQ"), ("/contact", "Contact"), ("/escuela-de-trafico", "Español")]
NAV_ES = [("/escuela-de-trafico", "Inicio"), ("/in-person-classes", "Clases"), ("/contact", "Contacto"), ("/", "English")]

CSS = """
:root{--ink:#16181b;--yellow:#FFC400;--yellow-soft:#FFF4CC;--red:#D7261E;--asphalt:#23262b;--muted:#5d6570;--line:#e3e5e8;--bg:#f7f7f5}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:var(--ink);background:#fff;line-height:1.6;font-size:16.5px}
a{color:#b31d16}
.bar{background:var(--asphalt);color:#fff;font-size:13.5px}
.bar .in{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;max-width:1080px;margin:0 auto;padding:7px 18px}
.bar a{color:var(--yellow);text-decoration:none;font-weight:700}
header.site{border-bottom:4px solid var(--yellow);background:#fff}
header.site .in{max-width:1080px;margin:0 auto;padding:10px 18px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--ink);font-weight:800;font-size:19px}
.brand img{height:58px;width:58px}
nav.main{display:flex;flex-wrap:wrap;gap:2px}
nav.main a{color:var(--ink);text-decoration:none;font-weight:600;font-size:14px;padding:7px 10px;border-radius:8px}
nav.main a:hover,nav.main a.on{background:var(--yellow-soft)}
.hero{background:var(--asphalt);color:#fff;background-image:repeating-linear-gradient(90deg,transparent 0 46px,rgba(255,196,0,.9) 46px 86px,transparent 86px 132px);background-size:100% 6px;background-repeat:no-repeat;background-position:bottom}
.hero .in{max-width:1080px;margin:0 auto;padding:44px 18px 46px}
.kicker{color:var(--yellow);font-weight:800;letter-spacing:.08em;font-size:13px;text-transform:uppercase;margin:0 0 8px}
h1{font-size:clamp(28px,4.6vw,44px);line-height:1.15;margin:0 0 14px;font-weight:800}
.hero p.intro{font-size:18px;max-width:720px;margin:0 0 22px;color:#e6e8eb}
.btns{display:flex;flex-wrap:wrap;gap:10px}
.btn{display:inline-block;text-decoration:none;font-weight:800;border-radius:10px;padding:13px 20px;font-size:15.5px}
.btn.yellow{background:var(--yellow);color:#1a1400}.btn.white{background:#fff;color:var(--ink)}.btn.line{border:2px solid #fff;color:#fff}
.btn.dark{background:var(--asphalt);color:#fff}
.trust{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:20px;font-size:14px;color:#d5d8dc;padding:0;list-style:none}
.trust li:before{content:"\\2713  ";color:var(--yellow);font-weight:800}
main .in{max-width:1080px;margin:0 auto;padding:34px 18px}
h2{font-size:clamp(22px,3vw,28px);line-height:1.25;margin:34px 0 12px}
h3{font-size:18px;margin:22px 0 6px}
.answer{background:var(--yellow-soft);border-left:5px solid var(--yellow);padding:14px 18px;border-radius:8px;font-size:17px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;margin:16px 0}
.card{border:1px solid var(--line);border-radius:14px;padding:18px;background:#fff;text-decoration:none;color:inherit;display:block}
a.card:hover{border-color:var(--red);box-shadow:0 4px 14px rgba(0,0,0,.07)}
.card h3{margin:0 0 6px}.card p{margin:0;color:var(--muted);font-size:15px}
.card .tag{display:inline-block;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#b31d16;margin-bottom:4px}
.facts{width:100%;border-collapse:collapse;margin:12px 0;font-size:15px}
.facts th,.facts td{border:1px solid var(--line);padding:9px 11px;text-align:left;vertical-align:top}
.facts th{background:var(--bg);width:34%}
.wrap{overflow-x:auto}
.faq details{border:1px solid var(--line);border-radius:10px;padding:12px 16px;margin:8px 0;background:#fff}
.faq summary{font-weight:700;cursor:pointer}
.faq details p{margin:8px 0 0}
.cta{background:var(--asphalt);color:#fff;border-radius:16px;padding:26px;margin:36px 0 10px;border-top:6px solid var(--yellow)}
.cta h2{color:#fff;margin-top:0}.cta p{color:#d5d8dc}
.note{font-size:13.5px;color:var(--muted)}
ul.checks{padding-left:20px}ul.checks li{margin:5px 0}
footer.site{background:#15171a;color:#c8cbd0;font-size:14.5px;margin-top:30px}
footer.site .in{max-width:1080px;margin:0 auto;padding:30px 18px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px}
footer.site a{color:#fff}footer.site h4{color:var(--yellow);margin:0 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:.06em}
footer.site ul{list-style:none;padding:0;margin:0}footer.site li{margin:4px 0}
.legal{border-top:1px solid #2b2f35;text-align:center;padding:14px 18px;font-size:12.5px;color:#9aa0a8}
.callbar{position:fixed;left:0;right:0;bottom:0;display:flex;z-index:9;box-shadow:0 -4px 14px rgba(0,0,0,.2)}
.callbar a{flex:1;text-align:center;padding:14px 6px;font-weight:800;text-decoration:none;font-size:15px}
.callbar .c{background:var(--yellow);color:#1a1400}.callbar .t{background:var(--asphalt);color:#fff}
body{padding-bottom:56px}
.lead{border:1px solid var(--line);border-radius:16px;padding:22px;background:var(--bg);margin:30px 0}
.lead h2{margin-top:0}.lead form{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.lead label{display:flex;flex-direction:column;font-weight:700;font-size:14px;gap:5px}
.lead input,.lead select,.lead textarea{font:inherit;font-weight:400;padding:11px 12px;border:1px solid #cfd3d8;border-radius:10px;background:#fff;color:var(--ink);width:100%}
.lead .full{grid-column:1/-1}.lead .consent{flex-direction:row;align-items:flex-start;gap:8px;font-weight:400;color:var(--muted);font-size:13px}
.lead .consent input{width:auto;margin-top:3px}.lead button{font:inherit;font-weight:800;background:var(--yellow);color:#1a1400;border:0;border-radius:10px;padding:14px 20px;cursor:pointer;font-size:16px}
.lead .hp{position:absolute;left:-9999px}.lead .msg{grid-column:1/-1;font-weight:700;margin:0}
@media(min-width:900px){.callbar{display:none}body{padding-bottom:0}}
@media(max-width:700px){nav.main{width:100%;overflow-x:auto;flex-wrap:nowrap}nav.main a{white-space:nowrap}.brand img{height:48px;width:48px}}
"""

CLASSES = [("4-Hour Basic Driver Improvement (BDI)", "Clase de 4 horas BDI"), ("8-Hour Intermediate Driver Improvement", "Clase de 8 horas"),
           ("12-Hour Advanced Driver Improvement (ADI)", "Clase de 12 horas ADI"), ("4-Hour TLSAE (Drug & Alcohol)", "Curso TLSAE de 4 horas"),
           ("8-Hour Youthful Offender", "Clase de 8 horas para jóvenes"), ("Florida permit / knowledge exam", "Examen de permiso"),
           ("Mature driver course", "Curso para conductores mayores"), ("Not sure which class I need", "No sé cuál necesito")]


def esc(s):
    return html.escape(s, quote=True)


def faq_schema(faqs, url):
    return {"@type": "FAQPage", "@id": url + "#faq", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faqs]}


def faq_html(faqs, heading):
    items = "".join(f"<details><summary>{esc(q)}</summary><p>{esc(a)}</p></details>" for q, a in faqs)
    return f'<h2 id="faq">{esc(heading)}</h2><div class="faq">{items}</div>'


def course_schema(path, name, desc, hours, online_price=None, buy=None):
    url = SITE + path
    c = {"@type": "Course", "@id": url + "#course", "name": name, "description": desc, "url": url,
         "provider": {"@id": ORG_ID}, "inLanguage": ["en", "es"],
         "hasCourseInstance": [{"@type": "CourseInstance", "courseMode": "Onsite", "courseWorkload": f"PT{hours}H",
                                "location": {"@type": "Place", "name": NAME, "address": ADDRESS}}]}
    if online_price:
        c["hasCourseInstance"].append({"@type": "CourseInstance", "courseMode": "Online", "courseWorkload": f"PT{hours}H"})
        c["offers"] = {"@type": "Offer", "price": online_price, "priceCurrency": "USD", "category": "Online course",
                       "url": buy, "availability": "https://schema.org/InStock"}
    return c


def cta_block(lang="en"):
    if lang == "es":
        return (f'<section class="cta"><h2>Reserve su clase hoy</h2><p>Clases en persona en 800 S. Congress Ave., West Palm Beach, '
                f'o tome su curso en línea. Llame al {PHONE}. Se habla español.</p><div class="btns">'
                f'<a class="btn yellow" href="{TEL}">Llamar {PHONE}</a><a class="btn white" href="/in-person-classes#request">Pedir una clase</a></div></section>')
    return (f'<section class="cta"><h2>Save your seat today</h2><p>In-person classes at 800 S. Congress Ave. in West Palm Beach, '
            f'or take your course online. Call {PHONE}. Se habla español.</p><div class="btns">'
            f'<a class="btn yellow" href="{TEL}">Call {PHONE}</a><a class="btn white" href="/in-person-classes#request">Request a class</a>'
            f'<a class="btn line" href="{ONLINE}" rel="noopener">Take a course online</a></div></section>')


def lead_form(source, lang="en", default=None):
    """Class request. Posts to /api/lead, which emails (and optionally texts) the school."""
    es = lang == "es"
    t = (lambda en, sp: sp if es else en)
    o = "".join(f'<option value="{esc(en)}"{" selected" if en == default else ""}>{esc(sp if es else en)}</option>' for en, sp in CLASSES)
    return f"""<section class="lead" id="request"><h2>{t("Request an in-person class", "Pida una clase en persona")}</h2>
<p>{t("Tell us which class you need and we will call you with the next date and price. Prefer to talk now? Call", "Díganos qué clase necesita y le llamaremos con la próxima fecha y el precio. ¿Prefiere hablar ahora? Llame al")} <a href="{TEL}">{PHONE}</a>.</p>
<form method="post" action="/api/lead" data-lead>
<input type="hidden" name="source" value="{esc(source)}"><input type="hidden" name="lang" value="{lang}">
<label class="hp" aria-hidden="true">Company<input name="company" tabindex="-1" autocomplete="off"></label>
<label>{t("Full name", "Nombre completo")}<input name="name" required autocomplete="name" maxlength="80"></label>
<label>{t("Mobile phone", "Teléfono celular")}<input name="phone" type="tel" required autocomplete="tel" maxlength="20" inputmode="tel"></label>
<label>{t("Email (optional)", "Correo (opcional)")}<input name="email" type="email" autocomplete="email" maxlength="120"></label>
<label>{t("Class", "Clase")}<select name="coverage">{o}</select></label>
<label>{t("Court or ticket deadline (optional)", "Fecha límite de la corte (opcional)")}<input name="time" maxlength="30" placeholder="{t("e.g. Jan 15", "ej. 15 de enero")}"></label>
<label>{t("ZIP code (optional)", "Código postal (opcional)")}<input name="zip" inputmode="numeric" pattern="[0-9]{{5}}" maxlength="5" autocomplete="postal-code"></label>
<label class="full">{t("Anything we should know? (optional)", "¿Algo que debamos saber? (opcional)")}<textarea name="note" rows="3" maxlength="600"></textarea></label>
<label class="consent full"><input type="checkbox" name="consent" value="yes" required> {t("I agree that Fast Lane Traffic School may call, text or email me about my class. Message and data rates may apply.", "Acepto que Fast Lane Traffic School me llame, envíe mensajes de texto o correos sobre mi clase. Pueden aplicar tarifas de mensajes y datos.")}</label>
<div class="full"><button type="submit">{t("Request my class", "Pedir mi clase")}</button></div>
<p class="msg" role="status" aria-live="polite"></p>
</form></section>"""


PAGES = []


def page(path, title, desc, h1, lead, body, faqs=None, kicker=NAME, crumbs=None, lang="en",
         extra_schema=None, hero_buttons=True, prio="0.8", form=None, form_default=None, alt=None):
    url = SITE + path
    graph = [ORG, {"@type": "WebSite", "@id": SITE + "/#website", "url": SITE + "/", "name": NAME,
                   "publisher": {"@id": ORG_ID}, "inLanguage": ["en-US", "es-US"]},
             {"@type": "WebPage", "@id": url + "#webpage", "url": url, "name": title, "description": desc,
              "isPartOf": {"@id": SITE + "/#website"}, "about": {"@id": ORG_ID},
              "inLanguage": "es-US" if lang == "es" else "en-US", "dateModified": TODAY}]
    if crumbs:
        graph.append({"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": n, "item": SITE + p} for i, (p, n) in enumerate(crumbs)]})
    if faqs:
        graph.append(faq_schema(faqs, url))
    if extra_schema:
        graph.extend(extra_schema)
    ld = json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False, separators=(",", ":"))
    nav = "".join(f'<a href="{p}"{" class=on" if p == path else ""}>{n}</a>' for p, n in (NAV_ES if lang == "es" else NAV))
    hreflang = ""
    if alt:
        en_p, es_p = (alt, path) if lang == "es" else (path, alt)
        hreflang = (f'<link rel="alternate" hreflang="en-us" href="{SITE}{en_p}">\n<link rel="alternate" hreflang="es-us" href="{SITE}{es_p}">\n'
                    f'<link rel="alternate" hreflang="x-default" href="{SITE}{en_p}">')
    es = lang == "es"
    buttons = ""
    if hero_buttons:
        buttons = (f'<div class="btns"><a class="btn yellow" href="{TEL}">{"Llamar" if es else "Call"} {PHONE}</a>'
                   f'<a class="btn white" href="{"#request" if form else "/in-person-classes#request"}">{"Pedir una clase" if es else "Request a class"}</a>'
                   f'<a class="btn line" href="{ONLINE}" rel="noopener">{"Cursos en línea" if es else "Online courses"}</a></div>')
    trust = ("<ul class=trust><li>Clases en persona en West Palm Beach</li><li>Cursos en línea aprobados por el estado</li><li>Abierto 7 días</li><li>Se habla español</li></ul>"
             if es else
             "<ul class=trust><li>In-person classes in West Palm Beach</li><li>State-approved online courses</li><li>Open 7 days</li><li>Se habla español</li></ul>")
    year = datetime.date.today().year
    doc = f"""<!DOCTYPE html>
<html lang="{'es' if es else 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{url}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{NAME}">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE}/img/og.jpg">
<meta property="og:locale" content="{'es_US' if es else 'en_US'}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.png" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
{hreflang}
<style>{CSS}</style>
<script type="application/ld+json">{ld}</script>
</head>
<body>
<div class="bar"><div class="in"><span>{'Escuela de tráfico en West Palm Beach · Se habla español' if es else 'Traffic school in West Palm Beach · Se habla español'}</span><span><a href="{TEL}">{PHONE}</a> · {HOURS_ES if es else HOURS}</span></div></div>
<header class="site"><div class="in"><a class="brand" href="/"><img src="/img/fast-lane-traffic-school-logo.webp" width="58" height="58" alt="Fast Lane Traffic School logo, Palm Beach County"><span>{NAME}</span></a><nav class="main" aria-label="Main">{nav}</nav></div></header>
<section class="hero"><div class="in"><p class="kicker">{esc(kicker)}</p><h1>{esc(h1)}</h1><p class="intro">{lead}</p>{buttons}{trust if hero_buttons else ''}</div></section>
<main><div class="in">
{body}
{lead_form(form, lang, form_default) if form else ""}
{faq_html(faqs, "Preguntas frecuentes" if es else "Frequently asked questions") if faqs else ""}
{cta_block(lang)}
</div></main>
<footer class="site"><div class="in">
<div><h4>{NAME}</h4><p>{'Clases de manejo y cursos de tráfico en West Palm Beach.' if es else 'Traffic school and driver improvement classes in West Palm Beach.'}</p><p>{'Cursos en línea ofrecidos por' if es else 'Online courses delivered by'} {PROVIDER}, {'proveedor aprobado por FLHSMV.' if es else 'an FLHSMV-approved course provider.'}</p></div>
<div><h4>{'Contacto' if es else 'Contact'}</h4><ul><li><a href="{TEL}">{PHONE}</a></li><li><a href="mailto:{EMAIL}">{EMAIL}</a></li><li>{ADDRESS}</li><li>{HOURS_ES if es else HOURS}</li><li><a href="{MAPS}" rel="noopener">{'Cómo llegar' if es else 'Directions'}</a></li></ul></div>
<div><h4>{'Cursos' if es else 'Courses'}</h4><ul><li><a href="/4-hour-bdi-course">4-hour BDI</a></li><li><a href="/8-hour-traffic-school">8-hour driver improvement</a></li><li><a href="/12-hour-adi-course">12-hour ADI</a></li><li><a href="/tlsae-drug-alcohol-course">TLSAE / first-time driver</a></li><li><a href="/florida-permit-test">Florida permit test</a></li><li><a href="/mature-driver-course">Mature driver course</a></li></ul></div>
<div><h4>{'Escuela' if es else 'School'}</h4><ul><li><a href="/in-person-classes">{'Clases en persona' if es else 'In-person classes'}</a></li><li><a href="/about">{'Nosotros' if es else 'About us'}</a></li><li><a href="/faq">FAQ</a></li><li><a href="/escuela-de-trafico">Español</a></li><li><a href="{FACEBOOK}" rel="noopener">Facebook</a></li><li><a href="/privacy">{'Privacidad' if es else 'Privacy policy'}</a></li></ul></div>
</div><div class="legal">&copy; {year} {NAME}, {ADDRESS}.</div></footer>
<div class="callbar"><a class="c" href="{TEL}">{'Llamar' if es else 'Call'} {PHONE}</a><a class="t" href="/in-person-classes#request">{'Pedir clase' if es else 'Request a class'}</a></div>
<script>document.querySelectorAll("form[data-lead]").forEach(function(f){{f.addEventListener("submit",function(e){{e.preventDefault();var m=f.querySelector(".msg"),b=f.querySelector("button"),es=f.querySelector("[name=lang]").value=="es";b.disabled=true;m.textContent=es?"Enviando...":"Sending...";var d={{}};new FormData(f).forEach(function(v,k){{d[k]=v}});d.page=location.pathname;d.ref=document.referrer;fetch("/api/lead",{{method:"POST",headers:{{"content-type":"application/json"}},body:JSON.stringify(d)}}).then(function(r){{return r.json()}}).then(function(j){{if(j.ok){{f.reset();m.style.color="#0a7a3d";m.textContent=es?"Recibido. Le llamaremos pronto. Si es urgente, llame al {PHONE}.":"Got it. We will call you shortly. If it's urgent, call {PHONE}."}}else throw 0}}).catch(function(){{m.style.color="#b42318";m.textContent=es?"No se pudo enviar. Por favor llame al {PHONE}.":"That didn't go through. Please call {PHONE}."}}).finally(function(){{b.disabled=false}})}})}})</script>
</body>
</html>
"""
    fname = "index.html" if path == "/" else path.strip("/") + ".html"
    f = OUT / fname
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(doc, encoding="utf-8")
    if prio:
        PAGES.append((path, prio))


def facts(rows):
    return '<div class="wrap"><table class="facts">' + "".join(f"<tr><th>{esc(k)}</th><td>{v}</td></tr>" for k, v in rows) + "</table></div>"


def online_btn(key, label="Take it online"):
    return f'<a class="btn dark" href="{BUY[key]}" rel="noopener">{label}</a>'


# ---------------------------------------------------------------- Home
HOME_FAQ = [
    ("Where can I take traffic school in person in West Palm Beach?",
     f"Fast Lane Traffic School teaches in-person classes at {ADDRESS}. Classes include the 4-hour BDI for ticket dismissal, 8-hour intermediate, 12-hour ADI for license reinstatement, 8-hour youthful offender and the 4-hour TLSAE drug and alcohol course. Call {PHONE} for the next date."),
    ("How do I get a traffic ticket dismissed in Palm Beach County?",
     "For an eligible non-criminal moving violation, tell the Palm Beach County Clerk you elect traffic school and pay the reduced fine within 30 days of the ticket. Then complete a 4-hour Basic Driver Improvement course within 90 days. No points go on your license."),
    ("Can I take my traffic school course online?",
     f"Yes. Fast Lane offers online 4-hour BDI, 8-hour, 12-hour ADI, TLSAE, mature driver and permit courses through {PROVIDER}, an FLHSMV-approved provider. Completion is reported to the state electronically."),
    ("Is Fast Lane open on weekends?",
     f"Yes. The office is open 7 days a week, 9 AM to 5 PM. Call {PHONE} to confirm class times before you come in."),
    ("Do you teach classes in Spanish?",
     f"Yes. Se habla español. Call {PHONE} to ask about Spanish-language classes and online courses."),
]
page("/", "Traffic School West Palm Beach | Fast Lane Traffic School",
     f"In-person and online traffic school in West Palm Beach: 4-hour BDI, 12-hour ADI, 8-hour and TLSAE. Open 7 days. Call {PHONE}.",
     "Traffic School in West Palm Beach, In Person or Online",
     "Got a ticket, a court order or a suspended license? Fast Lane Traffic School teaches state-required driver improvement classes in person at 800 S. Congress Ave., and offers the same courses online. We help you pick the right class the first time.",
     f"""
<p class="answer"><strong>In short:</strong> Fast Lane Traffic School is a traffic school at {ADDRESS}. We teach in-person 4-hour BDI, 8-hour, 12-hour ADI and 4-hour TLSAE classes, sell state-approved online courses and the Florida permit exam, and we are open 7 days from 9 AM to 5 PM. Call {PHONE}.</p>
<h2>Which class do you need?</h2>
<div class="grid">
<a class="card" href="/4-hour-bdi-course"><span class="tag">Got a ticket</span><h3>4-hour BDI</h3><p>Elect traffic school to keep points off your license and cut the fine 18%.</p></a>
<a class="card" href="/12-hour-adi-course"><span class="tag">License suspended</span><h3>12-hour ADI</h3><p>Required to reinstate a license suspended for points or habitual offender status.</p></a>
<a class="card" href="/8-hour-traffic-school"><span class="tag">Court ordered</span><h3>8-hour driver improvement</h3><p>Ordered by a judge or required after certain violations, including youthful offender classes.</p></a>
<a class="card" href="/tlsae-drug-alcohol-course"><span class="tag">First license</span><h3>TLSAE drug and alcohol</h3><p>The 4-hour course every new Florida driver needs before a learner's permit.</p></a>
<a class="card" href="/florida-permit-test"><span class="tag">Learner's permit</span><h3>Florida permit test</h3><p>Permit exam prep and the online Class E knowledge exam.</p></a>
<a class="card" href="/mature-driver-course"><span class="tag">55 and over</span><h3>Mature driver course</h3><p>Online defensive driving course for an insurance discount.</p></a>
</div>
<h2>Why drivers pick Fast Lane</h2>
<ul class="checks">
<li><strong>Real classroom, local instructors.</strong> In-person classes at 800 S. Congress Ave., West Palm Beach 33406.</li>
<li><strong>Open 7 days.</strong> Come in or call any day of the week, 9 AM to 5 PM.</li>
<li><strong>In person or online.</strong> If a judge did not require a classroom, you can finish online at your own pace.</li>
<li><strong>Help in English and Spanish.</strong> Se habla español.</li>
</ul>
""", faqs=HOME_FAQ, form="home", kicker="Fast Lane Traffic School · Palm Beach County", prio="1.0", alt="/escuela-de-trafico")

# ---------------------------------------------------------------- 4-hour BDI
BDI_FAQ = [
    ("How long do I have to finish the 4-hour BDI course in Florida?",
     "You must elect traffic school with the Clerk within 30 days of your ticket, then finish the 4-hour Basic Driver Improvement course within 90 days of electing. If you miss the deadline, the points go on your license."),
    ("How often can I take traffic school to dismiss a ticket?",
     "Florida lets you elect a Basic Driver Improvement course to avoid points no more than once every 12 months and no more than five times in 10 years. Check your eligibility with the Clerk before you pay."),
    ("Does traffic school reduce my fine?",
     "Yes. Electing BDI reduces the civil penalty on an eligible ticket by 18 percent, and no points are added to your Florida driving record."),
    ("Who cannot use traffic school to dismiss a ticket?",
     "Commercial driver license (CDL) holders cannot elect BDI to avoid points, and criminal traffic citations or tickets that require a court hearing do not qualify. Ask the Palm Beach County Clerk if you are unsure."),
    ("Does the 4-hour course lower my insurance?",
     "Because no points go on your record, your insurance rate is not raised by that ticket. Ask your insurance agent about any extra discount for completing the course."),
]
page("/4-hour-bdi-course", "4-Hour BDI Course West Palm Beach | Fast Lane Traffic School",
     f"4-hour BDI course in person in West Palm Beach or online. Keep points off your license and cut the fine 18%. Call {PHONE}.",
     "4-Hour BDI Course for Ticket Dismissal in West Palm Beach",
     "The 4-hour Basic Driver Improvement (BDI) course is how Florida drivers keep a ticket's points off their license. Take it in our West Palm Beach classroom or online.",
     f"""
<p class="answer"><strong>In short:</strong> Elect traffic school with the Palm Beach County Clerk within 30 days of your ticket, pay the fine (18% less), then complete the 4-hour BDI course within 90 days. No points go on your license. Fast Lane teaches it in person at 800 S. Congress Ave. and online for $35.</p>
{facts([("Length", "4 hours"), ("Who takes it", "Drivers with an eligible non-criminal moving violation who elect traffic school, and some drivers ordered by a judge"),
        ("Deadlines", "Elect within 30 days of the ticket; finish within 90 days of electing"),
        ("What you get", "No points on your license and an 18% lower civil penalty"),
        ("In person", f"800 S. Congress Ave., West Palm Beach. Call {PHONE} for the next class and price"),
        ("Online", f"$35 through {PROVIDER}, an FLHSMV-approved provider")])}
<div class="btns">{online_btn("bdi4", "Take the 4-hour BDI online ($35)")}<a class="btn yellow" href="#request">Request an in-person class</a></div>
<h2>How ticket dismissal works in Palm Beach County</h2>
<ol>
<li>Within 30 days of the ticket, tell the Palm Beach County Clerk you elect to attend traffic school and pay the reduced fine.</li>
<li>Complete a 4-hour Basic Driver Improvement course within 90 days.</li>
<li>Your completion is reported to the Florida Department of Highway Safety and Motor Vehicles (FLHSMV). Keep your certificate.</li>
</ol>
""", faqs=BDI_FAQ, form="bdi", form_default="4-Hour Basic Driver Improvement (BDI)", kicker="Ticket dismissal",
     crumbs=[("/", "Home"), ("/4-hour-bdi-course", "4-Hour BDI")],
     extra_schema=[course_schema("/4-hour-bdi-course", "4-Hour Basic Driver Improvement (BDI)", "Florida 4-hour Basic Driver Improvement course for ticket dismissal and point avoidance.", 4, "35.00", BUY["bdi4"])])

# ---------------------------------------------------------------- 8-hour
IDI_FAQ = [
    ("Who has to take an 8-hour driver improvement course in Florida?",
     "Usually a driver ordered by a judge after a traffic case, or a driver directed by FLHSMV after certain violations. Your court paperwork or FLHSMV letter names the course you need. Bring it with you or read it to us on the phone."),
    ("Can I take the 8-hour course online?",
     "Often yes, but if a judge specifically ordered a classroom course, take it in person. Fast Lane teaches the 8-hour course in our West Palm Beach classroom and online."),
    ("What is the 8-hour youthful offender course?",
     "It is an 8-hour driver improvement class that courts can order for young drivers. Fast Lane teaches it in person in West Palm Beach. Call to check the next date."),
]
page("/8-hour-traffic-school", "8-Hour Traffic School West Palm Beach | Fast Lane",
     f"8-hour intermediate driver improvement and youthful offender classes in person in West Palm Beach, or online. Court-ordered classes. Call {PHONE}.",
     "8-Hour Driver Improvement Course in West Palm Beach",
     "Ordered by a judge to take an 8-hour class? Fast Lane teaches the 8-hour intermediate driver improvement course and the 8-hour youthful offender class in our West Palm Beach classroom.",
     f"""
<p class="answer"><strong>In short:</strong> The 8-hour driver improvement course is usually ordered by a judge or required by FLHSMV after certain violations. Fast Lane teaches it in person at 800 S. Congress Ave. and offers it online for $75. Bring your court order so we confirm it is the right class.</p>
{facts([("Length", "8 hours"), ("Who takes it", "Drivers ordered by a judge, drivers directed by FLHSMV, and young drivers ordered to a youthful offender class"),
        ("In person", f"800 S. Congress Ave., West Palm Beach. Call {PHONE} for the next class"),
        ("Online", f"$75 through {PROVIDER}, an FLHSMV-approved provider")])}
<div class="btns">{online_btn("bdi8", "Take the 8-hour course online ($75)")}<a class="btn yellow" href="#request">Request an in-person class</a></div>
""", faqs=IDI_FAQ, form="idi", form_default="8-Hour Intermediate Driver Improvement", kicker="Court-ordered classes",
     crumbs=[("/", "Home"), ("/8-hour-traffic-school", "8-Hour")],
     extra_schema=[course_schema("/8-hour-traffic-school", "8-Hour Driver Improvement", "Florida 8-hour driver improvement course for court-ordered and FLHSMV-required students, including youthful offender classes.", 8, "75.00", BUY["bdi8"])])

# ---------------------------------------------------------------- 12-hour ADI
ADI_FAQ = [
    ("Who needs the 12-hour ADI course in Florida?",
     "Drivers whose license was suspended for too many points, or who were designated a habitual traffic offender for non-DUI violations, must complete the 12-hour Advanced Driver Improvement course to reinstate. A judge can also order it."),
    ("Can I get a hardship license while I take ADI?",
     "Drivers suspended for points may qualify for a business or employment-purposes license after enrolling in ADI. Ask us for proof of enrollment when you sign up, then apply for the hardship hearing."),
    ("Is the 12-hour ADI class offered in person in West Palm Beach?",
     f"Yes. Fast Lane teaches the 12-hour ADI class in person at {ADDRESS}. It is also available online. Call {PHONE} for the next class."),
    ("Do I need driving lessons with ADI?",
     "If your license was suspended for three crashes in three years, Florida requires behind-the-wheel training on top of the 12-hour ADI course. For point suspensions, the 12-hour course alone is required."),
]
page("/12-hour-adi-course", "12-Hour ADI Class West Palm Beach | Fast Lane Traffic School",
     f"12-hour ADI class in person in West Palm Beach or online, to reinstate a license suspended for points. Call {PHONE}.",
     "12-Hour ADI Course in West Palm Beach",
     "Suspended for points or habitual offender status? The 12-hour Advanced Driver Improvement (ADI) course is the step that gets your Florida license back. Take it in person in West Palm Beach or online.",
     f"""
<p class="answer"><strong>In short:</strong> The 12-hour ADI course is required to reinstate a Florida license suspended for points or non-DUI habitual traffic offender status. Fast Lane teaches it in person at 800 S. Congress Ave. and online for $99.95. Ask for proof of enrollment if you need a hardship license.</p>
{facts([("Length", "12 hours"), ("Who takes it", "Drivers suspended for points, non-DUI habitual traffic offenders, and drivers ordered by a judge"),
        ("Hardship license", "Proof of ADI enrollment is part of the hardship (business purposes) application"),
        ("In person", f"800 S. Congress Ave., West Palm Beach. Call {PHONE} for the next class and price"),
        ("Online", f"$99.95 through {PROVIDER}, an FLHSMV-approved provider")])}
<div class="btns">{online_btn("adi12", "Take the 12-hour ADI online ($99.95)")}<a class="btn yellow" href="#request">Request an in-person class</a></div>
""", faqs=ADI_FAQ, form="adi", form_default="12-Hour Advanced Driver Improvement (ADI)", kicker="License reinstatement",
     crumbs=[("/", "Home"), ("/12-hour-adi-course", "12-Hour ADI")],
     extra_schema=[course_schema("/12-hour-adi-course", "12-Hour Advanced Driver Improvement (ADI)", "Florida 12-hour Advanced Driver Improvement course for license reinstatement after a points or habitual traffic offender suspension.", 12, "99.95", BUY["adi12"])])

# ---------------------------------------------------------------- TLSAE
TLSAE_FAQ = [
    ("Who needs the TLSAE course in Florida?",
     "Anyone getting a Florida driver license for the first time, at any age, must complete the 4-hour Traffic Law and Substance Abuse Education (TLSAE) course, also called the drug and alcohol course or DATA course."),
    ("Can I take TLSAE online?",
     f"Yes. The 4-hour TLSAE course is $35 online through {PROVIDER}. Fast Lane also teaches it in person in West Palm Beach."),
    ("What comes after TLSAE?",
     "After TLSAE, you pass the Class E knowledge (permit) exam, then take your learner's permit documents to a driver license office. Fast Lane sells permit test prep and the online permit exam."),
]
page("/tlsae-drug-alcohol-course", "TLSAE Drug & Alcohol Course | Fast Lane Traffic School",
     f"4-hour TLSAE drug and alcohol course for first-time Florida drivers, in West Palm Beach or online for $35. Call {PHONE}.",
     "TLSAE Drug and Alcohol Course for First-Time Drivers",
     "Every first-time Florida driver needs the 4-hour Traffic Law and Substance Abuse Education (TLSAE) course before a learner's permit. Take it in our West Palm Beach classroom or online.",
     f"""
<p class="answer"><strong>In short:</strong> TLSAE is the 4-hour drug and alcohol course required for a first Florida driver license. Fast Lane teaches it in person at 800 S. Congress Ave. and online for $35, and offers first-time driver packages with permit test prep.</p>
{facts([("Length", "4 hours"), ("Who takes it", "Anyone getting a first Florida driver license, including teens and adults"),
        ("Online", "$35 TLSAE alone; first-time driver package $54.95, or $62.95 with practice tests"),
        ("In person", f"800 S. Congress Ave., West Palm Beach. Call {PHONE}")])}
<div class="btns">{online_btn("tlsae", "Take TLSAE online ($35)")}{online_btn("ftdpractice", "First-time driver package ($62.95)")}<a class="btn yellow" href="#request">Request an in-person class</a></div>
""", faqs=TLSAE_FAQ, form="tlsae", form_default="4-Hour TLSAE (Drug & Alcohol)", kicker="First-time drivers",
     crumbs=[("/", "Home"), ("/tlsae-drug-alcohol-course", "TLSAE")],
     extra_schema=[course_schema("/tlsae-drug-alcohol-course", "4-Hour TLSAE (Drug and Alcohol) Course", "Florida Traffic Law and Substance Abuse Education course required for first-time drivers.", 4, "35.00", BUY["tlsae"])])

# ---------------------------------------------------------------- Permit test
PERMIT_FAQ = [
    ("What is on the Florida permit test?",
     "The Class E knowledge exam has 50 multiple-choice questions on Florida road signs and traffic laws. You need 40 correct answers (80 percent) to pass."),
    ("Can I take the Florida permit test online?",
     f"Yes, through an approved online provider. Fast Lane sells the online Florida permit exam for $29 and permit test prep for $20 through {PROVIDER}. Under-18 rules may require part of the process in person; call {PHONE} if you are unsure."),
]
page("/florida-permit-test", "Florida Permit Test Prep & Online Exam | Fast Lane",
     f"Florida learner's permit test prep and the online Class E knowledge exam from Fast Lane Traffic School in West Palm Beach. Call {PHONE}.",
     "Florida Permit Test Prep and Online Exam",
     "Get ready for the Florida Class E knowledge exam and take it online. Pair it with the TLSAE course for everything a first-time driver needs before visiting the driver license office.",
     f"""
<p class="answer"><strong>In short:</strong> The Florida permit test is a 50-question Class E knowledge exam; you need 80 percent to pass. Fast Lane sells permit prep ($20), the online permit exam ($29) and first-time driver packages that include TLSAE.</p>
<div class="btns">{online_btn("permitprep", "Permit test prep ($20)")}{online_btn("permitexam", "Online permit exam ($29)")}{online_btn("ftdpractice", "Full first-time driver package ($62.95)")}</div>
""", faqs=PERMIT_FAQ, kicker="Learner's permit", crumbs=[("/", "Home"), ("/florida-permit-test", "Permit test")], prio="0.7")

# ---------------------------------------------------------------- Mature driver
MATURE_FAQ = [
    ("Do Florida drivers 55 and over get an insurance discount for a driving course?",
     "Yes. Florida law requires auto insurers to give a premium discount to drivers 55 and older who complete an approved mature driver course. The discount lasts three years, then you retake the course."),
]
page("/mature-driver-course", "Florida Mature Driver Course (55+) | Fast Lane",
     "6-hour online mature driver course for Florida drivers 55 and over. Complete it for a required auto insurance discount. $14.95.",
     "Mature Driver Course for Florida Drivers 55 and Over",
     "Florida drivers 55 and older who complete an approved mature driver course get an auto insurance discount by law. Take the 6-hour course online.",
     f"""
<p class="answer"><strong>In short:</strong> The 6-hour mature driver course costs $14.95 online. Florida insurers must give drivers 55 and over a discount for completing it, good for three years.</p>
<div class="btns">{online_btn("mature", "Take the mature driver course ($14.95)")}</div>
""", faqs=MATURE_FAQ, kicker="55 and over", crumbs=[("/", "Home"), ("/mature-driver-course", "Mature driver")], prio="0.6",
     extra_schema=[course_schema("/mature-driver-course", "6-Hour Florida Mature Driver Course", "Online defensive driving course for Florida drivers 55 and over that qualifies for an auto insurance discount.", 6, "14.95", BUY["mature"])])

# ---------------------------------------------------------------- In-person classes
page("/in-person-classes", "In-Person Traffic School Classes West Palm Beach | Fast Lane",
     f"In-person 4-hour BDI, 8-hour, 12-hour ADI and TLSAE classes at 800 S. Congress Ave., West Palm Beach. Call {PHONE} to reserve.",
     "In-Person Traffic School Classes in West Palm Beach",
     "Some courts require a classroom, and many drivers simply learn better in a room with an instructor. Fast Lane teaches every core Florida driver improvement class at our West Palm Beach location.",
     f"""
<p class="answer"><strong>In short:</strong> Fast Lane teaches in-person 4-hour BDI, 8-hour driver improvement, 8-hour youthful offender, 12-hour ADI and 4-hour TLSAE classes at {ADDRESS}. Call {PHONE} or send the form below and we will reserve your seat for the next class.</p>
<div class="wrap"><table class="facts">
<tr><th>Class</th><td><strong>Who it is for</strong></td></tr>
<tr><th><a href="/4-hour-bdi-course">4-hour BDI</a></th><td>Ticket dismissal and point avoidance</td></tr>
<tr><th><a href="/8-hour-traffic-school">8-hour driver improvement</a></th><td>Court-ordered or FLHSMV-required</td></tr>
<tr><th><a href="/8-hour-traffic-school">8-hour youthful offender</a></th><td>Young drivers ordered by a court</td></tr>
<tr><th><a href="/12-hour-adi-course">12-hour ADI</a></th><td>License reinstatement after points or habitual offender suspension</td></tr>
<tr><th><a href="/tlsae-drug-alcohol-course">4-hour TLSAE</a></th><td>First-time Florida drivers</td></tr>
</table></div>
<h2>What to bring</h2>
<ul class="checks"><li>A photo ID</li><li>Your ticket, court order or FLHSMV letter, so we confirm you are in the right class</li><li>Payment</li></ul>
<h2>Getting here</h2>
<p>We are at {ADDRESS}. <a href="{MAPS}" rel="noopener">Get directions</a>.</p>
""", form="classes", kicker="Classroom courses", crumbs=[("/", "Home"), ("/in-person-classes", "In-person classes")], prio="0.9")

# ---------------------------------------------------------------- FAQ
ALL_FAQ = HOME_FAQ + BDI_FAQ + ADI_FAQ[:2] + IDI_FAQ[:1] + TLSAE_FAQ[:1] + PERMIT_FAQ[:1] + MATURE_FAQ
page("/faq", "Florida Traffic School FAQ | Fast Lane Traffic School",
     "Florida traffic school answers: ticket dismissal deadlines, BDI eligibility, 12-hour ADI, TLSAE and online courses.",
     "Florida Traffic School Questions, Answered", "Straight answers about tickets, points, suspensions and first-time driver courses in Florida.",
     "", faqs=ALL_FAQ, kicker="FAQ", crumbs=[("/", "Home"), ("/faq", "FAQ")], prio="0.7")

# ---------------------------------------------------------------- About
page("/about", "About Fast Lane Traffic School | West Palm Beach",
     f"Fast Lane Traffic School is a locally owned traffic school at 800 S. Congress Ave. in West Palm Beach, owned by Carlos Sevilla. Call {PHONE}.",
     "About Fast Lane Traffic School", "A locally owned traffic school in West Palm Beach, serving Palm Beach County drivers in English and Spanish.",
     f"""
<p class="answer"><strong>In short:</strong> Fast Lane Traffic School is owned by Carlos Sevilla and located at {ADDRESS}. We teach Florida driver improvement classes in person and sell state-approved online courses delivered by {PROVIDER}, an FLHSMV-approved provider.</p>
<p>Fast Lane serves drivers across Palm Beach County, including West Palm Beach, Palm Springs, Lake Worth Beach, Greenacres, Lantana, Wellington, Royal Palm Beach and Boynton Beach. The office is open 7 days a week, 9 AM to 5 PM, and our staff speaks English and Spanish.</p>
""", kicker="About us", crumbs=[("/", "Home"), ("/about", "About")], prio="0.6")

# ---------------------------------------------------------------- Contact
page("/contact", "Contact Fast Lane Traffic School | West Palm Beach",
     f"Call {PHONE} or visit 800 S. Congress Ave., Suite B, West Palm Beach, FL 33406. Open 7 days, 9 AM to 5 PM.",
     "Contact Fast Lane Traffic School", f"Call {PHONE}, email {EMAIL}, or visit us at {ADDRESS}.",
     f"""{facts([("Phone", f'<a href="{TEL}">{PHONE}</a>'), ("Email", f'<a href="mailto:{EMAIL}">{EMAIL}</a>'),
               ("Address", f'{ADDRESS} (<a href="{MAPS}" rel="noopener">directions</a>)'), ("Hours", HOURS), ("Languages", "English and Spanish")])}""",
     form="contact", kicker="Contact", crumbs=[("/", "Home"), ("/contact", "Contact")], prio="0.7")

# ---------------------------------------------------------------- Spanish
ES_FAQ = [
    ("¿Dónde puedo tomar la escuela de tráfico en persona en West Palm Beach?",
     f"Fast Lane Traffic School da clases en persona en {ADDRESS}: BDI de 4 horas, clase de 8 horas, ADI de 12 horas y TLSAE de 4 horas. Llame al {PHONE}."),
    ("¿Cómo quito los puntos de una multa en Palm Beach?",
     "Dentro de 30 días de la multa, elija escuela de tráfico con el Secretario del Condado (Clerk) y pague la multa reducida. Luego complete el curso BDI de 4 horas dentro de 90 días. No se agregan puntos a su licencia."),
    ("¿Puedo tomar el curso en línea?",
     f"Sí. Ofrecemos cursos en línea aprobados por el estado a través de {PROVIDER}."),
]
page("/escuela-de-trafico", "Escuela de Tráfico en West Palm Beach | Fast Lane",
     f"Escuela de tráfico en West Palm Beach: clases en persona y en línea. BDI de 4 horas, ADI de 12 horas, TLSAE. Se habla español. Llame al {PHONE}.",
     "Escuela de Tráfico en West Palm Beach", "¿Recibió una multa, una orden de la corte o le suspendieron la licencia? Le ayudamos a elegir la clase correcta, en persona o en línea. Se habla español.",
     f"""
<p class="answer"><strong>En resumen:</strong> Fast Lane Traffic School está en {ADDRESS}. Damos clases en persona de 4, 8 y 12 horas y el curso TLSAE, y vendemos cursos en línea aprobados por el estado. Abierto 7 días, 9 AM a 5 PM. Llame al {PHONE}.</p>
<div class="grid">
<a class="card" href="/4-hour-bdi-course"><h3>BDI de 4 horas</h3><p>Para quitar los puntos de una multa y bajar la multa 18%.</p></a>
<a class="card" href="/12-hour-adi-course"><h3>ADI de 12 horas</h3><p>Para recuperar una licencia suspendida por puntos.</p></a>
<a class="card" href="/tlsae-drug-alcohol-course"><h3>TLSAE de 4 horas</h3><p>Curso de drogas y alcohol para la primera licencia.</p></a>
</div>
""", faqs=ES_FAQ, form="espanol", lang="es", kicker="Se habla español", crumbs=[("/escuela-de-trafico", "Inicio")], prio="0.8", alt="/")

# ---------------------------------------------------------------- Privacy and 404
page("/privacy", "Privacy Policy | Fast Lane Traffic School", "How Fast Lane Traffic School handles information you send through this website.",
     "Privacy Policy", "", f"""<p>When you send a class request, we use your name, phone, email and note only to contact you about your class. We do not sell your information. Online courses are purchased on {PROVIDER}'s site, which has its own privacy policy. Questions: {EMAIL}.</p>""",
     kicker="Privacy", hero_buttons=False, prio="0.2")
page("/404", "Page not found | Fast Lane Traffic School", "This page does not exist.", "Page not found",
     "The page you were looking for has moved. Pick a class below or call us.",
     '<p><a href="/">Home</a> · <a href="/4-hour-bdi-course">4-hour BDI</a> · <a href="/12-hour-adi-course">12-hour ADI</a> · <a href="/in-person-classes">In-person classes</a></p>',
     kicker="404", prio=None)

# ---------------------------------------------------------------- sitemap, robots, llms.txt, headers, redirects
urls = "\n".join(f"<url><loc>{SITE}{p}</loc><lastmod>{TODAY}</lastmod><priority>{pr}</priority></url>" for p, pr in PAGES)
(OUT / "sitemap.xml").write_text(f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}\n</urlset>\n')
(OUT / "robots.txt").write_text(
    "User-agent: *\nAllow: /\n\n# AI assistants are welcome to read and cite this site\n" +
    "".join(f"User-agent: {b}\nAllow: /\n" for b in ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User",
                                                     "PerplexityBot", "Google-Extended", "Applebot-Extended", "Bingbot"]) +
    f"\nSitemap: {SITE}/sitemap.xml\n")
(OUT / "llms.txt").write_text(f"""# {NAME}

> Traffic school in West Palm Beach, Florida (Palm Beach County). In-person driver improvement classes at {ADDRESS}, plus state-approved online courses delivered by {PROVIDER}, an FLHSMV-approved provider. Open 7 days, 9 AM to 5 PM. Phone {PHONE}. Se habla español.

## Facts
- Name: {NAME} (Google listing also shows "West Palm Beach Traffic School")
- Address: {ADDRESS}
- Phone: {PHONE}
- Email: {EMAIL}
- Hours: {HOURS}
- Owner: Carlos Sevilla
- Languages: English, Spanish
- In-person classes: 4-hour BDI, 8-hour driver improvement, 8-hour youthful offender, 12-hour ADI, 4-hour TLSAE
- Online prices: 4-hour BDI $35, 8-hour $75, 12-hour ADI $99.95, TLSAE $35, mature driver $14.95, permit exam $29, permit prep $20

## Pages
- [4-hour BDI (ticket dismissal)]({SITE}/4-hour-bdi-course)
- [8-hour driver improvement]({SITE}/8-hour-traffic-school)
- [12-hour ADI (license reinstatement)]({SITE}/12-hour-adi-course)
- [TLSAE drug and alcohol course]({SITE}/tlsae-drug-alcohol-course)
- [Florida permit test]({SITE}/florida-permit-test)
- [Mature driver course]({SITE}/mature-driver-course)
- [In-person classes]({SITE}/in-person-classes)
- [FAQ]({SITE}/faq)
- [Escuela de tráfico (español)]({SITE}/escuela-de-trafico)
- [Contact]({SITE}/contact)
""")
(OUT / "_headers").write_text("https://:project.pages.dev/*\n  X-Robots-Tag: noindex\nhttps://:version.:project.pages.dev/*\n  X-Robots-Tag: noindex\n/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: SAMEORIGIN\n/img/*\n  Cache-Control: public, max-age=2592000\n")
(OUT / "_redirects").write_text("""/home / 301
/index.php / 301
/wp-sitemap.xml /sitemap.xml 301
/wp-sitemap-posts-page-1.xml /sitemap.xml 301
/contact-us /contact 301
/bdi /4-hour-bdi-course 301
/adi /12-hour-adi-course 301
/tlsae /tlsae-drug-alcohol-course 301
/espanol /escuela-de-trafico 301
/privacy-policy /privacy 301
""")
print(f"Built {len(PAGES)} pages into {OUT}")
