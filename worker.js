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
//  5. POST /api/reading-list — the lead-magnet funnel for EVERY magnet (see
//     the MAGNETS table below; the form posts which one). Validates the email,
//     stores the contact in its Resend segment, emails the file, and notifies
//     Rachel. If email can't send (e.g. RESEND_API_KEY unset or domain
//     unverified), the response carries the download URL so the visitor still
//     gets the file. Needs secret RESEND_API_KEY; vars in wrangler.jsonc.
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
      return readingListSignup(request, env, ctx);
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

/* ---------------- Lead magnets ----------------
   One endpoint serves every magnet. Add a magnet by adding an entry here
   (and a segment id in wrangler.jsonc vars); the page just posts
   {magnet: "<key>"} from its form's data-magnet attribute. */

const MAGNETS = {
  "reading-list": {
    label: "12 Books to Read With Your Middle Schooler",
    file: "/assets/guides/twelve-books-middle-schooler.pdf", // unused: Drive-hosted, see downloadFor()
    segmentVar: "READING_LIST_SEGMENT_ID",
    subject: "Here’s your reading list 📖",
    eyebrow: "A reading list",
    title: "Twelve Books to Read with Your Middle Schooler",
    tagline: "so you can stay weird and wonderful together",
    cta: "Download the PDF",
    body: [
      "It took earning a degree in English Literature for me to learn that as much as I can appreciate a good classic, YA fiction formed and shaped me more than anything else. It’s the books by L’Engle and Pierce that I find myself coming back to year after year, not Faulkner and Fitzgerald. The older I get, the more tenderness I feel for my middle school self who first read these books. As my daughter gets into her tween years, these are the books I most want to share with her, so we can stay weird and wonderful girls together.",
    ],
  },
  "knitting": {
    label: "Learn to Knit an Heirloom Wardrobe",
    file: "/assets/guides/learn-to-knit-an-heirloom-wardrobe.pdf",
    segmentVar: "KNITTING_SEGMENT_ID",
    subject: "Here’s your knitting guide 🧶",
    eyebrow: "A knitting guide",
    title: "Learn to Knit an Heirloom Wardrobe",
    tagline: "seven steps to make more than bad rectangles",
    cta: "Download the guide",
    body: [
      "When I was a young girl, I sat in my great-grandmothers’ sitting room eating tootsie rolls and learning to knit. For years afterward I honored that legacy by making bad rectangles in terrible chunky chenille yarn — pot holders, doll blankets, scarves that were either far too short or much too long.",
      "It took me until my thirties to make my first sweater. This guide is the path I wish I’d had: two stitches, the right needles, how to read yarn, a hat, and then a sweater. Will you have a finished sweater tomorrow? No. Can you have one in the next two months? You sure can.",
    ],
  },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SITE = "https://rachelfletcherwrites.com";

function magnetFor(body) {
  const key = String(body && body.magnet || "reading-list");
  return MAGNETS[key] ? key : "reading-list";
}

function downloadFor(key, env) {
  // The reading list stays on its existing Drive link; everything else is
  // served straight from the site.
  if (key === "reading-list") return env.READING_LIST_DOWNLOAD_URL;
  return SITE + MAGNETS[key].file;
}

async function readingListSignup(request, env, ctx) {
  if (request.method === "GET") {
    // Health check: config state only, never values.
    return json({
      ok: true,
      configured: Boolean(env.RESEND_API_KEY),
      magnets: Object.keys(MAGNETS).filter((k) => Boolean(env[MAGNETS[k].segmentVar])),
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

  const key = magnetFor(body);
  const magnet = MAGNETS[key];
  const download = downloadFor(key, env);

  if (!env.RESEND_API_KEY) {
    // Not configured yet: still hand over the file so no visitor is stranded.
    return json({ ok: true, delivered: false, download, note: "RESEND_API_KEY not set" });
  }

  const auth = { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" };
  const segmentId = env[magnet.segmentVar];

  // 1. Store the contact (duplicates are fine — the email still goes out)
  let contact = null;
  try {
    const cr = await fetch("https://api.resend.com/contacts", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        email,
        unsubscribed: false,
        segments: segmentId ? [{ id: segmentId }] : undefined,
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
        subject: magnet.subject,
        html: deliveryHtml(magnet, download, email, env),
        text: deliveryText(magnet, download, email, env),
        tags: [{ name: "funnel", value: key }],
      }),
    });
    delivered = res.ok;
  } catch (e) { delivered = false; }

  // 3. Tell Rachel (fire-and-forget so the visitor never waits on it)
  if (env.NOTIFY_TO) {
    const note = fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        from: env.MAIL_FROM || "Rachel Fletcher <hello@rachelfletcherwrites.com>",
        to: [env.NOTIFY_TO],
        subject: "🌱 New signup (" + magnet.label + "): " + email,
        text: [
          "Someone just asked for: " + magnet.label,
          "",
          "Email:  " + email,
          "Source: " + String(body.source || "site"),
          "Page:   " + String(body.page || ""),
          "PDF email delivered: " + (delivered ? "yes" : "no (they got the direct link)"),
          "",
          "All signups: https://resend.com/contacts",
        ].join("\n"),
        tags: [{ name: "funnel", value: key + "-notify" }],
      }),
    }).catch(() => {});
    ctx.waitUntil(note);
  }

  // 4. Substack sync stays off: Substack's subscribe endpoint sits behind a JS
  //    challenge and 403s server-side posts. The success state and the delivery
  //    email link to /subscribe?email=… instead (one click, prefilled).
  let substack = "off";
  if ((env.SUBSTACK_SYNC || "off") !== "off") {
    const base = env.SUBSTACK_URL || "https://rachelfletcher.substack.com";
    try {
      const form = new URLSearchParams({ email, source: "embed" });
      const sr = await fetch(base + "/api/v1/free?nojs=true", {
        method: "POST",
        body: form,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          "Origin": base,
          "Referer": base + "/embed",
        },
        redirect: "manual",
      });
      substack = sr.status;
      if (sr.status >= 400) substack = sr.status + " " + (await sr.text()).slice(0, 120);
    } catch (e) { substack = "error " + String(e && e.message || e); }
  }

  return json(delivered
    ? { ok: true, delivered: true, magnet: key, contact, substack }
    : { ok: true, delivered: false, magnet: key, download, contact, substack });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS },
  });
}

