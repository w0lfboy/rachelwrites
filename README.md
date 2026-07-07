# Rachel Fletcher — Landing Page

A single, self-contained static landing page built from the Claude Design handoff
(`project/Landing Page.dc.html`). No build step, no server, no dependencies — just
plain files.

## Contents

- `index.html` — the page
- `assets/` — the three images it uses (sparrow mark, Blue Ridge painting, RF shield)

Fonts (Cormorant Garamond, EB Garamond, Monsieur La Doulaise) load from Google Fonts,
so the page needs an internet connection to render the type exactly as designed.

## Preview locally

Open `index.html` directly in a browser, or serve the folder:

```
cd site
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Publish to a domain

1. **Host it.** Drag this `site/` folder onto [app.netlify.com/drop](https://app.netlify.com/drop)
   (or use Cloudflare Pages / Vercel / GitHub Pages). It goes live in seconds.
2. **Buy a domain** (~$10–15/yr) at Porkbun, Namecheap, or Cloudflare.
3. **Connect them.** Add the custom domain in your host's dashboard and set the DNS
   records it gives you at the registrar. HTTPS is automatic.

To update later, edit the files and re-deploy the folder the same way.

## Links wired in

- Read Along / Recent Writings → https://rachelfletcher.substack.com/
- Recipes → https://rachelfletcher.substack.com/archive
- Field Notes → https://www.pinterest.com/rachelfletcherwrites/
