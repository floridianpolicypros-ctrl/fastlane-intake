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

// The domain once ran a hacked WordPress site with ~20,000 spam posts
// (/?p=123, /?page_id=..). Google still remembers 1,450+ of them. Answer
// those old WordPress addresses with 410 Gone so Google drops them fast.
const WP_QUERY_KEYS = ["p", "page_id", "cat", "tag", "attachment_id", "m", "author"];
function isOldWordPressUrl(url) {
  if (url.pathname.startsWith("/wp-") || url.pathname === "/xmlrpc.php") return true;
  return ROOT_EXEMPT.has(url.pathname) && WP_QUERY_KEYS.some((k) => url.searchParams.has(k));
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const isPageView = request.method === "GET" || request.method === "HEAD";
  if (isPageView && isOldWordPressUrl(url)) {
    return new Response("Gone", {
      status: 410,
      headers: { "Content-Type": "text/plain", "X-Robots-Tag": "noindex" },
    });
  }
  if (OLD_HOSTS.has(url.hostname) && isPageView && !url.pathname.startsWith("/api/") && !ROOT_EXEMPT.has(url.pathname)) {
    url.hostname = CANONICAL_HOST;
    url.protocol = "https:";
    url.port = "";
    // no-store: keep browsers from caching the redirect while hosts are moving,
    // so a later change can never trap a visitor in a stale redirect.
    return new Response(null, {
      status: 301,
      headers: { Location: url.toString(), "Cache-Control": "no-store" },
    });
  }
  return context.next();
}
