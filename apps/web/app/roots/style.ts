// Verbatim page <style> from docs/design/v6/roots.html (mounted with the page so it never leaks).
export const css = String.raw`
html,body{overflow:hidden}
*{-webkit-user-select:none;user-select:none}
canvas#scene{position:fixed;inset:0;width:100%;height:100%;display:block;cursor:crosshair}
canvas#scene.pointing{cursor:pointer}

/* My queries card (replaces v4's engine card) */
#mine{left:28px;top:28px;width:350px;max-height:calc(100vh - 140px);display:flex;flex-direction:column}
#mine .body{display:flex;flex-direction:column;gap:10px;min-height:0;overflow:hidden}
#mine .page-title{margin:2px 0 0}
#mine .who{display:flex;align-items:center;gap:10px;padding-top:4px}
#mine .who .t{font-weight:600;font-size:14px}
#mine .who .s{font-size:12px;color:var(--ink-2)}
#mine .who .chip{margin-left:auto}
#qlist{overflow:auto;min-height:0;padding:2px 4px 2px 0;margin-right:-4px}
#qlist .row{cursor:pointer}
#qlist .row .mid{flex:1;min-width:0}
#qlist .row .t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#qlist .row .meta{display:flex;align-items:center;gap:8px;margin-top:4px}
#qlist .row .chip{font-size:11px;padding:1px 8px;flex:none}
#qlist .row .go{font-size:18px;color:var(--ink-2);opacity:.5;transition:opacity .25s,translate .3s var(--spring)}
#qlist .row:hover .go{opacity:1;translate:3px 0}
#qlist .row.playing{background:rgb(255 255 255/.85);box-shadow:0 0 0 2px #fff,0 4px 14px rgb(0 40 100/.15)}
.vleg{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11px;color:var(--ink-2)}
.vleg span{display:inline-flex;align-items:center;gap:5px}
.vleg i{width:8px;height:8px;border-radius:50%}
.empty{font-size:13px;color:var(--ink-2);padding:10px 4px}

/* Legend strip: thin glass bar above the dock (replaces v5's Network panel) */
#legend{position:fixed;left:50%;bottom:100px;translate:-50% 0;z-index:12;display:flex;align-items:center;gap:18px;padding:7px 18px;border-radius:99px;white-space:nowrap;
  font-size:13px;color:var(--ink-2);background:linear-gradient(175deg,rgb(255 255 255/.62),rgb(255 255 255/.32));border:1px solid rgb(255 255 255/.8);
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 6px 18px rgb(0 40 100/.14),inset 0 1px 0 #fff}
#legend span{display:inline-flex;align-items:center;gap:7px}
#legend .dot.l{width:15px;height:15px}#legend .dot.m{width:11px;height:11px}#legend .dot.s{width:8px;height:8px}
#legend .flat{width:16px;height:6px;border-radius:3px}
#legend .n{font-weight:600;color:var(--ink)}

/* Focus bar */
#focusbar{position:fixed;top:28px;left:50%;translate:-50% -12px;z-index:12;display:flex;gap:10px;align-items:center;opacity:0;pointer-events:none;transition:opacity .4s var(--ease),translate .5s var(--spring)}
#focusbar.on{opacity:1;translate:-50% 0;pointer-events:auto}
#focusbar .lbl{font-size:14px;padding:8px 14px}

/* Scene labels: wrapper is placed by CSS2D, inner pill sits above the bubble */
.lw{pointer-events:none}
.lw .lbl{transform:translateY(-24px)}
.lw .lbl.dept{font-size:13px}
.lw .lbl.sub{font-size:12px;font-weight:600;padding:5px 9px 5px 7px;transform:translateY(-18px)}
.lw .lbl.person{transform:translateY(-14px)}
.lw .lbl.off{transform:translateY(-8px) scale(.9)}
.lw .lbl.dim{opacity:.32}
.lw .lbl.core{font-size:15px;color:#fff;text-shadow:0 1px 2px rgb(0 60 0/.5);transform:translateY(-44px);
  background:linear-gradient(180deg,rgb(255 255 255/.5),rgb(255 255 255/.1) 49%,transparent 50%),linear-gradient(180deg,#5BD86B,#1F8F37);border-color:rgb(255 255 255/.7)}
.lw .lbl.me{box-shadow:0 0 0 2px #5BD86B,0 3px 10px rgb(0 40 100/.22)}

@media (max-width:700px){
  #mine{left:12px;right:12px;top:12px;width:auto;max-height:40vh}
  #mine .who{display:none}
  #mine .page-title{font-size:28px}
  #mine{right:84px}
  #legend{bottom:72px;gap:10px;padding:5px 12px;font-size:11px}
  #legend .opt{display:none}
  #focusbar{top:auto;bottom:150px}
  body.has-dock #toast{bottom:112px}
}
`;
