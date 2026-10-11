"use client";
// Darwin's easter egg, bottom left: a Frutiger Aero aquarium lamp. The base is a water ring toss
// (hold a jet to push the 10 rings up; a ring that falls straight onto a peg stays there), the
// power switch dims the lamp and stops the water, and the shell on the sand opens Shel.

import { useEffect, useRef, useState } from "react";
import { toast } from "@/lib/aero/runtime";
import { play } from "./sfx";
import ShelGame from "./ShelGame";
import { EGG_STYLE } from "./style";

const TW = 250, TH = 144, FLOOR = TH - 10, TIP = 58, PEGS = [74, 176], HILL = { rx: 36, ry: 22 };
const COLORS = ["#FF5C93", "#FFD23F", "#35C3F0", "#6FD86B", "#FF8A5B", "#B28CFF", "#FF5C93", "#FFD23F", "#35C3F0", "#6FD86B"];
const STEP = 1000 / 60;

type Ring = { x: number; y: number; vx: number; vy: number; rot: number; vr: number; tumble: number; peg: number; slot: number; home: boolean };

// The sand, with a mound under each peg
function ground(x: number) {
  let y = FLOOR;
  for (const px of PEGS) { const d = (x - px) / HILL.rx; if (Math.abs(d) < 1) y = Math.min(y, FLOOR - HILL.ry * Math.sqrt(1 - d * d)); }
  return y;
}
const hillTop = FLOOR - HILL.ry;

function scatter(): Ring[] {
  return COLORS.map((_, i) => {
    const x = 14 + ((i * 97 + Math.random() * 30) % (TW - 28));
    return { x, y: ground(x) - 3, vx: 0, vy: 0, rot: Math.random() * 6, vr: 0, tumble: 0, peg: -1, slot: 0, home: false };
  });
}

const Fish = {
  zebra: <svg width="30" height="12" viewBox="0 0 30 12"><path d="M2 6 Q8 1 16 2.6 Q21 3.4 23 5 L29 1 L27.5 6 L29 11 L23 7 Q21 8.6 16 9.4 Q8 11 2 6Z" fill="#F4E9B8" /><path d="M5 5 H22 M6 7.3 H21" stroke="#3A63C8" strokeWidth="1.1" /><circle cx="5.4" cy="5.2" r="1" fill="#13294A" /></svg>,
  clown: <svg width="28" height="16" viewBox="0 0 28 16"><path d="M22 8 L28 3 L27 8 L28 13Z" fill="#FF7A1A" stroke="#222" strokeWidth=".6" /><path d="M9 2.2 Q13 -1 17 2.4" fill="#FF7A1A" stroke="#222" strokeWidth=".6" /><ellipse cx="12" cy="8" rx="11" ry="6.5" fill="#FF7A1A" stroke="#222" strokeWidth=".6" /><g stroke="#fff" fill="none"><path d="M6 2.8 Q4.8 8 6 13.2" strokeWidth="2.4" /><path d="M13 1.8 Q11.6 8 13 14.2" strokeWidth="2.4" /><path d="M19.4 3.6 Q18.6 8 19.4 12.4" strokeWidth="1.8" /></g><circle cx="3.6" cy="6.6" r="1.1" fill="#13294A" /></svg>,
  butter: <svg width="26" height="22" viewBox="0 0 26 22"><path d="M20 11 L26 7 L25.5 11 L26 15Z" fill="#FFD23F" /><path d="M2 11 Q4 3 12 2 Q20 2 21 11 Q20 20 12 20 Q4 19 2 11Z" fill="#FFD23F" /><path d="M6.5 3.6 Q5 11 6.5 18.6" stroke="#222" strokeWidth="2.2" fill="none" /><path d="M9 3 Q7.6 11 9 19" stroke="#fff" strokeWidth="1.6" fill="none" /><circle cx="5.9" cy="9.6" r="1" fill="#fff" /><circle cx="17.5" cy="13" r="1.5" fill="#222" /></svg>,
};
const SCHOOL = [
  { f: Fish.zebra, top: 26, dur: 17, delay: -3, rev: false },
  { f: Fish.clown, top: 64, dur: 23, delay: -14, rev: true },
  { f: Fish.butter, top: 40, dur: 29, delay: -8, rev: false },
  { f: Fish.zebra, top: 86, dur: 21, delay: -18, rev: true },
];
const IDLE_BUBBLES = [[22, 3.6, 0], [60, 4.4, -1.2], [128, 5.1, -2.6], [206, 3.9, -0.6], [236, 4.8, -3.1], [96, 4.2, -2]];

