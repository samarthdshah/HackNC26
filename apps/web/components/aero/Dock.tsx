"use client";
// Bottom dock: the v7 Windows 7 glass-icon navigation, as Next links.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { PAGES, wireCandy, type PageId } from "@/lib/aero/runtime";

// Simple white glyphs (24-unit box, currentColor) for the Win7 glass dock icons; .p1 bobs on hover (v7 aero.js).
const ICONS: Record<PageId, string> = {
  home: `<g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 11.5 12 4l8.5 7.5"/><path d="M6.5 9.8V20h11V9.8"/><path d="M10.2 20v-5.2h3.6V20"/></g>`,
  roots: `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="5" r="2.4" fill="currentColor"/><path d="M12 7.5v4M12 11.5 6 17M12 11.5l6 5.5M12 11.5V19"/><circle cx="6" cy="18" r="1.8"/><circle cx="18" cy="18" r="1.8"/><circle cx="12" cy="20" r="1.4"/></g>`,
  currents: `<g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="4.5" cy="12" r="2.2"/><circle cx="12" cy="7" r="2.2"/><circle cx="19.5" cy="12" r="2.2"/><path d="M6.3 11 10.2 8M13.8 8l3.9 3"/><path d="M4 18.5c2.7-2 5.3-2 8 0s5.3 2 8 0"/></g>`,
  insights: `<g fill="currentColor"><rect x="4" y="12" width="3.6" height="8" rx="1.2"/><rect x="10.2" y="7" width="3.6" height="13" rx="1.2"/><rect x="16.4" y="3.5" width="3.6" height="16.5" rx="1.2"/></g>`,
  lagoon: `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 11a7 6 0 0 1 14 0z" fill="currentColor"/><path d="M8 11c0 3-1 5 0 8M12 11v9M16 11c0 3 1 5 0 8"/></g>`,
  darwin: `<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V11M12 14 7 9M12 12l5-5"/><circle cx="6.5" cy="8.5" r="2" fill="currentColor"/><circle cx="17.5" cy="6.5" r="2" fill="currentColor"/><circle cx="12" cy="9" r="1.6" fill="currentColor"/></g>`,
};

// Hue and saturation per page (the old candy colours).
const GLASS: Record<PageId, [number, number]> = { home: [119, 51], roots: [184, 72], currents: [210, 80], insights: [37, 96], lagoon: [326, 70], darwin: [262, 55] };

/** Windows 7 glass icon: rounded tinted base, inner highlight, white glyph with a soft shadow, gloss on the top half. */
function glassIcon(id: PageId) {
  const [h, s] = GLASS[id], c = (l: number) => `hsl(${h} ${s}% ${l}%)`;
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

export function activePage(path: string): PageId {
  const hit = PAGES.find((p) => p.href !== "/" && path.startsWith(p.href));
  return hit?.id ?? "home";
}

export default function Dock() {
  const path = usePathname() ?? "/";
  const ref = useRef<HTMLElement>(null);
  const page = activePage(path);
  useEffect(() => { if (ref.current) wireCandy(ref.current); }, []);
  return (
    <nav id="dock" ref={ref} aria-label="AVATAR pages" data-tour="90|Pages|Jump between the six views of AVATAR from this dock.">
      {PAGES.map((p) => (
        <Link key={p.id} className="ctl" href={p.href} aria-current={p.id === page ? "page" : undefined}>
          <span className="sq glass">
            <svg className="i-bob" viewBox="0 0 40 40" aria-hidden="true" dangerouslySetInnerHTML={{ __html: glassIcon(p.id) }} />
          </span>
          <span className="lb">{p.label}</span>
        </Link>
      ))}
    </nav>
  );
}
