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
//  5. POST /api/reading-list — the lead-magnet funnel: validates the email,
//     stores the contact in Resend (segment "Middle School Reading List"),
//     and emails the PDF. If email can't send (e.g. RESEND_API_KEY unset or
//     domain unverified), the response carries the download URL so the
//     visitor still gets the list. Needs secret RESEND_API_KEY; vars in
//     wrangler.jsonc.
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
    if (url.pathname === "/api/reading-list") {
      return readingListSignup(request, env);
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
  let meta = {};
  try {
    // Substack bot-blocks plain/custom UAs from datacenter IPs; browser-like
    // headers get the feed through.
    const res = await fetch(FEED_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept": "application/rss+xml, application/xml, text/xml, */*",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    meta.status = res.status;
    if (res.ok) items = parseFeed(await res.text());
  } catch (e) {
    // fall through with empty items; the short cache below limits retry pressure
    meta.error = String(e && e.message || e);
  }

  const out = new Response(JSON.stringify({ items, meta }), {
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

/* ---------------- Reading-list lead magnet ---------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function readingListSignup(request, env) {
  if (request.method === "GET") {
    // Health check: config state only, never values.
    return json({
      ok: true,
      configured: Boolean(env.RESEND_API_KEY),
      segment: Boolean(env.READING_LIST_SEGMENT_ID),
      from: env.MAIL_FROM || null,
    });
  }
  if (request.method !== "POST") {
    return json({ ok: false, error: "POST only" }, 405);
  }
  let body = {};
  try {
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) body = await request.json();
    else body = Object.fromEntries((await request.formData()).entries());
  } catch (e) {
    return json({ ok: false, error: "Couldn't read that. Try once more?" }, 400);
  }
  // honeypot: bots fill every field
  if (body.website) return json({ ok: true, delivered: true });

  const email = String(body.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return json({ ok: false, error: "That email doesn't look quite right." }, 400);
  }

  const download = env.READING_LIST_DOWNLOAD_URL;
  if (!env.RESEND_API_KEY) {
    // Not configured yet: still hand over the list so no visitor is stranded.
    return json({ ok: true, delivered: false, download, note: "RESEND_API_KEY not set" });
  }

  const auth = { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" };

  // 1. Store the contact (duplicates are fine — the email still goes out)
  let contact = null;
  try {
    const cr = await fetch("https://api.resend.com/contacts", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        email,
        unsubscribed: false,
        segments: env.READING_LIST_SEGMENT_ID ? [{ id: env.READING_LIST_SEGMENT_ID }] : undefined,
        properties: { source: String(body.source || "site").slice(0, 40), page: String(body.page || "").slice(0, 80) },
      }),
    });
    contact = cr.status;
    if (!cr.ok) contact = cr.status + " " + (await cr.text()).slice(0, 160);
  } catch (e) { contact = "error " + String(e && e.message || e); }

  // 2. Send the delivery email
  let delivered = false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        from: env.MAIL_FROM || "Rachel Fletcher <hello@rachelfletcherwrites.com>",
        to: [email],
        reply_to: env.MAIL_REPLY_TO || undefined,
        subject: "Here\u2019s your reading list \ud83d\udcd6",
        html: deliveryHtml(download, email, env),
        text: deliveryText(download, email, env),
        tags: [{ name: "funnel", value: "reading-list" }],
      }),
    });
    delivered = res.ok;
  } catch (e) { delivered = false; }

  // 3. Subscribe them to Fletchling Thoughts on Substack (consent is stated on
  //    every form). Uses the same endpoint Substack's own embed widget posts to.
  //    Undocumented, so it's fail-safe: any failure is reported, never fatal.
  //    Switch off with SUBSTACK_SYNC="off" in wrangler.jsonc vars.
  let substack = "off";
  if ((env.SUBSTACK_SYNC || "on") !== "off") {
    const base = env.SUBSTACK_URL || "https://rachelfletcher.substack.com";
    try {
      const form = new URLSearchParams({
        email,
        source: "embed",
        first_url: "https://rachelfletcherwrites.com/reading-list",
        first_referrer: "https://rachelfletcherwrites.com/",
        current_url: "https://rachelfletcherwrites.com" + String(body.page || "/reading-list").slice(0, 80),
        current_referrer: "https://rachelfletcherwrites.com/",
        first_session_url: "https://rachelfletcherwrites.com/reading-list",
        first_session_referrer: "https://rachelfletcherwrites.com/",
      });
      const sr = await fetch(base + "/api/v1/free?nojs=true", {
        method: "POST",
        body: form,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,*/*",
          "Origin": base,
          "Referer": base + "/embed",
        },
        redirect: "manual",
      });
      substack = sr.status;
      if (sr.status >= 400) substack = sr.status + " " + (await sr.text()).slice(0, 120);
    } catch (e) { substack = "error " + String(e && e.message || e); }
  }

  return json(delivered ? { ok: true, delivered: true, contact, substack } : { ok: true, delivered: false, download, contact, substack });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS },
  });
}

