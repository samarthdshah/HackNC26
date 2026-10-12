// Page CSS from docs/design/v6/insights.html, trimmed with the page (rendered in a <style> that unmounts with the page).
export const css = `
html,body{overflow-x:hidden}
body[data-page=insights]{--page:var(--accent);--page-hi:var(--accent-hi)}   /* v7: title bar matches the other panels instead of dock amber */
canvas#bubbles{position:fixed;inset:0;width:100%;height:100%;z-index:0;pointer-events:none}
main{position:relative;z-index:1;max-width:1280px;margin:0 auto;padding:30px 28px 140px}

header.top{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:22px;color:#fff;text-shadow:0 1px 3px rgb(0 40 100/.35)}
header.top .k{color:rgb(255 255 255/.9)}
header.top .page-title{line-height:1.2;padding-top:.22em}
header.top .page-title{font-size:56px}
header.top .page-sub{color:rgb(255 255 255/.92);max-width:560px;font-size:16px}
header.top .when{display:flex;gap:10px;align-items:center}

.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}
.span2{grid-column:1 / -1}
.card .body{padding:16px 18px 18px}
.bar .sub{margin-left:auto;font-weight:400;font-size:13px;color:#F0F8FF}

/* KPI tiles */
.kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}
.tile{min-width:0;overflow:hidden;padding:12px 14px 10px;border-radius:12px;background:rgb(255 255 255/.5);border:1px solid rgb(255 255 255/.8);box-shadow:inset 0 1px 0 #fff,0 2px 8px rgb(0 40 100/.08);display:grid;gap:4px}
.tile .num{font-size:30px;font-weight:300;line-height:1.05;letter-spacing:-.01em;white-space:nowrap}
.tile .num small{font-size:15px;color:var(--ink-2);font-weight:400}
.tile .foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:4px 6px;min-width:0}   /* the sparkline drops under the chip when the card is narrow */
.tile .chip{white-space:nowrap;font-size:11px;padding:2px 7px;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.spark{flex:1 0 56px;min-width:0;max-width:84px;height:26px;overflow:visible}
.spark .ln{fill:none;stroke:var(--accent);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.spark .ar{fill:var(--accent-soft);opacity:.22}
.spark .end{fill:#fff;stroke:var(--accent);stroke-width:1.5}

/* Gain radial */
.gain-wrap{position:relative;border-radius:12px;overflow:hidden;aspect-ratio:750/500;
  background:radial-gradient(120% 90% at 30% 0%,rgb(255 255 255/.35),transparent 55%),linear-gradient(150deg,var(--accent-hi) 0%,var(--accent) 50%,var(--accent-lo) 100%);
  box-shadow:inset 0 1px 0 rgb(255 255 255/.8),inset 0 -20px 40px rgb(0 30 80/.18)}
.gain-wrap::before{content:"";position:absolute;top:0;left:3%;width:94%;height:42%;border-radius:0 0 50% 50%;pointer-events:none;background:linear-gradient(rgb(255 255 255/.28),transparent)}
#gain{position:relative;width:100%;height:100%;display:block;visibility:hidden}
#gain .nm{font:600 14px var(--font);fill:#fff;letter-spacing:.04em}
#gain .nm tspan{font-weight:400;fill:rgb(255 255 255/.8);letter-spacing:0}
#gain .jt{font:400 13px var(--font);fill:rgb(255 255 255/.9)}
#gain .val{font:600 11px var(--font);fill:var(--ink);opacity:0}
#gain #gainTxt{font:600 15px var(--font);fill:var(--ink)}
.card-actions{display:flex;justify-content:space-between;align-items:center;margin-top:12px;gap:10px}

/* Chord */
.chord-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:20px;align-items:center}
#chord{width:100%;max-height:520px;display:block}
#chord .grp path{stroke:#fff;stroke-width:1.5;cursor:pointer;transition:opacity .3s}
#chord .rib{stroke:rgb(255 255 255/.8);stroke-width:.6;transition:opacity .3s;fill-opacity:.62}
#chord text{font:600 12px var(--font);fill:var(--ink)}
#chord.iso .rib{opacity:.07}
#chord.iso .rib.on{opacity:1}
#chord.iso .grp path{opacity:.35}
#chord.iso .grp.on path{opacity:1}
.detail .big{font-size:34px;font-weight:300;line-height:1.1}
.detail .rows{margin-top:12px}
.detail .row .v{margin-left:auto;font-weight:600}

@media (max-width:700px){
  main{padding:18px 12px 120px}
  header.top{flex-direction:column;align-items:flex-start}
  header.top .page-title{font-size:40px}
  .grid{grid-template-columns:minmax(0,1fr)}
  .kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
  .chord-grid{grid-template-columns:minmax(0,1fr)}
}
/* port: four KPI tiles in a 2x2 beside the gain radial; the card stretches to the radial's height */
.kpi-card{display:flex;flex-direction:column}
.kpi-card .body{flex:1;display:flex}
.kpis{flex:1;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:1fr}
.kpi-card .tile{align-content:space-between;padding:14px 16px 12px}
.kpi-card .tile .num{font-size:38px}
.kpi-card .spark{max-width:110px}
@media (max-width:1000px){ .kpi-card .tile .num{font-size:32px} }
`;
