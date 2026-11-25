// One public address for search engines: www.24hourbailbondsnearme.com.
// Page views on the old apply. subdomain get a permanent (301) redirect to the
// same path on www. API calls and form posts are never redirected, so payments,
// e-sign callbacks and application submissions keep working on either host.
const CANONICAL_HOST = "www.24hourbailbondsnearme.com";
const OLD_HOSTS = new Set(["apply.24hourbailbondsnearme.com"]);

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const isPageView = request.method === "GET" || request.method === "HEAD";
  if (OLD_HOSTS.has(url.hostname) && isPageView && !url.pathname.startsWith("/api/")) {
    url.hostname = CANONICAL_HOST;
    url.protocol = "https:";
    url.port = "";
    return Response.redirect(url.toString(), 301);
  }
  return context.next();
}
