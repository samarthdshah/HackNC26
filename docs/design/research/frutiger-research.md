# Wayfinder v2: Frutiger Aero / "modern retro" design research

Research for the v2 redesign of the Wayfinder big-screen site (Mycelium, Flows, Insights). Written 2026-10-10 against the v1 design doc (`docs/design/v1-design-doc.html`) and its screenshots in `docs/design/img/`.

How to read the tags in this doc:
- **[verified]**: I opened the primary source, or ran the code or check myself.
- **[derived]**: my own calculation from a cited source. The math is shown.
- **[unverified]**: from search snippets or secondary sources only. Check before relying on it.
- **[proposal]**: my recommendation. It isn't a claim about any source.

---

## Executive summary

1. **v1 got Aero backwards.** Real Vista/7 used glass only for the *frame*: title bars, the taskbar, Alt+Tab. Content sat on opaque white. v1 made every content card translucent and pushed text onto it. Microsoft's own guideline says to use glass "in small regions... without text" and never "where a plain window background would be more attractive or easier to use" ([Window Frames](https://learn.microsoft.com/en-us/windows/win32/uxguide/win-window-frames)). For v2: **glass chrome, opaque content.**
2. **Make it one stage, not three tabs.** The graph is the full-bleed backdrop and always on screen. One Aero "window" holds the current goal, and one hero number holds the payoff. Tabs become automatic *scenes* (Live, Replay, Receipt) of that same stage. This follows Few's "single screen... monitored at a glance" ([Few 2006](https://www.perceptualedge.com/articles/Whitepapers/Common_Pitfalls.pdf)) and the calm-center/periphery split ([Weiser & Brown](https://calmtech.com/papers/designing-calm-technology)).
3. **Mycelium becomes a semantic-zoom graph with three levels.** Zoomed out, departments are glossy orbs with aggregated links. In the middle, people appear clustered inside soft department "islands". Zoomed in, you get names, roles and the live message. Layout is a seeded, frozen force layout clustered by department, not a 4×3 grid. In React Flow, each level is a `useStore(s => lod(s.transform[2]))` bucket [verified API].
4. **Draw a flow as a route on the graph, not as text cards.** The route lights up as numbered stops on Mycelium. A docked "delivery tracker" strip below shows the steps, and only the *current* step expands into an iMessage bubble. Swimlanes and nested cards don't survive a projector.
5. **Design type for the back row.** AVIXA's basic-decision-making acuity factor of 200 means a character must be at least 1/200 of the viewing distance. That works out to a **24–28 px minimum** at 1440 px wide and **32 px for primary labels** at 1920 px [derived]. Nothing essential goes below 24 px. The hero number runs 132–160 px.
6. **Fonts:** **Selawik**, Microsoft's OFL-licensed open replacement for Segoe UI, in Light, Semilight, Regular, Semibold and Bold. Prebuilt files are on jsDelivr via `winstrap@0.5.12` [verified]. **Open Sans** is the Google Fonts fallback (same designer as Segoe, Steve Matteson) [verified].
7. **Color does jobs; it isn't decoration.** The stage is a deep-blue aurora (`#0B3A66` to `#0E5E78`). Edge kinds are learned `#10A592`, delegate `#9070F0` and suggested `#DD6A2E`, which pass an all-pairs color-vision check on the stage [verified with a validator]. The active route is a white core with a cyan `#7FE3FF` glow. Org-chart lines are a recessive hairline. Goal-type colors always come with an icon and a label.
8. **Icons:** Fluent UI System Icons (MIT). Use the `Color` gradient variants (about 200 icons) for the glossy Aero feel, bundled with `Filled` fallbacks for forced-colors mode as Microsoft recommends [verified]. No emoji anywhere.
9. **Motion rules come from research.** Transitions last about 1 s with slow-in/slow-out ([Heer & Robertson 2007](https://idl.cs.washington.edu/files/2007-AnimatedTransitions-InfoVis.pdf)). Complex changes are staged one at a time. The camera uses the van Wijk–Nuij "smooth" zoom-pan, which React Flow v12 exposes as `interpolate: 'smooth'` [verified in installed types]. Pulses stay ≤1 Hz and never go past 3 flashes/s (WCAG 2.3.1).
10. **The cheap look comes from specific things:** glass under body text, gloss on everything, decorative bubbles, rainbow category colors, tiny bold labels, emoji, hairline-thin light text on mid-blue, and heavy frosted blur. Real Aero glass used *light* blur plus streaks. The heavy frost is a 2020s glassmorphism habit, not Aero ([archive blog](https://frutigeraeroarchive.org/blog/posts/20_09_2025)).

---

## Track A: Aero then and now

### A1. What Windows Vista/7 Aero actually was (Microsoft's own guidelines)

The Windows 7 UX Guidelines are still on Microsoft Learn. Each page says it "was created for Windows 7 and has not been updated." They are the primary source, and they're more specific than the "glass + gloss" folklore. [verified]

**The name and intent.** "Aero stands for: authentic, energetic, reflective, and open. Aero aims to establish a design that is both professional and beautiful" ([Icons guideline](https://learn.microsoft.com/en-us/windows/win32/uxguide/vis-icons)). The key word is *professional*. The style was never meant to be toy-like. Windows XP's Luna had been mocked as "Fisher-Price" ([archive history](https://frutigeraeroarchive.org/history)), and Aero was a step away from that.

**Glass is for the frame, not the content.** ([Window Frames](https://learn.microsoft.com/en-gb/windows/win32/uxguide/win-window-frames))
- Glass frames should be "attractive and lightweight... helping users focus on content and functionality rather than the interface surrounding it."
- "Consider using glass strategically in small regions touching the window frame **without text**."
- "Don't use glass in situations where a plain window background would be more attractive or easier to use."
- Their correct example is Alt+Tab: glass works "because it consists of graphics and a single, strong text label". Their incorrect example is a glass window holding twelve graphics.

Looking at real screenshots confirms this (Windows 7 Explorer, the Vista Welcome Center and the Vista website, in the [archive's examples](https://frutigeraeroarchive.org/)). The glass is a thin frame, about 8 px of tinted blur with a bright 1 px inner edge. Everything you actually read sits on **opaque white**. The Vista website used one aurora gradient banner, white content panes, thin Segoe-style headlines, and gloss only on small controls.

**Type.** ([Fonts guideline](https://learn.microsoft.com/en-us/windows/win32/uxguide/vis-fonts))
- Segoe UI is a humanist sans with "varying widths of its capitals... and its true italic," designed with "no strong character or distracting quirkiness."
- Default sizes: 9 pt body `#000000`. Main instruction **12 pt `#003399`**. Group header 11 pt `#003399`. Link `#0066CC`, hover `#3399FF`. Disabled text `#323232`.
- "If you want to make sure users read your text, use dark text on a light background." Light-on-dark is meant "for secondary UI surfaces... that you want to de-emphasize."
- "Consider a maximum line length of 65 characters."
- Bold is used "sparingly... Using too much bold lessens its impact." Bold italic: "Don't use."
- Aero raised the default UI size from 8 pt to 9 pt "to improve readability" ([Wikipedia: Windows Aero](https://en.wikipedia.org/wiki/Windows_Aero)).

**Color.** ([Color guideline](https://learn.microsoft.com/en-us/windows/win32/uxguide/vis-color))
- "Never use color as a primary method of communication."
- Design in monochrome first, then add color.
- Meanings: blue/green = Windows brand. Glass, black, gray and white = neutral chrome. Blue = "start, commit" and main instructions. Red = error. Yellow = warning. Green = "go, proceed, progress, safe".
- Colors carry those warning meanings only when they're fully saturated at mid luminosity. To avoid implying status, "choose colors [with] mid to low saturation and high or low luminosity."
- For data, pick hues far apart: "prefer triad harmonies or complementary hues, but not adjacent hues."
- "Poor use of color results in designs that look unprofessional, dated, confusing, or just plain ugly."

**Icons.** ([Icons guideline](https://learn.microsoft.com/en-us/windows/win32/uxguide/vis-icons))
- "More realistic than illustrative, but not quite photorealistic."
- Light comes from "above, slightly in front of, and slightly to the left." Light rays are parallel, "like the sun," so every icon is lit the same way.
- Shadows run 30–50% opacity, with no shadows at 24×24 or smaller.
- "Colors are generally less saturated than they were [in] Windows XP. Use gradients."
- Toolbar icons are always flat and front-facing. Perspective is only for big icons.
- "Use no more than three objects in an icon (two is preferred)."
- These rules are why emoji look wrong next to Aero chrome: emoji follow none of them.

**Notifications were deliberately calm.** Aero notifications "fade in and out" and are queued while something full-screen is showing ([Wikipedia: Windows Aero](https://en.wikipedia.org/wiki/Windows_Aero)). That's useful precedent for a live ticker.

### A2. Frutiger Aero, the broader aesthetic

- **Term and dates.** The term was coined retroactively by Sofi Xian (Consumer Aesthetics Research Institute) for the corporate tech look of roughly 2005–2013 ([CARI](https://cari.institute/aesthetics/frutiger-aero), [Wikipedia](https://en.wikipedia.org/wiki/Frutiger_Aero)). Wikipedia puts the naming in 2018; the archive says 2017.
- **Motifs (CARI).** Skeuomorphism, gloss, "Frutiger/humanist sans-serif typefaces", "tertiary color palettes", glassy materials, aurora borealis, bokeh, macro grass.
- **Motifs (Frutiger Aero Archive).** Bright colors, gloss, glass, aurora, bubbles, bokeh, macro grass, "futurism, and humanism." Its examples: Vista, 7, the Wii and Wii U, PS3, Xbox 360 "Blades", Mac OS X Leopard, Asian stock photography ([frutigeraeroarchive.org](https://frutigeraeroarchive.org/)).
- **The name.** It comes from Adrian Frutiger's typeface, which inspired Segoe UI, Myriad and similar humanist fonts ([archive history](https://frutigeraeroarchive.org/history)). Frutiger was "intended to be clear and highly legible at a distance" ([Wikipedia: Frutiger](https://en.wikipedia.org/wiki/Frutiger_(typeface))). It came from airport signage, which is a happy fit for a projector.
- **Windows Aero is not the same thing as Frutiger Aero.** The NameThatUI brief separates them ([namethatui](https://namethatui.com/styles/windows-aero)). Windows Aero is the OS chrome: blurred tinted frame, "specular sweeps," glowing controls, luminous gradients. Frutiger Aero adds the eco-tech mood: sky, water, bubbles, grass. Its warnings: "Don't detach the glass into floating generic cards. That drifts toward Glassmorphism," and "Don't turn the glass into opaque gel buttons. That drifts toward Aqua." v1 drifted into the glassmorphism failure.
- **The old critique still applies.** In 2007, "How to destroy the Web 2.0 look" listed the clichés: "gloss/sheen, beveled edges, gradients, diagonal lines, shiny table reflection effect, 'special offer' badges." It noted they made sites look like "Dollies (cloned sheep)" ([snap2objects](https://snap2objects.com/2007/11/20/how-to-destroy-the-web-20-look/)). The parts it said were worth keeping: "nice big text, loads of white space." That's the modern-retro recipe in one line.

### A3. Lessons from looking at the originals

These are things I saw in the archive's screenshots of Windows 7, Vista, the Vista website, Xbox 360 Blades and the Wii Menu. They are my observations, so treat them as [proposal]-level reads.

| Original | What makes it work | Lesson for Wayfinder |
|---|---|---|
| Vista desktop + Welcome Center | A dark teal aurora wallpaper with light ribbons gives one strong mood. Glass is dark-tinted and only on the frame. Content is white. A huge, light-weight "welcome" sits as a watermark. | Use a deep aurora stage. Text panels are opaque. Hero type is big and *light*, not heavy. |
| Windows 7 Explorer | The glass frame is about 8 px with a 1 px white inner line and a dark outer line. The toolbar has a soft vertical gradient. Selection is a pale-blue gradient with a 1 px `#aaddfa`-ish border. | Hairline double borders (dark outside, light inside) carry the "glass" read more than blur does. |
| Vista.com website (2008) | An aurora banner, then white panes on pale blue. Segoe-ish thin headings in `#1F4E79`-type blues. Gloss only on the nav bar and small arrows. | Gloss belongs on small controls. Don't spread it across big areas. |
| Xbox 360 Blades (2005) | One saturated hue owns the screen (green). Labels on the blade spines are big and lowercase. List rows are glossy. Lots of contrast. | One dominant hue per scene. Big lowercase labels read well from far away. |
| Wii Menu (2006) | Mostly white and light gray, a cyan accent, a huge thin clock, rounded "TV" tiles. | Big, thin numerals as the calm anchor. A cyan accent on near-white is enough to feel "Aero". |

### A4. Modern glass guidance: when glass helps vs hurts

**Apple Liquid Glass (HIG Materials, updated Sept 9, 2025)** [verified via the HIG's JSON]
- "Liquid Glass forms a distinct functional layer for controls and navigation elements... that floats above the content layer."
- "**Don't use Liquid Glass in the content layer**... it can result in unnecessary complexity and a confusing visual hierarchy." Use standard materials there instead.
- "**Use Liquid Glass effects sparingly**... overusing this material in multiple custom controls can provide a subpar user experience by distracting from that content."
- Regular vs clear variants: the regular variant "blurs and adjusts the luminosity of background content to maintain legibility." Use it "when components have a significant amount of text." The clear variant is for controls over rich media. "If the underlying content is bright, consider adding a dark dimming layer of **35% opacity**."
- Thicker, more opaque materials "provide better contrast for text and other elements with fine features."
- Apple's glass also responds to the reduce-transparency and increase-contrast settings.

Apple and Microsoft 2007 agree: glass for chrome, solid for content.

**Microsoft Fluent Acrylic** ([acrylic](https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic)) [verified]
- The recipe: "background, blur, exclusion blend, color/tint overlay, noise." The exclusion blend layer is there "to ensure contrast and legibility."
- Use it on transient surfaces such as menus and flyouts.
- "Avoid layering multiple acrylic surfaces... distracting optical illusions."
- "Don't place multiple acrylic panes next to each other... visible seam."
- "Don't put desktop acrylic on large background surfaces."
- "Don't place accent-colored text over acrylic surfaces."
- "Rendering acrylic surfaces is GPU-intensive." It falls back to solid when Transparency effects are off, in Battery Saver, and on low-end hardware.

**Microsoft Mica** ([mica](https://learn.microsoft.com/en-us/windows/apps/design/style/mica)) [verified]
- An *opaque* base layer that samples the wallpaper once, for performance.
- The two-layer system: Mica base, then a content layer on a "low-opacity solid color."
- "Don't apply backdrop material more than once in an application."

This is the pattern we want: one tinted base (the stage), then near-solid content layers.

**Nielsen Norman Group, "Glassmorphism"** ([nngroup](https://www.nngroup.com/articles/glassmorphism/)) [verified]
- Use it "sparingly to create an illusion of depth."
- Readability suffers when "the background is too busy."
- "More background blur is better, especially with intricate backgrounds." A 30%-opacity white panel with 25 px blur still shows edges behind it. At 100 px the background "blend[s] together."
- If you control what's behind the panel, use "simple or single-color backgrounds."
- A low-opacity stroke creates "an illusion of thickness."
- Let users reduce transparency, or at minimum meet WCAG.
- Prefer system materials over home-made glass.

**Josh Comeau, "Next-level frosted glass"** ([joshwcomeau](https://www.joshwcomeau.com/css/backdrop-filter/)) [verified]
- `backdrop-filter` only samples pixels *directly behind* the element, so glass looks flat.
- The fix: extend a backdrop child to `height: 200%` and mask off the bottom half with `mask-image: linear-gradient(to bottom, black 0% 50%, transparent 50% 100%)`. Use `mask-image` rather than `overflow: hidden`, because Chrome clips overflow before filters run.

**An Aero-specific note.** The Frutiger Aero Archive's author recommends 1–2 px of blur: "don't over-do it, or it will look more like frosted glass than Aero glass" ([archive blog](https://frutigeraeroarchive.org/blog/posts/20_09_2025)). That matches 7.css, whose `.glass` window uses `backdrop-filter: blur(4px)` plus painted diagonal streaks ([7.css `_window.scss`](https://github.com/khang-nd/7.css/blob/main/gui/_window.scss)) [verified].

The upshot: **Aero glass = light blur, a visible tint, painted streaks and a crisp double edge. Glassmorphism = heavy frost.** Because Wayfinder's glass never carries body text, the light Aero blur is safe here.

**Accessibility and support** ([MDN browser-compat-data](https://github.com/mdn/browser-compat-data)) [verified]
- `backdrop-filter`: Chrome 76, Firefox 103, Safari 18 unprefixed.
- `prefers-reduced-transparency`: Chrome 118, Firefox 113 (marked experimental), **not Safari**. Treat it as a progressive enhancement and keep a manual `?solid=1` switch.
- `prefers-reduced-motion`, `prefers-contrast` and `forced-colors` are broadly supported.

### A5. Web fonts with the Segoe/Frutiger feel

| Option | License and source | Verdict |
|---|---|---|
| **Selawik** | Microsoft. "An open source replacement for Segoe UI" ([repo README](https://github.com/microsoft/Selawik)). **SIL OFL 1.1** (GitHub API; [LICENSE](https://cdn.jsdelivr.net/npm/winstrap@0.5.12/dist/fonts/LICENSE.txt)). The repo has only sources. Built TTFs ship in the MIT npm package `winstrap@0.5.12` at `dist/fonts/`: `selawkl.ttf` (Light), `selawksl.ttf` (Semilight), `selawk.ttf` (Regular), `selawksb.ttf` (Semibold), `selawkb.ttf` (Bold). The jsDelivr URL returns 200, `font/ttf`, CORS `*` [verified]. Known issues per the README: "missing kerning to match Segoe UI" and "needs improved hinting." | **Primary pick.** It's metric-compatible with Segoe UI and has the right Light/Semilight weights. Self-host it: copy to `public/fonts`, convert to woff2 if you have time. |
| **Open Sans** | Google Fonts, OFL. Designed by **Steve Matteson, who also designed Segoe** ([Wikipedia: Open Sans](https://en.wikipedia.org/wiki/Open_Sans), [Segoe](https://en.wikipedia.org/wiki/Segoe)) [verified]. Variable weights 300–800. | **Fallback**, and the safest Google Fonts choice. It's a close sibling in feel. |
| Noto Sans | Google Fonts, OFL. 7.css's fallback after Segoe (`--w7-font: 9pt "Segoe UI", "SegoeUI", "Noto Sans", sans-serif`) [verified]. | Good fallback. Slightly more neutral. |
| Hind, Mukta, Fira Sans, Source Sans 3, Istok Web, Signika | All available on Google Fonts (CSS API checked) [verified]. | Humanist, but each has its own voice. Hind and Mukta lean Frutiger-like; Fira leans technical. |
| Nunito Sans (v1's font) | Google Fonts. | Rounder and softer. It read "friendly SaaS" in v1, not Aero. Drop it. |
| Segoe UI itself | Licensed through Monotype ([Fonts guideline](https://learn.microsoft.com/en-us/windows/win32/uxguide/vis-fonts)). | Don't ship the file. Listing `"Segoe UI"` in the stack is fine on Windows machines, but the demo laptop is a Mac, so Selawik must load. |

Recommended stack [proposal]:

```css
@font-face { font-family: "Selawik"; src: url("/fonts/selawkl.ttf")  format("truetype"); font-weight: 300; font-display: swap; }
@font-face { font-family: "Selawik"; src: url("/fonts/selawksl.ttf") format("truetype"); font-weight: 350; font-display: swap; }
@font-face { font-family: "Selawik"; src: url("/fonts/selawk.ttf")   format("truetype"); font-weight: 400; font-display: swap; }
@font-face { font-family: "Selawik"; src: url("/fonts/selawksb.ttf") format("truetype"); font-weight: 600; font-display: swap; }
@font-face { font-family: "Selawik"; src: url("/fonts/selawkb.ttf")  format("truetype"); font-weight: 700; font-display: swap; }
:root { --font-ui: "Selawik", "Segoe UI", "Open Sans", "Noto Sans", system-ui, sans-serif; }
/* Source: https://cdn.jsdelivr.net/npm/winstrap@0.5.12/dist/fonts/  (OFL 1.1) */
```

Use `font-variant-numeric: tabular-nums` for counters. Use `font-feature-settings: "kern" 1` too, though Selawik lacks a kerning table, so very large display text may want manual `letter-spacing: -0.01em`.

---

## Track B: Network graphs you can zoom into

### B1. Principles from the research literature

**Start from the focus, not the overview.** Van Ham & Perer argue that showing a whole large graph "often results in visualizations that focus exclusively on providing a global view." Their alternative to Shneiderman's "overview, zoom, details on demand" is **"search, show context, expand on demand"**: "users pick a particular datapoint as a focus... the system then computes and displays an 'optimal' relevant context" ([van Ham & Perer 2009, PDF](https://perer.org/papers/adamPerer-DOIGraphs-InfoVis2009.pdf)) [verified].

For Wayfinder, the "search" is the incoming text. When Leo texts, Leo is the focus, and the system shows the subgraph that matters to his goal.

**Degree of interest.** Furnas's generalized fisheye gives each node an interest score: DOI(x | focus) = API(x) − D(x, focus). That's a-priori importance minus distance from the focus. The display shows the top-n nodes by that score ([Furnas 1986 via course copies](https://cspages.ucalgary.ca/~saul/581/exer.eps/4furnas86.pdf)) [unverified: from search summary; the PDF was not opened].

Practical version [proposal]:
- API = 1 for people on an active route, 0.5 for department heads, 0.
- D = graph hops from the current requester or step owner.
- Show labels for DOI ≥ 0. Dim everything else to 35% opacity.

**Semantic zoom ≠ optical zoom.** Microsoft's SemanticZoom guideline says "Don't confuse semantic zooming with optical zooming." Their other rules:
- "Item layout and panning direction don't change based on the zoom level."
- "Limit the number of pages/screens to three in the zoomed-out mode."
- "Avoid using semantic zoom to change the scope of the content."
([learn.microsoft.com](https://learn.microsoft.com/en-us/windows/apps/design/controls/semantic-zoom)) [verified]

So positions must stay stable across levels. Only the *representation* changes.

**Animated transitions** ([Heer & Robertson 2007](https://idl.cs.washington.edu/files/2007-AnimatedTransitions-InfoVis.pdf)) [verified, section 3.2]
- *Congruence:* "intermediate interpolation states remain valid data graphics." Use "consistent semantic-syntactic mappings" (the same kind of change always animates the same way). "Avoid ambiguity."
- *Apprehension:* "Group similar transitions" (common fate). "Minimize occlusion." "Maximize predictability... slow-in slow-out timing." "Use simple transitions." Translation and expand/contract are easier to follow than rotation. "Use staging for complex transitions."
- *Timing:* "Make transitions as long as needed, but no longer... transition times around **1 second**."
- Animation's attention-grabbing power "can be a powerful force for distraction."

**Camera moves.** Van Wijk & Nuij (2003), "Smooth and efficient zooming and panning," gives the optimal zoom-out-then-in path.
- d3 implements it as `d3.interpolateZoom`, which "exposes... the recommended transition duration in milliseconds... based on the path length of the curved trajectory." The default curvature is ρ = √2 ([d3-interpolate/zoom](https://d3js.org/d3-interpolate/zoom)) [verified].
- React Flow v12 exposes it as `interpolate: 'smooth'` on `fitView`, `setCenter` and `fitBounds`. The installed `@xyflow/system` types have `ViewportHelperFunctionOptions = { duration?, ease?, interpolate?: 'smooth' | 'linear' }` [verified in `node_modules`].

**Edge bundling.** Holten (2006), "Hierarchical Edge Bundles," bends each edge as a B-spline toward the path through the hierarchy, controlled by a bundling strength β (0 = straight; 0.85 is commonly cited) ([course copy](https://www.cg.tuwien.ac.at/courses/InfoVis/HallOfFame/2007/Grasberger/InfoVis2006%20Hierarchical%20Edge%20Bundles%20-%20Visualization%20of%20Adjacency%20Relations%20in%20Hierarchical%20Data%20%5BDanny%20Holten%5D.pdf)) [unverified: the PDF host failed DNS; details from search summaries].

The "person → department hub → department hub → person" curve is a cheap stand-in for this in an org graph [proposal].

**Aggregation, combos and meta-edges.**
- Cytoscape's expand-collapse extension collapses compound nodes and reroutes hidden edges into "meta-edges." Its defaults: `animate: true`, `animationDuration: 1000`, `fisheye: true`. It recommends re-running layout with `randomize: false` "to preserve the user's mental map" ([cytoscape.js-expand-collapse](https://github.com/iVis-at-Bilkent/cytoscape.js-expand-collapse)) [verified]. The extension is no longer maintained.
- Cytoscape compound parents have "no independent geometry" ([Cytoscape.js docs](https://js.cytoscape.org/#notation/compound-nodes)) [verified].
- KeyLines' "combos" pair open/closed groups with aggregated links ([Cambridge Intelligence](https://cambridge-intelligence.com/5-quirky-ways-to-style-combos-for-maximum-impact/)) [unverified: search summary].

**Clustered force layout.** d3 `forceX/forceY` pull each node toward a target. With a per-node accessor, `d3.forceX(d => groupX[d.group]).strength(0.2)` clusters nodes by group. The default strength is 0.1 ([d3-force position](https://d3js.org/d3-force/position)) [verified].

**Label density, level of detail.** Sigma.js only draws a label if the node's rendered size is at least `labelRenderedSizeThreshold: 6` px. It also limits labels per grid cell (`labelDensity: 1`, `labelGridCellSize: 100`), and node size grows with zoom by `zoomToSizeRatioFunction: Math.sqrt`, so nodes don't balloon ([sigma settings.ts](https://github.com/jacomyal/sigma.js/blob/main/packages/sigma/src/settings.ts)) [verified]. These are good defaults to copy.

### B2. Tools that handle this well

| Tool | Pattern worth copying | Source |
|---|---|---|
| **Kumu** | "Focus mode" shows the selection plus N degrees. `+`/`-` expand and contract degrees; `esc` restores. Can be preset: `focus: #jack out 2`. | [docs.kumu.io/guides/focus](https://docs.kumu.io/guides/focus) [verified] |
| **Obsidian graph** | Local graph depth slider. Color *groups* by query. Center, repel and link forces. "Text fade threshold" fades labels by zoom. "Animate" replays creation over time. | [obsidian.md/help/plugins/graph](https://obsidian.md/help/plugins/graph) [verified] |
| **Neo4j Bloom** | Expand neighbors on demand. "Dismiss" isolated nodes. Shortest path within 20 hops. Minimap with fit-to-screen. | [Bloom scene interactions](https://neo4j.com/docs/bloom-user-guide/current/bloom-visual-tour/bloom-scene-interactions/) [verified] |
| **Cytoscape.js** | Compound nodes, plus expand-collapse with meta-edges and fisheye. | above [verified] |
| **Sigma.js** | Grid-based label culling and a size threshold. | above [verified] |
| **React Flow** | "Contextual Zoom" example: "the current zoom level can be used by a node to decide which content to show," via `useStore`. Sub-flows via `parentId`. `hidden` toggling to collapse. | [contextual zoom](https://reactflow.dev/examples/interaction/contextual-zoom), [sub flows](https://reactflow.dev/learn/layouting/sub-flows), [performance](https://reactflow.dev/learn/advanced-use/performance) [verified] |
| **Graphistry** | GPU-scale hairball handling. | Not researched further. Overkill for 23 people [unverified]. |

### B3. Camera rules for live events [proposal, grounded in B1]

1. **Coalesce, then move.** Buffer events for 600 ms. Move once to the *union* of involved nodes: `fitView({ nodes, padding: 0.3, duration: 1000, interpolate: 'smooth' })`.
2. **Dwell.** After arriving, hold at least 2.5 s before any other camera move. Calm-tech principle: the periphery mustn't keep stealing the center.
3. **Stage it** (Heer & Robertson). Camera moves first, then edges animate, then the label or toast appears. Never move the camera while an edge is drawing.
4. **Small moves stay small.** If the target is already in the middle 60% of the viewport, don't move the camera. Animate in place.
5. **Return home.** After 12 s with no events, ease back to the overview level (`fitView`, 1.2 s).
6. **No rotation, no roll.** Translate and zoom only, since rotation is harder to follow.
7. **Zoom ceiling.** Never zoom past the "near" level on a live event. The audience needs context: the route plus its neighbors.

### B4. Implementing semantic zoom in React Flow v12 (installed: `@xyflow/react` 12.12.0)

APIs checked against the installed type definitions [verified]:
- The store's `transform: Transform`, where `Transform = [number, number, number]`, so zoom is `transform[2]`.
- `setCenter(x, y, { zoom, duration, ease, interpolate })`.
- `fitView({ nodes, padding, duration, interpolate, minZoom, maxZoom })`.
- Nodes support `parentId`, `extent: 'parent'` and `expandParent`.
- `onlyRenderVisibleElements` exists.

The code below is a **[proposal]** sketch.

```tsx
import { memo } from 'react';
import { useStore, useReactFlow, type NodeProps } from '@xyflow/react';

// 1) Bucket the zoom so nodes re-render only when the LEVEL changes, not on every wheel tick.
//    Zustand re-renders when the selector's return value changes (===), so return a string.
type LOD = 'far' | 'mid' | 'near';
const lodSelector = (s: { transform: [number, number, number] }): LOD => {
  const z = s.transform[2];
  return z < 0.6 ? 'far' : z < 1.15 ? 'mid' : 'near';
};

export const PersonNode = memo(function PersonNode({ data }: NodeProps<PersonNodeT>) {
  const lod = useStore(lodSelector);
  if (lod === 'far') return null;                       // dept orb represents them
  return (
    <div className={`person person--${lod}`} data-active={data.active || undefined}>
      <span className="orb" style={{ '--hue': data.deptHue } as React.CSSProperties}>{data.initials}</span>
      {lod === 'near' || data.active ? <span className="name">{data.name}</span> : null}
      {lod === 'near' && data.role ? <span className="role">{data.role}</span> : null}
    </div>
  );
});

export const DeptNode = memo(function DeptNode({ data }: NodeProps<DeptNodeT>) {
  const lod = useStore(lodSelector);
  // far: big glossy orb + name + count badge; mid/near: soft "island" region with a quiet label
  return lod === 'far'
    ? <div className="dept-orb"><b>{data.name}</b><small>{data.people} people</small></div>
    : <div className="dept-island" style={{ width: data.w, height: data.h }}><span>{data.name}</span></div>;
});

// 2) Camera helper used by the live reducer
export function useCamera() {
  const rf = useReactFlow();
  return {
    focus: (ids: string[]) =>
      rf.fitView({ nodes: ids.map(id => ({ id })), padding: 0.3, duration: 1000, interpolate: 'smooth', maxZoom: 1.4 }),
    home: () => rf.fitView({ padding: 0.08, duration: 1200, interpolate: 'smooth' }),
  };
}
```

Notes:
- **Parent/child setup.** Departments are parent nodes. People get `parentId: deptId` and positions *relative* to the parent. Parents must come **before** children in the `nodes` array ([sub flows](https://reactflow.dev/learn/layouting/sub-flows)) [verified].
- **Edges per level.** Keep two edge sets.
  - *Far:* aggregated dept→dept edges, `strokeWidth = 2 + 2*log2(count)`.
  - *Mid/near:* person→person edges.
  - Swap them with `hidden` when the LOD changes (one `setEdges` per level change, not per frame).
- **Performance.** Memoize node and edge components. Don't read the full `nodes` array inside nodes. Simplify CSS (shadows, gradients) if FPS drops ([performance](https://reactflow.dev/learn/advanced-use/performance)) [verified]. With 23 people this is cheap. The real cost is `backdrop-filter`, so keep it **off** nodes entirely.
- **Layout.** Run d3-force *once* at build or load time with a fixed seed: `forceX/forceY` toward department centroids, `forceCollide(r+8)`, link force on learned edges. Then freeze positions. That gives an organic shape with a stable mental map.
- **Department order.** Place departments on a loose ring, ordered so the heaviest-linked pairs sit next to each other. A greedy order over 12 departments is enough. This removes v1's long diagonals across a 4×3 grid.

---

## Track C: What a good big-screen dashboard looks like

### C1. Principles

- **Definition (Few).** A dashboard is "a visual display of the most important information... consolidated and arranged on a **single screen** so the information can be monitored **at a glance**." ([Few 2006, Common Pitfalls](https://www.perceptualedge.com/articles/Whitepapers/Common_Pitfalls.pdf)) [verified]
  - Pitfall #1, exceeding one screen: "Something critical is sacrificed when the viewer must... move from screen to screen."
  - Pitfall #10: "When everything is visually prominent, nothing stands out."
  - Pitfall #11: decoration "becomes an absurd distraction... even people who enjoy the decoration upon first sight will grow weary of it in a short time."
  - The v1 doc's own critique ("no focal point," "decoration competes") restates #10 and #11 almost word for word.
- **Few's color rules** ([PDF](https://www.perceptualedge.com/articles/visual_business_intelligence/rules_for_using_color.pdf)) [verified]
  - #3: color "only when needed."
  - #4: different colors "only when they correspond to differences of meaning."
  - #5: "soft, natural colors to display most information and bright and/or dark colors to highlight."
  - #7: non-data components "just visibly enough... but no more."
  - #8: avoid red + green together.
  - #9: "Avoid using visual effects in graphs."
  - The last one matters for Aero: gloss belongs on chrome and nodes, **never on chart marks** (bars, lines).
- **Preattentive attributes** ([Healey, NC State](https://www.csc2.ncsu.edu/faculty/healey/PP/)) [verified]
  - Tasks done in under about 200–250 ms "are considered preattentive."
  - The list includes size, hue, intensity, orientation, curvature, **flicker, direction of motion, velocity**, and others.
  - Conjunction targets (two features at once) force a slow serial search.
  - Hierarchy: "luminance tends to dominate hue."
  - So: mark the single live thing with **motion + luminance** (it's the only moving, brightest object), not with yet another hue.
- **Calm technology** ([Weiser & Brown 1995](https://calmtech.com/papers/designing-calm-technology)) [verified]
  - "Calm technology engages both the center and the periphery of our attention."
  - The Dangling String "draws attention when it first appears, then fades into the background."
  - "Less is more, when less bandwidth provides more calmness."
  - So: routine events whisper in the periphery (ticker, faint edge shimmer). Only state changes that matter earn the center.
- **TV dashboard practice** ([Geckoboard teardown](https://www.geckoboard.com/blog/data-visualization-for-tv-dashboards-a-teardown)) [verified]
  - "Everything is large enough to read from a distance."
  - A table with "everything" is "a sign that the dashboard needs simplifying."
  - Number widgets with a comparison beat gauges. Avoid pies and 3-D.
  - Charts shouldn't take "more than a few seconds to understand."
  - Search snippets also mention putting the key number top-left and giving it context (target or prior period) [unverified, snippet].

### C2. Distance legibility: how big is big enough [derived]

AVIXA DISCAS (ANSI/INFOCOMM V202.01:2016) defines **%Element Height** ("a group of pixels conveying an item of information (e.g., a character...)"). The **Basic Decision Making acuity factor is 200**; analytical decision making uses 3438 ([AVIXA](https://api.avixa.org/standards/discas-calculators/discas/learn-more-about-display-size)) [verified definitions].

In plain terms, a character needs to be at least 1/200 of the distance to the farthest viewer:

> element height ≥ farthest viewer distance ÷ 200

Worked example. Assume a 100" 16:9 projection (image about 1.25 m tall) and a farthest judge about 8 m away.
- Minimum character height = 8 m ÷ 200 = **4 cm**, which is 3.2% of image height.
- At a **1920×1080** CSS viewport: 3.2% × 1080 ≈ 35 px *cap/x-height-ish element*.
- At **1440×900**: ≈ 29 px.

Humanist sans cap height is about 0.7 em, so a 35 px element ≈ 50 px font-size for "must be read from the back." That's strict. For "most of the room" (5 m), the same math gives ≈ 31 px font at 1080p.

Recommended scale [proposal]:

| Role | 1920×1080 | 1440×900 | Weight | Notes |
|---|---|---|---|---|
| Hero number ("3 h") | 160 px | 132 px | Light 300 | `tabular-nums`, `#FFFFFF` on stage or `#0B2340` on white |
| Scene headline / live event | 56 px | 46 px | Semilight 350 | One line, ≤ 40 characters |
| Window title (goal name) | 40 px | 34 px | Semibold 600 | |
| Primary labels (active people, current step, dept names at far zoom) | 32 px | 26 px | Semibold 600 | The working minimum for anything the back row needs |
| Body (message bubble text, step names) | 28 px | 24 px | Regular 400 | ≤ 45 characters per line on the projector, not 65 |
| Secondary (time, role) | 24 px | 20 px | Regular 400, `#3D5873` | Near-viewer detail only |
| Floor | 20 px | 18 px | | Nothing important. v1's 11–12 px pills are banned |

### C3. How live updates should behave [proposal + sources]

- **One live thing at a time in the center.** Everything else queues, like Aero notifications that "fade in and out" and queue ([Wikipedia](https://en.wikipedia.org/wiki/Windows_Aero)).
- **Arcs, not blinks.** Shopify's BFCM globe draws each order as an arc with a "normalized age from 0 to 2 (0 = start, 1 = arrival, 2 = trail fully played out)." Trails dissolve with noise, and each arc animates on its own clock ([Shopify Engineering](https://shopify.engineering/how-we-built-shopifys-bfcm-2023-globe)) [verified]. A message traveling along an edge works the same way: a comet head, then a fading trail.
- **Celebrate rarely.** Shopify launches "fireworks" only for a merchant's *first sale*. Panic's board played "a virtual champagne animation when all counters reach zero" ([Panic](https://panic.com/blog/the-panic-status-board/)) [verified]. In Wayfinder, celebrate exactly once: goal done, receipt.
- **Peripheral sound and shape.** Listen to Wikipedia encodes edits as circles plus bells/plucks, with pitch tied to size and color to editor type ([hatnote](http://listen.hatnote.com/)) [verified]. It shows an ambient stream can be beautiful *and* calm. Use it as a model for the ticker and the idle graph shimmer.
- **Live status on a graph.** GitHub Actions' visualization graph shows each job as a node with a status icon left of the name, lines for dependencies, and real-time updates ([GitHub Docs](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-the-visualization-graph)) [verified]. That's a familiar mental model for "steps with status."

### C4. Live displays worth studying (and why they work)

| Display | Why it works | URL |
|---|---|---|
| Shopify BFCM Live Globe | One focal object. Live events are motion (arcs), not text. Ambient detail (planes, stars) is low-contrast. Bloom only on celebrations. Streams over SSE in 2025, the same transport Wayfinder plans. | https://shopify.engineering/how-we-built-shopifys-bfcm-2023-globe |
| Panic Status Board | "Airport-style" thin-bezel display. A few big counters and bus times. Public numbers changed behavior ("support turnaround was faster than ever"). | https://panic.com/blog/the-panic-status-board/ |
| Listen to Wikipedia | Ambient, beautiful, peripheral. Each event is a short-lived shape. | http://listen.hatnote.com/ |
| GitHub Actions run graph | Steps plus dependencies plus live status in one picture. Detail on click. | https://docs.github.com/en/actions/how-tos/monitor-workflows/use-the-visualization-graph |
| Wii Menu clock / Xbox 360 Blades | A huge thin numeral as the calm anchor. One dominant hue per scene. | https://frutigeraeroarchive.org/ (examples) |

---

## Track D: Survey of real designs and verified CSS recipes

### D1. Examples (24)

"Opened" means I loaded the URL or its source. CodePen and Dribbble returned 403 or Cloudflare challenges to my fetcher, so those rows are **[unverified]**. Open them in a browser before showing them.

| # | Example | URL | What works | What doesn't / caution | Technique | Opened |
|---|---|---|---|---|---|---|
| 1 | **7.css** (Windows 7 CSS framework, MIT, about 2.4k stars) | https://khang-nd.github.io/7.css/ · [repo](https://github.com/khang-nd/7.css) | Faithful details: dark outer plus white inner hairline, 45% hard-stop button gradients, painted glass streaks | 9 pt type. It's a desktop replica, not a big-screen system | Layered gradients, `backdrop-filter: blur(4px)` on `.glass` (see D2) | yes (source) |
| 2 | **Frutiger Aero Archive** site and gloss tutorial | https://frutigeraeroarchive.org/blog/posts/20_09_2025 | Real-practice tips: 1–2 px blur, a hard 55% stop on buttons, a reflection layer at 0.3 opacity, Segoe UI Semilight | Hobby-site density | `linear-gradient` + `::before` highlight | yes |
| 3 | **makeaero.com** (Visnalize, MIT) | https://makeaero.com · [repo](https://github.com/Visnalize/makeaero) | Generators for gloss buttons, orbs and glass windows. Orb CSS uses OKLCH | Generator output still needs restraint | radial-gradient sphere + `::after` specular (see D2) | yes (source) |
| 4 | **NameThatUI: Windows Aero brief** | https://namethatui.com/styles/windows-aero | Clean separation of Aero vs Frutiger Aero vs glassmorphism. Concrete rgba values. Accessibility do/don'ts | Its suggested `blur(12px)` is heavier than real Aero | `rgba(190,215,240,.35)` tint, `inset 0 0 0 1px rgba(255,255,255,.35)` | yes |
| 5 | **daisyUI trend: Frutiger Aero** | https://trends.daisyui.com/trend/frutiger-aero/ | Token mapping (sky-blue primary, aqua/grass secondary). Radius 1–2 rem | Suggests rounded fonts (Quicksand, Varela), which drift toward kitsch | daisyUI theme vars | yes |
| 6 | **CARI: Frutiger Aero** | https://cari.institute/aesthetics/frutiger-aero | The canonical motif list | Moodboard, not UI guidance | n/a | yes |
| 7 | **Win7 UX guide: Alt+Tab glass (correct) vs 12-graphic glass window (incorrect)** | https://learn.microsoft.com/en-us/windows/win32/uxguide/win-window-frames | The official rule: glass plus a single strong label | n/a | n/a | yes |
| 8 | **Windows 7 desktop / Explorer** (archive screenshot) | https://frutigeraeroarchive.org/images/introduction/windows_7.jpg | Glass frame, opaque content, pale-blue selection, toolbar gradient | Dense, desktop-scale | n/a | yes (image) |
| 9 | **Windows Vista Welcome Center + aurora wallpaper** | https://frutigeraeroarchive.org/images/introduction/windows_vista.jpg | Deep teal aurora, giant light "welcome" watermark, dark glass | Start menu is dense | n/a | yes (image) |
| 10 | **Windows Vista website (2008)** | https://frutigeraeroarchive.org/images/introduction/windows_vista_website.jpg | Aurora header plus white panes. Thin headings. Small gloss | Portal-page clutter | n/a | yes (image) |
| 11 | **Xbox 360 Blades (2005)** | https://frutigeraeroarchive.org/images/introduction/xbox_360_blades.jpg | One hue owns the scene. Huge lowercase blade labels. Glossy list rows | Very saturated green; you need restraint at projector scale | n/a | yes (image) |
| 12 | **Wii Menu (2006)** | https://frutigeraeroarchive.org/images/introduction/wii.jpg · [Wikipedia](https://en.wikipedia.org/wiki/Wii_system_software) | Near-white, one cyan accent, giant thin clock, rounded tiles | Low contrast gray text | n/a | yes (image) |
| 13 | **Windows Desktop Gadgets** (Vista/7 sidebar) | https://en.wikipedia.org/wiki/Windows_Desktop_Gadgets | Small glassy widgets with one big value (clock, weather). A model for the hero-number "gadget" | Many gadgets at once = clutter | n/a | yes (summary) |
| 14 | **Windows Media Center** | https://en.wikipedia.org/wiki/Windows_Media_Center | 10-foot UI: big type, horizontal strips, deep blue | Dated chrome | n/a | yes (summary) |
| 15 | **Zune / Metro** (the reaction to Aero) | https://en.wikipedia.org/wiki/Zune · https://en.wikipedia.org/wiki/Metro_(design_language) | "Typography... absence of clutter, increased content to chrome ratio." Borrow the *type confidence*, not the flatness | Pure flat loses the Aero feel | n/a | yes (summary) |
| 16 | **iOS 6** (last skeuomorphic iOS) | https://en.wikipedia.org/wiki/IOS_6 | Glossy controls with crisp hierarchy | Felt textures and linen = kitsch risk | n/a | yes (summary) |
| 17 | **Apple Liquid Glass (HIG)** | https://developer.apple.com/design/human-interface-guidelines/materials | The modern rulebook: glass only for controls, sparingly, regular variant for text, 35% dim layer | Apple-only rendering (refraction) | n/a | yes (JSON) |
| 18 | **Fluent Acrylic / Mica** | https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic | Recipe layers. No stacking. Solid fallbacks | n/a | blur + exclusion + tint + noise | yes |
| 19 | **Josh Comeau: extended backdrop-filter** | https://www.joshwcomeau.com/css/backdrop-filter/ | Glass that picks up nearby color | Extra DOM | `height:200%` + `mask-image` | yes |
| 20 | **Shopify BFCM Live Globe** | https://shopify.engineering/how-we-built-shopifys-bfcm-2023-globe | Live events as arcs. One focal object | 3-D is overkill for us | three.js / r3f | yes |
| 21 | **Z2r-YT 7-Aero-Stylesheet** (MIT) | https://github.com/Z2r-YT/7-Aero-Stylesheet | Windows 7 + Frutiger Aero stylesheet (105 KB `aero.css`) | Replica, heavy | CSS | metadata only |
| 22 | **CodePen "Windows 7 Aero CSS" (LuizMouraBR)** | https://codepen.io/LuizMouraBR/pen/wBvZOJx | Per search snippet: `.aero` = translucent gradient + `backdrop-filter: blur(6px)`, `::before` top sheen | n/a | CSS | **[unverified]** (blocked) |
| 23 | **CodePen "Pure-CSS glossy buttons" (rzahniser)** | https://codepen.io/rzahniser/pen/ONwdQQ | Radial-gradient glow as border-image plus a white top overlay | n/a | CSS | **[unverified]** (blocked) |
| 24 | **CodePen "CSS Gradient Ball/Sphere" (vikas78)** | https://codepen.io/vikas78/pen/vYEymWd | Off-center radial highlight (~65% 15%) + inset shadow | n/a | CSS | **[unverified]** (blocked) |

Also relevant: [98.css](https://jdan.github.io/98.css) and [XP.css](https://botoxparty.github.io/XP.css/) (MIT). They're the sibling faithful-replica libraries, and they show the "replica" trap: perfect nostalgia, wrong scale for a stage. Dribbble's [frutiger-aero tag](https://dribbble.com/tags/frutiger-aero) returned an empty page to my fetcher [unverified]. Browse it manually for music-player and widget shots.

### D2. Verified CSS from the sources

**7.css window glass and title-bar streaks** ([`gui/_window.scss`](https://github.com/khang-nd/7.css/blob/main/gui/_window.scss)) [verified, excerpt]:

```scss
--w7-w-bd: #000000b3;           // outer dark hairline
--w7-w-bg: #4580c4;             // glass tint (blue)
--w7-w-grad: linear-gradient(to right, #ffffff66, #0000001a, #ffffff33), var(--w7-w-bg);
.window {
  box-shadow: 2px 2px 10px 1px var(--w7-w-bd), inset 0 0 0 1px #fffa;  // shadow + inner white line
  border: 1px solid var(--w7-w-bd);
  border-radius: 6px;
  &::before { background: linear-gradient(transparent 20%, #ffffffb3 40%, transparent 41%), var(--w7-w-grad); }
  &.glass::before { opacity: .6; }
  &.glass::after  { backdrop-filter: blur(4px); }
}
// --w7-w-glass also paints ~10 diagonal "streaks" at 54deg with #0002 / #bbb2 stops (sheen)
```

**7.css buttons** ([`_variables.scss`](https://github.com/khang-nd/7.css/blob/main/gui/_variables.scss)) [verified]. The hard 45% stop is the Aero "split" highlight:

```css
--w7-el-grad:   linear-gradient(#f2f2f2 45%, #ebebeb 45%, #cfcfcf);
--w7-el-grad-h: linear-gradient(#eaf6fd 45%, #bee6fd 45%, #a7d9f5);   /* hover: Aero blue */
--w7-el-bd-h:   #3c7fb1;
--w7-li-bd-hl:  #aaddfa;                                               /* selection border */
```

**Frutiger Aero Archive gloss button** ([blog](https://frutigeraeroarchive.org/blog/posts/20_09_2025)) [verified]:

```css
.example-div { background: linear-gradient(to bottom, #c8ffc5 0%, #1fbf24 55%, #009a05 55%, #457a28 100%); position: relative; }
.example-div::before { content:""; position:absolute; top:0; width:90%; height:16px; border-radius:20px;
  background: linear-gradient(to bottom, rgb(255,255,255) 0%, rgba(255,255,255,.5) 100%); opacity:.3; }
/* author: "I typically go for 1 to 2 pixels of blur" for Aero glass */
```

**makeaero glossy orb** ([`app/orb/orb-client.tsx`](https://github.com/Visnalize/makeaero/blob/main/app/orb/orb-client.tsx)) [verified, template with variables]:

```css
.glossy-orb { border-radius: 50%; position: relative;
  background: radial-gradient(circle at 35% 35%, rgba(255,255,255,var(--gloss)),
              oklch(65% var(--sat) var(--hue)) 50%, oklch(35% var(--sat) var(--hue)) 100%);
  box-shadow: inset 0 -4px 8px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.4); }
.glossy-orb::after { content:""; position:absolute; top:8%; left:18%; width:45%; height:35%;
  background: radial-gradient(ellipse, rgba(255,255,255,var(--gloss-plus)), transparent);
  border-radius:50%; transform: rotate(-20deg); pointer-events:none; }
```

**NameThatUI Aero frame + close glow** ([brief](https://namethatui.com/styles/windows-aero)) [verified]:

```css
background: rgba(190,215,240,.35); backdrop-filter: blur(12px) saturate(1.3);
border: 1px solid rgba(255,255,255,.6);
box-shadow: inset 0 0 0 1px rgba(255,255,255,.35), 0 8px 24px rgba(0,20,60,.35);
.close:hover { background: radial-gradient(circle at 50% 40%, #ff9d8a, #e81123 70%); box-shadow: 0 0 10px rgba(232,17,35,.7); }
```

---

## Track E: Recommendations for Wayfinder v2

### E1. Direction statement [proposal]

> **"Windows 7's calm, rebuilt for a stage."** A single deep-blue aurora scene where the org's real wiring glows like light through glass. Glass is the *frame*: thin, tinted and streaked. Anything you need to read sits on opaque white "windows" with large, light Selawik type. Exactly one thing moves at a time. The gloss is earned: it sits on the objects you can point at (people orbs, the active route, the one button) and never on the text or the charts. It should feel like 2009 Microsoft with 2026 spacing, accessibility and motion: optimistic, professional, readable from the back row.

What this fixes from v1:

| v1 problem (from the v1 doc) | v2 response |
|---|---|
| "A dashboard wearing an Aero skin" | Aero's *structure* (glass chrome + opaque windows + aurora stage) replaces SaaS cards. No KPI-tile grid |
| "No focal point" | One stage, one live thing, one hero number. Everything else is ≤ 35% salience |
| "Flows is a wall of text" | Route on the graph + delivery-tracker strip. Only the current step shows text |
| "Graph is a grid, not a network" | Seeded clustered force layout, dept "islands", aggregated dept edges at far zoom |
| "Small, low-contrast text" | 24 px floor, 32 px primary labels, contrast checked (E3) |
| "Decoration competes" | No background bubbles. Ambient light lives in the backdrop only and never moves faster than 1 px/s |
| "Emoji as icons" | Fluent System Icons (Color variant) with Filled fallback |
| "Auto-follow lands on blank graph" | Single stage, so there's no page switch to land on blank. The graph never unmounts |

### E2. Palette [proposal; contrast and CVD numbers verified with a script]

**Stage (backdrop, full-bleed).** A Vista-style dusk aurora:

```css
--stage-0: #062A4A;  /* top-left deep */
--stage-1: #0B3A66;  /* main field (graph surface for contrast checks) */
--stage-2: #0E5E78;  /* teal horizon */
--aurora-a: #2FD3B5; /* ribbon, used at 8-14% opacity only */
--aurora-b: #7FE3FF; /* ribbon highlight, 10% */
background:
  radial-gradient(120% 80% at 85% 110%, rgb(47 211 181 / .18), transparent 60%),
  radial-gradient(90% 60% at 10% -10%, rgb(127 227 255 / .14), transparent 55%),
  linear-gradient(160deg, var(--stage-0), var(--stage-1) 45%, var(--stage-2));
```

**Why a dark stage on a projector?** Glowing edges and the active route read best on dark. Vista's own signature was a dark aurora. Text lives on white windows, so dark-on-light still carries everything people read ("If you want to make sure users read your text, use dark text on a light background," [MS Fonts](https://learn.microsoft.com/en-us/windows/win32/uxguide/vis-fonts)). Keep the stage at mid-dark navy, not black: projectors render black as gray, and navy survives a lit room better [proposal; test in the venue].

**Windows (opaque content):** `--win-body: #FFFFFF`, `--win-body-alt: #F3F8FC`.

**Ink:**

| Token | Hex | Contrast | Use |
|---|---|---|---|
| `--ink` | `#0B2340` | 15.8:1 on white, 14.4:1 on `#EEF5FB` | Primary text |
| `--ink-2` | `#3D5873` | 6.7:1 on `#EEF5FB` | Secondary text |
| `--ink-3` | `#5B7189` | 4.6:1 | Minimum for real text |
| `--on-stage` | `#FFFFFF` | 11.6:1 on `#0B3A66`, 7.3:1 on `#0E5E78` | Text on the stage |
| `--on-stage-2` | `#CFE6FA` | 9.0:1 on `#0B3A66` | Secondary text on the stage |

**Aero blues (chrome and controls).**
- Glass tint `#0E4C8A`. White on it is 8.7:1.
- Commit blue `#1565A8`. White is 6.1:1.
- Hover glow `#3399FF` (the Win7 "Hot" link color).
- Main-instruction blue `#003399` (straight from the Win7 type table).

**Edges on the stage** (validated with the dataviz skill's `validate_palette.js`, dark mode, surface `#0B3A66`, **all-pairs**: lightness band, chroma, CVD ΔE ≥ 13, normal ΔE ≥ 25, contrast ≥ 3:1 all **PASS**):

| Edge kind | Color | Secondary encoding | Width |
|---|---|---|---|
| Learned from replies | `#10A592` (Aero aqua-green) | solid | 3 px; +1 px per 3 confirmations, max 6 |
| Delegate / covering | `#9070F0` (violet) | long dash `8 6` | 3 px |
| Suggested connection | `#DD6A2E` (warm orange) | dotted `2 6`, round caps | 3 px |
| Org chart (context) | `#6E8AA8` | hairline | 1.5 px, 3.2:1. Deliberately recessive |
| **Active route** | white core `#FFFFFF` + `0 0 12px #7FE3FF` glow | animated comet | 5 px |

The active route is set apart by *luminance and motion*, not by another hue (Healey: luminance dominates hue). So it never collides with the categories.

**Goal types (on white windows only)**, validated light mode, surface `#FFFFFF`, adjacent pairs PASS:
- Onboarding `#15996B`
- Event `#7A4FD6`
- Incident `#D23C5A`
- Money `#B57F00`
- Question `#1F6FD1`

Under all-pairs, Question and Event fail (deutan ΔE 0.7) [verified]. So **type color is never alone**: it always comes with its Fluent icon and a text label. On the stage, goal type isn't color-coded at all.

**Status (reserved; icon + label always):** Waiting `#B57F00`, In progress `#1F6FD1`, Done `#15996B`, Blocked `#D23C5A`, Planning `#5B7189` (dashed outline).

**Departments.** Don't give 12 departments 12 hues. Twelve categorical hues can't pass the color-vision checks, and Microsoft warns against "adjacent hues." Draw department islands in one neutral glass tone (`rgb(255 255 255 / .06)` fill, `rgb(255 255 255 / .18)` 1 px edge) and identify them by **label and position**. Person orbs use the stage blue at three lightness steps for variety, not identity.

### E3. Glass, gloss and orb recipes [proposal; derived from the D2 verified sources]

**Recipe 1: "Aero chrome."** For the top bar, ticker, scene pill and window frames. No body text on it, only a single strong label.

```css
.aero-chrome {
  position: relative; isolation: isolate;
  color: #fff;
  background:
    /* specular split: bright top half, hard edge at 50% (7.css uses 40-45%) */
    linear-gradient(180deg, rgb(255 255 255 / .34) 0%, rgb(255 255 255 / .10) 49%, rgb(255 255 255 / 0) 50%),
    /* side sheen like 7.css --w7-w-grad */
    linear-gradient(90deg, rgb(255 255 255 / .18), rgb(0 0 0 / .06), rgb(255 255 255 / .10)),
    rgb(14 76 138 / .62);                         /* tint #0E4C8A */
  -webkit-backdrop-filter: blur(6px) saturate(1.4);
  backdrop-filter: blur(6px) saturate(1.4);       /* Aero = light blur */
  border: 1px solid rgb(2 18 40 / .7);            /* dark outer line */
  border-radius: 12px;
  box-shadow:
    inset 0 0 0 1px rgb(255 255 255 / .38),       /* bright inner line */
    inset 0 1px 0 rgb(255 255 255 / .65),         /* top lip */
    0 10px 30px rgb(0 16 40 / .45);
}
.aero-chrome::after {                             /* faint diagonal streaks (7.css idea, 3 bands not 10) */
  content: ""; position: absolute; inset: 0; border-radius: inherit; z-index: -1; pointer-events: none;
  background: linear-gradient(54deg, transparent 18%, rgb(255 255 255 / .07) 19% 23%, transparent 24% 44%,
                                     rgb(255 255 255 / .05) 45% 52%, transparent 53% 70%, rgb(255 255 255 / .06) 71% 73%, transparent 74%);
}
.aero-chrome .label { font: 600 32px/1.1 var(--font-ui); text-shadow: 0 1px 2px rgb(0 0 0 / .45); }
```

**Recipe 2: "Aero window."** Use it for the goal panel and the receipt. The glass frame wraps opaque content, exactly like Windows 7.

```css
.aero-window { padding: 8px; /* the glass frame */ }        /* + .aero-chrome on the same element */
.aero-window__title { padding: 6px 14px 10px; font: 600 40px/1.1 var(--font-ui); }
.aero-window__body {
  background: #fff; color: var(--ink);
  border: 1px solid rgb(2 18 40 / .55); border-radius: 6px;
  box-shadow: 0 0 0 1px rgb(255 255 255 / .6);              /* 7.css .window-body ring */
  padding: 24px 28px; font: 400 28px/1.35 var(--font-ui);
}
```

**Recipe 3: gloss pill button.** There should be only one on screen, if any: "Replay", hidden in the corner during the demo.

```css
.gloss {
  font: 600 24px/1 var(--font-ui); color: #fff; padding: 14px 28px; border-radius: 999px; border: 1px solid #08396F;
  background:
    linear-gradient(180deg, rgb(255 255 255 / .55), rgb(255 255 255 / .16) 49%, transparent 50%),  /* split highlight */
    radial-gradient(120% 70% at 50% 120%, rgb(127 227 255 / .75), transparent 60%),             /* bottom glow (Aero hover) */
    linear-gradient(180deg, #2C8BE0, #0B4F9C);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / .35), 0 2px 8px rgb(0 30 70 / .35);
  text-shadow: 0 1px 1px rgb(0 0 0 / .35);
}
.gloss:focus-visible { outline: 3px solid #7FE3FF; outline-offset: 3px; }
```

**Recipe 4: person and department orbs (nodes).** The orb is the *object*, so gloss belongs here. Adapted from makeaero.

```css
.orb { --h: 235; --c: .14; width: 56px; height: 56px; border-radius: 50%; position: relative;
  display: grid; place-items: center; font: 600 22px/1 var(--font-ui); color: #fff; text-shadow: 0 1px 2px rgb(0 0 0 / .5);
  background: radial-gradient(circle at 35% 30%, rgb(255 255 255 / .55), oklch(62% var(--c) var(--h)) 48%, oklch(34% var(--c) var(--h)) 100%);
  box-shadow: inset 0 -4px 8px rgb(0 0 0 / .3), inset 0 0 0 1px rgb(255 255 255 / .35), 0 6px 18px rgb(0 0 0 / .35); }
.orb::after { content:""; position:absolute; top:7%; left:18%; width:46%; height:32%; border-radius:50%;
  background: radial-gradient(ellipse, rgb(255 255 255 / .75), transparent 70%); transform: rotate(-20deg); }
.orb[data-active] { box-shadow: 0 0 0 3px #fff, 0 0 24px 6px rgb(127 227 255 / .65), inset 0 -4px 8px rgb(0 0 0 / .3); }
.dept-orb { width: 168px; height: 168px; }   /* far zoom: dept as orb, 32px label below on a chrome pill */
```

**Rules for glass** (Apple + Microsoft + NN/g, merged):
- Never stack glass on glass.
- Never put adjacent glass panes edge to edge.
- Never put body text on glass.
- Never use accent-colored text on glass.
- At most three glass surfaces on screen: top bar, ticker, window frame.
- No `backdrop-filter` on graph nodes. It's GPU-heavy, per Microsoft's acrylic note.

### E4. Iconography [verified licensing; proposal for use]

- **Fluent UI System Icons** (MIT, about 10.9k stars). `@fluentui/react-icons` latest is `2.0.344`. The repo has `Regular`, `Filled`, `Light` and **`Color`** variants. Color covers about 200 icons with gradient fills (e.g., `ic_fluent_send_24_color.svg` uses `radialGradient`/`linearGradient`), including Chat, Database, Clock, Laptop, Building, Calendar, Approvals App, Bot, Coin Multiple and Checkmark Circle [verified via `icons_color.md`].
- **Caveat.** The react-icons README says: "We strongly recommend avoiding `Color` icon variants due to several accessibility issues". They are "non-compliant with Windows High Contrast Mode." The workaround is `bundleIcon(XFilled, XColor)` plus a `@media (forced-colors: active)` swap [verified]. On a projector this is acceptable. Ship the bundle anyway.
- **Mapping:** text message → `Chat`; email draft → `Mail`; call → `Call`; money → `CoinMultiple`; approval → `ApprovalsApp`; receipt → `Receipt`; database → `Database`; laptop → `Laptop`; badge → `ContactCard`; time saved → `Clock`; delegate → `PersonSwap`; suggested connection → `PeopleAdd`. Not every one has a Color variant. Where one is missing, use `Filled` in white on a glossy orb chip (Recipe 4 at 40 px).
- **Aero icon rules to honor** ([vis-icons](https://learn.microsoft.com/en-us/windows/win32/uxguide/vis-icons)): flat front-facing at small sizes, one light source from the top-left, no shadow under 24 px, no more than two objects per icon.

### E5. Motion rules [proposal; numbers from sources where cited]

| Kind | Duration | Easing | Notes |
|---|---|---|---|
| Camera move | 900–1200 ms (or d3's recommended `duration` from path length) | van Wijk smooth (`interpolate:'smooth'`) | Heer & Robertson: about 1 s |
| Edge draw (new route hop) | 600 ms | ease-out | `stroke-dashoffset` from length to 0 |
| Message "comet" along edge | 700 ms head, trail fades 600 ms | linear head, ease-out trail | Shopify age 0 to 2 model |
| Reroute (staged) | fade old 300 → pause 150 → draw new 600 → settle glow 400 | ease-in-out | One stage at a time |
| Panel / window change | 280–360 ms | `cubic-bezier(.2,.8,.2,1)` | Crossfade + 8 px rise |
| Number count-up (hero) | 1200 ms | ease-out | `tabular-nums`; only on the receipt scene |
| Attention pulse | ≤ 1 Hz, max 2 cycles | sine | Never > 3 flashes/s (WCAG 2.3.1) |
| Ambient (aurora drift) | ≥ 60 s loop | linear | ≤ 1 px/s, opacity changes ≤ 3% |

- **Stage, don't stack.** Camera moves first, then the edge, then the label or toast. One center event at a time; the rest queue (Aero notifications queued too).
- **Dwell ≥ 2.5 s** after each center event. Merge events that arrive within 600 ms.
- **Reduced motion** (`prefers-reduced-motion: reduce`, or `MotionConfig reducedMotion="user"` in Framer Motion 14.1, where `reducedMotion?: ReducedMotionConfig` is in the installed types [verified]):
  - Camera cuts with a 200 ms crossfade.
  - Edges appear fully drawn.
  - No pulses or comets; the active route just turns white.

### E6. Accessibility rules [proposal; thresholds verified]

- **Text contrast.** At least 4.5:1, or 3:1 for text ≥ 24 px regular or ≥ 18.5 px bold ([WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)). Our minimum projector text is 24 px, but aim for 7:1 because projectors lose contrast. Every pairing in E2 is ≥ 4.5:1 except deliberate context lines.
- **Graphics and UI states.** At least 3:1 ([WCAG 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)). All edge colors pass on `#0B3A66` [verified].
- **Glass panels carry no body text.** The worst case for text near glass, white 72% over `#0E4C8A`, still gives 9.7:1 for `--ink` [derived]. But the rule stays: text sits on opaque white.
- **Reduced transparency:**

  ```css
  @media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
    .aero-chrome { backdrop-filter: none; background: #0E4C8A; }
    .aero-chrome::after { display: none; }
  }
  @media (forced-colors: active) { .aero-chrome, .aero-window__body { border: 1px solid CanvasText; background: Canvas; } }
  ```

  Safari lacks `prefers-reduced-transparency`, so also support `?solid=1`.
- **Color never alone.** Edges have dash patterns. Goal types and statuses have icon + label. The active route has luminance + motion.
- **Flashing.** No more than 3 flashes in any 1 s ([WCAG 2.3.1](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html)).

### E7. Mycelium interaction model [proposal]

**Zoom levels** (React Flow zoom value; positions identical across levels, per Microsoft's semantic zoom rule):

| Level | Zoom | Shows | Labels | Edges |
|---|---|---|---|---|
| **Far: "the org"** | < 0.6 | 12 department orbs (168 px) on the aurora, each with a 32 px chrome name pill and a people count | Department names only | Aggregated dept→dept learned edges, width = 2 + 2·log2(n). Org-chart lines hidden |
| **Mid: "the teams"** | 0.6–1.15 | Department "islands" (soft glass blobs, not boxes) with person orbs (56 px) inside | Names only for DOI ≥ 0 (active route, focus, dept heads), 26–32 px | Person→person learned / delegate / suggested. Org chart as hairline only on toggle |
| **Near: "the conversation"** | > 1.15 | Focused people with name + role; the live message bubble beside the active node | Name 32 px, role 24 px | Only edges touching the focus. Everything else at 25% opacity |

**Department expand and collapse.**
- *Automatic, by zoom.* Crossing 0.6 cross-fades the dept orb into its island and fades people in, staggered 40 ms each. Positions animate *from the orb's center outward* (Heer: "divergence" motion is easy to follow).
- *By event.* When a goal touches a department, that one department expands even at far zoom (focus+context). Others stay as orbs. That's the van Ham/Perer "show context, expand on demand" model.
- *Click (team, post-demo).* Clicking an orb runs `fitView` on that department. A breadcrumb chip ("Org › Analytics Eng") in the top bar returns home. There's no minimap in demo mode: the stage is always the whole org at home zoom.

**A live reroute** ("Not us. Analytics Engineering owns that now."):
1. Camera fits Data Platform + Analytics Eng (1 s, smooth).
2. The Dmitri edge turns orange-red dashed, then *retracts* toward Leo (400 ms). A small 26 px chip appears on the edge: "Not us".
3. Pause 150 ms.
4. The new edge draws Leo → Priya, then Priya's delegate turns violet "covering" → Tom (600 ms each, staged).
5. The learned edge Customer DB → Analytics Eng thickens by 1 px and gets a one-time white shimmer. A toast in the ticker reads "Learned: customer DB access → Analytics Eng".
6. Dwell 2.5 s.

**Path replay** (the "last quarter: 6 hops, 9 days" hook):
- Camera at far level.
- Hops play one at a time. A comet travels each edge. Each department visited gets a white numbered badge (1–6, 28 px, Semibold, on a 40 px white disc), and a big day counter on the stage (56 px) ticks up "Day 1 … Day 9".
- After the last hop, the whole path holds, then collapses into a single straight line from first to last department, captioned "should have been 1 hop".
- Numbers sit *beside* nodes, never on top of edges or people. That fixes the v1 issue where labels sat inside the bubbles.

**Label rules:**
- At most 12 visible labels at any moment.
- Label culling uses Sigma-style grid density: one label per 160 px cell, priority = DOI.
- Labels sit on small chrome pills (Recipe 1, 999 px radius) or as white text with a dark halo. They never sit on department fill.
- Never truncate names. Use first names only.

### E8. Drawing a workflow (Flows) visually

| Option | Pros | Cons on a projector | Verdict |
|---|---|---|---|
| **Delivery-tracker timeline** (horizontal stops: Asked → Routed → Waiting → Replied → Done) | Universally understood. Shows *where it's waiting*. Great for one goal | Hides *who handed off to whom* | **Yes, as a docked strip** |
| **Swimlanes by person** | Precise handoffs | 5–8 lanes × tiny text, a wall again. Needs reading time | No (keep for a post-demo admin view) |
| **Path on the graph** | Shows the *shape* of the work. Reuses the hero visual. Reroutes are visible | Step text can't live there | **Yes, as the primary** |
| **Subway map** (one colored line per goal, stops = people) | Beautiful. Shows parallel goals sharing stations. Octilinear maps are a known, readable convention (Nöllenburg & Wolff, [KIT](https://i11www.iti.kit.edu/extra/publications/nw-dlhqm-10.pdf) [unverified, search summary]) | A second layout to build. Competes with Mycelium | Maybe for Insights' "all goals this week" receipt |
| Cards (v1) | Complete | "Wall of text" | No |

**Recommendation.** The route on the graph is the flow. A docked **tracker strip** (bottom-left Aero window, about 960×220 px at 1080p) carries the steps:
- One row of 4–6 stops. Each stop is a 40 px orb with a Fluent icon, a 24 px step name below, and the owner's first name.
- Status by fill (done = solid green orb with a check, waiting = amber ring with a 1 Hz pulse, ×2 then still) plus the label.
- Only the **current** stop expands upward into a white iMessage-style bubble with the actual text sent or received, at 28 px, ≤ 2 lines.
- High-stakes steps get an amber "Needs Leo's OK" chip and a lock icon.
- Email drafts become a single chip on the stop ("Draft ready, Gmail"), not a strip that pushes the flow off-screen.

### E9. Big-screen layout: one stage

**One stage, three scenes, no tabs.** Scenes switch automatically from the event `focus` field. Tabs become a small chrome indicator pill: "Live · Replay · Receipt". Layout at 1920×1080 [proposal]:

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ [W] Wayfinder  ● live               "How work really flows"      Live·Replay·Receipt │  top chrome, 64px
│                                                                                │
│                 M Y C E L I U M   (full-bleed stage, behind everything)        │
│      ○ Finance        ○ Legal                ○ IT ─────●  Ivan                 │
│            ○ People & Facilities   ●Leo ═══════╗                               │
│                                     Analytics Eng ●Priya ┄┄ ●Tom               │
│                                                                                │
│ ┌ Leo's first week ──────────────────────────┐            ┌──────────────────┐ │
│ │ "It's my first day. I need a laptop…"      │            │   3 h            │ │
│ │ ●──────●──────◐──────○──────○              │            │   vs 4 days      │ │
│ │ Laptop  Badge  DB access  Buddy  Done      │            │   last 10 hires  │ │
│ └────────────────────────────────────────────┘            └──────────────────┘ │
│  ▸ Priya is out till Thu, so Tom is covering · 2s ago                          │  ticker, 48px
└────────────────────────────────────────────────────────────────────────────────┘
```

**Focal point per demo moment:**

| Moment | Center (loud) | Periphery (calm) | Scene |
|---|---|---|---|
| Idle / attract | The whole org at far zoom, slow aurora | Headline "How work really flows" | Live |
| Hook: last quarter's bounce chain | Path replay with day counter | Hero tile hidden | Replay |
| Leo texts | His message bubble enters the goal window. Camera to Analytics Eng | Graph dims to 60% except Leo | Live |
| Routing (auto texts to Ivan, Fatima) | Edges draw out from Leo, staged | Tracker stops turn "Sent" | Live |
| Reply: "Not us…" (reroute) | Reroute sequence (E7) | Ticker: "Learned…" | Live |
| Delegate (Priya out → Tom) | Violet dashed edge + "covering" pill | — | Live |
| High-stakes approval | Goal window: amber "Waiting on Leo: send?" | Graph holds still | Live |
| Done / receipt | **Hero number** grows to 160 px "3 h vs 4 days"; graph dims to 40% and shows the final route only | Before/after line, a single bar pair drawn to true scale | Receipt |

**Insights becomes the Receipt scene,** not a KPI grid. Show one number with its comparison (Geckoboard: numbers beat gauges and pies). Then a simple two-bar comparison drawn honestly. The v1 doc complained that "Leo's 3-hour bar is a sliver". That's correct behavior: show it on a log axis with a label, or as "32× faster", not as a misleading bar. Optional: the top 3 slowest handoffs as a ranked list at 28 px. No donut.

### E10. Anti-patterns: what makes Aero look cheap

1. **Glass under reading text.** Translucent content cards (v1). Apple: no glass "in the content layer"; Microsoft: glass "without text."
2. **Heavy frosted blur** (20–40 px) everywhere. That's glassmorphism, not Aero. Aero used light blur + tint + streaks.
3. **Gloss on everything.** Gloss belongs on objects and one button, never on panels, charts or chips (Few rule #9: no visual effects in graphs).
4. **Decorative bubbles, bokeh and lens flares** floating over content (v1's four circles). Keep atmosphere inside the backdrop at ≤ 14% opacity.
5. **Rainbow categories.** 12 department hues, or 5 type colors on the graph. Use one dominant hue per scene (Xbox Blades lesson), with color for jobs only.
6. **Rounded "cute" fonts** (Nunito, Quicksand, Varela Round) and heavy 800-weight titles. Aero type is humanist and light-to-semibold.
7. **Tiny labels** (11–12 px pills). Nothing essential under 24 px on stage.
8. **Emoji icons** next to rendered chrome. Use one icon family with one light source.
9. **Equal-weight card grids** and KPI tiles. That's SaaS, not Aero. One window and one gadget.
10. **Stacked or adjacent glass panes,** which create seams and optical illusions (Fluent Acrylic).
11. **Bevels, drop-shadowed text and "Web 2.0" reflections under everything** ([snap2objects 2007](https://snap2objects.com/2007/11/20/how-to-destroy-the-web-20-look/)). Use at most one reflection: under the hero number, if any.
12. **Motion everywhere.** Pulses that never stop, a camera that moves with every event, rotation. One live thing, about 1 s moves, ≤ 2 pulse cycles.
13. **Pure-black or pure-saturated backgrounds.** Vista's aurora is deep teal-navy with soft light, not `#000` or `#00F`.
14. **Replica chrome** (fake title-bar minimize/maximize/close buttons, Start orb). It reads as costume, not product. Borrow the materials, not the OS.

---

## Sources (URLs actually opened, grouped by track)

### Track A
- https://learn.microsoft.com/en-us/windows/win32/uxguide/vis-fonts
- https://learn.microsoft.com/en-us/windows/win32/uxguide/vis-color
- https://learn.microsoft.com/en-us/windows/win32/uxguide/vis-icons
- https://learn.microsoft.com/en-gb/windows/win32/uxguide/win-window-frames
- https://learn.microsoft.com/en-us/windows/win32/uxguide/winenv-desktop
- https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic
- https://learn.microsoft.com/en-us/windows/apps/design/style/mica
- https://developer.apple.com/design/human-interface-guidelines/materials (read via https://developer.apple.com/tutorials/data/design/human-interface-guidelines/materials.json)
- https://www.nngroup.com/articles/glassmorphism/
- https://www.joshwcomeau.com/css/backdrop-filter/
- https://frutigeraeroarchive.org/
- https://frutigeraeroarchive.org/history
- https://frutigeraeroarchive.org/blog/posts/20_09_2025
- https://cari.institute/aesthetics/frutiger-aero
- https://snap2objects.com/2007/11/20/how-to-destroy-the-web-20-look/
- https://namethatui.com/styles/windows-aero
- https://en.wikipedia.org/wiki/Windows_Aero
- https://en.wikipedia.org/wiki/Frutiger_Aero
- https://en.wikipedia.org/wiki/Segoe
- https://en.wikipedia.org/wiki/Open_Sans
- https://en.wikipedia.org/wiki/Frutiger_(typeface)
- https://en.wikipedia.org/wiki/Myriad_(typeface)
- https://github.com/microsoft/Selawik (README + license via GitHub API)
- https://github.com/microsoft/fonts (README)
- https://cdn.jsdelivr.net/npm/winstrap@0.5.12/dist/fonts/LICENSE.txt (and the file listing via data.jsdelivr.com)
- https://fonts.googleapis.com/css2 (availability check for Open Sans, Noto Sans, Hind, Mukta, Fira Sans, Source Sans 3, Istok Web, Signika, and others)
- https://github.com/microsoft/fluentui-system-icons (README, icons_color.md, packages/react-icons/README.md, assets/Send/SVG)
- https://github.com/mdn/browser-compat-data (css/at-rules/media.json, css/properties/backdrop-filter.json)
- https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
- https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html

### Track B
- https://perer.org/papers/adamPerer-DOIGraphs-InfoVis2009.pdf
- https://idl.cs.washington.edu/files/2007-AnimatedTransitions-InfoVis.pdf
- https://d3js.org/d3-interpolate/zoom
- https://d3js.org/d3-force/position
- https://learn.microsoft.com/en-us/windows/apps/design/controls/semantic-zoom
- https://reactflow.dev/examples/interaction/contextual-zoom
- https://reactflow.dev/learn/layouting/sub-flows
- https://reactflow.dev/learn/advanced-use/performance
- Local: `apps/web/node_modules/@xyflow/react@12.12.0` and `@xyflow/system` type definitions (read-only)
- https://js.cytoscape.org/#notation/compound-nodes
- https://github.com/iVis-at-Bilkent/cytoscape.js-expand-collapse
- https://github.com/jacomyal/sigma.js/blob/main/packages/sigma/src/settings.ts
- https://docs.kumu.io/guides/focus
- https://obsidian.md/help/plugins/graph
- https://neo4j.com/docs/bloom-user-guide/current/bloom-visual-tour/bloom-scene-interactions/
- Not opened (search summaries only, marked [unverified] above): Holten 2006 (tuwien course copy), Furnas 1986 (ucalgary copy), Cambridge Intelligence combos, Nöllenburg & Wolff metro maps (KIT PDF).

### Track C
- https://www.perceptualedge.com/articles/Whitepapers/Common_Pitfalls.pdf
- https://www.perceptualedge.com/articles/visual_business_intelligence/rules_for_using_color.pdf
- https://www.csc2.ncsu.edu/faculty/healey/PP/
- https://calmtech.com/papers/designing-calm-technology
- https://api.avixa.org/standards/discas-calculators/discas/learn-more-about-display-size
- https://api.avixa.org/standards/discas-calculators/discas/bdm
- https://www.geckoboard.com/blog/data-visualization-for-tv-dashboards-a-teardown
- https://panic.com/blog/the-panic-status-board/
- https://shopify.engineering/how-we-built-shopifys-bfcm-2023-globe
- http://listen.hatnote.com/
- https://docs.github.com/en/actions/how-tos/monitor-workflows/use-the-visualization-graph

### Track D
- https://github.com/khang-nd/7.css (gui/_variables.scss, gui/_window.scss, gui/_progressbar.scss)
- https://makeaero.com and https://github.com/Visnalize/makeaero (app/orb/orb-client.tsx)
- https://trends.daisyui.com/trend/frutiger-aero/
- https://github.com/Z2r-YT/7-Aero-Stylesheet (metadata, file list)
- https://github.com/jdan/98.css, https://github.com/botoxparty/XP.css (metadata)
- https://frutigeraeroarchive.org/images/introduction/windows_7.jpg, windows_vista.jpg, windows_vista_website.jpg, xbox_360_blades.jpg, wii.jpg (viewed)
- Wikipedia summaries: Wii system software, Zune, Xbox system software, iOS 6, Windows Media Center, Windows Desktop Gadgets, Metro (design language)
- Blocked (403 or Cloudflare), listed from search only: https://codepen.io/LuizMouraBR/pen/wBvZOJx, https://codepen.io/rzahniser/pen/ONwdQQ, https://codepen.io/vikas78/pen/vYEymWd, https://dribbble.com/tags/frutiger-aero, https://www.webdesignmuseum.org/gallery/windows-vista-2008

### Track E (tools used)
- Contrast ratios: computed with the WCAG 2.x relative-luminance formula (script run locally).
- Palette checks: the dataviz skill's `scripts/validate_palette.js` (lightness band, chroma, CVD ΔE, normal-vision ΔE, contrast), light mode on `#FFFFFF`/`#EEF5FB` and dark mode on `#0B3A66`, adjacent and all-pairs.
