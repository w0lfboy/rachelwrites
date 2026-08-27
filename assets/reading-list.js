/* Reading-list lead magnet: form handling + pop-up.
   - Any <form class="rl-form"> posts to /api/reading-list and swaps to a success state.
   - On non-landing pages, a pop-up appears after ~20s or on exit-intent,
     once per 14 days, never for someone who already signed up. */
(function () {
  var KEY_SEEN = 'rl_popup_seen_at';
  var KEY_DONE = 'rl_subscribed';
  var POPUP_DELAY = 20000;
  var POPUP_COOLDOWN = 14 * 24 * 60 * 60 * 1000;
  var SUBSTACK = 'https://rachelfletcher.substack.com/subscribe?email=';
  var DOWNLOAD_FALLBACK = 'https://drive.google.com/uc?export=download&id=1ajmWr9mFpPf7vewSfTkmAuKAWlrlMUCp';

  // ?src=pin-main etc. on the landing URL → remembered for the session so the
  // signup (even from the pop-up on another page) is attributed to the pin.
  function srcTag() {
    try {
      var m = location.search.match(/[?&]src=([^&#]{1,40})/);
      if (m) { sessionStorage.setItem('rl_src', decodeURIComponent(m[1])); return decodeURIComponent(m[1]); }
      return sessionStorage.getItem('rl_src');
    } catch (e) { return null; }
  }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  var NOUNS = { 'reading-list': 'reading list', 'knitting': 'knitting guide' };
  function successMarkup(data, email, magnet) {
    var noun = NOUNS[magnet] || 'guide';
    var h = '<div class="rl-success" role="status">' +
      '<div style="font-family:\'Monsieur La Doulaise\',cursive; font-size:44px; color:#5A322F; line-height:0.95;">It’s on its way</div>';
    if (data && data.delivered) {
      h += '<p style="font-size:17px; line-height:1.65; color:#4a4432; margin:12px 0 0;">Check your inbox for <em>“Here’s your reading list”</em> — and peek in Promotions or Spam if it’s shy. Welcome to the letters.</p>';
    } else {
      var url = (data && data.download) || DOWNLOAD_FALLBACK;
      h += '<p style="font-size:17px; line-height:1.65; color:#4a4432; margin:12px 0 18px;">You’re on the list. Here’s the ' + noun + ' itself, no waiting:</p>' +
        '<a class="btn btn-solid" href="' + url + '" style="display:inline-flex; align-items:center; gap:10px; background:#3A4651; color:#F4EEE1; font-family:\'EB Garamond\',serif; text-transform:uppercase; letter-spacing:0.2em; font-size:13px; padding:14px 26px;">Download the PDF <span class="arrow">→</span></a>';
    }
    h += '<p style="font-size:16px; line-height:1.6; color:#4a4432; margin:18px 0 10px;">Want more from Rachel? Fletchling Thoughts on Substack is free — one click, your email is already filled in:</p>' +
      '<a class="btn btn-ghost" href="' + SUBSTACK + encodeURIComponent(email || '') + '" target="_blank" rel="noopener" style="display:inline-flex; align-items:center; gap:10px; border:1px solid #3A4651; color:#3A4651; font-family:\'EB Garamond\',serif; text-transform:uppercase; letter-spacing:0.2em; font-size:12.5px; padding:12px 22px;">Subscribe for free <span class="arrow">→</span></a>';
    return h + '</div>';
  }

  function wireForm(form) {
    if (form.__rl) return;
    form.__rl = true;
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var email = form.querySelector('input[type=email]');
      var hp = form.querySelector('input[name=website]');
      var btn = form.querySelector('button[type=submit]');
      var msg = form.querySelector('.rl-msg');
      if (!email || !email.value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) {
        if (msg) msg.textContent = 'That email doesn’t look quite right.';
        return;
      }
      if (btn) btn.disabled = true;
      if (msg) msg.textContent = 'Sending…';
      fetch('/api/reading-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.value.trim(), website: hp ? hp.value : '', source: srcTag() || form.getAttribute('data-source') || 'site', page: location.pathname, magnet: form.getAttribute('data-magnet') || 'reading-list' })
      }).then(function (r) { return r.json().then(function (d) { d.__status = r.status; return d; }); })
        .then(function (d) {
          if (d.ok) {
            store(KEY_DONE, '1');
            var wrap = document.createElement('div');
            wrap.innerHTML = successMarkup(d, email.value.trim(), form.getAttribute('data-magnet') || 'reading-list');
            var node = wrap.firstChild;
            node.classList.add('is-visible'); // survives scroll-reveal containers
            form.parentNode.replaceChild(node, form);
          } else {
            if (btn) btn.disabled = false;
            if (msg) msg.textContent = d.error || 'Something went sideways. Try once more?';
          }
        })
        .catch(function () {
          if (btn) btn.disabled = false;
          if (msg) msg.textContent = 'The connection wandered off. Try once more?';
        });
    });
  }

  function baseStyles() {
    if (document.getElementById('rl-base-style')) return;
    var st = document.createElement('style');
    st.id = 'rl-base-style';
    st.textContent = '.rl-form{display:flex;gap:10px;flex-wrap:wrap}.rl-form input[type=email]{flex:1 1 220px;min-width:0;font:17px "EB Garamond",Georgia,serif;color:#33301F;background:#F4EEE1;border:1px solid rgba(58,70,81,.35);padding:14px 16px}.rl-form input[type=email]::placeholder{color:#8b8270;font-style:italic}.rl-form button{flex:0 0 auto;background:#3A4651;color:#F4EEE1;border:0;font-family:"EB Garamond",serif;text-transform:uppercase;letter-spacing:.2em;font-size:13px;padding:15px 26px;display:inline-flex;align-items:center;gap:10px;cursor:pointer}.rl-form button[disabled]{opacity:.6;cursor:wait}.rl-hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}.rl-msg{font-size:16px;line-height:1.6;color:#5A322F;margin-top:12px;min-height:1em}.rl-success{background:#F4EEE1;border:1px solid rgba(58,70,81,.2);padding:26px 28px;text-align:left}.rl-band-grid{display:grid;grid-template-columns:200px 1fr;gap:40px;align-items:center}@media(max-width:700px){.rl-band-grid{grid-template-columns:1fr !important;text-align:center}.rl-band-grid .rl-form{justify-content:center}}';
    document.head.appendChild(st);
  }

  function wireAll() { baseStyles(); Array.prototype.forEach.call(document.querySelectorAll('form.rl-form'), wireForm); }

  /* ---------- pop-up ---------- */
  function shouldPopup() {
    // never compete with a dedicated magnet landing page (marked in its <body>)
    if (document.querySelector('[data-magnet-page]')) return false;
    if (read(KEY_DONE)) return false;
    var seen = parseInt(read(KEY_SEEN) || '0', 10);
    return !(seen && Date.now() - seen < POPUP_COOLDOWN);
  }

  function buildPopup() {
    var el = document.createElement('div');
    el.id = 'rl-popup';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'rl-popup-title');
    el.style.cssText = 'position:fixed; inset:0; z-index:200; display:flex; align-items:center; justify-content:center; padding:20px; background:rgba(58,70,81,0.55); -webkit-backdrop-filter:blur(4px); backdrop-filter:blur(4px); opacity:0; transition:opacity .35s cubic-bezier(.22,.61,.36,1);';
    el.innerHTML =
      '<div style="position:relative; background:#EAE1CE; border:1px solid rgba(58,70,81,0.25); box-shadow:0 50px 100px -40px rgba(20,26,30,0.7); max-width:720px; width:100%; display:grid; grid-template-columns:220px 1fr; font-family:\'EB Garamond\',Georgia,serif; color:#33301F;" class="rl-popup-card">' +
        '<button type="button" class="rl-close" aria-label="Close" style="position:absolute; top:10px; right:12px; background:none; border:0; font:28px/1 \'Cormorant Garamond\',serif; color:#3A4651; cursor:pointer; padding:4px 8px;">&times;</button>' +
        '<div class="rl-popup-img" style="background:#F4EEE1; padding:18px; display:flex; align-items:center;"><img src="/assets/reading-list-cover-sm.webp" alt="Twelve Books to Read with Your Middle Schooler" width="510" height="660" style="display:block; width:100%; height:auto; box-shadow:0 20px 40px -24px rgba(20,26,30,0.6);"></div>' +
        '<div style="padding:36px 34px 30px;">' +
          '<div style="font-family:\'EB Garamond\',serif; text-transform:uppercase; letter-spacing:0.32em; font-size:11px; color:#857438; margin-bottom:12px;">A free reading list</div>' +
          '<h2 id="rl-popup-title" style="font-family:\'Cormorant Garamond\',serif; font-weight:500; font-size:30px; line-height:1.1; margin:0; color:#3A4651;">12 Books to Read With Your Middle Schooler</h2>' +
          '<p style="font-size:15.5px; line-height:1.6; color:#4a4432; margin:12px 0 16px;">What you read in middle school makes you who you are. These twelve books (and spoiler, most of them are series!) are meant for you to read alongside your middle schooler, to foster all that is weird and wonderful in your child, and to remind us older folks to make friends with the middle schooler who still lives inside us all. <a href="/reading-list" style="color:#6f5a2e;">See what\'s inside →</a></p>' +
          '<form class="rl-form" action="/api/reading-list" method="post" data-source="popup" style="position:relative;">' +
            '<label for="rl-email-popup" style="position:absolute; left:-9999px;">Email address</label>' +
            '<input id="rl-email-popup" type="email" name="email" placeholder="your@email.com" required autocomplete="email" inputmode="email">' +
            '<input class="rl-hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">' +
            '<button class="btn btn-solid" type="submit">Send me the list <span class="arrow">→</span></button>' +
            '<div class="rl-msg" role="status" aria-live="polite" style="flex-basis:100%;"></div>' +
          '</form>' +
          '<p style="font-size:13.5px; line-height:1.5; color:#7d7156; font-style:italic; margin:12px 0 0;">You’ll also get Fletchling Thoughts, every other week. Unsubscribe anytime.</p>' +
        '</div>' +
      '</div>';
    var style = document.createElement('style');
    style.textContent = '#rl-popup .rl-form{display:flex;gap:8px;flex-wrap:wrap}#rl-popup .rl-form input[type=email]{flex:1 1 180px;min-width:0;font:16px "EB Garamond",Georgia,serif;color:#33301F;background:#F4EEE1;border:1px solid rgba(58,70,81,.35);padding:12px 14px}#rl-popup .rl-form button{flex:0 0 auto;background:#3A4651;color:#F4EEE1;border:0;font-family:"EB Garamond",serif;text-transform:uppercase;letter-spacing:.2em;font-size:12px;padding:13px 20px;display:inline-flex;align-items:center;gap:8px;cursor:pointer}#rl-popup .rl-form button[disabled]{opacity:.6}#rl-popup .rl-hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}#rl-popup .rl-msg{font-size:15px;color:#5A322F;margin-top:8px}#rl-popup .rl-success{padding:4px 0 0}@media(max-width:640px){#rl-popup .rl-popup-card{grid-template-columns:1fr !important}#rl-popup .rl-popup-img{display:none !important}}';
    document.head.appendChild(style);
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.style.opacity = '1'; });
    store(KEY_SEEN, String(Date.now()));

    function close() { el.style.opacity = '0'; setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 350); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    el.querySelector('.rl-close').addEventListener('click', close);
    el.addEventListener('click', function (e) { if (e.target === el) close(); });
    document.addEventListener('keydown', onKey);
    wireForm(el.querySelector('form'));
    var input = el.querySelector('input[type=email]');
    if (input && window.matchMedia('(min-width: 641px)').matches) input.focus();
  }

  function armPopup() {
    if (!shouldPopup()) return;
    var fired = false;
    function fire() { if (fired || !shouldPopup()) return; fired = true; buildPopup(); }
    setTimeout(fire, POPUP_DELAY);
    document.addEventListener('mouseout', function (e) {
      if (!e.relatedTarget && e.clientY <= 0) fire();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { wireAll(); armPopup(); });
  } else { wireAll(); armPopup(); }
})();