function deliveryText(download, email, env) {
  const sub = substackLink(email, env);
  return [
    "Here's your reading list.",
    "",
    "Twelve Books to Read with Your Middle Schooler \u2014 so you can stay weird and wonderful together.",
    "",
    "Download the PDF: " + download,
    "",
    "A few of these are the books my sisters and I read by candlelight as tweens (we moved the basement sofa to hide the wax). Some will spark conversations you didn't expect; I've left honest notes on the moments worth talking through. Read them alongside your kid, not ahead of them \u2014 that's the whole trick.",
    "",
    "One more click and you'll get Fletchling Thoughts \u2014 my letters on books, home, and making meaning, every other week. Your email is already filled in: " + sub,
    "",
    "Happy reading,",
    "Rachel",
    "",
    "Rachel Fletcher \u00b7 Harrisonburg, Virginia \u00b7 rachelfletcherwrites.com",
    "Not your thing? Reply with 'unsubscribe' and I'll take you off the list.",
  ].join("\n");
}

function substackLink(email, env) {
  return (env.SUBSTACK_URL || "https://rachelfletcher.substack.com") + "/subscribe?email=" + encodeURIComponent(email);
}

function deliveryHtml(download, email, env) {
  const sub = substackLink(email, env);
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#EAE1CE;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#EAE1CE;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#F4EEE1;border:1px solid #cfc6b0;">
<tr><td style="padding:40px 40px 8px;text-align:center;font-family:Georgia,'Times New Roman',serif;">
  <div style="font-size:11px;letter-spacing:4px;text-transform:uppercase;color:#857438;">A reading list</div>
  <h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:30px;line-height:1.15;color:#3A4651;margin:14px 0 0;">Twelve Books to Read with Your Middle Schooler</h1>
  <div style="font-style:italic;font-size:17px;color:#5A322F;margin-top:10px;">so you can stay weird and wonderful together</div>
</td></tr>
<tr><td align="center" style="padding:26px 40px 8px;">
  <a href="${download}" style="display:inline-block;background:#3A4651;color:#F4EEE1;font-family:Georgia,serif;font-size:13px;letter-spacing:3px;text-transform:uppercase;text-decoration:none;padding:15px 30px;">Download the PDF &rarr;</a>
</td></tr>
<tr><td style="padding:26px 40px 0;font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:1.65;color:#33301F;">
  <p style="margin:0 0 16px;">A few of these are the books my sisters and I read by candlelight as tweens (we moved the basement sofa to hide the wax). Some will spark conversations you didn\u2019t expect; I\u2019ve left honest notes on the moments worth talking through. Read them <em>alongside</em> your kid, not ahead of them \u2014 that\u2019s the whole trick.</p>
  <p style="margin:0 0 14px;">One more click and you\u2019ll get <strong style="font-weight:normal;color:#3A4651;">Fletchling Thoughts</strong> \u2014 my letters on books, home, and making meaning, every other week. Your email is already filled in:</p>
  <p style="margin:0 0 22px;"><a href="${sub}" style="display:inline-block;border:1px solid #3A4651;color:#3A4651;font-family:Georgia,serif;font-size:12.5px;letter-spacing:3px;text-transform:uppercase;text-decoration:none;padding:12px 22px;">Get the letters &rarr;</a></p>
  <p style="margin:0 0 6px;">Happy reading,</p>
  <p style="margin:0;font-size:26px;color:#5A322F;font-style:italic;">Rachel</p>
</td></tr>
<tr><td style="padding:30px 40px 34px;font-family:Georgia,serif;font-size:12.5px;line-height:1.6;color:#8b8270;border-top:1px solid #e2d9c3;margin-top:20px;">
  Rachel Fletcher &middot; Harrisonburg, Virginia &middot; <a href="https://rachelfletcherwrites.com/" style="color:#8b8270;">rachelfletcherwrites.com</a><br>
  Not your thing? Reply with &ldquo;unsubscribe&rdquo; and I\u2019ll take you off the list.
</td></tr>
</table></td></tr></table></body></html>`;
}
