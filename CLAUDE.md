# rachelwrites — Rachel Fletcher's author site

Static site for **rachelfletcherwrites.com**. No build step, no framework — plain
HTML/CSS/JS served as Cloudflare Workers static assets.

## Deploy

Push to `main` → Cloudflare Workers Builds auto-deploys (`npx wrangler deploy`,
config in `wrangler.jsonc`). Nothing else to do. `.assetsignore` lists repo files
that must NOT be publicly served (config, README, `design-system/`).

## Structure

- `index.html` — landing page (hero, Blue Ridge quote band, novel teaser, destination cards, read-along band)
- `recipes.html` — recipe shelf; one card per real recipe letter (newest first) + archive card. Add a card each time a recipe letter publishes; also add it to the ItemList JSON-LD in the head. Below the shelf, a "Fresh from the letters" strip auto-renders the 3 newest Substack posts from `/api/letters` (client-side; hidden if the API fails).
- `about.html` — bio (DRAFT copy — Rachel should personalize), quote band, trio tiles
- `guides.html` — Free Guides index (nav points here); lists all four magnets + carries the knitting capture band
- `how-to-read-a-yarn-band.html`, `navigating-the-yarn-aisle.html` — free content pages (the Pinterest destinations) that give the one-pager away on the page, offer it as a printable, then ask for an email for the full knitting guide. Generated from a shared template; regenerate or hand-edit as needed.
- `assets/guides/*.pdf` — the downloadable files, served from the site (Workers assets cap is 25 MiB/file)
- `reading-list.html` — lead-magnet landing page ("12 Books to Read With Your Middle Schooler"); the Pinterest destination. Trimmed nav on purpose.
- `assets/reading-list.js` — shared funnel script: handles every `form.rl-form` (POST `/api/reading-list`, success state), injects form styles, and shows the pop-up (20s or exit-intent, once per 14 days, never after signup, never on the landing page). Inline form bands live on index + about.
- `worker.js` — `POST /api/reading-list` (Resend contact + PDF delivery email; falls back to returning the download URL if email can't send; needs secret `RESEND_API_KEY`, vars in wrangler.jsonc); serves the GSC verification path with a 200 (assets routing 307s `*.html`, which Google's verifier rejects); `/api/letters` proxies the Substack RSS feed (30-min edge cache) for the "Fresh from the letters" strip on /recipes; all other requests fall through to assets
- `404.html` — branded not-found page (`not_found_handling: "404-page"` in wrangler.jsonc); noindex
- www → apex 301 lives in `worker.js` (the `_redirects` file cannot do domain-level rules on Workers)
- security headers site-wide + 1-week browser cache on `/assets/*` — set in `worker.js` (a `_headers` file is ignored for Worker-generated responses)
- `llms.txt` — short site summary for AI-search crawlers
- `assets/` — WebP images (page use) + PNG/JPEG originals, OG image, favicons
- `design-system/` — component library + `Design System.dc.html` (Claude Design format). Reference only; not served.
- `sitemap.xml`, `robots.txt`, `googled*.html` (Search Console verification)

## Conventions

- Design language: Bluestone Slate `#3A4651`, Farmhouse Bone `#EAE1CE`, Paper `#F4EEE1`,
  Olive Gold `#857438` accent, Fig Plum `#5A322F` script/hover. Fonts: Cormorant Garamond
  (display), EB Garamond (body/UI), Monsieur La Doulaise (script flourish only).
  Full tokens: `design-system/tokens/tokens.css`.
- One shared easing `cubic-bezier(.22,.61,.36,1)`; scroll-reveal via IntersectionObserver;
  everything honors `prefers-reduced-motion`.
- Styling is inline-styles + one `<style>` block per page (inherited from the Claude Design
  prototype). Head/nav/footer are duplicated per page — keep them in sync when editing.
- Each page carries canonical URL, OG/Twitter tags, and JSON-LD (Person/WebSite/Book on
  index; ProfilePage on about). Update the Book node with ISBN/retail links at launch.
- SEO principle: the site's job is owning searches for "Rachel Fletcher" and the book
  title. Essays/letters stay canonical on Substack; this site hosts index/landing pages.

## Links wired

- Substack: https://rachelfletcher.substack.com/ — publication name **Fletchling Thoughts**, tagline "Learning to be a meaning maker in a world of already but not yet." (subscribe: /subscribe, archive: /archive)
- Pinterest: https://www.pinterest.com/rachelfletcherwrites/ (domain claimed via meta tag on index)

## Reading-list funnel (lead magnet)

Flow: Pinterest pin → a magnet page → `POST /api/reading-list` (serves EVERY magnet; the form's `data-magnet` picks which, see the `MAGNETS` table in worker.js) → Resend contact (its own segment) + delivery email with the Drive PDF link → one-click Substack subscribe (success state + delivery email link to `/subscribe?email=…`, prefilled). Server-side subscribe (`SUBSTACK_SYNC`) is OFF: Substack 403s non-browser posts. Safety net: monthly CSV import of the Resend segment into Substack. Magnets: `reading-list` (Drive-hosted) and `knitting` (site-hosted). Pages carrying their own form set `data-magnet-page` on `<body>` so the site-wide pop-up stays out of the way. Config: `wrangler.jsonc` vars + secret `RESEND_API_KEY`. Sending requires `rachelfletcherwrites.com` verified in Resend (DNS records).

## Near-term TODO

- [x] Replace recipe placeholder cards with real letter titles + URLs (lemonade syrups, maple balsamic cabbage — Aug 2026)
- [ ] Rachel personalizes the About bio draft
- [ ] Swap About sparrow plate for a portrait photo when available
- [ ] Novella page + capture form when the novella (reader magnet) nears completion
- [ ] Book/preorder page for *The Flower Farm at the End of the World* (upgrade the teaser)
- [ ] Import `design-system/Design System.dc.html` into the Claude Design project

Private planning notes live in `PRIVATE-NOTES.md` (gitignored — do not commit).
