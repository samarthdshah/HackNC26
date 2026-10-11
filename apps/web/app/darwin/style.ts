// Verbatim from docs/design/v6/darwin.html <style> (shared/logo.svg → /logo.svg).
export const STYLE = `
html,body{overflow:hidden;-webkit-user-select:none;user-select:none}
/* v4 daylight: sun glow and two soft light ribbons behind the tree */
body::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;
  background:radial-gradient(circle at 18% 12%,rgb(255 250 230/.75),rgb(255 250 230/0) 22%),
    radial-gradient(120% 40% at 50% 34%,rgb(255 255 255/.18),transparent 60%)}
body::after{content:"";position:fixed;left:-10%;right:-10%;top:26%;height:18%;pointer-events:none;z-index:0;border-radius:50%;
  border-top:2px solid rgb(255 255 255/.35);border-bottom:1px solid rgb(255 255 255/.2);transform:rotate(-4deg);filter:blur(1px)}

#stage{position:fixed;inset:0 0 96px 0;display:flex;align-items:center;justify-content:center;z-index:1}
#tree{display:block}
#tree.hit{cursor:pointer}

#head{left:28px;top:28px;width:340px}
#head .page-title{margin:2px 0 6px}
#head .now{margin:14px 0 4px;font-size:30px;font-weight:300;line-height:1.1}
#head .now b{font-weight:600}
#head .now .g{display:inline-block;transition:transform .45s var(--spring)}
#head .now .g.bump{transform:scale(1.12)}
#head .from{font-size:13px;color:var(--ink-2)}
#head .acts{display:flex;align-items:center;gap:10px;margin-top:14px;flex-wrap:wrap}

#gens{right:28px;top:96px;width:310px}   /* clear of the top-right menu */
#gens .body{padding:12px 12px 14px}
#gens .rows{gap:6px}
.gen{gap:10px;padding:7px 10px}
.gen .orb.sm{background:radial-gradient(circle at 35% 28%,#fff,#B8C8D8 45%,#7890A8);transition:background .4s}
.gen.done .orb.sm{background:radial-gradient(circle at 35% 28%,rgb(255 255 255/.9),var(--accent-hi) 40%,var(--accent-lo))}
.gen .nm{width:52px;font-weight:600;font-size:14px}
.gen .fit{flex:1;height:8px;border-radius:99px;background:rgb(255 255 255/.55);box-shadow:inset 0 1px 2px rgb(0 40 100/.3);overflow:hidden}
.gen .fit i{display:block;height:100%;width:var(--w);border-radius:inherit;transform:scaleX(0);transform-origin:left;transition:transform .8s var(--spring);
  background:linear-gradient(180deg,rgb(255 255 255/.65),rgb(255 255 255/0) 55%),linear-gradient(90deg,var(--accent-soft),var(--accent))}
.gen.done .fit i{transform:scaleX(1)}
.gen .hp{width:58px;text-align:right;font-size:13px;color:var(--ink-2);font-variant-numeric:tabular-nums}
.gen .chip{min-width:30px;justify-content:center}
.gen{opacity:.55;transition:opacity .4s,background .25s,box-shadow .3s,transform .3s var(--spring)}
.gen.done{opacity:1}
.gen.on{background:rgb(255 255 255/.88);box-shadow:0 0 0 2px #fff,0 0 16px rgb(255 255 255/.85)}
#gens .foot{margin-top:10px;font-size:12px;color:var(--ink-2);line-height:1.4}

#tip{position:fixed;z-index:20;pointer-events:none;transform:translate(-50%,calc(-100% - 14px))}
#tip.off{opacity:0}

#rule{width:300px;z-index:25;display:none}
#rule.open{display:block}
#rule .x{margin-left:auto;width:22px;height:22px;border-radius:50%;font-size:14px;line-height:22px;text-align:center;color:#fff;background:rgb(255 255 255/.2);box-shadow:inset 0 0 0 1px rgb(255 255 255/.5)}
#rule .x:hover{background:rgb(255 255 255/.35)}
#rule .txt{font-size:17px;font-weight:600;line-height:1.3;margin:6px 0 10px}
#rule .meta{display:flex;gap:8px;flex-wrap:wrap}
#rule .acts{display:flex;gap:10px;margin-top:14px}

@media (max-width:700px){
  #head{left:12px;right:12px;top:12px;width:auto}
  #head .page-sub{display:none}
  #head .now{font-size:22px;margin-top:8px}
  #gens{left:12px;right:12px;top:auto;bottom:76px;width:auto}
  #gens .bar,#gens .foot{display:none}
  #gens .body{padding:6px}
  .gen:not(.on){display:none}
  #stage{inset:190px 0 140px 0}
  #rule{left:12px!important;right:12px;width:auto;top:auto!important;bottom:150px}
}
`;
