// Roots: the v6 roots.html three.js scene, ported as mount(root, ctx) => api.
// Same shaders, layout and motion as v6; data comes from the WF snapshot instead of data.js.
// The query list is React (page.tsx); it calls api.playQuery on hover.

import * as THREE from "three";
import gsap from "gsap";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { WF, WfMatch, WfQuery } from "@wayfinder/shared";
import { RM, css, hex, hideToast, onTheme, palette, sleep, toast, type Palette } from "@/lib/aero/runtime";

export interface RootsApi {
  playQuery: (id: string) => void;
  update: (wf: WF) => void;
  cleanup: () => void;
}

type Node = { kind: number; pos: THREE.Vector3; size: number; dist: number; name?: string; full?: string; dept?: string; sub?: string; person?: string };
type Graph = {
  nodes: Node[]; pairs: [number, number, number][]; adj: number[][]; adjMain: number[][]; order: Map<string, [number, number]>;
  deptIx: Record<string, number>; subIx: Record<string, number>; personIx: Record<string, number>;
};
type Label = { i: number; n: Node; o: CSS2DObject; d: HTMLDivElement; base: boolean; temp: boolean; dim: boolean };
type Route = { dots: THREE.Mesh[]; mat: THREE.MeshBasicMaterial };

const Y_SPREAD = 1.35; // v7: vertical spacing between nodes (stays above the water at WATER_Y)
const WATER_Y = -23, SUN = new THREE.Vector3(-0.55, 0.32, -0.77).normalize(), UP = new THREE.Vector3(0, 1, 0);
const ROUTE_COLOR = 0x1f9a3a; // Wayfinder green: flat, unlit dots

const NOISE = `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;} vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);} vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;i=mod289(i);
vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));}`;
const PULSE = `
uniform vec3 uPulsePositions[3]; uniform float uPulseTimes[3]; uniform float uPulseSpeed; uniform float uTime;
float pulseAt(vec3 p){ float tot = 0.0;
  for (int i = 0; i < 3; i++) { float dt = uTime - uPulseTimes[i]; if (dt < 0.0 || dt > 4.0) continue;
    float w = abs(distance(p, uPulsePositions[i]) - dt * uPulseSpeed); tot += smoothstep(3.0, 0.0, w) * smoothstep(4.0, 0.0, dt); }
  return min(tot, 1.0); }`;

const nodeVert = `${NOISE} ${PULSE}
  attribute vec3 aPos; attribute float aSize; attribute vec3 aCol; attribute float aType; attribute float aDist; attribute float aDimFrom; attribute float aDimTo;
  uniform float uMirror, uWaterY, uPixel, uAlpha, uDimT; varying vec3 vColor; varying float vPulse; varying float vFade; varying float vDim;
  void main(){ vec3 p = aPos;
    if (aType > 0.5) p += vec3(snoise(p * 0.08 + uTime * 0.08), snoise(p * 0.08 + 17.0 + uTime * 0.08), snoise(p * 0.08 + 31.0 + uTime * 0.08)) * 0.35;
    vPulse = pulseAt(p);
    if (uMirror > 0.5) p.y = 2.0 * uWaterY - p.y;
    float breathe = sin(uTime * 0.7 + aDist * 0.15) * 0.08 + 0.92;
    vDim = mix(aDimFrom, aDimTo, uDimT);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aSize * breathe * (1.0 + vPulse * 0.9) * mix(0.8, 1.0, vDim) * uPixel * (1250.0 / -mv.z);
    gl_Position = projectionMatrix * mv; vColor = aCol; vFade = (uMirror > 0.5 ? 0.32 : 1.0) * uAlpha * mix(0.22, 1.0, vDim); }`;
const nodeFrag = `varying vec3 vColor; varying float vPulse; varying float vFade; varying float vDim;
  void main(){ vec2 c = gl_PointCoord * 2.0 - 1.0; float d = length(c); if (d > 1.0) discard;
    vec3 n = vec3(c.x, -c.y, sqrt(max(0.0, 1.0 - d * d)));
    float diff = clamp(dot(n, normalize(vec3(-0.45, 0.65, 0.6))), 0.0, 1.0);
    vec3 col = vColor * (0.5 + 0.62 * diff);
    float caus = smoothstep(0.75, 0.0, length(c - vec2(0.12, 0.52)));
    col += vColor * caus * 0.6 + vec3(caus * 0.1);
    col = mix(col, vColor * 0.42, smoothstep(0.76, 0.98, d) * 0.75);
    col += vec3(1.0) * smoothstep(0.9, 1.0, d) * 0.22;
    float spec = smoothstep(0.52, 0.04, length((c - vec2(-0.2, -0.46)) * vec2(0.85, 1.6)));
    col = mix(col, vec3(1.0), spec * 0.85);
    col = mix(col, vec3(1.0), smoothstep(0.13, 0.0, length(c - vec2(-0.44, -0.36))));
    col = mix(col, vec3(1.0), vPulse * 0.45); col += vec3(0.6, 0.95, 1.0) * smoothstep(0.7, 0.95, d) * vPulse;
    col = mix(col, vec3(0.78, 0.86, 0.94), (1.0 - vDim) * 0.55);
    gl_FragColor = vec4(col, smoothstep(1.0, 0.93, d) * vFade); }`;
// Fibers: v4 glass-tube ribbons, minus the bead sparkle
const fiberVert = `${NOISE} ${PULSE}
  attribute float aT; attribute float aSide; attribute vec3 aS; attribute vec3 aE; attribute float aStr; attribute vec3 aCol; attribute float aPath; attribute float aDimFrom; attribute float aDimTo;
  uniform float uMirror, uWaterY, uPixel, uDimT; uniform vec2 uRes;
  varying float vSide; varying vec3 vColor; varying float vStr; varying float vPulse; varying float vFade; varying float vDim;
  vec3 at(float t, vec3 S, vec3 E){ vec3 dir = E - S; vec3 perp = cross(normalize(dir + vec3(1e-5)), vec3(0.0, 1.0, 0.0)); perp = length(perp) < 0.1 ? vec3(1.0, 0.0, 0.0) : normalize(perp);
    vec3 M = mix(S, E, 0.5) + perp * (0.35 + length(dir) * 0.03);
    vec3 p = mix(mix(S, M, t), mix(M, E, t), t);
    return p + perp * snoise(vec3(aPath * 0.08, t * 0.6, uTime * 0.15)) * 0.2; }
  void main(){ vec3 S = aS, E = aE;
    float t2 = aT < 0.98 ? aT + 0.02 : aT - 0.02;
    vec3 p0 = at(aT, S, E), p1 = at(t2, S, E);
    vPulse = pulseAt(p0);
    if (uMirror > 0.5) { p0.y = 2.0 * uWaterY - p0.y; p1.y = 2.0 * uWaterY - p1.y; }
    vec4 c0 = projectionMatrix * modelViewMatrix * vec4(p0, 1.0), c1 = projectionMatrix * modelViewMatrix * vec4(p1, 1.0);
    vec2 s0 = c0.xy / c0.w * uRes * 0.5, s1 = c1.xy / c1.w * uRes * 0.5, dir = s1 - s0;
    dir = length(dir) < 1e-4 ? vec2(1.0, 0.0) : normalize(dir) * (aT < 0.98 ? 1.0 : -1.0);
    float w = (1.6 + aStr * 2.6) * uPixel * clamp(55.0 / c0.w, 0.55, 1.7) * (1.0 + vPulse * 0.8);
    c0.xy += vec2(-dir.y, dir.x) * aSide * w / (uRes * 0.5) * c0.w;
    gl_Position = c0; vSide = aSide; vColor = aCol; vStr = aStr; vFade = uMirror > 0.5 ? 0.3 : 1.0; vDim = mix(aDimFrom, aDimTo, uDimT); }`;
