// Runs on every request (run_worker_first: true in wrangler.jsonc) to handle
// two things the static-assets layer can't:
//  1. www → apex 301 (the _redirects file does not support domain-level rules
//     on Workers, unlike Pages — deploy validation rejects them)
//  2. The Google Search Console verification path must answer 200 at the exact
//     filename — assets routing 307s "*.html" to the extensionless URL, and
//     Google's verifier does not follow redirects.
// Everything else falls through to static assets (which still applies
// _headers and the 404.html not-found page).
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "www.rachelfletcherwrites.com") {
      url.hostname = "rachelfletcherwrites.com";
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === "/googled7fff89c63962e50.html") {
      return new Response("google-site-verification: googled7fff89c63962e50.html", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