export default function Aquarium() {
  const [on, setOn] = useState(true);
  const [landed, setLanded] = useState(0);
  const [won, setWon] = useState(false);
  const [held, setHeld] = useState<[boolean, boolean]>([false, false]);
  const [shel, setShel] = useState(false);
  const tank = useRef<HTMLDivElement>(null);
  const els = useRef<(HTMLElement | null)[]>([]);
  const S = useRef({ on: true, pump: [false, false], rings: [] as Ring[], frame: 0, landed: 0, won: false });

  useEffect(() => { S.current.on = on; }, [on]);
  useEffect(() => {
    document.body.classList.add("aq-on");
    return () => document.body.classList.remove("aq-on");
  }, []);

  // Ring toss physics: fixed 60 Hz steps, written straight to the ring transforms
  useEffect(() => {
    const s = S.current;
    s.rings = scatter();
    let raf = 0, last = performance.now(), acc = 0;

    const bubble = (side: number) => {
      const t = tank.current; if (!t) return;
      const b = document.createElement("i");
      b.className = "bub jet";
      const x = side ? TW - 18 - Math.random() * 10 : 10 + Math.random() * 10;
      Object.assign(b.style, { left: `${x}px`, top: `${FLOOR - 4}px`, ["--s" as string]: `${4 + Math.random() * 5}px`, ["--dx" as string]: `${(side ? -1 : 1) * (10 + Math.random() * 40)}px` });
      b.addEventListener("animationend", () => b.remove());
      t.appendChild(b);
    };
    const jet = (side: number) => {
      const nx = side ? TW - 16 : 16;
      for (const r of s.rings) {
        if (r.peg >= 0) continue;
        const d = Math.hypot(r.x - nx, (r.y - TH) * 0.8), k = Math.max(0, 1 - d / 190) * (0.8 + Math.random() * 0.6);
        r.vy -= k * 1.25;
        r.vx += (side ? -1 : 1) * k * (0.25 + Math.random() * 0.8) + (Math.random() - 0.5) * 0.5;
        r.vr += (Math.random() - 0.5) * 0.25;
      }
      bubble(side);
    };

    const step = () => {
      s.frame++;
      if (!s.on) return;
      s.pump.forEach((p, side) => { if (!p) return; if (s.frame % 5 === 0) jet(side); if (s.frame % 20 === 0) play("pump"); });
      let count = 0;
      for (const r of s.rings) {
        if (r.peg >= 0) {
          // threaded: slide down the peg onto the stack
          const target = hillTop - 3 - r.slot * 4.6;
          r.x += (PEGS[r.peg] - r.x) * 0.3;
          if (r.y < target) r.y = Math.min(target, r.y + 1.3);
          else if (!r.home) { r.home = true; play("ring"); }
          r.rot *= 0.85; r.tumble *= 0.85;
          if (r.home) count++;
          continue;
        }
        const py = r.y;
        r.vy = Math.max(-4, r.vy + 0.05); r.vx *= 0.985; r.vy *= 0.985; r.vr *= 0.97;
        r.x += r.vx; r.y += r.vy; r.rot += r.vr; r.tumble += Math.abs(r.vy) * 0.08 + Math.abs(r.vr) * 0.5;
        if (r.y < 9) { r.y = 9; r.vy = Math.abs(r.vy) * 0.3; }
        if (r.x < 9) { r.x = 9; r.vx = Math.abs(r.vx) * 0.5; }
        if (r.x > TW - 9) { r.x = TW - 9; r.vx = -Math.abs(r.vx) * 0.5; }
        let caught = false;
        PEGS.forEach((px, i) => {
          if (caught) return;
          const dx = r.x - px;
          if (r.vy > 0 && py < TIP && r.y >= TIP && Math.abs(dx) < 5.5) {
            r.peg = i; r.slot = s.rings.filter((o) => o.peg === i && o !== r).length; r.vx = r.vy = r.vr = 0; caught = true; return;
          }
          if (r.y >= TIP && r.y < hillTop && Math.abs(dx) < 9.5) { r.x = px + Math.sign(dx || 1) * 9.5; r.vx = Math.sign(dx || 1) * Math.abs(r.vx) * 0.5; }
        });
        if (caught) continue;
        const g = ground(r.x) - 3;
        if (r.y >= g) {
          r.y = g; r.vy = 0;
          const slope = (ground(r.x + 1) - ground(r.x - 1)) / 2;
          r.vx = (r.vx + slope * 0.12) * 0.86; r.vr *= 0.6; r.tumble *= 0.8;
        }
      }
      if (count !== s.landed) {
        s.landed = count; setLanded(count);
        if (count === COLORS.length && !s.won) {
          s.won = true; setWon(true); play("win");
          toast("evo", "Ring master", "10 of 10 on the pegs", "Even Darwin couldn't evolve a better throw.");
        }
      }
    };

    const draw = () => {
      s.rings.forEach((r, i) => {
        const el = els.current[i]; if (!el) return;
        const flat = r.peg >= 0 || r.y >= ground(r.x) - 3.5;
        const sy = flat ? 0.34 : 0.34 + 0.66 * Math.abs(Math.cos(r.tumble));
        el.style.transform = `translate(${r.x.toFixed(1)}px,${r.y.toFixed(1)}px) rotate(${flat ? 0 : r.rot.toFixed(2)}rad) scaleY(${sy.toFixed(2)})`;
      });
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      acc += Math.min(100, now - last); last = now;
      while (acc >= STEP) { step(); acc -= STEP; }
      draw();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const pump = (side: number, down: boolean) => {
    if (down && !S.current.on) return;
    S.current.pump[side] = down;
    setHeld((h) => { const n: [boolean, boolean] = [...h]; n[side] = down; return n; });
  };
  const jetProps = (side: number) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); pump(side, true); },
    onPointerUp: () => pump(side, false),
    onPointerCancel: () => pump(side, false),
    onKeyDown: (e: React.KeyboardEvent) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); pump(side, true); } },
    onKeyUp: (e: React.KeyboardEvent) => { if (e.key === " " || e.key === "Enter") pump(side, false); },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });
  const reset = () => {
    const s = S.current;
    s.rings = scatter().map((r) => ({ ...r, y: 20 + Math.random() * 40, vy: 0.5 })); // shaken: everything drifts back down
    s.landed = 0; s.won = false; setLanded(0); setWon(false); play("pump");
  };
  const dash = (e: React.MouseEvent<HTMLElement>) => {
    const f = e.currentTarget;
    f.classList.remove("dash"); void f.offsetWidth; f.classList.add("dash"); play("click");
  };
  const JET = <svg viewBox="0 0 14 14" fill="#fff"><path d="M7 1.5c2.4 3 3.8 5 3.8 6.8A3.8 3.8 0 0 1 3.2 8.3C3.2 6.5 4.6 4.5 7 1.5z" /></svg>;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: EGG_STYLE }} />
      <div className={`aq${on ? "" : " off"}`} aria-label="Aquarium lamp with a water ring toss">
        <div className="lid" />
        <div ref={tank} className={`tank${won ? " won" : ""}`}>
          <div className="layer far" /><div className="layer mid" />
          {SCHOOL.map((s, i) => (
            <div key={i} className={`fish${s.rev ? " rev" : ""}`} style={{ top: s.top, animationDuration: `${s.dur}s`, animationDelay: `${s.delay}s` }} onClick={dash} aria-hidden="true">
              <span style={{ animationDelay: `${-i * 0.7}s` }}>{s.f}</span>
            </div>
          ))}
          <div className="layer near" />
          <div className="sand" />
          <svg className="toy" width={TW} height={TH} viewBox={`0 0 ${TW} ${TH}`} aria-hidden="true">
            <defs>
              <linearGradient id="aqHill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFF1C8" /><stop offset="1" stopColor="#E3C27E" /></linearGradient>
              <linearGradient id="aqPeg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff" /><stop offset=".5" stopColor="#CFF3FF" /><stop offset="1" stopColor="#7FCBE6" /></linearGradient>
            </defs>
            {PEGS.map((px) => (
              <g key={px}>
                <ellipse cx={px} cy={FLOOR} rx={HILL.rx} ry={HILL.ry} fill="url(#aqHill)" />
                <rect x={px - 2} y={TIP} width="4" height={hillTop - TIP + 2} rx="2" fill="url(#aqPeg)" stroke="rgb(255 255 255/.8)" strokeWidth=".6" />
                <circle cx={px} cy={TIP} r="3" fill="#fff" />
              </g>
            ))}
          </svg>
          {IDLE_BUBBLES.map(([x, d, delay], i) => (
            <i key={i} className="bub" style={{ left: x, top: TH, ["--d" as string]: `${d}s`, ["--s" as string]: `${4 + (i % 3) * 2}px`, animationDelay: `${delay}s` }} />
          ))}
          {COLORS.map((c, i) => <i key={i} ref={(el) => { els.current[i] = el; }} className="ring" style={{ ["--c" as string]: c }} />)}
          <button className="shell" title="Shel?" aria-label="A seashell. Open Shel in Frutiger Aero" onClick={() => { play("heal"); setShel(true); }}>
            <svg viewBox="0 0 24 20" width="24" height="20"><path d="M12 19 L2.5 9 A10 9 0 0 1 21.5 9Z" fill="#FF9EC4" /><g stroke="#E0508A" strokeWidth="1" fill="none"><path d="M12 19 L5 6 M12 19 L8.5 3.3 M12 19 L12 2.6 M12 19 L15.5 3.3 M12 19 L19 6" /></g><path d="M9 17.5h6l-3 2z" fill="#FFD1E3" /></svg>
          </button>
          <div className="glass" />
        </div>
        <div className="base">
          <button className={`jet${held[0] ? " held" : ""}`} aria-label="Left water jet (hold)" disabled={!on} {...jetProps(0)}>{JET}</button>
          <div className="label">
            <b>AQUA TOSS</b>
            <span>{landed}/10 on pegs<button className="rs" aria-label="Shake the rings off" title="Shake" onClick={reset}>↺</button></span>
          </div>
          <button className="pwr" aria-label={on ? "Turn the lamp off" : "Turn the lamp on"} aria-pressed={on} onClick={() => { setOn(!on); play("click"); if (on) S.current.pump = [false, false]; }}>
            <svg viewBox="0 0 14 14" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"><path d="M7 1.8v5" /><path d="M4.1 3.9a4.4 4.4 0 1 0 5.8 0" /></svg>
          </button>
          <button className={`jet${held[1] ? " held" : ""}`} aria-label="Right water jet (hold)" disabled={!on} {...jetProps(1)}>{JET}</button>
        </div>
      </div>
      {shel && <ShelGame onClose={() => setShel(false)} />}
    </>
  );
}
