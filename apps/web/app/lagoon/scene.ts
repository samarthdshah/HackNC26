// Lagoon: the v6 lagoon.html scene, ported as mount(root, ctx) => api.
// Ocean (three.js), jellyfish (GSAP), topic bubbles + tentacles + drawer (DOM, as in v6).
// Topics come from wf.topics; update(wf) diffs them in place so live refreshes keep positions and sent state.

import * as THREE from "three";
import gsap from "gsap";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { WF, WfPerson, WfTopic } from "@wayfinder/shared";
import { RM, css, getTheme, onTheme, palette, toast, wireCandy, type Palette } from "@/lib/aero/runtime";

export interface LagoonCtx { refresh: () => Promise<void> }
export interface LagoonApi { update: (wf: WF) => void; setFilter: (f: string) => void; cleanup: () => void }

type Pp = { p: WfPerson; score: number };
type Topic = WfTopic & {
  key: string; i: number; ppl: Pp[]; x: number; y: number; tx: number; ty: number; vis: boolean;
  el: HTMLButtonElement; g: SVGGElement; glow: SVGPathElement; core: SVGPathElement; flow: SVGPathElement;
};
type Pulse = { t: Topic; pid: string; dot?: SVGCircleElement; t0: number; dur: number };
type IntroState = "sending" | "sent" | "err";

const PI = Math.PI;
const SHAPES = {
  seabed: { radius: 660, height: 700, rSeg: 50, hSeg: 20, ampR: 20, speedC: 0.015, rotation: 0.005, y: -620, z: -50, step: 0.000005 },
  water: { groups: 22, members: 20, depth: 450, step: 0.0015 },
  fish: { radius: 4, height: 15, segments: 12 },
};
const SEABED = [0x4fae9e, 0x6cbf5c, 0xd99a7a]; // per theme: seafoam, kelp, coral sand
const FOG = [0x3ab6d8, 0x3fb59a, 0xc06a8e];
const KIND_C: Record<string, string> = { query: "var(--c-primary)", resource: "var(--c-warm)", team: "var(--c-secondary)" };
const AVC = ["var(--c-primary)", "var(--c-secondary)", "var(--c-warm)"];
const TOP = 5;
const SLOTS: Record<number, number[]> = { 1: [90], 2: [140, 40], 3: [160, 90, 20], 4: [165, 118, 62, 15], 5: [168, 128, 90, 52, 12] }; // degrees, y-up
const NS = "http://www.w3.org/2000/svg";
const handshake = `<g class="icon__part p1" data-anim-end fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="3"/><circle cx="16.5" cy="8" r="3"/><path d="M3 19c.6-3.2 2.6-5 5-5s4.4 1.8 5 5M13.2 14.6c.9-.4 2-.6 3.3-.6 2.4 0 4.4 1.8 5 5"/></g>`;
const sentIcon = `<g class="icon__part p1" data-anim-end fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17l9-10"/></g>`;
const failIcon = `<g class="icon__part p1" data-anim-end fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v6M12 17h.01"/></g>`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const size = (n: number) => Math.round(112 + Math.min(n, 9) * 12); // 2 people → 136px, 9 → 220px
const av = (p: WfPerson, k: number, cls = "") => `<i class="av ${cls}" style="--c:${AVC[k % 3]}">${esc(p.first[0] ?? "?")}</i>`;
const keyOf = (t: WfTopic) => `${t.kind}|${t.topic}`;
// Intro state survives navigation within the session (the agent is the source of truth; this is only the button).
const introState = new Map<string, IntroState>();