const fiberFrag = `uniform float uAlpha; varying float vSide; varying vec3 vColor; varying float vStr; varying float vPulse; varying float vFade; varying float vDim;
  void main(){ float a = abs(vSide);
    vec3 col = vColor * (0.45 + 0.45 * (1.0 - a * a));
    col = mix(col, vec3(1.0), smoothstep(0.42, 0.0, abs(vSide + 0.32)) * 0.6);
    col = mix(col, vec3(1.0), vPulse * 0.6);
    col = mix(col, vec3(0.8, 0.87, 0.94), (1.0 - vDim) * 0.5);
    float alpha = smoothstep(1.0, 0.5, a) * (0.6 + 0.35 * vStr + vPulse * 0.3) * uAlpha * vFade * mix(0.12, 1.0, vDim);
    gl_FragColor = vec4(col, alpha); }`;

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const orgKey = (wf: WF) => JSON.stringify([wf.org.map((d) => [d.id, d.name, d.subs.map((s) => [s.id, s.name, s.ids])]), wf.routing]);

export function mount(root: HTMLElement, initial: WF): RootsApi {
  let WF = initial;
  const $ = (id: string) => root.querySelector<HTMLElement>("#" + id) ?? document.getElementById(id)!;
  const S = { paused: false, density: 1, auto: !RM, run: 0, time: 0, focus: null as string | null, building: false, rebuildAgain: false };
  let disposed = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => { const t = setTimeout(() => { timers.delete(t); if (!disposed) fn(); }, ms); timers.add(t); };
  const tok = (n: string) => new THREE.Color(css(n) || "#1E8BE0").getHex();
  // The 3-colour palette: department = --c-primary (a shade deeper), team = --c-secondary, person = --c-warm
  const P3 = () => ({ dept: new THREE.Color(tok("--c-primary")).offsetHSL(0, 0, -0.1).getHex(), team: tok("--c-secondary"), person: tok("--c-warm") });
  const person = (id: string) => WF.people.find((p) => p.id === id);
  const dept = (id: string) => WF.org.find((d) => d.id === id);
  const nameOf = (id: string) => (id === "wf" || id === "agent" ? "Wayfinder" : person(id)?.first ?? WF.actorNames[id] ?? id);

  /* ============ Renderer, camera, environment (v4) ============ */
  const canvas = $("scene") as HTMLCanvasElement;
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" }); }
  catch (e) { $("err").style.display = "block"; throw e; }
  const DPR = Math.min(devicePixelRatio, 2);
  renderer.setPixelRatio(DPR); renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92;
  const labelRenderer = new CSS2DRenderer(); labelRenderer.setSize(innerWidth, innerHeight);
  Object.assign(labelRenderer.domElement.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: 5 });
  root.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment(renderer);
  const envTex = pmrem.fromScene(room, 0.03).texture;
  scene.environment = envTex;
  const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 2000);
  const HOME = innerWidth / innerHeight < 1 ? new THREE.Vector3(0, 103, 103) : new THREE.Vector3(0, 58, 53); // v7: higher camera, the ring reads taller on screen
  camera.position.copy(HOME);
  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.05, rotateSpeed: 0.6, minDistance: 8, maxDistance: 170, enablePan: false, autoRotate: S.auto, autoRotateSpeed: 0.25, maxPolarAngle: 1.68, minPolarAngle: 0.5 });
  controls.target.set(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xdff4ff, 0x2a7fd0, 1.1));
  const sun = new THREE.DirectionalLight(0xfff6e0, 2.2); sun.position.copy(SUN).multiplyScalar(80); scene.add(sun);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.35, 0.97); composer.addPass(bloom);
  composer.addPass(new OutputPass());
  // Fit: shift the projection so the network centres in the space right of the left card (and above the legend strip)
  function fitView() {
    if (disposed) return;
    const W = innerWidth, H = innerHeight, card = $("mine").getBoundingClientRect();
    const left = W > 700 ? card.right + 12 : 0, top = W > 700 ? 0 : card.bottom, bottom = W > 700 ? 140 : 110;
    const sx = left / 2, sy = (top - bottom) / 2;
    camera.setViewOffset(W, H, -sx, -sy, W, H); camera.updateProjectionMatrix();
    const z = $("graphZone").style; Object.assign(z, { left: left + "px", top: Math.max(top, 16) + "px", width: W - left - 110 + "px", height: H - Math.max(top, 16) - bottom - 20 + "px" });
  }

  /* ============ Shared uniforms (v4 pulse system) ============ */
  const U = {
    uTime: { value: 0 }, uWaterY: { value: WATER_Y }, uPixel: { value: DPR }, uRes: { value: new THREE.Vector2(innerWidth * DPR, innerHeight * DPR) },
    uPulsePositions: { value: [new THREE.Vector3(1e3, 1e3, 1e3), new THREE.Vector3(1e3, 1e3, 1e3), new THREE.Vector3(1e3, 1e3, 1e3)] },
    uPulseTimes: { value: [-1e3, -1e3, -1e3] }, uPulseSpeed: { value: 18 },
    uAlpha: { value: 1 }, uDimT: { value: 1 },
  };

  /* ============ Sky dome (v4, unchanged) ============ */
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uTop: { value: new THREE.Color(0x0646a8) }, uMid: { value: new THREE.Color(0x2a8fe0) }, uHor: { value: new THREE.Color(0xbfe6fb) }, uSun: { value: SUN }, uTime: U.uTime },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position + cameraPosition, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `${NOISE} uniform vec3 uTop, uMid, uHor, uSun; uniform float uTime; varying vec3 vDir;
    void main(){ vec3 d = normalize(vDir); float y = d.y;
      vec3 col = mix(uHor, uMid, smoothstep(0.0, 0.18, y)); col = mix(col, uTop, smoothstep(0.18, 0.7, y));
      if (y < 0.0) col = uHor;
      float s = max(dot(d, uSun), 0.0);
      col += vec3(1.0, 0.97, 0.88) * (pow(s, 600.0) * 2.0 + pow(s, 24.0) * 0.35 + pow(s, 6.0) * 0.05);
      float az = atan(d.z, d.x);
      float b1 = y - 0.22 - 0.07 * sin(az * 2.0 + 0.8 + uTime * 0.02); col += vec3(1.0) * 0.2 * exp(-pow(b1 / 0.03, 2.0));
      float b2 = y - 0.30 - 0.05 * sin(az * 3.0 + 2.0 - uTime * 0.015); col += vec3(1.0) * 0.16 * exp(-pow(b2 / 0.012, 2.0));
      float cl = snoise(vec3(az * 2.2, y * 9.0, uTime * 0.01)) * 0.5 + 0.5; col = mix(col, vec3(1.0), smoothstep(0.62, 0.9, cl) * smoothstep(0.3, 0.04, y) * smoothstep(-0.01, 0.05, y) * 0.22);
      gl_FragColor = vec4(col, 1.0); }`,
  }));
  sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);

  /* ============ Water (v4, unchanged) ============ */
  const water = new THREE.Mesh(new THREE.PlaneGeometry(700, 700, 260, 260), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { ...U, uA: { value: 1 }, uB: { value: 0 }, uCycles: { value: 2 }, uDir: { value: 1 }, uAmp: { value: 1.3 }, uK: { value: (Math.PI * 2) / 70 },
      uDeep: { value: new THREE.Color(0x0657a8) }, uShallow: { value: new THREE.Color(0x1fb3e0) }, uHor: { value: new THREE.Color(0xbfe6fb) }, uSun: { value: SUN } },
    vertexShader: `${PULSE} uniform float uA, uB, uCycles, uDir, uAmp, uK; varying vec3 vWorld; varying vec3 vN;
      float h(vec2 p){ float a = uTime * 0.55, sum = max(uA + uB, 0.001);
        float y = uAmp * (uA * cos(uK * p.x + a) + uB * cos(uDir * uCycles * uK * p.x + a)) / sum;
        y += 0.38 * sin(p.y * 0.21 + a * 1.3) + 0.14 * sin((p.x + p.y) * 0.55 - a * 2.2);
        for (int i = 0; i < 3; i++) { float dt = uTime - uPulseTimes[i]; if (dt < 0.0 || dt > 5.0) continue;
          float d = distance(p, uPulsePositions[i].xz); y += 0.7 * sin(d * 1.1 - dt * 7.0) * exp(-dt * 0.7) * smoothstep(dt * 10.0 + 3.0, dt * 10.0 - 8.0, d) * exp(-d * 0.025); }
        return y; }
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); float y = h(w.xz), e = 0.5;
        vN = normalize(vec3(-(h(w.xz + vec2(e, 0.0)) - y) / e, 1.0, -(h(w.xz + vec2(0.0, e)) - y) / e));
        w.y += y; vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `${NOISE} uniform vec3 uDeep, uShallow, uHor, uSun; uniform float uTime; varying vec3 vWorld; varying vec3 vN;
      void main(){ vec3 V = normalize(cameraPosition - vWorld), N = normalize(vN);
        float ndv = max(dot(N, V), 0.0), fres = pow(1.0 - ndv, 3.0);
        vec3 col = mix(uShallow, uDeep, smoothstep(0.1, 0.9, ndv));
        col = mix(col, vec3(0.55, 0.82, 0.97), fres * 0.6);
        float spec = pow(max(dot(reflect(-uSun, N), V), 0.0), 140.0); col += vec3(1.0, 0.98, 0.9) * spec * 2.2;
        float sp = snoise(vec3(vWorld.xz * 0.3, uTime * 0.5)); col += vec3(1.0) * smoothstep(0.7, 0.92, sp) * 0.3;
        float band = sin(vWorld.x * 0.08 + vWorld.z * 0.05 + uTime * 0.4) * 0.5 + 0.5; col += vec3(0.6, 0.9, 1.0) * smoothstep(0.85, 1.0, band) * 0.08;
        float fog = smoothstep(90.0, 420.0, length(vWorld.xz - cameraPosition.xz));
        col = mix(col, uHor, fog);
        gl_FragColor = vec4(col, mix(0.7 + fres * 0.28, 1.0, fog)); }`,
  }));
  water.rotation.x = -Math.PI / 2; water.position.y = WATER_Y; water.renderOrder = -5; water.frustumCulled = false; scene.add(water);

  /* ============ Soap bubbles rising (v4, unchanged) ============ */
  const BN = RM ? 120 : 260, bPos: number[] = [], bSize: number[] = [], bSpeed: number[] = [];
  for (let i = 0; i < BN; i++) { bPos.push(THREE.MathUtils.randFloatSpread(220), Math.random() * 80, THREE.MathUtils.randFloat(-160, 40)); bSize.push(THREE.MathUtils.randFloat(0.4, 2.2) * (Math.random() < 0.08 ? 2.2 : 1)); bSpeed.push(THREE.MathUtils.randFloat(0.6, 2.2)); }
  const bGeo = new THREE.BufferGeometry();
  bGeo.setAttribute("position", new THREE.Float32BufferAttribute(bPos, 3)); bGeo.setAttribute("aSize", new THREE.Float32BufferAttribute(bSize, 1)); bGeo.setAttribute("aSpeed", new THREE.Float32BufferAttribute(bSpeed, 1));
  const bubbles = new THREE.Points(bGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { uTime: U.uTime, uPixel: U.uPixel, uWaterY: U.uWaterY },
    vertexShader: `attribute float aSize; attribute float aSpeed; uniform float uTime, uPixel, uWaterY; varying float vFade; varying float vSeed;
      void main(){ vec3 p = position; p.y = uWaterY + mod(p.y + uTime * aSpeed, 80.0); p.x += sin(uTime * 0.4 + position.z) * 1.2; vSeed = position.x;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = aSize * uPixel * (900.0 / -mv.z); gl_Position = projectionMatrix * mv;
        vFade = smoothstep(0.0, 4.0, p.y - uWaterY) * smoothstep(80.0, 60.0, p.y - uWaterY) * smoothstep(320.0, 80.0, -mv.z); }`,
    fragmentShader: `uniform float uTime; varying float vFade; varying float vSeed;
      void main(){ vec2 c = gl_PointCoord * 2.0 - 1.0; float d = length(c); if (d > 1.0) discard;
        float ang = atan(c.y, c.x);
        vec3 irid = 0.5 + 0.5 * cos(vec3(0.0, 2.1, 4.2) + ang * 2.0 + uTime * 0.6 + vSeed);
        float rim = smoothstep(0.72, 0.97, d) * smoothstep(1.0, 0.95, d);
        float spec = smoothstep(0.32, 0.0, length((c - vec2(-0.36, -0.42)) * vec2(1.0, 1.5)));
        float spec2 = smoothstep(0.18, 0.0, length(c - vec2(0.42, 0.5)));
        vec3 col = mix(vec3(0.85, 0.96, 1.0), irid, 0.45);
        float a = (0.06 + rim * 0.6 + spec * 0.85 + spec2 * 0.35) * vFade;
        gl_FragColor = vec4(mix(col, vec3(1.0), spec), a); }`,
  }));
  bubbles.frustumCulled = false; bubbles.renderOrder = -4; scene.add(bubbles);

  /* ============ The org as one hierarchy: core → departments → teams → people (+ spores) ============ */
  // kind: 0 core, 1 department, 2 team, 3 person, 4 spore (tiny drifting filler that makes it read as mycelium)
  const ME = WF.me.id;
  function buildOrg(d: number): Graph {
    const rand = rng(7), nodes: Node[] = [], pairs: [number, number, number][] = [], seen = new Set<string>();
    const add = (kind: number, pos: THREE.Vector3, size: number, extra: Partial<Node> = {}) => { nodes.push({ kind, pos, size, dist: 0, ...extra }); return nodes.length - 1; };
    const link = (a: number | undefined, b: number | undefined, s: number) => {
      if (a == null || b == null) return;
      const k = a < b ? `${a}-${b}` : `${b}-${a}`; if (a === b || seen.has(k)) return; seen.add(k); pairs.push([a, b, s]);
    };
    add(0, new THREE.Vector3(), 0, { name: "Wayfinder" });
    const R = 27, nD = WF.org.length, deptIx: Record<string, number> = {}, subIx: Record<string, number> = {}, personIx: Record<string, number> = {};
    WF.org.forEach((dep, i) => {
      const a = (i / nD) * Math.PI * 2, pos = new THREE.Vector3(R * Math.cos(a), Math.sin(i * 2.1) * 5, R * Math.sin(a));
      const di = add(1, pos, 2.7, { name: dep.name, dept: dep.id }); deptIx[dep.id] = di; link(0, di, 0.9);
      const out = new THREE.Vector3(pos.x, 0, pos.z).normalize(), tan = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
      // density decides how many teams and people show; the viewer's team and the viewer always stay
      const subs = dep.subs.filter((s, j) => j < Math.max(1, Math.ceil(dep.subs.length * d)) || s.ids.includes(ME));
      subs.forEach((sub, j) => {
        const k = subs.length, phi = (j - (k - 1) / 2) * 0.85;
        const sp = pos.clone().addScaledVector(out, 7.6 * Math.cos(phi)).addScaledVector(tan, 7.6 * Math.sin(phi)).addScaledVector(UP, k > 1 ? (j % 2 ? 2.1 : -2.1) : 1);
        const si = add(2, sp, 1.75, { name: sub.name, dept: dep.id, sub: sub.id }); subIx[sub.id] = si; link(di, si, 0.8);
        const w = sp.clone().sub(pos).normalize(), p1 = new THREE.Vector3().crossVectors(w, UP).normalize(), p2 = new THREE.Vector3().crossVectors(p1, w);
        const ppl = sub.ids.map(person).filter((p): p is NonNullable<typeof p> => !!p);
        const keep = ppl.filter((p, n) => n < Math.max(1, Math.ceil(ppl.length * d)) || p.id === ME);
        const pIx: number[] = [];
        keep.forEach((p, n) => {
          const psi = (n / keep.length) * Math.PI * 2 + j * 0.9 + i;
          const pp = sp.clone().addScaledVector(w, 3).addScaledVector(p1, Math.cos(psi) * 4).addScaledVector(p2, Math.sin(psi) * 4);
          const pi = add(3, pp, p.id === ME ? 1.35 : 1.1, { name: p.first, full: p.name, dept: dep.id, sub: sub.id, person: p.id }); personIx[p.id] = pi; pIx.push(pi); link(si, pi, 0.65);
          const spores = Math.round(4 * d * d);
          for (let s = 0; s < spores; s++) {
            const dir = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
            const zi = add(4, pp.clone().addScaledVector(dir, 1.1 + rand() * 1.1).addScaledVector(w, 0.6), 0.45 + rand() * 0.3, { dept: dep.id }); link(pi, zi, 0.3);
          }
        });
        for (let n = 0; n + 1 < pIx.length; n++) if (rand() < 0.6) link(pIx[n], pIx[n + 1], 0.45);
      });
    });
    // ring of neighbouring departments, plus real routing cross-links
    for (let i = 0; i < nD; i++) link(deptIx[WF.org[i].id], deptIx[WF.org[(i + 1) % nD].id], 0.5);
    const maxV = Math.max(1, ...WF.routing.map((r) => r[2]));
    // v6 scaled strength by v/400 for its ~100-scale mock; real counts are small, so scale to the busiest flow instead.
    WF.routing.forEach(([a, b, v]) => link(deptIx[a], deptIx[b], Math.min(0.75, 0.3 + (v / maxV) * 0.45)));
    // spores reach for nearby spores of other people: the mycelium threads
    const sp = nodes.map((n, i) => (n.kind === 4 ? i : -1)).filter((i) => i >= 0);
    for (const a of sp) {
      let best = -1, bd = 3.2;
      for (const b of sp) { if (b <= a) continue; const dd = nodes[a].pos.distanceTo(nodes[b].pos); if (dd < bd && rand() < 0.7) { bd = dd; best = b; } }
      if (best >= 0) link(a, best, 0.3);
    }
    nodes.forEach((n) => { if (n.kind) n.pos.y *= Y_SPREAD; n.dist = n.pos.length(); }); // v7: space nodes further apart top to bottom
    const adj: number[][] = nodes.map(() => []), adjMain: number[][] = nodes.map(() => []), order = new Map<string, [number, number]>();
    pairs.forEach(([a, b]) => {
      adj[a].push(b); adj[b].push(a); order.set(a < b ? `${a}-${b}` : `${b}-${a}`, [a, b]);
      if (nodes[a].kind !== 4 && nodes[b].kind !== 4) { adjMain[a].push(b); adjMain[b].push(a); }
    });
    return { nodes, pairs, adj, adjMain, order, deptIx, subIx, personIx };
  }

  /* ============ Colors ============ */
  function nodeColors(G: Graph, pal: Palette) {
    const c = new THREE.Color(), out = new Float32Array(G.nodes.length * 3), p3 = P3();
    G.nodes.forEach((n, i) => {
      if (n.kind === 0) c.set(pal.levels[0]);
      else if (n.kind === 1) c.set(p3.dept);
      else if (n.kind === 2) { c.set(p3.team); c.offsetHSL((((i * 37) % 7) - 3) * 0.006, 0, 0); }
      else if (n.kind === 3) c.set(p3.person);
      else { c.set(pal.levels[2 + (i % 4)]); c.offsetHSL((((i * 37) % 7) - 3) * 0.006, 0, (((i * 13) % 5) - 2) * 0.02); }
      out.set([c.r, c.g, c.b], i * 3);
    });
    return out;
  }

  let G: Graph | null = null;
  let nodeMesh: THREE.Points | null = null, nodeMirror: THREE.Points | null = null;
  let fibers: { mesh: THREE.Mesh; mirror: THREE.Mesh } | null = null;
  const dimState: { from: Float32Array; to: Float32Array } = { from: new Float32Array(), to: new Float32Array() }; // per-node focus brightness
  function disposeMesh(m: THREE.Mesh | THREE.Points | null | undefined, shared = false) {
    if (!m) return; scene.remove(m); if (!shared) m.geometry.dispose(); (m.material as THREE.Material).dispose();
  }
  function buildNodes() {
    const g0 = G!;
    disposeMesh(nodeMesh); disposeMesh(nodeMirror, true);
    const n = g0.nodes.length, g = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), size = new Float32Array(n), type = new Float32Array(n), dist = new Float32Array(n);
    g0.nodes.forEach((d, i) => { pos.set([d.pos.x, d.pos.y, d.pos.z], i * 3); size[i] = d.size; type[i] = d.kind === 4 ? 1 : 0; dist[i] = d.dist; });
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("aPos", new THREE.BufferAttribute(pos, 3)); g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    g.setAttribute("aType", new THREE.BufferAttribute(type, 1)); g.setAttribute("aDist", new THREE.BufferAttribute(dist, 1));
    g.setAttribute("aCol", new THREE.BufferAttribute(nodeColors(g0, palette()), 3));
    g.setAttribute("aDimFrom", new THREE.BufferAttribute(dimState.from.slice(), 1)); g.setAttribute("aDimTo", new THREE.BufferAttribute(dimState.to.slice(), 1));
    const mk = (mirror: boolean) => new THREE.ShaderMaterial({ uniforms: { ...U, uMirror: { value: mirror ? 1 : 0 } }, vertexShader: nodeVert, fragmentShader: nodeFrag, transparent: true, depthWrite: !mirror });
    nodeMesh = new THREE.Points(g, mk(false)); nodeMirror = new THREE.Points(g, mk(true));
    nodeMesh.frustumCulled = nodeMirror.frustumCulled = false; nodeMesh.renderOrder = 0; nodeMirror.renderOrder = -6;
    scene.add(nodeMesh, nodeMirror);
  }
  function fiberAttrs(col: ArrayLike<number>, dimF: Float32Array, dimT: Float32Array) { // per-vertex arrays that depend on node colors or focus
    const SEG = 16, P = SEG + 1, nv = G!.pairs.length * P * 2, c = new Float32Array(nv * 3), df = new Float32Array(nv), dt = new Float32Array(nv);
    let v = 0;
    G!.pairs.forEach(([a, b]) => {
      const f = Math.min(dimF[a], dimF[b]), t = Math.min(dimT[a], dimT[b]);
      for (let i = 0; i < P * 2; i++, v++) { for (let k = 0; k < 3; k++) c[v * 3 + k] = (col[a * 3 + k] + col[b * 3 + k]) * 0.5; df[v] = f; dt[v] = t; }
    });
    return { c, df, dt };
  }
  function buildFibers() {
    const g0 = G!;
    disposeMesh(fibers?.mesh); disposeMesh(fibers?.mirror, true);
    const SEG = 16, P = SEG + 1, nv = g0.pairs.length * P * 2;
    const A: Record<string, Float32Array> = { aT: new Float32Array(nv), aSide: new Float32Array(nv), aStr: new Float32Array(nv), aPath: new Float32Array(nv), aS: new Float32Array(nv * 3), aE: new Float32Array(nv * 3) };
    const idx = new Uint32Array(g0.pairs.length * SEG * 6); let v = 0, k = 0;
    g0.pairs.forEach(([a, b, s], pi) => {
      const base = v, pa = g0.nodes[a].pos, pb = g0.nodes[b].pos;
      for (let i = 0; i < P; i++) for (const side of [-1, 1]) {
        A.aT[v] = i / SEG; A.aSide[v] = side; A.aStr[v] = s; A.aPath[v] = pi;
        A.aS.set([pa.x, pa.y, pa.z], v * 3); A.aE.set([pb.x, pb.y, pb.z], v * 3); v++;
      }
      for (let i = 0; i < SEG; i++) { const o = base + i * 2; idx.set([o, o + 1, o + 2, o + 1, o + 3, o + 2], k); k += 6; }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    for (const key in A) g.setAttribute(key, new THREE.BufferAttribute(A[key], key === "aS" || key === "aE" ? 3 : 1));
    const fa = fiberAttrs(nodeMesh!.geometry.getAttribute("aCol").array, dimState.from, dimState.to);
    g.setAttribute("aCol", new THREE.BufferAttribute(fa.c, 3)); g.setAttribute("aDimFrom", new THREE.BufferAttribute(fa.df, 1)); g.setAttribute("aDimTo", new THREE.BufferAttribute(fa.dt, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const mk = (mirror: boolean) => new THREE.ShaderMaterial({ uniforms: { ...U, uMirror: { value: mirror ? 1 : 0 } }, vertexShader: fiberVert, fragmentShader: fiberFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, mk(false)), mirror = new THREE.Mesh(g, mk(true));
    mesh.frustumCulled = mirror.frustumCulled = false; mesh.renderOrder = 1; mirror.renderOrder = -7;
    scene.add(mesh, mirror); fibers = { mesh, mirror };
  }
  function setAttr(geo: THREE.BufferGeometry, name: string, arr: ArrayLike<number>) { const a = geo.getAttribute(name) as THREE.BufferAttribute; (a.array as Float32Array).set(arr); a.needsUpdate = true; }
  function recolor() {
    const col = nodeColors(G!, palette()); setAttr(nodeMesh!.geometry, "aCol", col);
    setAttr(fibers!.mesh.geometry, "aCol", fiberAttrs(col, dimState.from, dimState.to).c);
    paintLegend(); labels.forEach(paintLabelDot);
  }

  /* ============ Wayfinder core: glass sphere around a green heart (v4) ============ */
  const coreGroup = new THREE.Group(); scene.add(coreGroup);
  const heart = new THREE.Mesh(new THREE.SphereGeometry(1.5, 48, 32), new THREE.MeshPhysicalMaterial({ color: 0x3fd66a, emissive: 0x2fbf5a, emissiveIntensity: 0.55, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 }));
  const shell = new THREE.Mesh(new THREE.SphereGeometry(2.7, 64, 48), new THREE.MeshPhysicalMaterial({ color: 0xe8fbff, roughness: 0.02, metalness: 0, clearcoat: 1, clearcoatRoughness: 0, transparent: true, opacity: 0.26, envMapIntensity: 2.2, depthWrite: false }));
  const gloss = new THREE.Mesh(new THREE.SphereGeometry(2.72, 48, 32, 0, Math.PI * 2, 0, Math.PI * 0.32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false }));
  gloss.rotation.set(-0.35, 0, 0.3); coreGroup.add(heart, shell, gloss);
  const coreMirror = coreGroup.clone(); coreMirror.scale.y = -1; coreMirror.position.y = 2 * WATER_Y;
  coreMirror.traverse((o) => { const m = o as THREE.Mesh; if (m.material) { const mat = (m.material as THREE.Material).clone(); mat.transparent = true; mat.opacity = (mat.opacity ?? 1) * 0.35; m.material = mat; } });
  scene.add(coreMirror);

  /* ============ Labels ============ */
  let labels: Label[] = [];
  function makeLabel(i: number): Label {
    const n = G!.nodes[i], w = document.createElement("div"), d = document.createElement("div");
    w.className = "lw"; const cls = ["core", "dept", "sub", "person"][n.kind];
    d.className = `lbl ${cls} off` + (n.person === ME ? " me" : "");
    d.innerHTML = n.kind === 0 ? "" : "<i></i>";
    d.append(n.person === ME ? `${n.name} (you)` : n.name ?? "");
    w.appendChild(d); const o = new CSS2DObject(w); o.position.copy(n.pos); scene.add(o);
    const L: Label = { i, n, o, d, base: false, temp: false, dim: false }; paintLabelDot(L); return L;
  }
  function paintLabelDot(L: Label) {
    const i = L.d.querySelector("i"); if (!i) return;
    const p3 = P3(); i.style.background = hex(L.n.kind === 1 ? p3.dept : L.n.kind === 2 ? p3.team : p3.person);
  }
  function removeLabels() { labels.forEach((L) => { scene.remove(L.o); L.o.element.remove(); }); labels = []; }
  function buildLabels() {
    removeLabels();
    labels = G!.nodes.map((n, i) => (n.kind === 4 ? null : makeLabel(i))).filter((x): x is Label => !!x);
    refreshLabels();
  }
  function refreshLabels() {
    labels.forEach((L) => {
      const k = L.n.kind, inFocus = !!S.focus && L.n.dept === S.focus;
      L.base = k === 0 || k === 1 || (inFocus && (k === 2 || k === 3));
      L.dim = !!S.focus && k === 1 && !inFocus;
      L.d.classList.toggle("off", !(L.base || L.temp)); L.d.classList.toggle("dim", L.dim && !L.temp);
    });
  }
  function paintLegend() {
    const pal = palette(), g = (c: number) => `radial-gradient(circle at 35% 30%,#fff,${hex(c)} 55%)`;
    const p3 = P3(); $("lg-dept").style.background = g(p3.dept); $("lg-sub").style.background = g(p3.team); $("lg-person").style.background = g(p3.person); $("lg-match").style.background = hex(pal.match);
  }

  /* ============ Build / rebuild with a fade ============ */
  const tween = (ms: number, f: (t: number) => void) => new Promise<void>((res) => {
    if (RM || disposed) { if (!disposed) f(1); return res(); }
    const t0 = performance.now();
    const st = () => { if (disposed) return res(); const t = Math.min(1, Math.max(0, (performance.now() - t0) / ms)); f(t); if (t < 1) requestAnimationFrame(st); else res(); };
    requestAnimationFrame(st);
  });
  function focusDims() { return Float32Array.from(G!.nodes, (n) => (!S.focus || n.kind === 0 || n.dept === S.focus ? 1 : 0)); }
  function build() {
    G = buildOrg(S.density);
    if (S.focus && !G.deptIx[S.focus]) { S.focus = null; $("focusbar").classList.remove("on"); }
    const dims = focusDims(); dimState.from = dims; dimState.to = dims.slice(); U.uDimT.value = 1;
    buildNodes(); buildFibers(); buildLabels();
    const c = { d: 0, s: 0, p: 0 }; G.nodes.forEach((n) => { if (n.kind === 1) c.d++; else if (n.kind === 2) c.s++; else if (n.kind === 3) c.p++; });
    $("counts").textContent = `${c.p} people`;
  }
  async function rebuild() {
    if (S.building) { S.rebuildAgain = true; return; }
    S.building = true; S.run++; clearRoutes(); hideToast();
    await tween(380, (t) => (U.uAlpha.value = 1 - t));
    if (disposed) return;
    build();
    await tween(620, (t) => (U.uAlpha.value = t));
    S.building = false; if (S.rebuildAgain && !disposed) { S.rebuildAgain = false; void rebuild(); }
  }

  /* ============ Focus: fly into a department ============ */
  function setDims() {
    const cur = Float32Array.from(dimState.from, (f, i) => f + (dimState.to[i] - f) * U.uDimT.value), next = focusDims();
    dimState.from = cur; dimState.to = next;
    setAttr(nodeMesh!.geometry, "aDimFrom", cur); setAttr(nodeMesh!.geometry, "aDimTo", next);
    const fa = fiberAttrs(nodeMesh!.geometry.getAttribute("aCol").array, cur, next);
    setAttr(fibers!.mesh.geometry, "aDimFrom", fa.df); setAttr(fibers!.mesh.geometry, "aDimTo", fa.dt);
    U.uDimT.value = 0; gsap.to(U.uDimT, { value: 1, duration: RM ? 0 : 0.9, ease: "power2.out" });
  }
  function fly(pos: THREE.Vector3, target: THREE.Vector3, dur = 1.6) {
    gsap.killTweensOf([camera.position, controls.target]);
    const d = RM ? 0 : dur;
    gsap.to(camera.position, { x: pos.x, y: pos.y, z: pos.z, duration: d, ease: "power3.inOut" });
    gsap.to(controls.target, { x: target.x, y: target.y, z: target.z, duration: d, ease: "power3.inOut" });
  }
  function focusDept(id: string) {
    if (S.focus === id || !G) return;
    S.focus = id; S.run++; clearRoutes(); hideToast();
    const members = G.nodes.filter((n) => n.dept === id && n.kind !== 4), c = new THREE.Vector3();
    members.forEach((n) => c.add(n.pos)); c.divideScalar(members.length || 1);
    const out = new THREE.Vector3(c.x, 0, c.z).normalize();
    const side = new THREE.Vector3(-out.z, 0, out.x); // view the cluster at an angle so teams don't hide behind their department
    fly(c.clone().addScaledVector(out, 16).addScaledVector(side, 10).addScaledVector(UP, 13), c);
    controls.autoRotate = false; setDims(); refreshLabels();
    const dep = dept(id), teams = members.filter((n) => n.kind === 2).length, ppl = members.filter((n) => n.kind === 3).length;
    const ft = $("ftitle"); ft.innerHTML = `<i style="background:${hex(P3().dept)}"></i>`;
    ft.append(`${dep?.name ?? id} · ${teams} ${teams === 1 ? "team" : "teams"} · ${ppl} people`);
    $("focusbar").classList.add("on");
  }
  function unfocus() {
    if (!S.focus) return; S.focus = null; S.run++; clearRoutes();
    fly(HOME, new THREE.Vector3()); controls.autoRotate = S.auto; setDims(); refreshLabels();
    $("focusbar").classList.remove("on"); lastStory = performance.now() - 5000;
  }
  const onBack = () => unfocus();
  $("back").addEventListener("click", onBack);
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") unfocus(); };
  addEventListener("keydown", onKey);

  /* ============ Picking: nearest bubble on screen ============ */
  const v3 = new THREE.Vector3();
  function pick(x: number, y: number) {
    let best: number | null = null, bd = Infinity;
    G!.nodes.forEach((n, i) => {
      if (n.kind === 0 || n.kind === 4) return;
      v3.copy(n.pos).project(camera); if (v3.z > 1) return;
      const sx = ((v3.x + 1) / 2) * innerWidth, sy = ((1 - v3.y) / 2) * innerHeight, d = Math.hypot(sx - x, sy - y);
      const r = (n.kind === 1 ? 30 : n.kind === 2 ? 18 : 13) * (S.focus ? 1.3 : 1);
      if (d < r && d - (n.kind === 1 ? 8 : 0) < bd) { bd = d - (n.kind === 1 ? 8 : 0); best = i; }
    });
    return best;
  }
  let lastPulse = 0;
  function pulseAt(p: THREE.Vector3) { lastPulse = (lastPulse + 1) % 3; U.uPulsePositions.value[lastPulse].copy(p); U.uPulseTimes.value[lastPulse] = U.uTime.value; }
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(), plane = new THREE.Plane(), hit = new THREE.Vector3();
  let down: { x: number; y: number } | null = null;
  const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
  const onMove = (e: PointerEvent) => { if (!G || e.buttons) return; renderer.domElement.classList.toggle("pointing", pick(e.clientX, e.clientY) != null); };
  const onUp = (e: PointerEvent) => {
    if (!G || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    const i = pick(e.clientX, e.clientY);
    if (i != null) {
      const n = G.nodes[i];
      if (n.dept !== S.focus) focusDept(n.dept!);
      else if (n.kind === 3) {
        const p = person(n.person!);
        if (p) toast("route", p.deptName + " · " + p.subName, esc(p.name), n.person === ME ? "That’s you." : esc(p.role || "Wayfinder knows what they own."));
      }
      pulseAt(n.pos); return;
    }
    // empty space: the v4 click-to-energize pulse
    ptr.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ptr, camera);
    plane.normal.copy(camera.position).sub(controls.target).normalize(); plane.constant = -plane.normal.dot(controls.target);
    if (ray.ray.intersectPlane(plane, hit)) pulseAt(hit);
  };
  renderer.domElement.addEventListener("pointerdown", onDown);
  renderer.domElement.addEventListener("pointermove", onMove);
  renderer.domElement.addEventListener("pointerup", onUp);

  /* ============ Routes: simple flat dots moving along the fibers ============ */
  function bfs(adj: number[][], a: number, b: number) {
    const prev = new Map<number, number>([[a, -1]]), q = [a];
    while (q.length) { const x = q.shift()!; if (x === b) break; for (const y of adj[x]) if (!prev.has(y)) { prev.set(y, x); q.push(y); } }
    if (!prev.has(b)) return null; const path: number[] = []; for (let x = b; x !== -1; x = prev.get(x)!) path.unshift(x); return path;
  }
  // CPU copy of the fiber curve (same S, E order the shader uses, minus its tiny noise wobble)
  const cS = new THREE.Vector3(), cE = new THREE.Vector3(), cM = new THREE.Vector3(), cP = new THREE.Vector3(), cD = new THREE.Vector3();
  function curvePoint(i: number, j: number, t: number, out: THREE.Vector3) {
    const ord = G!.order.get(i < j ? `${i}-${j}` : `${j}-${i}`); const [a, b] = ord || [i, j]; if (a !== i) t = 1 - t;
    cS.copy(G!.nodes[a].pos); cE.copy(G!.nodes[b].pos); cD.subVectors(cE, cS);
    cP.copy(cD).normalize().cross(UP); if (cP.length() < 0.1) cP.set(1, 0, 0); else cP.normalize();
    cM.addVectors(cS, cE).multiplyScalar(0.5).addScaledVector(cP, 0.35 + cD.length() * 0.03);
    const u = 1 - t; return out.set(0, 0, 0).addScaledVector(cS, u * u).addScaledVector(cM, 2 * u * t).addScaledVector(cE, t * t);
  }
  const dotGeo = new THREE.SphereGeometry(1, 20, 14);
  const routes: Route[] = [];
  function makeDots(color: number): Route {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
    const dots = [0.75, 0.52, 0.36].map((r) => { const m = new THREE.Mesh(dotGeo, mat); m.scale.setScalar(r); m.renderOrder = 3; scene.add(m); return m; });
    const r = { dots, mat }; routes.push(r); return r;
  }
  function clearRoutes() {
    routes.splice(0).forEach((r) => { r.dots.forEach((d) => scene.remove(d)); r.mat.dispose(); });
    labels.forEach((L) => (L.temp = false)); refreshLabels();
    document.querySelectorAll("#qlist .row.playing").forEach((r) => r.classList.remove("playing"));
  }
  async function travel(path: number[], color: number, msPerHop: number, alive: () => boolean) {
    const r = makeDots(color), segs = path.length - 1, tmp = new THREE.Vector3();
    const place = (T: number) => r.dots.forEach((d, k) => {
      const tt = Math.max(0, T - k * 0.09); const s = Math.min(segs - 1, Math.floor(tt));
      curvePoint(path[s], path[s + 1], tt - s, tmp); d.position.copy(tmp); d.visible = T > k * 0.09 || k === 0;
    });
    await tween(msPerHop * segs, (t) => { if (alive()) place(t * segs); });
    if (G && !disposed) place(segs); return r;
  }
  async function fadeDots(r: Route, ms = 600) {
    await tween(ms, (t) => { r.mat.opacity = 1 - t; r.dots.forEach((d) => d.scale.multiplyScalar(0.985)); });
    r.dots.forEach((d) => scene.remove(d)); r.mat.dispose(); const k = routes.indexOf(r); if (k >= 0) routes.splice(k, 1);
  }
  // Hop `who` may be a person or a department. A person may be hidden at low density: route to their team, then
  // their department. Anything else (a room, a vendor, the agent) has no bubble and is skipped.
  function nodeFor(id: string): number | undefined {
    const g = G!;
    if (g.deptIx[id] != null) return g.deptIx[id];
    const p = person(id); if (!p) return undefined;
    return g.personIx[id] ?? g.subIx[p.sub] ?? g.deptIx[p.dept];
  }
  function chainPath(ids: string[]) {
    const stops = ids.map(nodeFor).filter((x): x is number => x != null), path: number[] = stops.length ? [stops[0]] : [];
    for (let k = 1; k < stops.length; k++) {
      if (stops[k] === path.at(-1)) continue;
      const seg = bfs(G!.adjMain, path.at(-1)!, stops[k]); if (seg) path.push(...seg.slice(1));
    }
    return { stops, path };
  }
  function showTemp(ixs: number[]) {
    ixs.forEach((i) => { const L = labels.find((l) => l.i === i); if (L) L.temp = true; }); refreshLabels();
    ixs.forEach((i) => labels.find((l) => l.i === i)?.d.classList.add("hot"));
  }
  function hideTemp() { labels.forEach((L) => { L.temp = false; L.d.classList.remove("hot"); }); refreshLabels(); }
  const rowOf = (id: string) => document.querySelector(`#qlist .row[data-q="${CSS.escape(id)}"]`);

  async function playQuery(q: WfQuery) {
    if (!G || disposed) return;
    S.run++; const run = S.run, alive = () => run === S.run && !S.building && !disposed; clearRoutes();
    rowOf(q.id)?.classList.add("playing");
    const { stops, path } = chainPath([q.requester, ...q.hops.map((h) => h.who)]); if (path.length < 2) return;
    showTemp(stops);
    const last = q.hops.at(-1)!, lastName = esc(nameOf(last.who));
    toast("route", "Wayfinder is routing", `${esc(nameOf(q.requester))} → ${lastName}`, esc(q.title));
    const r = await travel(path, ROUTE_COLOR, RM ? 1 : 420, alive); if (!alive()) return;
    const n = q.hops.filter((h) => !h.synthetic).length || q.hops.length;
    if (q.status === "done") toast("route", "Resolved", esc(q.title), `${esc(q.elapsed)}${q.usual ? `, usually ${esc(q.usual)}` : ""} <span class="hops">${n} ${n === 1 ? "hop" : "hops"}</span>`);
    else toast("msg", `Waiting on ${lastName}`, esc(q.title), `${last.msg ? `“${esc(last.msg)}” ` : ""}<span class="hops">${n} ${n === 1 ? "hop" : "hops"} so far</span>`);
    await sleep(2600); if (!alive()) return; await fadeDots(r); if (!alive()) return;
    hideTemp(); rowOf(q.id)?.classList.remove("playing");
  }
  async function playMatch(m: WfMatch) {
    if (!G || disposed) return;
    S.run++; const run = S.run, alive = () => run === S.run && !S.building && !disposed; clearRoutes();
    const { stops, path } = chainPath([m.a, m.b]); if (path.length < 2) return;
    showTemp(stops);
    toast("myc", "Mycelium found a match", `${esc(nameOf(m.a))} and ${esc(nameOf(m.b))} share ${esc(m.topic)}`, esc(m.why));
    const r = await travel(path, palette().match, RM ? 1 : 460, alive); if (!alive()) return;
    await sleep(2600); if (!alive()) return; await fadeDots(r); if (!alive()) return; hideTemp(); hideToast();
  }
  // The ambient story replays real data only: every live request's hop chain, interleaved with Mycelium's matches.
  let STORY: ({ q: WfQuery } | { m: WfMatch })[] = [];
  const makeStory = () => {
    STORY = [];
    const qs = WF.allQueries.length ? WF.allQueries : WF.queries;
    const n = Math.max(qs.length, WF.matches.length);
    for (let i = 0; i < n; i++) { if (qs[i]) STORY.push({ q: qs[i] }); if (WF.matches[i]) STORY.push({ m: WF.matches[i] }); }
  };
  makeStory();
  let storyIx = 0, lastStory = 0;
  function story() { if (!STORY.length) return; const s = STORY[storyIx++ % STORY.length]; if ("q" in s) void playQuery(s.q); else void playMatch(s.m); }

  /* ============ Panel controls ============ */
  const offTheme = onTheme(() => { if (G) recolor(); });

  /* ============ Loop ============ */
  const clock = new THREE.Clock();
  let raf = 0;
  function frame() {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta());
    if (!S.paused) S.time += dt; U.uTime.value = S.time;
    const now = performance.now();
    if (S.auto && !S.focus && !S.building && now - lastStory > 8000) { lastStory = now; story(); }
    const breathe = 1 + Math.sin(S.time * 1.2) * 0.03; heart.scale.setScalar(breathe); shell.rotation.y += dt * 0.2;
    controls.update(); composer.render(); labelRenderer.render(scene, camera);
  }
  const onResize = () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
    labelRenderer.setSize(innerWidth, innerHeight); bloom.resolution.set(innerWidth, innerHeight); U.uRes.value.set(innerWidth * DPR, innerHeight * DPR); fitView();
  };
  addEventListener("resize", onResize);

  paintLegend();
  fitView(); later(fitView, 600); // again once the title card has collapsed
  build();
  lastStory = performance.now() - 5500;
  const deep = new URLSearchParams(location.search).get("focus"); // deep link: /roots?focus=dept_it
  if (deep && dept(deep)) later(() => focusDept(deep), RM ? 0 : 600);
  frame();

  let key = orgKey(WF);
  return {
    playQuery(id) {
      const q = WF.allQueries.find((x) => x.id === id) ?? WF.queries.find((x) => x.id === id);
      if (!q || !G || S.building) return;
      lastStory = performance.now(); void playQuery(q);
    },
    update(next) {
      WF = next; makeStory();
      const k = orgKey(next);
      if (k !== key) { key = k; void rebuild(); } // org or routing changed: fade and rebuild
    },
    cleanup() {
      disposed = true; S.run++;
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout); timers.clear();
      offTheme();
      removeEventListener("resize", onResize); removeEventListener("keydown", onKey);
      $("back").removeEventListener("click", onBack);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerup", onUp);
      gsap.killTweensOf([camera.position, controls.target, U.uDimT]);
      hideToast();
      routes.splice(0).forEach((r) => r.mat.dispose());
      removeLabels(); labelRenderer.domElement.remove();
      controls.dispose();
      const geos = new Set<THREE.BufferGeometry>(), mats = new Set<THREE.Material>();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) geos.add(m.geometry);
        if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => mats.add(x));
      });
      geos.add(dotGeo);
      geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose());
      envTex.dispose(); pmrem.dispose(); room.dispose();
      bloom.dispose(); composer.dispose();
      renderer.dispose(); renderer.forceContextLoss();
      G = null;
    },
  };
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
