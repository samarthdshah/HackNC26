/* Wayfinder v5 · shared runtime: theme, dock, toast.
   Load with <script src="shared/aero.js"></script> before page scripts. Set <body data-page="roots"> to mark the active dock button.
   API: Aero.theme (0|1|2), Aero.palette() → hex numbers for three.js, Aero.css(name) → resolved CSS var,
        Aero.onTheme(fn), Aero.setTheme(i), Aero.toast(kind, k, m, s), Aero.hideToast(), Aero.RM (reduced motion). */
(() => {
  'use strict';
  const PALETTES = [   // same per-level palettes as v4: root → outer shell, plus hub/person accents
    {name:'Aqua Sky', levels:[0x1a7fe0, 0x2fb5f5, 0x1fd1d1, 0x6fd9a8, 0x9fe8ff, 0xc8f3ff], hub:0x1460c8, person:0xffa63d, match:0xff8fd0, accent:0x1e8be0, sky:[0x0646a8, 0x2a8fe0, 0xbfe6fb]},
    {name:'Eco Leaf', levels:[0x2e9d4a, 0x57c84d, 0x8fdc5a, 0x30c9a0, 0xc6ef7a, 0xe2fbb0], hub:0x1d7a3a, person:0x2fb5f5, match:0xffb84d, accent:0x2e9d4a, sky:[0x0b6b6a, 0x3fb59a, 0xdff7d8]},
    {name:'Sunset Glass', levels:[0xff7a59, 0xffa94d, 0xffd166, 0xff6fa8, 0xffc2d6, 0xfff0c2], hub:0xd9405e, person:0x2fb5f5, match:0xb48cff, accent:0xff7a59, sky:[0x5a2a8a, 0xe0607a, 0xffe3c8]},
  ];
  const ICONS = {   // white line icons for the candy squares; .p1 bobs on hover
    home:`<g class="icon__part p1" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21v-7"/><circle cx="12" cy="9" r="5.5"/><path d="M8 20h8"/></g>`,
    roots:`<g class="icon__part p1" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="5" r="2.4" fill="#fff"/><path d="M12 7.5v4M12 11.5 6 17M12 11.5l6 5.5M12 11.5V19"/><circle cx="6" cy="18" r="1.8"/><circle cx="18" cy="18" r="1.8"/><circle cx="12" cy="20" r="1.4"/></g>`,
    currents:`<g class="icon__part p1" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="4.5" cy="12" r="2"/><circle cx="12" cy="7" r="2"/><circle cx="19.5" cy="12" r="2"/><path d="M6.3 11 10.2 8M13.8 8l3.9 3"/></g>`,
    glow:`<g class="icon__part p1" fill="#fff"><rect x="4" y="12" width="3.4" height="8" rx="1.2"/><rect x="10.3" y="7" width="3.4" height="13" rx="1.2"/><rect x="16.6" y="3.5" width="3.4" height="16.5" rx="1.2"/></g>`,
    lagoon:`<g class="icon__part p1" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M5 11a7 6 0 0 1 14 0z" fill="#fff" fill-opacity=".9"/><path d="M8 11c0 3-1 5 0 8M12 11v9M16 11c0 3 1 5 0 8"/></g>`,
    darwin:`<g class="icon__part p1" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V11M12 14 7 9M12 12l5-5"/><circle cx="6.5" cy="8.5" r="2" fill="#fff"/><circle cx="17.5" cy="6.5" r="2" fill="#fff"/><circle cx="12" cy="9" r="1.6" fill="#fff"/></g>`,
  };
  const PAGES = [
    {id:'home', href:'index.html', label:'Home Tree', sq:'green'},
    {id:'roots', href:'roots.html', label:'Roots', sq:'teal'},
    {id:'currents', href:'currents.html', label:'Currents', sq:'blue'},
    {id:'glow', href:'insights.html', label:'Glow', sq:'amber'},
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
    nav.innerHTML = PAGES.map(p => `<a class="ctl" href="${p.href}"${p.id === page ? ' aria-current="page"' : ''}><span class="sq ${p.sq}"><svg class="i-bob" viewBox="0 0 24 24" aria-hidden="true">${ICONS[p.id]}</svg></span><span class="lb">${p.label}</span></a>`).join('')
      + `<div class="themes" role="group" aria-label="Glass theme">${themeButtons(true)}</div>`;
    document.body.appendChild(nav); document.body.classList.add('has-dock');
  }
  function wireCandy(scope = document) {   // replay the icon animation on hover/focus, as in v4
    scope.querySelectorAll('.ctl').forEach(b => { if (b.dataset.wired) return; b.dataset.wired = 1; const sq = b.querySelector('.sq'); if (!sq) return;
      ['mouseenter', 'focus'].forEach(ev => b.addEventListener(ev, () => sq.classList.add('anim')));
      const end = sq.querySelector('[data-anim-end]') || sq.querySelector('.icon__part');
      end?.addEventListener('animationend', () => sq.classList.remove('anim')); });
  }

  function ensureToast() {
    let el = document.getElementById('toast'); if (el) return el;
    el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status');
    el.innerHTML = `<div class="in"><span class="orb" id="tOrb">W</span><div><div class="k" id="tK"></div><div class="m" id="tM"></div><div class="s" id="tS"></div></div></div>`;
    document.body.appendChild(el); return el;
  }
  // kind: 'route' (green W), 'myc' (iridescent ✦), 'evo' (↯), 'msg' (chat bubble)
  function toast(kind, k, m, s = '') {
    const el = ensureToast(); el.classList.toggle('myc', kind === 'myc');
    el.querySelector('#tK').textContent = k; el.querySelector('#tM').innerHTML = m; el.querySelector('#tS').innerHTML = s;
    el.querySelector('#tOrb').textContent = kind === 'myc' ? '✦' : kind === 'evo' ? '↯' : kind === 'msg' ? '✉' : 'W';
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }
  function hideToast() { document.getElementById('toast')?.classList.remove('show'); }

  function css(name) { return getComputedStyle(root).getPropertyValue(name).trim(); }

  document.addEventListener('click', e => { const b = e.target.closest('.theme-button[data-theme]'); if (b) setTheme(+b.dataset.theme); });
  const boot = () => { document.body.classList.add('aero-page'); buildDock(); wireCandy(); ensureToast(); };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();

  window.Aero = {
    PALETTES, PAGES, ICONS, RM,
    get theme() { return theme; },
    palette: () => PALETTES[theme],
    hex: n => '#' + n.toString(16).padStart(6, '0'),
    css, setTheme, themeButtons, wireCandy, toast, hideToast,
    onTheme(fn) { listeners.push(fn); },
    sleep: ms => new Promise(r => setTimeout(r, RM ? 1 : ms)),
  };
})();