export function mount(root: HTMLElement, initial: WF, ctx: LagoonCtx): LagoonApi {
  let WF = initial;
  const $ = (id: string) => root.querySelector<HTMLElement>("#" + id) ?? document.getElementById(id)!;
  let disposed = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => { const t = setTimeout(() => { timers.delete(t); if (!disposed) fn(); }, ms); timers.add(t); };
  const gctx = gsap.context(() => {}, root);
  const me = () => WF.me;
  const person = (id: string) => WF.people.find((p) => p.id === id);

  /* ============ Ocean (ported from the pasted pen, three r162 + BufferGeometry) ============ */
  let ocean: ReturnType<typeof buildOcean> | null = null;
  try { ocean = buildOcean(); } catch (e) { console.warn(e); $("err").style.display = "block"; }

  function buildOcean() {
    const W = innerWidth, H = innerHeight;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(W, H);
    $("ocean").appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const fog = new THREE.Fog(FOG[getTheme()], -200, 1150); scene.fog = fog;
    const camera = new THREE.PerspectiveCamera(60, W / H, 1, 10000);
    camera.position.set(0, 350, 600); camera.rotation.x = -PI / 32;
    scene.add(new THREE.AmbientLight(0x9fe8ff, 0.55), new THREE.HemisphereLight(0xffffff, 0x0a3a5a, 1.0));
    const sun = new THREE.DirectionalLight(0xfffbe8, 1.1); sun.position.set(-200, 900, 300); scene.add(sun);

    // Seabed: rotated bumpy cylinder; vertices merged so the bumps don't tear at the seam
    let g: THREE.BufferGeometry = new THREE.CylinderGeometry(SHAPES.seabed.radius, SHAPES.seabed.radius, SHAPES.seabed.height, SHAPES.seabed.rSeg, SHAPES.seabed.hSeg);
    g.rotateX(-PI / 2); g.deleteAttribute("normal"); g.deleteAttribute("uv");
    const raw = g; g = mergeVertices(g); raw.dispose();
    const pos = g.getAttribute("position") as THREE.BufferAttribute, bumps: { x: number; y: number; ang: number; amp: number; speed: number }[] = [];
    for (let i = 0; i < pos.count; i++) bumps.push({ x: pos.getX(i), y: pos.getY(i), ang: Math.random() * PI * 2, amp: Math.random() * SHAPES.seabed.ampR, speed: SHAPES.seabed.speedC + Math.random() * SHAPES.seabed.speedC });
    const seabedMat = new THREE.MeshPhongMaterial({ color: SEABED[getTheme()], flatShading: true, shininess: 30, specular: 0x88ccdd });
    const seabed = new THREE.Mesh(g, seabedMat); seabed.position.set(0, SHAPES.seabed.y, SHAPES.seabed.z); scene.add(seabed);

    // Water ring: fish (kept from the pen) and glass seeds (in place of bottles, cans, tires)
    const seedGeo = new THREE.SphereGeometry(1, 18, 14);
    const TOK = () => ["--c-primary", "--c-secondary", "--c-warm"].map((t) => new THREE.Color(css(t) || "#1E8BE0"));
    const seedMats = TOK().map((c) => new THREE.MeshPhongMaterial({ color: c, emissive: c.clone().multiplyScalar(0.28), specular: 0xffffff, shininess: 140, transparent: true, opacity: 0.82 }));
    const coneHead = new THREE.ConeGeometry(SHAPES.fish.radius, (SHAPES.fish.height * 8) / 15, SHAPES.fish.segments);
    const coneBody = new THREE.ConeGeometry(SHAPES.fish.radius, SHAPES.fish.height, SHAPES.fish.segments);
    const coneTail = new THREE.ConeGeometry(SHAPES.fish.radius / 2, (SHAPES.fish.height * 7) / 15, Math.round(SHAPES.fish.segments / 3));
    const fishMats: THREE.Material[] = [];
    function fish() {
      const m = new THREE.Object3D(), h = SHAPES.fish.height;
      const mat = new THREE.MeshPhongMaterial({ color: new THREE.Color(`rgb(255,${Math.floor(95 + Math.random() * 100)},${Math.floor(Math.random() * 20)})`), flatShading: true, shininess: 60 });
      fishMats.push(mat);
      const head = new THREE.Mesh(coneHead, mat), body = new THREE.Mesh(coneBody, mat), tail = new THREE.Mesh(coneTail, mat);
      body.rotation.x = PI; body.position.y -= h * 0.77; tail.position.y -= (h * 4) / 3; m.add(head, body, tail); return m;
    }
    const water = new THREE.Object3D(), seeds: THREE.Object3D[] = [];
    const step = (PI * 2) / SHAPES.water.groups;
    for (let j = 0; j < SHAPES.water.groups; j++) {
      const angle = step * j;
      for (let i = 0; i < SHAPES.water.members; i++) {
        const type = Math.floor(Math.random() * 30); let obj: THREE.Object3D, offset: number;
        if (type < 22) {
          offset = (PI / 4) * (Math.random() * 0.4 - 0.8);
          obj = new THREE.Mesh(seedGeo, seedMats[type % seedMats.length]); obj.scale.setScalar(2.4 + Math.random() * 4.2);
          obj.userData.bob = Math.random() * PI * 2; seeds.push(obj);
        } else {
          offset = (PI / 8) * (Math.random() * 0.4 - 0.8);
          obj = fish(); obj.rotation.z = angle + offset;
        }
        obj.position.z = -Math.random() * SHAPES.water.depth;
        const depth = SHAPES.seabed.height + Math.random() * SHAPES.water.depth * 1.5;
        obj.position.x = Math.cos(angle + offset) * depth; obj.position.y = Math.sin(angle + offset) * depth;
        obj.userData.base = obj.position.y; water.add(obj);
      }
    }
    water.position.y = SHAPES.seabed.y; scene.add(water);

    // Woodsprites: soft glowing seed points that drift up through the view
    const SN = RM ? 70 : 160, sp: number[] = [], ss: number[] = [], sd: number[] = [];
    for (let i = 0; i < SN; i++) { sp.push(THREE.MathUtils.randFloatSpread(1100), Math.random() * 760, THREE.MathUtils.randFloat(-420, 260)); ss.push(THREE.MathUtils.randFloat(6, 16)); sd.push(Math.random() * 100, THREE.MathUtils.randFloat(4, 12)); }
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3)); sGeo.setAttribute("aSize", new THREE.Float32BufferAttribute(ss, 1)); sGeo.setAttribute("aSeed", new THREE.Float32BufferAttribute(sd, 2));
    sGeo.setAttribute("aColor", new THREE.Float32BufferAttribute(new Float32Array(SN * 3), 3));
    const sMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 }, uPixel: { value: renderer.getPixelRatio() } },
      vertexShader: `attribute float aSize; attribute vec2 aSeed; attribute vec3 aColor; uniform float uTime, uPixel; varying vec3 vCol; varying float vSpin; varying float vFade;
        void main(){ vec3 p = position; float t = uTime * aSeed.y;
          p.y = mod(p.y + t, 760.0); p.x += sin(uTime * 0.3 + aSeed.x) * 22.0; p.z += cos(uTime * 0.25 + aSeed.x) * 14.0;
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = aSize * uPixel * (520.0 / -mv.z); gl_Position = projectionMatrix * mv;
          vCol = aColor; vSpin = uTime * 0.4 + aSeed.x; vFade = smoothstep(0.0, 60.0, p.y) * smoothstep(760.0, 640.0, p.y); }`,
      fragmentShader: `varying vec3 vCol; varying float vSpin; varying float vFade;
        void main(){ vec2 c = gl_PointCoord * 2.0 - 1.0; float d = length(c); if (d > 1.0) discard;
          float ang = atan(c.y, c.x) + vSpin;
          float tendril = pow(abs(cos(ang * 4.0)), 24.0) * smoothstep(1.0, 0.15, d) * 0.55;
          float core = smoothstep(0.22, 0.0, d), halo = smoothstep(1.0, 0.0, d) * 0.35;
          vec3 col = mix(vCol, vec3(1.0), core * 0.8);
          gl_FragColor = vec4(col, (core + halo + tendril) * vFade); }` });
    const sprites = new THREE.Points(sGeo, sMat); sprites.frustumCulled = false; scene.add(sprites);

    function tint(_pal: Palette, ti: number) {
      seabedMat.color.set(SEABED[ti]); fog.color.set(FOG[ti]);
      const tk = TOK();
      seedMats.forEach((m, i) => { m.color.copy(tk[i]); m.emissive.copy(tk[i]).multiplyScalar(0.28); });
      const ca = sGeo.getAttribute("aColor") as THREE.BufferAttribute, cols = [new THREE.Color(0xffffff), ...tk];
      for (let i = 0; i < SN; i++) { const c = cols[i % cols.length]; ca.setXYZ(i, c.r, c.g, c.b); } ca.needsUpdate = true;
    }
    tint(palette(), getTheme());

    const mouse = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => { mouse.x = (e.clientX / innerWidth) * 2 - 1; mouse.y = 1 - (e.clientY / innerHeight) * 2; };
    const onResize = () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
    addEventListener("pointermove", onMove);
    addEventListener("resize", onResize);

    function update(dt: number, time: number) {
      const k = dt * 60; // the pen stepped per frame at 60 fps
      if (!RM) {
        for (let i = 0; i < pos.count; i++) { const b = bumps[i]; pos.setXY(i, b.x + Math.cos(b.ang) * b.amp, b.y + Math.sin(b.ang) * b.amp); b.ang += b.speed * k; }
        pos.needsUpdate = true;
        seabed.rotation.z += (SHAPES.seabed.rotation * 0.2 + SHAPES.seabed.step) * k;
        water.rotation.z += SHAPES.water.step * k;
        for (const s of seeds) s.position.y = s.userData.base + Math.sin(time * 0.8 + s.userData.bob) * 4;
        sMat.uniforms.uTime.value = time;
      }
      camera.position.x += (mouse.x * 40 - camera.position.x) * 0.03;
      camera.position.y += (350 + mouse.y * 18 - camera.position.y) * 0.03;
      renderer.render(scene, camera);
    }
    function dispose() {
      removeEventListener("pointermove", onMove); removeEventListener("resize", onResize);
      [g, seedGeo, coneHead, coneBody, coneTail, sGeo].forEach((x) => x.dispose());
      [seabedMat, sMat, ...seedMats, ...fishMats].forEach((m) => m.dispose());
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    }
    return { update, tint, dispose };
  }

  /* ============ Jellyfish motion (pasted TweenMax timeline, in GSAP 3) ============ */
  if (!RM) gctx.add(() => {
    gsap.to("#feturbulence", { attr: { baseFrequency: "0.06 0" }, duration: 5, repeat: -1, yoyo: true, ease: "none" });
    gsap.to("#jfSvg", { y: -30, duration: 3, repeat: -1, yoyo: true, ease: "sine.inOut", delay: 0.2 });
    gsap.from("#jfSvg .bubble", { scale: 0.2, opacity: 0.2, duration: 4, transformOrigin: "50% 50%", ease: "none", stagger: { each: 1, repeat: -1, yoyo: true } });
    gsap.timeline({ repeat: -1, repeatDelay: 5 })
      .to("#jfSvg .eye", { scaleY: 0.5, opacity: 0.2, transformOrigin: "50% 50%", duration: 0.5, delay: 3, ease: "back.out(1.7)" })
      .to("#jfSvg .eye", { scaleY: 1, opacity: 1, transformOrigin: "50% 50%", duration: 0.5, ease: "back.out(1.7)" });
  });

  /* ============ Topics: Mycelium's overlaps around the viewer (wf.topics) ============ */
  const linksSvg = $("links") as unknown as SVGSVGElement;
  const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) => {
    const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, String(attrs[k])); parent?.appendChild(e); return e;
  };
  const stateOf = (t: Topic, pid: string) => introState.get(`${t.key}|${pid}`);
  const sentCount = (t: Topic) => t.ppl.filter((x) => stateOf(t, x.p.id) === "sent").length;

  function seedHTML(t: Topic) {
    const n = t.ppl.length, shown = t.ppl.slice(0, 4), sent = sentCount(t);
    return `<span class="bub"><b class="tp">${esc(t.topic)}</b><span class="avs">${shown.map((x, k) => av(x.p, k)).join("")}${n > 4 ? `<i class="av plus">+${n - 4}</i>` : ""}</span>
      <span class="n${sent ? " sent" : ""}">${sent ? `✓ ${sent} intro${sent > 1 ? "s" : ""} sent · ` : ""}${n} ${n === 1 ? "person" : "people"}</span></span>`;
  }
  function peopleOf(t: WfTopic): Pp[] {
    return [...new Set(t.ids)].map(person).filter((p): p is WfPerson => !!p && p.id !== me().id)
      .map((p, k) => ({ p, score: Math.max(0.42, t.score - k * 0.035) }));
  }
  let topics: Topic[] = [];
  function makeTopic(src: WfTopic): Topic {
    const el = document.createElement("button"); el.className = "seed"; el.type = "button";
    const g = svgEl("g", {}, linksSvg);
    const t = { ...src, key: keyOf(src), i: 0, ppl: [], x: innerWidth / 2, y: innerHeight / 2, tx: 0, ty: 0, vis: false, el, g,
      glow: svgEl("path", { class: "glow", opacity: 0.55 }, g), core: svgEl("path", { class: "core", opacity: 0.6 }, g), flow: svgEl("path", { class: "flow", opacity: 0.9 }, g) } as Topic;
    el.addEventListener("mouseenter", () => t.g.classList.add("hot"));
    el.addEventListener("mouseleave", () => t.g.classList.remove("hot"));
    el.addEventListener("click", () => openTopic(t));
    $("seeds").appendChild(el);
    return t;
  }
  function paintTopic(t: Topic) {
    t.el.style.setProperty("--k", String(t.i)); t.el.style.setProperty("--d", size(t.ppl.length) + "px"); t.el.style.setProperty("--c", KIND_C[t.kind] ?? KIND_C.query);
    t.el.setAttribute("aria-label", `${t.topic}: ${t.ppl.length} ${t.ppl.length === 1 ? "person" : "people"}. Show who.`);
    t.el.innerHTML = seedHTML(t);
    const w = 1.2 + Math.min(t.ppl.length, 9) * 0.42;
    t.glow.setAttribute("stroke-width", String(w * 3.2)); t.core.setAttribute("stroke-width", String(w * 0.5)); t.flow.setAttribute("stroke-width", String(w * 1.2));
  }
  function syncTopics(list: WfTopic[]) {
    const old = new Map(topics.map((t) => [t.key, t]));
    const next: Topic[] = [];
    for (const src of [...list].sort((a, b) => b.score - a.score)) {
      const ppl = peopleOf(src); if (!ppl.length) continue;
      const k = keyOf(src); if (next.some((t) => t.key === k)) continue;
      const t = old.get(k) ?? makeTopic(src); old.delete(k);
      Object.assign(t, src, { ppl });
      next.push(t);
    }
    old.forEach((t) => { t.el.remove(); t.g.remove(); if (openT === t) closeDrawer(); });
    topics = next;
    topics.forEach((t, i) => { t.i = i; paintTopic(t); delete t.el.dataset.tour; });
    if (topics[0]) topics[0].el.dataset.tour = "4|A shared topic|Each bubble is a topic you share. Bigger bubble, more people. Click one to see who’s on it and send an intro in one tap.";
    applyFilter();
    if (openT) renderTopic(openT); else if (listMode) renderMore();
  }

  /* ============ Which topics float: top five after the filter; the rest go behind "+N more" ============ */
  let filter = "all", openT: Topic | null = null, listMode = false;
  const pool = () => topics.filter((t) => filter === "all" || t.kind === filter);
  const floating = () => pool().slice(0, TOP);
  function applyFilter() {
    const fl = new Set(floating());
    topics.forEach((t) => { const on = fl.has(t); t.el.classList.toggle("hidden", !on); t.g.classList.toggle("off", !on); t.vis = on; });
    const extra = pool().length - fl.size, mt = $("moreTopics") as HTMLButtonElement;
    mt.hidden = extra <= 0; mt.style.display = extra <= 0 ? "none" : ""; mt.textContent = `+${extra} more topic${extra === 1 ? "" : "s"}`;
    layout();
  }

  /* ============ Layout: seeds on an arc over the jellyfish, clear of the title card and the drawer ============ */
  const mobile = () => innerWidth <= 700;
  function layout() {
    if (disposed) return;
    if (mobile()) { $("jelly").style.left = ""; return; }
    const vis = topics.filter((t) => t.vis), n = vis.length;
    const W = innerWidth, H = innerHeight, stage = W - ($("drawer").classList.contains("open") ? 390 : 0);
    const cx = stage / 2, cy = H * 0.47;
    $("jelly").style.left = cx + "px";
    const rx = Math.min(stage * 0.37, 540), ry = Math.min(H * 0.35, 300);
    const card = $("intro").getBoundingClientRect();
    vis.forEach((t, k) => {
      const a = ((SLOTS[n] || SLOTS[5])[k] * PI) / 180, r = size(t.ppl.length) / 2;
      let x = cx + Math.cos(a) * rx, y = cy - Math.sin(a) * ry;
      x = Math.min(stage - r - 20, Math.max(r + 20, x));
      y = Math.min(H - 130 - r, Math.max(r + 14, y));
      if (x - r < card.right + 14 && y - r < card.bottom + 14) y = Math.min(H - 130 - r, card.bottom + 14 + r); // would sit under the title card
      if (x + r > W - 100 && y - r < 96) y = 96 + r; // keep the menu corner clear
      t.tx = x; t.ty = y;
    });
    for (let it = 0; it < 40; it++) for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { // nudge overlapping bubbles apart
      const A = vis[i], B = vis[j], dx = B.tx - A.tx, dy = B.ty - A.ty, d = Math.hypot(dx, dy) || 1;
      const need = (size(A.ppl.length) + size(B.ppl.length)) / 2 + 14 - d; if (need <= 0) continue;
      const ux = ((dx / d) * need) / 2, uy = ((dy / d) * need) / 2;
      A.tx -= ux; A.ty -= uy; B.tx += ux; B.ty += uy;
    }
    vis.forEach((t) => {
      const r = size(t.ppl.length) / 2;
      t.tx = Math.min(stage - r - 16, Math.max(r + 16, t.tx)); t.ty = Math.min(H - 130 - r, Math.max(r + 14, t.ty));
    });
  }

  /* ============ Tentacle curves ============ */
  const jfSvg = $("jfSvg") as unknown as SVGSVGElement;
  function jellyOrigin(i: number) { // a point among the tentacles, in screen space (follows the GSAP bob)
    const m = jfSvg.getScreenCTM(); if (!m) return { x: innerWidth / 2, y: innerHeight / 2 };
    const p = jfSvg.createSVGPoint(); p.x = 240 + (i % 5) * 16; p.y = 300 + (i % 2) * 18; const q = p.matrixTransform(m); return { x: q.x, y: q.y };
  }
  function anchor(t: Topic, o: { x: number; y: number }) { // the point on the bubble's rim facing the jellyfish
    const r = size(t.ppl.length) / 2 - 2, dx = o.x - t.x, dy = o.y - t.y, len = Math.hypot(dx, dy) || 1;
    return { x: t.x + (dx / len) * r, y: t.y + (dy / len) * r };
  }
  function curve(t: Topic, time: number) {
    const o = jellyOrigin(t.i), e = anchor(t, o), dx = e.x - o.x, dy = e.y - o.y, len = Math.hypot(dx, dy) || 1;
    const px = -dy / len, py = dx / len, wig = RM ? 0 : Math.sin(time * 1.1 + t.i * 1.7) * Math.min(60, len * 0.16);
    const c1 = { x: o.x + dx * 0.25 + px * wig, y: o.y + Math.max(70, len * 0.25) + py * wig }; // hang down first, then sweep out
    const c2 = { x: o.x + dx * 0.7 - px * wig * 0.8, y: o.y + dy * 0.7 - py * wig * 0.8 };
    return `M${o.x.toFixed(1)} ${o.y.toFixed(1)}C${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${e.x.toFixed(1)} ${e.y.toFixed(1)}`;
  }

  /* ============ Drawer ============ */
  const drawer = $("drawer"), dBody = $("dBody");
  function introBtn(t: Topic, x: Pp) {
    const st = stateOf(t, x.p.id), pid = esc(x.p.id);
    if (st === "sent") return `<button class="ctl" disabled><span class="sq green sm"><svg class="i-bob" viewBox="0 0 24 24" aria-hidden="true">${sentIcon}</svg></span><span>Intro sent ✓</span></button>`;
    if (st === "sending") return `<button class="ctl" disabled data-pid="${pid}"><span class="sq green sm"><svg class="i-bob" viewBox="0 0 24 24" aria-hidden="true">${handshake}</svg></span><span>Sending…</span></button>`;
    if (st === "err") return `<button class="ctl" data-intro="${pid}"><span class="sq red sm"><svg class="i-bob" viewBox="0 0 24 24" aria-hidden="true">${failIcon}</svg></span><span>Not sent · try again</span></button>`;
    return `<button class="ctl" data-intro="${pid}"><span class="sq green sm"><svg class="i-bob" viewBox="0 0 24 24" aria-hidden="true">${handshake}</svg></span><span>Introduce</span></button>`;
  }
  function personRow(t: Topic, x: Pp, k: number) {
    const pct = Math.round(x.score * 100);
    return `<div class="row" data-k="${esc(x.p.id)}">${av(x.p, k, "lg")}<div class="info"><div class="t">${esc(x.p.name)}</div><div class="s">${esc(x.p.role ? `${x.p.role} · ${x.p.deptName}` : x.p.deptName)}</div></div>
      <span class="chip${pct < 75 ? " info" : ""}">${pct}%</span>${introBtn(t, x)}</div>`;
  }
  function renderTopic(t: Topic) {
    $("dTitle").textContent = t.topic;
    const label = ({ query: "Shared question", resource: "Spare resource", team: "Teammates" } as Record<string, string>)[t.kind] ?? "Shared topic";
    dBody.innerHTML = `<div><span class="chip ${t.kind === "resource" ? "warn" : "info"}">${label}</span></div><p class="why">${esc(t.why)}</p>
      <div class="k">${t.ppl.length} ${t.ppl.length === 1 ? "person" : "people"} on this</div><div class="rows">${t.ppl.map((x, k) => personRow(t, x, k)).join("")}</div>`;
    wireCandy(dBody);
  }
  function renderMore() {
    $("dTitle").textContent = "More topics near you";
    const rest = pool().slice(TOP);
    dBody.innerHTML = `<p class="why">Smaller overlaps. Open one to see who’s on it.</p><div class="rows">${rest.map((t) => `<div class="row topic" data-t="${esc(t.key)}" role="button" tabindex="0">
      <span class="avs">${t.ppl.slice(0, 3).map((x, k) => av(x.p, k)).join("")}</span><div class="info"><div class="t">${esc(t.topic)}</div><div class="s">${t.ppl.length} ${t.ppl.length === 1 ? "person" : "people"}</div></div><span class="go">›</span></div>`).join("")}</div>`;
  }
  function setOpen(on: boolean) {
    drawer.classList.toggle("open", on); drawer.setAttribute("aria-hidden", String(!on));
    topics.forEach((t) => t.el.classList.toggle("on", on && t === openT));
    layout();
  }
  function openTopic(t: Topic) { openT = t; listMode = false; renderTopic(t); setOpen(true); }
  function openMore() { openT = null; listMode = true; renderMore(); setOpen(true); }
  function closeDrawer() { openT = null; listMode = false; setOpen(false); }
  const byKey = (k: string) => topics.find((t) => t.key === k);
  const onClose = () => closeDrawer();
  const onMore = () => openMore();
  $("dClose").addEventListener("click", onClose);
  $("moreTopics").addEventListener("click", onMore);
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && drawer.classList.contains("open") && !document.querySelector("#tour.on")) closeDrawer(); };
  addEventListener("keydown", onKey);

  const rowFor = (t: Topic, pid: string) => (openT === t ? dBody.querySelector<HTMLElement>(`.row[data-k="${CSS.escape(pid)}"]`) : null);
  function swapBtn(t: Topic, pid: string) {
    const row = rowFor(t, pid), x = t.ppl.find((y) => y.p.id === pid); if (!row || !x) return;
    row.querySelector(".ctl")!.outerHTML = introBtn(t, x); wireCandy(row);
  }
  // Introduce: ask the agent to make the intro. Success only when the agent says so; never fake it.
  async function introduce(t: Topic, x: Pp) {
    const k = `${t.key}|${x.p.id}`;
    introState.set(k, "sending"); swapBtn(t, x.p.id);
    let ok = false, detail = "";
    try {
      const res = await fetch("/api/agent/intro", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ a: me().id, b: x.p.id, topic: t.topic, why: t.why }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      ok = res.ok && !!body?.ok;
      if (!ok) detail = body?.error ? String(body.error) : `HTTP ${res.status}`;
    } catch (e) { detail = e instanceof Error ? e.message : String(e); }
    if (disposed) { introState.set(k, ok ? "sent" : "err"); return; }
    if (!ok) {
      introState.set(k, "err"); swapBtn(t, x.p.id);
      toast("msg", "Intro not sent", "Wayfinder’s agent isn’t reachable", `Nothing was sent to ${esc(x.p.first)}. Try again in a moment. <span class="hops">${esc(detail)}</span>`);
      return;
    }
    introState.set(k, "sent");
    if (t.vis && !mobile()) { // a pulse travels the tentacle from you to the topic, then the row flips
      const dot = svgEl("circle", { r: 7, fill: "#fff", filter: "url(#pulseGlow)" }, linksSvg);
      pulses.push({ t, pid: x.p.id, dot, t0: performance.now(), dur: RM ? 1 : 1100 }); t.g.classList.add("hot");
    } else landPulse({ t, pid: x.p.id, t0: 0, dur: 0 });
    void ctx.refresh();
  }
  const onBodyClick = (e: MouseEvent) => {
    const tgt = e.target as HTMLElement;
    const r = tgt.closest<HTMLElement>(".row.topic"); if (r) { const t = byKey(r.dataset.t!); if (t) openTopic(t); return; }
    const b = tgt.closest<HTMLButtonElement>("[data-intro]"); if (!b || !openT) return;
    const t = openT, x = t.ppl.find((y) => y.p.id === b.dataset.intro); if (!x) return;
    const st = stateOf(t, x.p.id); if (st === "sent" || st === "sending") return;
    b.disabled = true; void introduce(t, x);
  };
  const onBodyKey = (e: KeyboardEvent) => {
    const r = (e.target as HTMLElement).closest<HTMLElement>(".row.topic");
    if (r && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); const t = byKey(r.dataset.t!); if (t) openTopic(t); }
  };
  dBody.addEventListener("click", onBodyClick);
  dBody.addEventListener("keydown", onBodyKey);

  const pulses: Pulse[] = [];
  function landPulse(pl: Pulse) {
    pl.dot?.remove(); const t = pl.t, x = t.ppl.find((y) => y.p.id === pl.pid);
    toast("myc", "Intro sent", `${esc(me().first)} and ${esc(x?.p.first ?? "them")} should meet`, esc(t.topic));
    t.el.innerHTML = seedHTML(t);
    const row = rowFor(t, pl.pid);
    const swap = () => swapBtn(t, pl.pid);
    if (RM || !row) { swap(); t.g.classList.remove("hot"); return; }
    gctx.add(() => {
      gsap.timeline().to(row, { rotationX: 90, duration: 0.22, ease: "power2.in" })
        .add(() => { swap(); const r2 = rowFor(t, pl.pid); if (r2) gsap.fromTo(r2, { rotationX: -90 }, { rotationX: 0, duration: 0.45, ease: "back.out(1.8)" }); })
        .add(() => t.g.classList.remove("hot"), "+=1.2");
    });
  }

  /* ============ Loop ============ */
  const clock = new THREE.Clock(); let time = 0, raf = 0;
  function frame() {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta()); time += dt;
    ocean?.update(dt, time);
    if (!mobile()) {
      for (const t of topics) {
        if (!t.vis) continue;
        const bx = RM ? 0 : Math.cos(time * 0.4 + t.i * 1.3) * 6, by = RM ? 0 : Math.sin(time * 0.6 + t.i) * 9, d = size(t.ppl.length);
        t.x += (t.tx + bx - t.x) * (RM ? 1 : 0.06); t.y += (t.ty + by - t.y) * (RM ? 1 : 0.06);
        t.el.style.transform = `translate(${(t.x - d / 2).toFixed(1)}px,${(t.y - d / 2).toFixed(1)}px)`;
        const c = curve(t, time); t.glow.setAttribute("d", c); t.core.setAttribute("d", c); t.flow.setAttribute("d", c);
        t.flow.setAttribute("stroke-dashoffset", RM ? "0" : (-time * 30 - t.i * 7).toFixed(1));
      }
    }
    const now = performance.now();
    for (let k = pulses.length - 1; k >= 0; k--) {
      const p = pulses[k], tt = Math.min(1, (now - p.t0) / p.dur), path = p.t.core, L = path.getTotalLength();
      const pt = path.getPointAtLength(L * (1 - Math.pow(1 - tt, 2))); p.dot!.setAttribute("cx", String(pt.x)); p.dot!.setAttribute("cy", String(pt.y));
      if (tt >= 1) { pulses.splice(k, 1); landPulse(p); }
    }
  }
  const onResize = () => layout();
  addEventListener("resize", onResize);
  const offTheme = onTheme((ti, pal) => ocean?.tint(pal, ti));

  syncTopics(WF.topics);
  raf = requestAnimationFrame(() => {
    if (disposed) return;
    layout(); topics.forEach((t) => { t.x = t.tx; t.y = t.ty + 30; });
    frame();
  });
  if (topics.length) {
    const big = [...topics].sort((a, b) => b.ppl.length - a.ppl.length)[0];
    later(() => toast("myc", "Mycelium is listening", `${topics.length} topic${topics.length === 1 ? "" : "s"} near you`, `Biggest: ${esc(big.topic)} · ${big.ppl.length} ${big.ppl.length === 1 ? "person" : "people"}`), RM ? 0 : 1600);
  }

  return {
    update(next) { WF = next; syncTopics(next.topics); },
    setFilter(f) { filter = f; applyFilter(); if (listMode) renderMore(); },
    cleanup() {
      disposed = true;
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout); timers.clear();
      offTheme();
      removeEventListener("resize", onResize); removeEventListener("keydown", onKey);
      $("dClose").removeEventListener("click", onClose); $("moreTopics").removeEventListener("click", onMore);
      dBody.removeEventListener("click", onBodyClick); dBody.removeEventListener("keydown", onBodyKey);
      gctx.revert();
      pulses.splice(0).forEach((p) => p.dot?.remove());
      topics.forEach((t) => { t.el.remove(); t.g.remove(); }); topics = [];
      ocean?.dispose(); ocean = null;
    },
  };
}
