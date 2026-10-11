/* Wayfinder v6 · shared runtime: theme, dock, toast, hamburger menu, tour, collapsible title card.
   Load with <script src="shared/aero.js"></script> before page scripts. Set <body data-page="roots"> to mark the active dock button.
   API: Aero.theme (0|1|2), Aero.palette() → hex numbers for three.js, Aero.css(name) → resolved CSS var,
        Aero.onTheme(fn), Aero.setTheme(i), Aero.toast(kind, k, m, s), Aero.hideToast(), Aero.RM (reduced motion),
        Aero.tour() runs the [data-tour="n|Title|Text"] steps, Aero.card(open) opens/collapses .title-card.
   Query flags: ?notour skips the first-visit tour, ?open starts with the title card expanded. */
(() => {
  'use strict';
  const PALETTES = [   // same per-level palettes as v4: root → outer shell, plus hub/person accents
    {name:'Aqua Sky', levels:[0x1a7fe0, 0x2fb5f5, 0x1fd1d1, 0x6fd9a8, 0x9fe8ff, 0xc8f3ff], hub:0x1460c8, person:0xffa63d, match:0xff8fd0, accent:0x1e8be0, sky:[0x0646a8, 0x2a8fe0, 0xbfe6fb]},
    {name:'Eco Leaf', levels:[0x2e9d4a, 0x57c84d, 0x8fdc5a, 0x30c9a0, 0xc6ef7a, 0xe2fbb0], hub:0x1d7a3a, person:0x2fb5f5, match:0xffb84d, accent:0x2e9d4a, sky:[0x0b6b6a, 0x3fb59a, 0xdff7d8]},
    {name:'Sunset Glass', levels:[0xff7a59, 0xffa94d, 0xffd166, 0xff6fa8, 0xffc2d6, 0xfff0c2], hub:0xd9405e, person:0x2fb5f5, match:0xb48cff, accent:0xff7a59, sky:[0x5a2a8a, 0xe0607a, 0xffe3c8]},
  ];
  const ICONS = {   // simple white glyphs (24-unit box, currentColor) for the Win7 glass dock icons; .p1 bobs on hover
    home:`<g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 11.5 12 4l8.5 7.5"/><path d="M6.5 9.8V20h11V9.8"/><path d="M10.2 20v-5.2h3.6V20"/></g>`,
    roots:`<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="5" r="2.4" fill="currentColor"/><path d="M12 7.5v4M12 11.5 6 17M12 11.5l6 5.5M12 11.5V19"/><circle cx="6" cy="18" r="1.8"/><circle cx="18" cy="18" r="1.8"/><circle cx="12" cy="20" r="1.4"/></g>`,
    currents:`<g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="4.5" cy="12" r="2.2"/><circle cx="12" cy="7" r="2.2"/><circle cx="19.5" cy="12" r="2.2"/><path d="M6.3 11 10.2 8M13.8 8l3.9 3"/><path d="M4 18.5c2.7-2 5.3-2 8 0s5.3 2 8 0"/></g>`,
    glow:`<g fill="currentColor"><rect x="4" y="12" width="3.6" height="8" rx="1.2"/><rect x="10.2" y="7" width="3.6" height="13" rx="1.2"/><rect x="16.4" y="3.5" width="3.6" height="16.5" rx="1.2"/></g>`,
    lagoon:`<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 11a7 6 0 0 1 14 0z" fill="currentColor"/><path d="M8 11c0 3-1 5 0 8M12 11v9M16 11c0 3 1 5 0 8"/></g>`,
    darwin:`<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V11M12 14 7 9M12 12l5-5"/><circle cx="6.5" cy="8.5" r="2" fill="currentColor"/><circle cx="17.5" cy="6.5" r="2" fill="currentColor"/><circle cx="12" cy="9" r="1.6" fill="currentColor"/></g>`,
  };
  const GLASS = {home:[119, 51], roots:[184, 72], currents:[210, 80], glow:[37, 96], lagoon:[326, 70], darwin:[262, 55]};   // hue, saturation (the old candy colours)
  function glassIcon(id) {   // Windows 7 glass icon: rounded tinted base, inner highlight, white glyph, gloss on the top half
    const [h, s] = GLASS[id], c = l => `hsl(${h} ${s}% ${l}%)`;
    return `<defs><linearGradient id="gb-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c(66)}"/><stop offset=".55" stop-color="${c(44)}"/><stop offset="1" stop-color="${c(28)}"/></linearGradient>
      <radialGradient id="gr-${id}" cx=".5" cy="1" r=".65"><stop offset="0" stop-color="${c(82)}" stop-opacity=".75"/><stop offset="1" stop-color="${c(82)}" stop-opacity="0"/></radialGradient>
      <linearGradient id="gg-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity=".18"/></linearGradient></defs>
      <rect x="1.5" y="1.5" width="37" height="37" rx="9" fill="url(#gb-${id})" stroke="${c(20)}" stroke-opacity=".75"/>
      <rect x="1.5" y="1.5" width="37" height="37" rx="9" fill="url(#gr-${id})"/>
      <rect x="2.6" y="2.6" width="34.8" height="34.8" rx="8" fill="none" stroke="#fff" stroke-opacity=".5"/>
      <g transform="translate(8 9)" color="rgb(0 30 60 / .35)"><g class="icon__part p1">${ICONS[id]}</g></g>
      <g transform="translate(8 8)" color="#fff"><g class="icon__part p1">${ICONS[id]}</g></g>
      <path d="M2.6 10.6Q2.6 2.6 10.6 2.6H29.4Q37.4 2.6 37.4 10.6V19.4Q20 22.4 2.6 19.4Z" fill="url(#gg-${id})"/>`;
  }
  const PAGES = [
    {id:'home', href:'index.html', label:'Home Tree', sq:'green'},
    {id:'roots', href:'roots.html', label:'Roots', sq:'teal'},
    {id:'currents', href:'currents.html', label:'Currents', sq:'blue'},
    {id:'glow', href:'insights.html', label:'Insights', sq:'amber'},
    {id:'lagoon', href:'lagoon.html', label:'Lagoon', sq:'pink'},
    {id:'darwin', href:'darwin.html', label:'Darwin', sq:'violet'},
  ];
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const listeners = [];
  const store = {get(k){ try { return localStorage.getItem(k); } catch { return null; } }, set(k, v){ try { localStorage.setItem(k, v); } catch {} }};

  let theme = Math.min(2, Math.max(0, +(store.get('wf-theme') ?? 0) || 0));
  const root = document.documentElement;
  root.dataset.theme = String(theme);

  function setTheme(i) {
    theme = i; root.dataset.theme = String(i); store.set('wf-theme', String(i));
    document.querySelectorAll('.theme-button[data-theme]').forEach(b => b.classList.toggle('active', +b.dataset.theme === i));
    listeners.forEach(fn => { try { fn(i, PALETTES[i]); } catch (e) { console.error(e); } });
  }
  function themeButtons(mini) {
    return PALETTES.map((p, i) => `<button class="theme-button t${i}${mini ? ' mini' : ''}${i === theme ? ' active' : ''}" data-theme="${i}" aria-label="${p.name}"><span class="nm">${p.name}</span></button>`).join('');
  }

  function buildDock() {
    const page = document.body.dataset.page;
    if (!page || document.body.dataset.dock === 'off') return;
    const nav = document.createElement('nav'); nav.id = 'dock'; nav.setAttribute('aria-label', 'Wayfinder pages');
    nav.dataset.tour = '90|Pages|Jump between the six views of Wayfinder from this dock.';
    nav.innerHTML = PAGES.map(p => `<a class="ctl" href="${p.href}"${p.id === page ? ' aria-current="page"' : ''}><span class="sq glass"><svg class="i-bob" viewBox="0 0 40 40" aria-hidden="true">${glassIcon(p.id)}</svg></span><span class="lb">${p.label}</span></a>`).join('');
    document.body.appendChild(nav); document.body.classList.add('has-dock');
  }
  function wireCandy(scope = document) {   // replay the icon animation on hover/focus, as in v4
    scope.querySelectorAll('.ctl').forEach(b => { if (b.dataset.wired) return; b.dataset.wired = 1; const sq = b.querySelector('.sq'); if (!sq) return;
      ['mouseenter', 'focus'].forEach(ev => b.addEventListener(ev, () => sq.classList.add('anim')));
      const end = sq.querySelector('[data-anim-end]') || sq.querySelector('.icon__part');
      end?.addEventListener('animationend', () => sq.classList.remove('anim')); });
  }

  function ensureToast() {   // the stack lives top right, just left of the menu button
    let el = document.getElementById('toasts'); if (el) return el;
    el = document.createElement('div'); el.id = 'toasts'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el); return el;
  }
  // kind: 'route' (green W), 'myc' (iridescent ✦), 'evo' (↯), 'msg' (chat bubble). New toasts stack below older ones.
  function toast(kind, k, m, s = '') {
    const box = ensureToast(), el = document.createElement('div'), route = !['myc', 'evo', 'msg'].includes(kind);
    el.className = 'toast' + (kind === 'myc' ? ' myc' : '');
    el.innerHTML = `<div class="in"><span class="${route ? 'logo-orb' : 'orb'}">${route ? '' : kind === 'myc' ? '✦' : kind === 'evo' ? '↯' : '✉'}</span><div><div class="k"></div><div class="m"></div><div class="s"></div></div></div>`;
    el.querySelector('.k').textContent = k; el.querySelector('.m').innerHTML = m; el.querySelector('.s').innerHTML = s;
    box.appendChild(el); void el.offsetWidth; el.classList.add('show');   // slides in from the right
    while (box.children.length > 4) box.firstElementChild.remove();      // keep the stack short
    el.hideT = setTimeout(() => dismiss(el), 6500);                       // never parks on top of content
  }
  function dismiss(el) { clearTimeout(el.hideT); el.classList.remove('show'); setTimeout(() => el.remove(), 600); }
  function hideToast() { document.querySelectorAll('#toasts .toast.show').forEach(dismiss); }


  /* ---------- Hamburger radial menu (top right): Tour · Card · 3 themes ---------- */
  const SVG = {
    tour:'<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M9 9a3 3 0 1 1 4.2 2.75c-.8.4-1.2 1-1.2 1.9V15"/><circle cx="12" cy="18.6" r=".6" fill="#fff"/></svg>',
    card:'<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><rect x="4" y="5" width="16" height="14" rx="3"/><path d="M4 9.5h16M8 13h8M8 16h5"/></svg>',
    chev:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  };
  function buildMenu() {
    if (document.body.dataset.menu === 'off') return;
    const m = document.createElement('nav'); m.id = 'menu'; m.setAttribute('aria-label', 'Page menu');
    m.dataset.tour = '91|Menu|Replay this tour, show the card details, or switch the glass colour theme.';
    const items = [
      `<button class="round-button blue" data-act="tour" aria-label="Tour this page">${SVG.tour}</button><span class="tip">Tour this page</span>`,
      `<button class="round-button purple" data-act="card" aria-label="Show or hide details">${SVG.card}</button><span class="tip">Details</span>`,
      ...PALETTES.map((p, i) => `<button class="theme-button t${i}${i === theme ? ' active' : ''}" data-theme="${i}" aria-label="${p.name}"></button><span class="tip">${p.name}</span>`),
    ];
    m.innerHTML = `<button class="toggle" aria-expanded="false" aria-label="Open menu"><span class="lg"></span><span class="bars"><i></i><i></i></span></button>
      <ul>${items.map((h, i) => `<li style="--i:${i}">${h}</li>`).join('')}</ul>`;
    document.body.appendChild(m);
    const tg = m.querySelector('.toggle');
    const set = on => { m.classList.toggle('active', on); document.body.classList.toggle('menu-open', on); tg.setAttribute('aria-expanded', on); tg.setAttribute('aria-label', on ? 'Close menu' : 'Open menu'); };
    tg.addEventListener('click', e => { e.stopPropagation(); set(!m.classList.contains('active')); });
    m.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'tour') { set(false); tour(); }
      if (b.dataset.act === 'card') card(); });
    document.addEventListener('click', e => { if (!m.contains(e.target)) set(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') set(false); });
  }

  /* ---------- Collapsible title card: title + one line; details behind a chevron ---------- */
  function card(open) {
    const c = document.querySelector('.title-card'); if (!c) return;
    const on = open ?? c.classList.contains('collapsed');
    c.classList.toggle('collapsed', !on);
    c.querySelector('.tc-toggle')?.setAttribute('aria-expanded', on);
    window.dispatchEvent(new Event('resize'));
  }
  function wireCard() {
    const c = document.querySelector('.title-card'); if (!c || !c.querySelector('.more')) return;
    const b = document.createElement('button'); b.className = 'tc-toggle'; b.innerHTML = SVG.chev; b.setAttribute('aria-label', 'Show details'); b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', e => { e.stopPropagation(); card(); });
    (c.querySelector(':scope > .bar') || c).appendChild(b);
    if (!new URLSearchParams(location.search).has('open')) c.classList.add('collapsed');
  }

  /* ---------- Tour: spotlight each [data-tour] element in order ---------- */
  let tourEl;
  function tour() {
    const steps = [...document.querySelectorAll('[data-tour]')].map(el => { const [n, t, x] = el.dataset.tour.split('|'); return {el, n:+n, t, x}; })
      .sort((a, b) => a.n - b.n);
    if (!steps.length) return;
    const tc = document.querySelector('.title-card'), wasCollapsed = tc?.classList.contains('collapsed');
    card(true);
    if (!tourEl) { tourEl = document.createElement('div'); tourEl.id = 'tour';
      tourEl.innerHTML = `<div class="spot"></div><div class="tour-tip milk still" role="dialog" aria-live="polite"><div class="body"><h4></h4><p></p>
        <div class="nav"><span class="n"></span><button class="pill ghost" data-t="skip">Skip</button><button class="pill ghost" data-t="back">Back</button><button class="pill" data-t="next">Next</button></div></div></div>`;
      document.body.appendChild(tourEl); }
    const spot = tourEl.querySelector('.spot'), tip = tourEl.querySelector('.tour-tip');
    let i = 0;
    const place = () => {
      const vis = steps.filter(s => s.el.getClientRects().length && s.el.getBoundingClientRect().width > 0);
      const s = vis[i]; if (!s) return end();
      s.el.scrollIntoView?.({block:'nearest', behavior: RM ? 'auto' : 'smooth'});
      setTimeout(() => {
        const r = s.el.getBoundingClientRect(), pad = 8, W = innerWidth, H = innerHeight;
        Object.assign(spot.style, {left:r.left - pad + 'px', top:r.top - pad + 'px', width:r.width + pad * 2 + 'px', height:r.height + pad * 2 + 'px'});
        tip.querySelector('h4').textContent = s.t; tip.querySelector('p').textContent = s.x;
        tip.querySelector('.n').textContent = `${i + 1} of ${vis.length}`;
        tip.querySelector('[data-t=back]').style.visibility = i ? 'visible' : 'hidden';
        tip.querySelector('[data-t=next]').textContent = i === vis.length - 1 ? 'Done' : 'Next';
        const tw = Math.min(320, W - 24), th = tip.offsetHeight || 160;
        let x = r.right + 18, y = r.top;                                   // prefer right of the target
        if (x + tw > W - 12) x = r.left - tw - 18;                          // else left
        if (x < 12) { x = Math.min(Math.max(12, r.left), W - tw - 12); y = r.bottom + 16 > H - th - 100 ? r.top - th - 16 : r.bottom + 16; }  // else below/above
        y = Math.min(Math.max(12, y), H - th - 100);
        Object.assign(tip.style, {left:x + 'px', top:y + 'px', width:tw + 'px'});
      }, RM ? 0 : 260);
    };
    const end = () => { tourEl.classList.remove('on'); document.removeEventListener('keydown', key);
      store.set('wf-tour-' + document.body.dataset.page, '1'); if (wasCollapsed !== false) card(false); };
    const go = d => { const n = steps.filter(s => s.el.getClientRects().length).length; i += d; if (i < 0) i = 0; if (i >= n) return end(); place(); };
    const key = e => { if (e.key === 'Escape') end(); if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1); };
    tip.onclick = e => { const t = e.target.closest('[data-t]')?.dataset.t; if (t === 'skip') end(); if (t === 'back') go(-1); if (t === 'next') go(1); };
    spot.onclick = () => go(1);
    document.addEventListener('keydown', key);
    tourEl.classList.add('on'); place();
  }
  function autoTour() {
    const q = new URLSearchParams(location.search), page = document.body.dataset.page;
    if (q.has('notour') || store.get('wf-tour-' + page)) return;
    setTimeout(tour, +(document.body.dataset.tourDelay || 1400));
  }
  function favicon() { if (document.querySelector('link[rel=icon]')) return;
    const l = document.createElement('link'); l.rel = 'icon'; l.type = 'image/png'; l.sizes = '32x32'; l.href = 'shared/avatar-favicon-32.png'; document.head.appendChild(l); }

  function css(name) { return getComputedStyle(root).getPropertyValue(name).trim(); }

  document.addEventListener('click', e => { const b = e.target.closest('.theme-button[data-theme]'); if (b) setTheme(+b.dataset.theme); });
  const boot = () => { document.body.classList.add('aero-page'); favicon(); buildDock(); buildMenu(); wireCard(); wireCandy(); ensureToast(); autoTour(); };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();

  window.Aero = {
    PALETTES, PAGES, ICONS, RM,
    get theme() { return theme; },
    palette: () => PALETTES[theme],
    hex: n => '#' + n.toString(16).padStart(6, '0'),
    css, setTheme, themeButtons, wireCandy, toast, hideToast, tour, card,
    onTheme(fn) { listeners.push(fn); },
    sleep: ms => new Promise(r => setTimeout(r, RM ? 1 : ms)),
  };
})();
