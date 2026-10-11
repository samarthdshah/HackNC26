"use client";
// Top-right hamburger (logo orb): drops down into Tour, Details and the three themes.

import { useEffect, useRef, useState } from "react";
import { PALETTES, card, getTheme, onTheme, tour } from "@/lib/aero/runtime";

const TOUR = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M9 9a3 3 0 1 1 4.2 2.75c-.8.4-1.2 1-1.2 1.9V15"/><circle cx="12" cy="18.6" r=".6" fill="#fff"/></svg>';
const CARD = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><rect x="4" y="5" width="16" height="14" rx="3"/><path d="M4 9.5h16M8 13h8M8 16h5"/></svg>';

export default function Menu() {
  const [open, setOpen] = useState(false);
  const [theme, setThemeState] = useState(0);
  const ref = useRef<HTMLElement>(null);

  // The toast stack slides left while the menu is open (v7: body.menu-open).
  useEffect(() => {
    document.body.classList.toggle("menu-open", open);
    return () => document.body.classList.remove("menu-open");
  }, [open]);

  useEffect(() => {
    setThemeState(getTheme());
    const off = onTheme((i) => setThemeState(i));
    const outside = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("click", outside);
    document.addEventListener("keydown", esc);
    return () => { off(); document.removeEventListener("click", outside); document.removeEventListener("keydown", esc); };
  }, []);

  // Theme buttons are switched by the runtime's document listener (data-theme).
  const items = [
    <><button className="round-button blue" aria-label="Tour this page" onClick={() => { setOpen(false); tour(); }} dangerouslySetInnerHTML={{ __html: TOUR }} /><span className="tip">Tour this page</span></>,
    <><button className="round-button purple" aria-label="Show or hide details" onClick={() => card()} dangerouslySetInnerHTML={{ __html: CARD }} /><span className="tip">Details</span></>,
    ...PALETTES.map((p, i) => (
      <><button className={`theme-button t${i}${i === theme ? " active" : ""}`} data-theme={i} aria-label={p.name} /><span className="tip">{p.name}</span></>
    )),
  ];

  return (
    <nav id="menu" ref={ref} className={open ? "active" : undefined} aria-label="Page menu"
      data-tour="91|Menu|Replay this tour, show the card details, or switch the glass colour theme.">
      <button className="toggle" aria-expanded={open} aria-label={open ? "Close menu" : "Open menu"}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        <span className="lg" /><span className="bars"><i /><i /></span>
      </button>
      <ul>
        {items.map((h, i) => <li key={i} style={{ ["--i" as string]: i }}>{h}</li>)}
      </ul>
    </nav>
  );
}
