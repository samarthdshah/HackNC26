// Home Tree scene: the v6 index.html <script type="module"> as a mount/cleanup pair.
// The globe, leaders and intro are imperative (three + gsap); the pin labels are React-rendered
// (#pins .pin, in PIN_SPECS order) so live refreshes update their text without a rebuild.

import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { gsap } from "gsap";
import { RM, palette, hex, onTheme, type Palette } from "@/lib/aero/runtime";

/** Where each pin sits on the settled globe (degrees around the view) and its accent colour. */
export const PIN_SPECS: { ang: number; c: "person" | "hub" | "match"; m?: boolean }[] = [
  { ang: 145, c: "person" },          // hours lost / saved
  { ang: 192, c: "hub", m: true },    // people helped
  { ang: 232, c: "hub" },             // departments · teams
  { ang: 62, c: "person", m: true },  // requests routed
  { ang: 308, c: "match" },           // avg hops
];

type Pin = (typeof PIN_SPECS)[number] & { i: number; el: HTMLElement; dot: HTMLElement | null; line: SVGLineElement; end: SVGCircleElement };

export function mount(root: HTMLElement): () => void {
  const $ = <T extends Element = HTMLElement>(id: string) => root.querySelector<T>("#" + id)!;
  const DEG = Math.PI / 180;
  const mobile = () => innerWidth <= 700;
  const cleanups: (() => void)[] = [];
  const listen = <K extends keyof WindowEventMap>(t: Window | HTMLElement, ev: K, fn: (e: WindowEventMap[K]) => void) => {
    t.addEventListener(ev, fn as EventListener);
    cleanups.push(() => t.removeEventListener(ev, fn as EventListener));
  };

  /* ============ Renderer, camera, light ============ */
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: $<HTMLCanvasElement>("globe"), antialias: true, alpha: true }); }
  catch (e) { $("err").style.display = "block"; console.error(e); return () => {}; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment(renderer);
  const envRT = pmrem.fromScene(room, 0.03);
  scene.environment = envRT.texture;
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 20000);
  scene.add(new THREE.HemisphereLight(0xdff4ff, 0x2a7fd0, 1.1));
  const sun = new THREE.DirectionalLight(0xfff6e0, 2.0); sun.position.set(-600, 1000, 1000); scene.add(sun);
  scene.add(new THREE.AmbientLight(0xaaccff, 0.35));

  /* ============ The cube globe (pen port: one cube per sphere vertex, instanced) ============ */
  const R = 800, W_SEG = 30, H_SEG = 50, CUBE = 20;
  const sphere = new THREE.SphereGeometry(R, W_SEG, H_SEG), pa = sphere.attributes.position;
  const cubes: { p0: THREE.Vector3; n: THREE.Vector3; tx: THREE.Vector3; ty: THREE.Vector3; q: THREE.Quaternion; row: number }[] = [];
  for (let row = 1; row < H_SEG; row++) for (let u = 0; u < W_SEG; u++) { // skip poles and the seam duplicate
    const k = row * (W_SEG + 1) + u, p0 = new THREE.Vector3(pa.getX(k), pa.getY(k), pa.getZ(k)), n = p0.clone().normalize();
    const tx = new THREE.Vector3(0, 1, 0).cross(n).normalize(), ty = n.clone().cross(tx).normalize();
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(p0, new THREE.Vector3(), new THREE.Vector3(0, 1, 0)));
    cubes.push({ p0, n, tx, ty, q, row });
  }
  sphere.dispose();
  const COUNT = cubes.length;
  const box = new THREE.BoxGeometry(CUBE, CUBE, CUBE);
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.18, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, flatShading: true });
  const mesh = new THREE.InstancedMesh(box, mat, COUNT);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const globe = new THREE.Group(); globe.add(mesh); scene.add(globe);

  /* ============ Anchors for the stat pins: picked by where they land on screen when settled ============ */
  const pinEls = [...root.querySelectorAll<HTMLElement>("#pins .pin")];
  const svg = $<SVGSVGElement>("leaders"), NS = "http://www.w3.org/2000/svg";
  const FINAL = { az: 0, el: 8 * DEG, dist: 2500, shift: 0.23, shiftY: 0.03 }; // shift: globe centre moves right by this share of the width
  const cameraAt = (az: number, el: number, dist: number, out = new THREE.Vector3()) =>
    out.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist);
  const PINS: Pin[] = [];
  {
    const camPos = cameraAt(FINAL.az, FINAL.el, FINAL.dist), fwd = camPos.clone().normalize();
    const right = new THREE.Vector3(0, 1, 0).cross(fwd).normalize(), up = fwd.clone().cross(right).normalize(), used = new Set<number>();
    PIN_SPECS.forEach((spec, k) => {
      const a = spec.ang * DEG, r = 0.74;
      const want = right.clone().multiplyScalar(Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).addScaledVector(fwd, Math.sqrt(1 - r * r));
      let best = -1, bd = -2;
      cubes.forEach((c, i) => { const d = c.n.dot(want); if (d > bd && !used.has(i)) { bd = d; best = i; } });
      used.add(best);
      const el = pinEls[k];
      if (!el) return;
      const line = document.createElementNS(NS, "line"), end = document.createElementNS(NS, "circle");
      end.setAttribute("r", "3"); svg.append(line, end); line.style.opacity = end.style.opacity = "0";
      PINS.push({ ...spec, i: best, el, dot: el.querySelector("i"), line, end });
    });
  }
  cleanups.push(() => PINS.forEach((p) => { p.line.remove(); p.end.remove(); p.el.style.opacity = "0"; }));
  const anchorSet = new Map(PINS.map((p) => [p.i, p]));

  /* ============ Colors: palette bands by latitude, anchors in accent colors ============ */
  function paint(pal: Palette) {
    const c = new THREE.Color(), c2 = new THREE.Color();
    cubes.forEach((cb, i) => {
      const pin = anchorSet.get(i);
      if (pin) c.set(pal[pin.c]);
      else {
        const lv = pal.levels.slice(0, 4), t = Math.abs(cb.row / H_SEG - 0.5) * 2 * (lv.length - 1), j = Math.min(lv.length - 2, Math.floor(t));
        c.set(lv[j]).lerp(c2.set(lv[j + 1]), t - j); c.offsetHSL((((i * 37) % 7) - 3) * 0.006, 0, (((i * 13) % 5) - 2) * 0.02);
      }
      mesh.setColorAt(i, c);
    });
    mesh.instanceColor!.needsUpdate = true;
  }
  const paintPins = (pal: Palette) => PINS.forEach((p) => { if (p.dot) p.dot.style.background = `radial-gradient(circle at 35% 30%,#fff,${hex(pal[p.c])} 55%)`; });
  paint(palette()); paintPins(palette());
  cleanups.push(onTheme((_i, pal) => { paint(pal); paintPins(pal); }));

  /* ============ Animation state (GSAP drives these numbers) ============ */
  const st = { amp: 1, az: -70 * DEG, el: -22 * DEG, dist: 1550, shift: 0, shiftY: 0, pins: 0, time: 0, speed: 0.6 };
  const settleTarget = () => mobile()
    ? { az: FINAL.az, el: FINAL.el, dist: 3500, shift: 0, shiftY: 0.2 }
    : { az: FINAL.az, el: FINAL.el, dist: FINAL.dist, shift: FINAL.shift, shiftY: FINAL.shiftY };

  function applyView() {
    const w = innerWidth, h = innerHeight;
    camera.aspect = w / h;
    camera.setViewOffset(w, h, -w * st.shift, h * st.shiftY, w, h); // slides the globe right (or up on phones) without moving it in 3D
    camera.updateProjectionMatrix();
  }

  const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), camPos = new THREE.Vector3();
  function updateCubes() {
    const d = st.time * st.speed, A = st.amp;
    for (let i = 0; i < COUNT; i++) {
      const c = cubes[i], ph = d + i;
      // the pen's smooth wave: each cube drifts in its tangent plane; integrated so it stays bounded
      pos.copy(c.p0).addScaledVector(c.tx, -Math.cos(ph) * 90 * A).addScaledVector(c.ty, Math.sin(ph) * 90 * A);
      let s = Math.pow(Math.abs(Math.sin(ph)) + 0.5, 2); s = 1 + (s - 1) * Math.max(A, 0.18);
      if (anchorSet.has(i)) s = 2.4 + Math.sin(st.time * 2 + i) * 0.15;
      scl.setScalar(s); m4.compose(pos, c.q, scl); mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  const hero = $("hero");
  const v = new THREE.Vector3(), o = new THREE.Vector3(), toCam = new THREE.Vector3();
  function updatePins() {
    if (st.pins <= 0) { PINS.forEach((p) => { p.el.style.opacity = "0"; p.line.style.opacity = p.end.style.opacity = "0"; }); return; }
    const w = innerWidth, h = innerHeight, heroR = mobile() ? 0 : hero.getBoundingClientRect().right + 8;
    o.set(0, 0, 0).project(camera); const cx = ((o.x + 1) / 2) * w, cy = ((1 - o.y) / 2) * h;
    PINS.forEach((p, k) => {
      mesh.getMatrixAt(p.i, m4); v.setFromMatrixPosition(m4);
      const facing = toCam.copy(camera.position).sub(v).normalize().dot(cubes[p.i].n);
      v.project(camera); const x = ((v.x + 1) / 2) * w, y = ((1 - v.y) / 2) * h;
      let dx = x - cx, dy = y - cy; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
      const len = mobile() ? 30 : 58; let ex = x + dx * len; const ey = y + dy * len;
      const r = p.el.getBoundingClientRect(), left = dx < 0;
      let lx = left ? ex - r.width : ex, ly = ey - r.height / 2;
      if (left && lx < heroR) { lx = heroR; ex = Math.max(ex, lx + r.width); }
      lx = Math.max(8, Math.min(w - r.width - 8, lx)); ly = Math.max(8, Math.min(h - r.height - 96, ly));
      const a = p.m && mobile() ? 0 : st.pins * THREE.MathUtils.smoothstep(facing, 0.05, 0.35) * Math.min(1, Math.max(0, st.pins * PINS.length - k));
      p.el.style.transform = `translate(${lx}px,${ly}px)`; p.el.style.opacity = String(a);
      p.line.setAttribute("x1", String(x)); p.line.setAttribute("y1", String(y));
      p.line.setAttribute("x2", String(left ? lx + r.width : lx)); p.line.setAttribute("y2", String(ly + r.height / 2));
      p.end.setAttribute("cx", String(x)); p.end.setAttribute("cy", String(y)); p.line.style.opacity = p.end.style.opacity = String(a);
    });
  }

  /* ============ Intro: one wave pass, glide right, settle, reveal ============ */
  const skipBtn = $("skip"), reveals = [...hero.querySelectorAll(".reveal")];
  const tl = gsap.timeline({ paused: true });
  tl.to(st, { az: 22 * DEG, el: 10 * DEG, dist: 1800, duration: 5.2, ease: "sine.inOut" })
    .to(st, { ...settleTarget(), amp: 0.14, speed: 0.32, duration: 2.4, ease: "power3.inOut" }, ">-0.4")
    .add(() => { skipBtn.classList.add("gone"); }, "<")
    .to(hero, { opacity: 1, x: 0, duration: 0.7, ease: "power2.out", startAt: { x: -30 } }, ">-0.9")
    .to(reveals, { opacity: 1, y: 0, duration: 0.5, stagger: 0.07, ease: "power2.out", startAt: { y: 10 }, clearProps: "transform" }, "<0.15")
    .to(st, { pins: 1, duration: 1.4, ease: "none" }, "<0.3"); // v6: no auto toast on Home (it overlapped the hero card)
  cleanups.push(() => { tl.kill(); });

  const skip = () => { if (tl.progress() < 1) tl.progress(1); };
  listen(skipBtn, "click", skip);
  listen(window, "keydown", (e) => { if (e.key === "Escape" || e.key === " ") skip(); });
  listen($<HTMLCanvasElement>("globe"), "pointerdown", skip);

  /* ============ Loop ============ */
  const clock = new THREE.Clock();
  let raf = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta()); st.time += RM ? 0 : dt;
    // gentle idle sway once settled; amplitude follows st.amp so nothing loops back to the intro
    const sway = tl.progress() >= 1 && !RM ? Math.sin(st.time * 0.12) * 3 * DEG : 0;
    cameraAt(st.az + sway, st.el + Math.sin(st.time * 0.09) * sway * 0.3, st.dist, camPos); camera.position.copy(camPos); camera.lookAt(0, 0, 0);
    applyView(); updateCubes(); renderer.render(scene, camera); updatePins();
  }
  listen(window, "resize", () => { renderer.setSize(innerWidth, innerHeight); if (tl.progress() >= 1) Object.assign(st, settleTarget()); });

  gsap.ticker.lagSmoothing(0); // keep the intro on wall-clock time even when frames are slow
  cleanups.push(() => gsap.ticker.lagSmoothing(500, 33)); // gsap's default, for the other pages
  if (RM || new URLSearchParams(location.search).has("settled")) tl.progress(1); else tl.play();
  frame();

  return () => {
    cancelAnimationFrame(raf);
    cleanups.splice(0).reverse().forEach((f) => f());
    box.dispose(); mat.dispose(); mesh.dispose();
    envRT.dispose(); pmrem.dispose();
    room.traverse((obj) => { const m = obj as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose?.(); });
    renderer.dispose(); // no forceContextLoss: StrictMode remounts reuse this canvas
  };
}
