"use client";
// Bottom dock: the v6 candy-square navigation, as Next links.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { PAGES, wireCandy, type PageId } from "@/lib/aero/runtime";

// White line icons for the candy squares; .p1 bobs on hover (v6 aero.js ICONS).
const ICONS: Record<PageId, string> = {
  home: `<g class="icon__part p1" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21v-7"/><circle cx="12" cy="9" r="5.5"/><path d="M8 20h8"/></g>`,
  roots: `<g class="icon__part p1" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="5" r="2.4" fill="#fff"/><path d="M12 7.5v4M12 11.5 6 17M12 11.5l6 5.5M12 11.5V19"/><circle cx="6" cy="18" r="1.8"/><circle cx="18" cy="18" r="1.8"/><circle cx="12" cy="20" r="1.4"/></g>`,
  currents: `<g class="icon__part p1" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="4.5" cy="12" r="2"/><circle cx="12" cy="7" r="2"/><circle cx="19.5" cy="12" r="2"/><path d="M6.3 11 10.2 8M13.8 8l3.9 3"/></g>`,
  insights: `<g class="icon__part p1" fill="#fff"><rect x="4" y="12" width="3.4" height="8" rx="1.2"/><rect x="10.3" y="7" width="3.4" height="13" rx="1.2"/><rect x="16.6" y="3.5" width="3.4" height="16.5" rx="1.2"/></g>`,
  lagoon: `<g class="icon__part p1" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M5 11a7 6 0 0 1 14 0z" fill="#fff" fill-opacity=".9"/><path d="M8 11c0 3-1 5 0 8M12 11v9M16 11c0 3 1 5 0 8"/></g>`,
  darwin: `<g class="icon__part p1" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V11M12 14 7 9M12 12l5-5"/><circle cx="6.5" cy="8.5" r="2" fill="#fff"/><circle cx="17.5" cy="6.5" r="2" fill="#fff"/><circle cx="12" cy="9" r="1.6" fill="#fff"/></g>`,
};

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
    <nav id="dock" ref={ref} aria-label="Wayfinder pages" data-tour="90|Pages|Jump between the six views of Wayfinder from this dock.">
      {PAGES.map((p) => (
        <Link key={p.id} className="ctl" href={p.href} aria-current={p.id === page ? "page" : undefined}>
          <span className={`sq ${p.sq}`}>
            <svg className="i-bob" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[p.id] }} />
          </span>
          <span className="lb">{p.label}</span>
        </Link>
      ))}
    </nav>
  );
}
