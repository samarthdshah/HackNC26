// Verbatim page CSS from docs/design/v6/insights.html (rendered in a <style> that unmounts with the page).
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
.tile{padding:12px 14px 10px;border-radius:12px;background:rgb(255 255 255/.5);border:1px solid rgb(255 255 255/.8);box-shadow:inset 0 1px 0 #fff,0 2px 8px rgb(0 40 100/.08);display:grid;gap:4px}
.tile .num{font-size:30px;font-weight:300;line-height:1.05;letter-spacing:-.01em;white-space:nowrap}
.tile .num small{font-size:15px;color:var(--ink-2);font-weight:400}
.tile .foot{display:flex;align-items:center;justify-content:space-between;gap:6px}
.tile .chip{white-space:nowrap;font-size:11px;padding:2px 7px}
.spark{flex:1 1 auto;min-width:40px;max-width:84px;height:26px;overflow:visible}
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

/* Skill bars */
.skills{display:grid;gap:9px}
.skill-row{display:grid;grid-template-columns:118px minmax(0,1fr);align-items:center;gap:10px;font-size:14px;font-weight:600}
.skill{position:relative;height:30px;border-radius:10px;overflow:hidden;background:rgb(255 255 255/.55);box-shadow:inset 0 1px 3px rgb(0 40 100/.22),0 1px 0 rgb(255 255 255/.8)}
.skill .fill{position:absolute;inset:0 auto 0 0;width:var(--w);border-radius:10px;transform-origin:left;
  background:linear-gradient(180deg,rgb(255 255 255/.55),rgb(255 255 255/.12) 49%,transparent 50%),linear-gradient(90deg,var(--accent-lo),var(--accent-hi));
  box-shadow:inset 0 0 0 1px rgb(255 255 255/.45),2px 0 8px rgb(0 40 100/.2)}
.skills:not(.go) .fill{transform:translateX(-102%)}
.skills.go .fill{animation:skills 1.25s cubic-bezier(.17,.67,0,1) both;animation-delay:calc(var(--i) * 70ms)}
@keyframes skills{0%{transform:translateX(-102%);opacity:0}100%{transform:translateX(0);opacity:1}}
.skill .lab{position:relative;z-index:1;display:flex;justify-content:flex-end;align-items:center;height:100%;padding:0 10px;font-size:13px;font-weight:600}
.skill .lab .h{color:var(--ink);text-shadow:0 1px 0 rgb(255 255 255/.7)}

/* Recharts */
.chart{height:280px}
.tip{padding:10px 12px;font-size:13px;min-width:150px}
.tip .t{font-weight:600;margin-bottom:4px}
.tip .r{display:flex;justify-content:space-between;gap:14px;color:var(--ink-2)}
.tip .r b{color:var(--ink);font-weight:600}
.tip .r i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:0}
.recharts-cartesian-axis-tick-value{font-family:var(--font)}
.legend{display:flex;gap:16px;font-size:13px;color:var(--ink-2);margin-bottom:6px}
.legend span{display:inline-flex;align-items:center;gap:6px}

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

@media (max-width:1000px){ .kpis{grid-template-columns:repeat(3,minmax(0,1fr))} }
@media (max-width:700px){
  main{padding:18px 12px 120px}
  header.top{flex-direction:column;align-items:flex-start}
  header.top .page-title{font-size:40px}
  .grid{grid-template-columns:minmax(0,1fr)}
  .kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
  .chord-grid{grid-template-columns:minmax(0,1fr)}
  .skill-row{grid-template-columns:100px minmax(0,1fr)}
  .chart{height:240px}
}
/* port: seven honest KPI tiles instead of v6's six (hours lost and hours saved are separate) */
.kpis{grid-template-columns:repeat(7,minmax(0,1fr))}
@media (max-width:1000px){ .kpis{grid-template-columns:repeat(4,minmax(0,1fr))} }
@media (max-width:700px){ .kpis{grid-template-columns:repeat(2,minmax(0,1fr))} }
`;
