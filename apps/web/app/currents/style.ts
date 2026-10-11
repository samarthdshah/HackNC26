// Verbatim from docs/design/v6/currents.html <style> (shared/logo.svg → /logo.svg).
export const STYLE = `
/* Sea under the sky: the shared page gradient carries the sky, this adds the water line */
.sea{position:fixed;left:0;right:0;bottom:0;height:42vh;z-index:0;pointer-events:none;
  background:linear-gradient(180deg,rgb(255 255 255/0) 0%,color-mix(in srgb,var(--accent) 22%,transparent) 30%,color-mix(in srgb,var(--accent-lo) 42%,transparent) 100%)}
.sea::before{content:"";position:absolute;left:0;right:0;top:28%;height:2px;background:linear-gradient(90deg,transparent,rgb(255 255 255/.7),transparent)}
.sea svg{position:absolute;left:0;top:calc(28% - 14px);width:200%;height:28px;opacity:.5;animation:drift 18s linear infinite}
@keyframes drift{to{transform:translateX(-50%)}}

.wrap{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1fr) 380px;grid-template-rows:auto minmax(0,1fr);gap:20px;
  padding:28px 96px 112px 28px;height:100vh;   /* right gutter keeps the top-right menu clear */min-height:640px;max-width:1440px;margin:0 auto}

/* Header */
.head .body{display:grid;gap:10px}
.head .top{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
.head .qt{font-size:22px;font-weight:600;line-height:1.2}
.head .meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:14px;color:var(--ink-2)}
.head .meta b{color:var(--ink);font-weight:600}
.switcher{flex-wrap:wrap;border-radius:18px;max-width:100%}
.switcher button{display:inline-flex;align-items:center;gap:6px;flex:none}
.switcher .dot{width:9px;height:9px}

/* Reference mini-map */
.ref .body{display:grid;grid-template-columns:1fr;gap:8px;padding:10px 14px 14px}
.ref svg{width:100%;height:150px;display:block}
.ref .foot{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:var(--ink-2)}
.ref .pill{padding:6px 12px;font-size:13px}

/* Main flow: flat on purpose, no glow or gloss */
.flow{grid-column:1;grid-row:2;display:flex;flex-direction:column;min-height:0}
.flow .bar .pill{margin-left:auto;padding:5px 12px;font-size:13px}
.tx .bar .summary{margin-left:8px;padding:4px 10px;font-size:12px;white-space:nowrap}   /* 🔊 Summary: AVATAR reads this request out */
.flow .stage{flex:1;position:relative;padding:8px 16px 0}
.flow .stage{min-height:0}
#flow{position:absolute;inset:8px 16px 0;width:calc(100% - 32px);height:calc(100% - 8px);display:block;overflow:visible}
.n-name{font:600 15px var(--font);fill:var(--ink)}
.n-sub{font:400 12px var(--font);fill:var(--ink-2)}
.n-verdict{font:600 11px var(--font);letter-spacing:.08em;text-transform:uppercase}
.n-init{font:700 18px var(--font);fill:#fff;pointer-events:none}
.n-num{font:600 13px var(--font);fill:var(--ink)}
.pulse{transform-box:fill-box;transform-origin:center;animation:ring 1.8s ease-out infinite}
@keyframes ring{from{transform:scale(1);opacity:.7}to{transform:scale(1.9);opacity:0}}
.ticker{display:flex;align-items:center;gap:10px;margin:0 16px 16px;padding:10px 14px;border-radius:12px;background:rgb(255 255 255/.5);border:1px solid rgb(255 255 255/.8);font-size:15px;min-height:46px}
.ticker .ico{width:22px;height:22px;flex:none;fill:var(--accent)}
.ticker .msg{flex:1;transition:none}
.ticker .msg.in{animation:tin .45s var(--ease)}
@keyframes tin{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.legend{display:flex;gap:14px;flex-wrap:wrap;padding:0 18px 14px;font-size:12px;color:var(--ink-2)}
.legend span{display:inline-flex;align-items:center;gap:6px}
.legend i{width:10px;height:10px;border-radius:50%}

/* Transactions + chat */
.ref{grid-column:2;grid-row:1}
.tx{grid-column:2;grid-row:2;display:flex;flex-direction:column;min-height:0}
.tx .list{min-height:0}
.tx .list{flex:1;overflow:auto;padding:14px 14px 6px;display:grid;gap:10px;align-content:start;-webkit-user-select:text;user-select:text}
.msgi{display:grid;grid-template-columns:32px 1fr;gap:10px;align-items:start}
.msgi .orb{width:32px;height:32px;font-size:13px}
.msgi .hd{display:flex;align-items:center;gap:6px;font-size:13px;flex-wrap:wrap}
.msgi .hd b{font-weight:600}
.msgi .hd time{color:var(--ink-2);font-size:12px}
.msgi .tx-t{margin-top:3px;font-size:14px;line-height:1.4;padding:8px 11px;border-radius:4px 12px 12px 12px;background:rgb(255 255 255/.62);border:1px solid rgb(255 255 255/.85)}
.msgi.me .tx-t{background:color-mix(in srgb,var(--accent-hi) 22%,rgb(255 255 255/.7));}
.msgi.sys .tx-t{background:rgb(255 255 255/.35);font-size:13px;color:var(--ink-2)}
.msgi.new{animation:tin .45s var(--ease)}
.typing{display:inline-flex;gap:4px;padding:10px 12px}
.typing i{width:6px;height:6px;border-radius:50%;background:var(--ink-2);animation:typ 1s infinite}
.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}
@keyframes typ{0%,100%{opacity:.25}50%{opacity:1}}
.compose{display:flex;gap:8px;padding:12px 14px 14px;border-top:1px solid rgb(255 255 255/.7)}
.compose input{flex:1;min-width:0;font:inherit;font-size:14px;color:var(--ink);padding:9px 14px;border-radius:99px;border:1px solid rgb(255 255 255/.85);outline:none;
  background:rgb(255 255 255/.6);box-shadow:inset 0 1px 3px rgb(0 40 100/.22)}
.compose input:focus{box-shadow:inset 0 1px 3px rgb(0 40 100/.22),0 0 0 3px color-mix(in srgb,var(--accent) 35%,transparent)}
.chats{display:flex;gap:8px;align-items:center;padding:10px 14px;border-bottom:1px solid rgb(255 255 255/.7);font-size:13px;color:var(--ink-2)}

@media (max-width:1000px){
  .wrap{grid-template-columns:minmax(0,1fr);grid-template-rows:auto}
  .wrap{height:auto}
  .ref,.tx,.flow{grid-column:1;grid-row:auto}
  .flow{min-height:420px}
  .tx .list{max-height:420px}
}
@media (max-width:700px){
  .wrap{padding:12px 12px 110px;gap:12px}
  .head .qt{font-size:18px}
  .flow{min-height:400px}
  .flow .stage{overflow-x:auto;overflow-y:hidden}
  #flow{width:760px}
  .head .top{gap:4px}
}
`;
