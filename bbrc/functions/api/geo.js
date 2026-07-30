/* ============================================================
   SILENT LOCATION
   ------------------------------------------------------------
   Carlos does not want the form to ASK for location — the browser
   permission prompt makes nervous clients hesitate, and many just
   decline, leaving no record at all.

   Cloudflare already knows roughly where the request came from and
   attaches it to `request.cf` at the edge. Reading it costs nothing,
   needs no third-party service, and produces NO prompt.

   Honest limit: this is IP-derived, so it is city / postal level,
   not a street address. It is evidence of the general place the
   application was signed, not a GPS fix.
   ============================================================ */

export async function onRequestGet(context) {
  const { request } = context;
  const cf = request.cf || {};

  return new Response(JSON.stringify({
    ok: true,
    ip:      request.headers.get("cf-connecting-ip") || "",
    city:    cf.city || "",
    region:  cf.region || "",
    postal:  cf.postalCode || "",
    country: cf.country || "",
    lat:     cf.latitude || "",
    lon:     cf.longitude || "",
    tz:      cf.timezone || ""
  }), {
    headers: {
      "content-type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "cache-control": "no-store"
    }
  });
}
