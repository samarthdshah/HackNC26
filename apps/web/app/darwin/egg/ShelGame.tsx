"use client";
// The window "Shel in Frutiger Aero" plays in. The engine (./shel) loads only when the shell is found.

import { useEffect, useRef, useState } from "react";
import type { ShelApi, ShelKey } from "./shel";
import { isMuted, setMuted } from "./sfx";

export default function ShelGame({ onClose }: { onClose: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const api = useRef<ShelApi | null>(null);
  const [muted, setMute] = useState(isMuted());
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    let alive = true;
    void import("./shel").then(({ startShel }) => {
      if (!alive || !cv.current) return;
      api.current = startShel(cv.current);
      cv.current.focus();
    });
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close.current(); };
    const hide = () => api.current?.setPaused(document.hidden);
    addEventListener("keydown", esc);
    document.addEventListener("visibilitychange", hide);
    return () => {
      alive = false;
      api.current?.destroy(); api.current = null;
      removeEventListener("keydown", esc);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);

  const hold = (k: ShelKey) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); api.current?.press(k, true); },
    onPointerUp: () => api.current?.press(k, false),
    onPointerCancel: () => api.current?.press(k, false),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  return (
    <div className="shel-veil" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="milk shel-win" role="dialog" aria-modal="true" aria-label="Shel in Frutiger Aero">
        <div className="bar"><span className="logo-orb"></span>Shel in Frutiger Aero<span className="hint">you found the shell 🐚</span>
          <button className="x" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="body">
          <canvas ref={cv} className="shel-cv" tabIndex={-1} aria-label="Shel, an 8-bit platformer. Arrow keys move, Space jumps, press twice to double jump." />
          <div className="pad">
            <button aria-label="Left" {...hold("left")}>◀</button>
            <button aria-label="Right" {...hold("right")}>▶</button>
            <button className="mute" onClick={() => { setMuted(!muted); setMute(!muted); }}>{muted ? "🔇 sound off" : "🔊 sound on"}</button>
            <button className="jump" aria-label="Jump" {...hold("jump")}>⤒</button>
          </div>
          <p className="keys">← → or A D to move · Space, ↑ or W to jump (twice for a double jump) · bump a kitty block for a healing shell · stomp ghosts · R restarts · P pauses · Esc closes</p>
        </div>
      </section>
    </div>
  );
}
