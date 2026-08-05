// Runs on every request (run_worker_first: true in wrangler.jsonc) to handle
// what the static-assets layer can't:
//  1. www → apex 301 (the _redirects file does not support domain-level rules
//     on Workers, unlike Pages — deploy validation rejects them)
//  2. The Google Search Console verification path must answer 200 at the exact
//     filename — assets routing 307s "*.html" to the extensionless URL, and
//     Google's verifier does not follow redirects.
//  3. Security + cache headers — a _headers file is ignored for responses that
//     pass through Worker code, so they're attached here instead.
// Asset serving itself (including the 404.html not-found page) still comes
// from env.ASSETS.

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function withHeaders(response, extra = {}) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "www.rachelfletcherwrites.com") {
      url.hostname = "rachelfletcherwrites.com";
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === "/googled7fff89c63962e50.html") {
      return new Response("google-site-verification: googled7fff89c63962e50.html", {
        headers: { "content-type": "text/html; charset=utf-8", ...SECURITY_HEADERS },
      });
    }
    const response = await env.ASSETS.fetch(request);
    const cacheable = response.ok && url.pathname.startsWith("/assets/");
    return withHeaders(response, cacheable ? { "Cache-Control": "public, max-age=604800" } : {});
  },
};
