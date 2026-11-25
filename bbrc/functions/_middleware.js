// One public address for search engines: www.24hourbailbondsnearme.com.
// Page views on the old apply. subdomain get a permanent (301) redirect to the
// same path on www. API calls and form posts are never redirected, so payments,
// e-sign callbacks and application submissions keep working on either host.
//
// The home page on apply. is NOT redirected. Until 2026-11-25 GoDaddy sent
// www -> apply. with a permanent 301, and browsers cache that. A returning
// visitor would bounce apply/ -> www/ -> (cached) apply/ forever. apply/ serves
// the home page with its canonical set to www, so search engines still
// consolidate on www. Remove ROOT_EXEMPT after a few months.
const ROOT_EXEMPT = new Set(["/", "/index.html"]);
const CANONICAL_HOST = "www.24hourbailbondsnearme.com";
const OLD_HOSTS = new Set(["apply.24hourbailbondsnearme.com"]);

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const isPageView = request.method === "GET" || request.method === "HEAD";
  if (OLD_HOSTS.has(url.hostname) && isPageView && !url.pathname.startsWith("/api/") && !ROOT_EXEMPT.has(url.pathname)) {
    url.hostname = CANONICAL_HOST;
    url.protocol = "https:";
    url.port = "";
    return Response.redirect(url.toString(), 301);
  }
  return context.next();
}
