import type { Metadata } from "next";
import Dock from "@/components/aero/Dock";
import Menu from "@/components/aero/Menu";
import { LiveBridge } from "@/lib/wf/live";
import { WFProvider } from "@/lib/wf/store";
import { THEME_BOOT } from "@/lib/aero/runtime";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wayfinder",
  description: "Discover. Connect. Coordinate. Evolve.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="0" suppressHydrationWarning>
      <head>
        {/* Set the saved theme before paint so there is no flash of Aqua Sky. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="aero-page has-dock" suppressHydrationWarning>
        <WFProvider>
          <LiveBridge />
          {children}
          <Dock />
          <Menu />
        </WFProvider>
      </body>
    </html>
  );
}
