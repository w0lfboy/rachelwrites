// Runs on every request (run_worker_first: true in wrangler.jsonc) to handle
// what the static-assets layer can't:
//  1. www → apex 301 (the _redirects file does not support domain-level rules
//     on Workers, unlike Pages — deploy validation rejects them)
//  2. The Google Search Console verification path must answer 200 at the exact
//     filename — assets routing 307s "*.html" to the extensionless URL, and
//     Google's verifier does not follow redirects.
//  3. Security + cache headers — a _headers file is ignored for responses that
//     pass through Worker code, so they're attached here instead.
//  4. /api/letters — server-side proxy of the Substack RSS feed (30-min edge
//     cache) that powers the "Fresh from the letters" strip on /recipes.
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
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname === "www.rachelfletcherwrites.com") {
      url.hostname = "rachelfletcherwrites.com";
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === "/api/letters") {
      return latestLetters(ctx);
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

const FEED_URL = "https://rachelfletcher.substack.com/feed";
const FEED_TTL = 1800; // 30 min — new letters appear on /recipes within this window

async function latestLetters(ctx) {
  const cache = caches.default;
  const cacheKey = new Request("https://cache.rachelfletcherwrites.com/api/letters");
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let items = [];
  try {
    const res = await fetch(FEED_URL, {
      headers: {
        "User-Agent": "rachelfletcherwrites.com site (Cloudflare Worker)",
        "Accept": "application/rss+xml, application/xml, text/xml",
      },
    });
    if (res.ok) items = parseFeed(await res.text());
  } catch (e) {
    // fall through with empty items; the short cache below limits retry pressure
  }

  const out = new Response(JSON.stringify({ items }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, s-maxage=${items.length ? FEED_TTL : 60}, max-age=300`,
      ...SECURITY_HEADERS,
    },
  });
  ctx.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}

function parseFeed(xml) {
  const items = [];
  for (const block of (xml.match(/<item>[\s\S]*?<\/item>/g) || []).slice(0, 6)) {
    const title = feedText(feedTag(block, "title"));
    const link = feedText(feedTag(block, "link"));
    const date = feedText(feedTag(block, "pubDate"));
    const description = feedText(feedTag(block, "description")).slice(0, 180);
    if (title && link.startsWith("https://")) items.push({ title, link, date, description });
  }
  return items;
}

function feedTag(block, name) {
  const m = block.match(new RegExp("<" + name + "[^>]*>([\\s\\S]*?)</" + name + ">"));
  return m ? m[1].trim() : "";
}

function feedText(v) {
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) v = cdata[1];
  return v
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
