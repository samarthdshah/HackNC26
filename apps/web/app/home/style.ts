// Verbatim page CSS from docs/design/v6/index.html, with the v7 hero changes (rendered in a <style> that unmounts with the page).
export const css = `
html,body{overflow:hidden}
body[data-page=home]{--page:var(--accent);--page-hi:var(--accent-hi)}   /* hero title bar matches the other panels' .bar and follows the theme */
/* Sky: theme gradient from aero.css, plus the v4 sun and Vista light ribbons */
#sky{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}
#sky .sun{position:absolute;left:8%;top:-14%;width:60vmax;height:60vmax;border-radius:50%;
  background:radial-gradient(circle,rgb(255 252 235/.95) 0,rgb(255 248 220/.55) 6%,rgb(255 255 255/.18) 22%,transparent 55%)}
#sky svg{position:absolute;inset:0;width:100%;height:100%}
#sky .rib{fill:none;stroke:#fff;stroke-linecap:round;filter:blur(6px)}
#sky .haze{position:absolute;left:0;right:0;bottom:0;height:38%;background:linear-gradient(180deg,transparent,rgb(255 255 255/.45))}
canvas#globe{position:fixed;inset:0;width:100%;height:100%;display:block;z-index:1}

/* Hero card on the left */
#heroWrap{position:fixed;z-index:10;left:5vw;top:0;bottom:96px;display:flex;align-items:center;pointer-events:none}
#hero{width:min(480px,40vw);opacity:0;pointer-events:auto}
#hero .body{padding:16px 22px 20px}
#hero .page-title{font-size:72px;margin:0 0 6px;padding-top:0;color:var(--ink)}
#hero .tag{font-size:21px;font-weight:300;line-height:1.3;margin-bottom:10px}
#hero .tag b{font-weight:600;color:var(--accent-lo)}
#hero .page-sub{margin-bottom:16px}
#hero .ctas{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px}
#hero .eng{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding-top:4px}
#hero .eng .milk{border-radius:22px;box-shadow:inset 0 0 14px rgb(255 255 255/.85),inset 0 -6px 14px rgb(160 210 245/.35),0 8px 20px rgb(0 40 100/.18)}
#hero .eng .milk:hover{box-shadow:inset 0 0 16px rgb(255 255 255/.95),inset 0 -6px 14px rgb(160 210 245/.4),0 12px 26px rgb(0 40 100/.22)}
#hero .eng .milk::before{content:"";position:absolute;left:0;right:0;top:0;height:50%;pointer-events:none;border-radius:22px 22px 50% 50% / 22px 22px 18px 18px;
  background:linear-gradient(180deg,rgb(255 255 255/.85),rgb(255 255 255/.15))}   /* glossy upper half */
#hero .eng .in{position:relative;padding:10px 12px 13px}
#hero .eng p{font-size:12px;line-height:1.35;color:var(--ink-2)}
#hero .reveal{opacity:0}

/* Stat pins: glass labels anchored to cubes */
#pins{position:fixed;inset:0;z-index:6;pointer-events:none}
#leaders{position:fixed;inset:0;width:100%;height:100%;z-index:5;pointer-events:none}
#leaders line{stroke:#fff;stroke-width:1.5;stroke-opacity:.9;filter:drop-shadow(0 1px 1px rgb(0 40 100/.35))}
#leaders circle{fill:#fff;filter:drop-shadow(0 1px 2px rgb(0 40 100/.4))}
.pin{position:absolute;left:0;top:0;opacity:0;transition:opacity .45s var(--ease)}
.pin .lbl{flex-direction:column;align-items:flex-start;gap:3px;padding:8px 12px 8px 11px;border-radius:14px}
.pin .v{font-size:20px;font-weight:700;line-height:1;color:var(--ink);display:flex;align-items:center;gap:7px}
.pin .v i{width:10px;height:10px}
.pin .l{font-size:12px;font-weight:400;color:var(--ink-2);line-height:1}
.pin .chip{margin-top:2px}

#globeSpot{position:fixed;right:3vw;top:7vh;width:46vw;height:76vh;pointer-events:none}
#skip{position:fixed;right:24px;bottom:110px;z-index:12;transition:opacity .4s}
#skip.gone{opacity:0;pointer-events:none}

@media (max-width:700px){
  #heroWrap{left:12px;right:12px;bottom:84px;align-items:flex-end}
  #hero{width:100%}
  #hero .page-title{font-size:46px}
  #hero .tag{font-size:17px}
  #hero .page-sub{display:none}
  .pin .v{font-size:16px} .pin .l{font-size:11px}
  .pin.m-hide{display:none}
  #skip{bottom:auto;top:16px;right:72px}
  #globeSpot{left:8vw;right:8vw;width:auto;top:6vh;height:44vh}
}
`;