function substackLink(email, env) {
  return (env.SUBSTACK_URL || "https://rachelfletcher.substack.com") + "/subscribe?email=" + encodeURIComponent(email);
}

function deliveryText(magnet, download, email, env) {
  const sub = substackLink(email, env);
  return [
    magnet.title + " — " + magnet.tagline + ".",
    "",
    magnet.cta + ": " + download,
    "",
    magnet.body.join("\n\n"),
    "",
    "Want more recommendations from Rachel? My Substack, Fletchling Thoughts, is just one click away. Recipes, hand crafts, and essays from my home in the Shenandoah Valley. Subscribe for free: " + sub,
    "",
    "Happy reading,",
    "Rachel",
    "",
    "Rachel Fletcher · Harrisonburg, Virginia · rachelfletcherwrites.com",
    "Not your thing? Reply with 'unsubscribe' and I'll take you off the list.",
  ].join("\n");
}

function deliveryHtml(magnet, download, email, env) {
  const sub = substackLink(email, env);
  const paras = magnet.body.map((t) => '<p style="margin:0 0 16px;">' + t + "</p>").join("\n  ");
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#EAE1CE;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#EAE1CE;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#F4EEE1;border:1px solid #cfc6b0;">
<tr><td style="padding:40px 40px 8px;text-align:center;font-family:Georgia,'Times New Roman',serif;">
  <div style="font-size:11px;letter-spacing:4px;text-transform:uppercase;color:#857438;">${magnet.eyebrow}</div>
  <h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:30px;line-height:1.15;color:#3A4651;margin:14px 0 0;">${magnet.title}</h1>
  <div style="font-style:italic;font-size:17px;color:#5A322F;margin-top:10px;">${magnet.tagline}</div>
</td></tr>
<tr><td align="center" style="padding:26px 40px 8px;">
  <a href="${download}" style="display:inline-block;background:#3A4651;color:#F4EEE1;font-family:Georgia,serif;font-size:13px;letter-spacing:3px;text-transform:uppercase;text-decoration:none;padding:15px 30px;">${magnet.cta} &rarr;</a>
</td></tr>
<tr><td style="padding:26px 40px 0;font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:1.65;color:#33301F;">
  ${paras}
  <p style="margin:0 0 14px;">Want more recommendations from Rachel? My Substack, <strong style="font-weight:normal;color:#3A4651;">Fletchling Thoughts</strong>, is just one click away. Recipes, hand crafts, and essays from my home in the Shenandoah Valley. Subscribe for free — your email is already filled in.</p>
  <p style="margin:0 0 22px;"><a href="${sub}" style="display:inline-block;border:1px solid #3A4651;color:#3A4651;font-family:Georgia,serif;font-size:12.5px;letter-spacing:3px;text-transform:uppercase;text-decoration:none;padding:12px 22px;">Subscribe for free &rarr;</a></p>
  <p style="margin:0 0 6px;">Happy reading,</p>
  <p style="margin:0;"><img src="${SITE}/assets/signature-rachel.png" alt="Rachel" width="140" height="53" style="display:block;width:140px;height:auto;border:0;"></p>
</td></tr>
<tr><td style="padding:30px 40px 34px;font-family:Georgia,serif;font-size:12.5px;line-height:1.6;color:#8b8270;border-top:1px solid #e2d9c3;margin-top:20px;">
  Rachel Fletcher &middot; Harrisonburg, Virginia &middot; <a href="${SITE}/" style="color:#8b8270;">rachelfletcherwrites.com</a><br>
  Not your thing? Reply with &ldquo;unsubscribe&rdquo; and I&rsquo;ll take you off the list.
</td></tr>
</table></td></tr></table></body></html>`;
}
