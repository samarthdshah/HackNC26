# Wayfinder design blueprint

The Frutiger Aero design system for the Wayfinder web app. **v6 is the current target.** v5 is the previous pass and is kept for comparison.

| Folder | What it is |
|---|---|
| `v6/` | Current design: six pages on one shared kit. Build from this. |
| `v5/` | First six-page pass (same kit, before the feedback round). |
| `v4-aero-network.html` | The original style source the kit was lifted from (glass, sky/sea shaders, candy buttons). |
| `exploration/` | Early visual exploration: relationships as the map, requests as routes over time. |

To view it, run `cd docs/design/v6 && python3 -m http.server` and open `localhost:8000`. Add `?notour` to skip the first-visit tour.

## The pages

Page titles use Avatar-themed names. The plain function is in brackets.

| File | Name | Job (one line) |
|---|---|---|
| `index.html` | Home Tree (landing) | Name, tagline, and a cube globe with stat pins. The intro plays once, then the globe settles on the right. |
| `roots.html` | Roots (org graph) | Departments, then teams, then people, as glass bubbles. Click a department to zoom in. The left card lists your queries. |
| `currents.html?q=<id>` | Currents (one query) | One request flowing left to right: numbered hops, the learned shortcut, transactions and chat. |
| `insights.html` | Insights (dashboard) | KPIs, the gain chart, hours by department, Recharts area and bar charts, and a d3 chord diagram of routing. |
| `lagoon.html` | Lagoon (discovery) | You as the jellyfish. Topic bubbles group people working on the same thing; a bubble opens a drawer with Introduce. |
| `darwin.html` | Darwin Growth (self-improvement) | A tree grows one generation per ring, then stops. Orange fruit are learned rules you can approve or reject. |

## Rules (the page contract)

1. **The whole look is Frutiger Aero.** That means glass, sky and sea gradients, glossy highlights, soft blue shadows (`rgb(0 40 100/.18)`) and the Selawik font. Papyrus (`--display`) is used for page titles only.
2. **Use the kit, don't invent.** Every card is `.milk` and every button is `.pill`, `.ctl` + `.sq`, `.orb` or `.round-button`. Page CSS covers layout and the visualisation only.
3. **Three colours plus one page accent.** Everything draws from `--c-primary`, `--c-secondary` and `--c-warm`, and each theme redefines those same three. Each page also has one `--page` colour, matching its dock button. Exactly one element uses it: the title card header.
4. **Title cards stay minimal.** The `.title-card` shows the title and one line. Everything else goes inside `.more`, which is collapsed by default and opened with the chevron.
5. **Explanations live in the tour, not on the page.** Mark 4–6 elements with `data-tour="n|Title|One or two plain sentences"`. The tour runs on the first visit and can be replayed from the menu.
6. **Fixed chrome:**
   - The bottom **dock** handles navigation between pages.
   - The top-right **hamburger** (logo orb) fans out into Tour, Details and the 3 themes.
   - The bottom-left **toast** shows live messages and auto-hides after 6.5 s.

   Keep content clear of all three: about 90 px at the bottom, 90×90 px in the top right.
7. **Phone breakpoint is 700 px.** Honour `prefers-reduced-motion`.

## Kit reference (`v6/shared/`)

**`aero.css`: tokens**
- Colour: `--c-primary`, `--c-secondary`, `--c-warm`, `--page` / `--page-hi`.
- Text: `--ink`, `--ink-2`.
- Status: `--good`, `--warn`, `--bad`.
- Type: `--font`, `--display`.
- Motion: `--ease`, `--spring`.
- Legacy, still used by charts and three.js: `--accent*` and `--lv0..5`.
- Themes are switched with `:root[data-theme="0|1|2"]`: Aqua Sky, Eco Leaf, Sunset Glass.

**`aero.css`: components**

| Class | Use |
|---|---|
| `.milk` (`.float`, `.still`, `.body`) | Glass panel for any text |
| `.bar` (`.live`) | Glossy title bar on a panel |
| `.title-card`, `.more` | The page's main card (see rule 4) |
| `.page-title`, `.page-sub`, `.k` | Title (Papyrus), one-line sub, small caps eyebrow |
| `.orb`, `.logo-orb`, `.dot` | Glossy avatars and markers |
| `.pill` (`.green`, `.ghost`) | Primary and secondary actions |
| `.ctl` + `.sq.<colour>` | XP-style candy square buttons (dock, Introduce) |
| `.round-button.<colour>` | Round glossy buttons (hamburger items) |
| `.seg`, `.switch`, `input[type=range]` | Controls |
| `.chip` (`.warn`, `.bad`, `.info`) | Status tags |
| `.row` / `.rows`, `.lbl` | Lists inside cards, scene labels |
| `#toast` | Message alert (built by `aero.js`) |

**`aero.js`: `window.Aero`**
- `palette()` gives the three.js hex colours; `css('--name')` reads a resolved token.
- `onTheme(fn)` re-tints when the theme changes; `setTheme(i)` switches it.
- `toast(kind, k, m, s)` takes kind `route`, `myc`, `evo` or `msg`.
- `tour()` and `card(open)` run the tour and open or close the title card.
- `RM` is true when reduced motion is on.

**`data.js`: `window.WF`**
- Sample company data: 9 departments, 19 teams, 37 people, and the "me" user Leo Park.
- Queries with hops and verdicts, transactions, Mycelium matches, stats, a 12-week series, Darwin generations and rules.
- Helpers: `person`, `dept`, `query`, `nameOf`.

**Libraries** (pinned, from CDN in the mockups): three@0.162.0, gsap@3.13.0, d3@7.9.0, react@18.3.1, recharts@2.12.7.

## Porting to `apps/web`

- **CSS:** move `aero.css` tokens and classes into `app/globals.css`, or a CSS module, unchanged. Theme switching sets `data-theme` on `<html>`.
- **Components:** wrap the kit classes in thin React components (`<Milk>`, `<Bar>`, `<TitleCard>`, `<Pill>`, `<Candy>`, `<Toast>`) instead of rewriting their styles.
- **Layout:** the dock, hamburger and tour belong in the app layout, so every route gets them.
- **Data:** `data.js` matches the shape the pages expect. Replace it with the agent's live feed, keeping the same fields.
