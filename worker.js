// The static-assets router 307-redirects "*.html" URLs to their extensionless
// form, but Google Search Console's verifier requires a 200 at the exact
// filename and does not follow redirects — so this one path is served here
// (run_worker_first in wrangler.jsonc). Everything else falls through to assets.
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/googled7fff89c63962e50.html") {
      return new Response("google-site-verification: googled7fff89c63962e50.html", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
