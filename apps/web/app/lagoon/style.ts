// Verbatim page <style> from docs/design/v6/lagoon.html (mounted with the page so it never leaks).
export const css = String.raw`
html,body{overflow:hidden}
/* ============ Ocean backdrop: Aero aqua, retinted per theme ============ */
#sea{position:fixed;inset:0;z-index:0;background:linear-gradient(180deg,#8fe0f6 0%,#2aa9d8 28%,#0b74a8 62%,#0a4f7c 85%,#0d324e 100%);transition:background .8s}
:root[data-theme="1"] #sea{background:linear-gradient(180deg,#b4f0d6 0%,#3fbf9f 28%,#0f7f72 62%,#0b5652 85%,#0b3a3e 100%)}
:root[data-theme="2"] #sea{background:linear-gradient(180deg,#ffd2b8 0%,#e5849a 28%,#9a4c8e 62%,#5a3484 85%,#2a1f4e 100%)}
#ocean{position:fixed;inset:0;z-index:1}
#ocean canvas{display:block;width:100%;height:100%}
/* soft light rays from the surface */
#rays{position:fixed;inset:0;z-index:2;pointer-events:none;overflow:hidden;mix-blend-mode:screen}
#rays i{position:absolute;top:-20%;height:130%;transform-origin:50% 0;filter:blur(10px);
  background:linear-gradient(180deg,rgb(255 255 255/.42),rgb(255 255 255/.12) 45%,transparent 80%);animation:ray 11s ease-in-out infinite alternate}
@keyframes ray{from{opacity:.35;rotate:var(--r)}to{opacity:.9;rotate:calc(var(--r) + 4deg)}}
#surface{position:fixed;left:0;right:0;top:0;height:120px;z-index:2;pointer-events:none;
  background:radial-gradient(120% 100% at 50% 0%,rgb(255 255 255/.45),transparent 70%)}

/* ============ Tentacle links ============ */
#links{position:fixed;inset:0;width:100%;height:100%;z-index:4;pointer-events:none;overflow:visible}
#links .glow{fill:none;stroke:url(#linkGrad);stroke-linecap:round;filter:url(#linkBlur);transition:opacity .5s}
#links .core{fill:none;stroke:rgb(255 255 255/.85);stroke-linecap:round;transition:opacity .5s}
#links .flow{fill:none;stroke:url(#linkGrad);stroke-linecap:round;stroke-dasharray:3 22;transition:opacity .5s}
#links g.off path{opacity:0!important}
#links g.hot .glow{opacity:1!important}

/* ============ Jellyfish: you ============ */
#jelly{position:fixed;left:50%;top:47%;z-index:5;width:min(290px,34vh);translate:-50% -50%;pointer-events:none;transition:left .7s var(--ease)}
#jelly svg{width:100%;height:auto;display:block;overflow:visible;
  filter:drop-shadow(0 0 16px color-mix(in srgb,var(--c-secondary) 75%,transparent)) drop-shadow(0 0 46px color-mix(in srgb,var(--c-primary) 40%,transparent))}
#jelly .you{position:absolute;left:50%;top:100%;translate:-50% -4px;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:auto}
#jelly .you .lbl{font-size:14px}

/* ============ Topic seeds: one glass bubble per shared topic; size = people ============ */
#seeds{position:fixed;inset:0;z-index:8;pointer-events:none}
.seed{position:absolute;left:0;top:0;width:var(--d);height:var(--d);pointer-events:auto;will-change:transform;transition:opacity .5s var(--ease);border-radius:50%}
.seed.hidden{opacity:0;pointer-events:none}
.seed .bub{position:absolute;inset:0;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;padding:16%;text-align:center;
  background:radial-gradient(circle at 50% 32%,rgb(255 255 255/.82),rgb(255 255 255/.5) 55%,color-mix(in srgb,var(--c) 34%,rgb(255 255 255/.3)) 100%);
  border:1.5px solid rgb(255 255 255/.92);backdrop-filter:blur(8px) saturate(1.2);-webkit-backdrop-filter:blur(8px) saturate(1.2);
  box-shadow:inset 0 -12px 26px color-mix(in srgb,var(--c) 38%,transparent),inset 0 8px 18px rgb(255 255 255/.7),0 10px 28px rgb(0 40 100/.25),0 0 30px color-mix(in srgb,var(--c) 45%,transparent);
  transition:transform .45s var(--spring),box-shadow .4s;animation:seedIn .9s var(--spring) backwards;animation-delay:calc(var(--k,0) * 130ms + 300ms)}
.seed .bub::before{content:"";position:absolute;top:7%;left:20%;width:44%;height:26%;border-radius:50%;transform:rotate(-18deg);pointer-events:none;
  background:linear-gradient(180deg,rgb(255 255 255/.95),rgb(255 255 255/0))}
@keyframes seedIn{from{opacity:0;transform:scale(.6)}}
.seed:hover .bub,.seed:focus-visible .bub{transform:scale(1.06)}
.seed.on .bub{box-shadow:0 0 0 3px #fff,0 0 34px color-mix(in srgb,var(--c) 80%,transparent),inset 0 -12px 26px color-mix(in srgb,var(--c) 38%,transparent),inset 0 8px 18px rgb(255 255 255/.7)}
.seed:focus-visible{outline:none}
.seed .tp{position:relative;font-weight:700;font-size:15px;line-height:1.15;color:var(--ink)}
.seed .n{position:relative;font-size:12px;font-weight:600;color:var(--ink-2)}
.seed .n.sent{color:#0B6B4A}
.avs{position:relative;display:flex;justify-content:center;padding-left:8px}
.av{width:26px;height:26px;margin-left:-8px;border-radius:50%;display:inline-grid;place-items:center;font:700 11px/1 var(--font);font-style:normal;color:#fff;text-shadow:0 1px 1px rgb(0 0 0/.3);
  background:radial-gradient(circle at 35% 28%,rgb(255 255 255/.85),var(--c,var(--c-primary)) 45%,color-mix(in srgb,var(--c,var(--c-primary)) 62%,#000));
  box-shadow:0 0 0 2px #fff,0 2px 4px rgb(0 40 100/.3)}
.av.plus{--c:#8aa4bd;font-size:10px}
.av.lg{width:36px;height:36px;font-size:15px;margin:0;flex:none}

/* ============ Drawer: the people inside one topic ============ */
#drawer{right:18px;top:96px;bottom:110px;width:350px;display:flex;flex-direction:column;z-index:20;translate:calc(100% + 40px) 0;opacity:0;visibility:hidden;
  transition:translate .55s var(--spring),opacity .3s,visibility 0s .55s}
#drawer.open{translate:0 0;opacity:1;visibility:visible;transition:translate .55s var(--spring),opacity .3s}
#drawer .x{margin-left:auto;width:26px;height:26px;border-radius:50%;font-size:18px;line-height:1;color:#fff;background:rgb(255 255 255/.22);box-shadow:inset 0 0 0 1px rgb(255 255 255/.5)}
#drawer .x:hover{background:rgb(255 255 255/.4)}
#drawer .body{overflow:auto;flex:1;display:grid;align-content:start;gap:12px}
#drawer .why{font-size:14px;line-height:1.4;color:var(--ink-2)}
#drawer .row:not(.topic){display:grid;grid-template-columns:36px 1fr auto;column-gap:10px;row-gap:8px;align-items:center}
#drawer .row .info{flex:1;min-width:0}
#drawer .row .info .t,#drawer .row .info .s{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#drawer .row .ctl{grid-column:2 / -1;justify-self:start;padding:3px 12px 3px 3px;font-size:13px}
#drawer .row .ctl[disabled]{cursor:default;transform:none}
#drawer .row.topic{cursor:pointer}
#drawer .row.topic .go{margin-left:auto;color:var(--ink-2);font-size:18px}

/* ============ Title card ============ */
#intro{left:28px;top:28px;width:330px}
#intro .body{display:grid;gap:10px}
#intro .more > div{display:grid;gap:10px}
#intro .stats{display:flex;gap:8px;flex-wrap:wrap}
#moreTopics{padding:6px 14px;font-size:13px;pointer-events:auto}

@media (max-width:700px){
  html,body{overflow:auto}
  #intro{position:relative;left:auto;top:auto;width:auto;margin:12px;margin-right:84px}
  #jelly{position:relative;left:auto!important;top:auto;translate:none;margin:8px auto 70px;width:190px}
  #links{display:none}
  #seeds{position:relative;inset:auto;display:grid;gap:10px;padding:0 12px 110px}
  .seed{position:relative;width:auto;height:auto;transform:none!important;border-radius:999px}
  .seed .bub{position:relative;inset:auto;flex-direction:row;justify-content:flex-start;gap:12px;padding:12px 18px;border-radius:999px;text-align:left}
  .seed .bub::before{left:8%;width:30%;height:40%;top:4%}
  .seed .tp{flex:1}
  .seed.hidden{display:none}
  #drawer{left:12px;right:12px;top:auto;bottom:76px;width:auto;max-height:62vh;translate:0 calc(100% + 100px)}
}
`;

// The jellyfish SVG body (docs/design/v6/lagoon.html #jfSvg), verbatim.
export const JELLY = String.raw`
    <defs>
      <filter id="turbulence" filterUnits="objectBoundingBox" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence id="feturbulence" baseFrequency="0.02 0.03" result="turbulence" type="fractalNoise" numOctaves="1" seed="1"/>
        <feDisplacementMap id="displacement" xChannelSelector="R" yChannelSelector="G" in="SourceGraphic" in2="turbulence" scale="13"/>
      </filter>
      <radialGradient id="jfFace" cx="50%" cy="38%" r="65%">
        <stop offset="0" stop-color="#fff"/>
        <stop offset=".62" stop-color="#fff" stop-opacity=".95"/>
        <stop offset="1" style="stop-color:var(--c-secondary);stop-opacity:.85"/>
      </radialGradient>
      <linearGradient id="jfBell" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity=".75"/>
        <stop offset="1" style="stop-color:var(--c-secondary);stop-opacity:.5"/>
      </linearGradient>
      <linearGradient id="jfIrid" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ff9bd8"/><stop offset=".33" stop-color="#8fe3ff"/><stop offset=".66" stop-color="#c8ff9a"/><stop offset="1" stop-color="#ffd38a"/>
      </linearGradient>
      <linearGradient id="jfTent" gradientUnits="userSpaceOnUse" x1="0" y1="250" x2="0" y2="440">
        <stop offset="0" stop-color="#fff"/>
        <stop offset="1" style="stop-color:var(--c-primary);stop-opacity:.35"/>
      </linearGradient>
    </defs>
    <g class="jellyfish" filter="url(#turbulence)">
      <g fill="url(#jfTent)">
        <path class="tentacle" d="M226.31 258.64c.77 8.68 2.71 16.48 1.55 25.15-.78 8.24-5 15.180-7.37 23-3.1 10.84-4.65 22.55 1.17 32.52 4.65 7.37 7.75 11.71 5.810 21.25-2.33 8.67-7.37 16.91-2.71 26 4.26 8.68 7.75 4.34 8.14-3 .39-12.14 0-24.28.77-36 .78-16.91-12-27.75-2.71-44.23 7-12.15 11.24-33 7.76-46.83z" opacity=".49"/>
        <path class="tentacle" d="M246.47 259.51a75 75 0 0 1 3.1 33.39c-1.55 11.71-8.91 20.82-8.91 33 0 10 3.48 18.21 5.81 27.75 2.71 10.410.39 19.51-.78 30.35-1.55 9.11-4.65 24.29-.77 33.39s7.37 4.77 7.37-2.6c0-6.07-.78-11.71-1.17-17.770-.39-8.25 3.1-12.58 5-20.39 5.43-21.24-9.3-42.06-3.49-63.31 2.72-11.27 10.86-22.55 11.25-34.26.38-6.07-1.55-14.74-2.72-20.38z" opacity=".66"/>
        <path class="tentacle" d="M276.54 262.11c-1.55 9.11 2.21 17.35-.51 26.89-3.87 12.57-8.2 23.41-8.58 37.29 0 10.41 5.78 15.61 7.72 25.150 2.72 11.28-2.73 19.95-5.44 30.35-1.94 6.51-3.11 15.62-.79 22.12 3.49 8.24 5.43 7.81 3.88 18.21-.78 4.77-2.72 17.35 4.26 19.09 5.430.86 5.82-6.94 5.82-11.72-.39-12.57-3.49-24.28-3.11-37.29.39-14.31 4.66-27.75 5.82-42.06.39-7.37-1.94-13-3.49-19.95-2.33-10.4-.78-15.170 3.1-24.71 4.65-10.85 5.28-21.25 6.06-33 .77-6.07 2.53-13-.54-18.65v.44z" opacity=".45"/>
        <path class="tentacle" d="M300.34 261.25c1.55 14.3 7 19.94 1.17 34.68-5.43 12.15-8.53 22.12-3.88 35.13 3.88 10.84 5.43 18.21 3.88 30.36-1.56 10-2.33 19.94 4.26 28.61 13.57 17.35 10.86-10.4 8.14-19.07-1.55-6.08-3.49-11.71-2.71-18.22 1.16-8.24 3.88-14.31 1.55-23-1.55-6.07-5-10.41-3.88-17.35s5.82-12.14 6.59-19.51c1.17-7.37 3.49-30.35-3.1-35.56z" opacity=".6"/>
        <path class="tentacle" d="M254.44 253.48c-8.78 25.12-15.81 53.28 2.61 77.35 11.06 14.46 42.58 51.91 38.16 69.8-3.91 15.83-20.78 24.73-14.17 28.18 8.22 3.21 22.2-26 18.7-41.25-3.89-16.94-17.68-35.47-34.38-54.78-2.48-2.86-13.15-18.09-14-35.580-1-19.92 12.84-42.61 12.38-42.62-3.13-.02-8.1-4.53-9.3-1.1z"/>
        <path class="tentacle" d="M276.84 253.3c7.24 20.7 13 43.91-2.15 63.75-9.11 11.91-35.1 42.78-31.45 57.53 3.22 13.05 13.8 19.9 11.68 23.22-2.87 3.86-16.15-16.76-16.55-25.86-.72-16.2 12.73-33.92 29.47-53.28 2-2.36 10.84-14.91 11.57-29.33.82-16.41-10.59-35.12-10.2-35.12 2.54-.02 6.64-3.74 7.63-.91z"/>
        <path class="tentacle" d="M295.27 254.27c5.83 16.69 12.69 18.82 1.58 35.22a45 45 0 0 0-6.67 19.22c-.52 6.52 6.09 13.33 5.5 19.6-2.35 24.92-17.13 46.55-19.33 44.29-4.35-4.6 22.07-28.6 12.46-51.16-8.38-19.64 6.49-36.53 9.9-42.49 2.75-4.8-11.51-24.51-11.42-24.51 2.05-.01 5.93-.6 7.98-.17z"/>
        <path class="tentacle" d="M256.56 252.22c-7 6.09-17.21 14-23.17 24-5.55 9.25-7.06 20.43-7.66 27.88-.53 6.52 2.21 13.76 5.49 19.6 14 24.92-15.62 46.55-19.330 44.29-4.55-4 14.59-16.95 17.41-23.45 2.91-6.69-.07-16.29-5-27.71-8.38-19.64 1-39.25 4.37-45.2 2.75-4.81 19.82-19 19.91-19 2.1-.07 5.92-.84 7.98-.41z"/>
        <path class="tentacle" d="M288.76 254.4c7 6.09 17.21 14 23.17 24 5.55 9.25 7.06 20.43 7.66 27.88.53 6.52-2.21 13.76-5.49 19.6-14 24.93 9 45 19.33 44.29 6.58-4.07-14.59-16.95-17.41-23.45-2.91-6.69.07-16.28 5-27.71 8.38-19.64-1-39.25-4.37-45.2-2.75-4.81-19.82-19-19.91-19-2.1-.06-5.92-.81-7.98-.41z"/>
      </g>
      <path class="face" d="M283.26 178.86c-17.72-1.84-36.33 5.33-52.24 17.37a110.1 110.1 0 0 0-22.14 22.06c-8.54 11.67-14 31.93-7.48 47.29 8.82 20.73 29.67 14.17 44.32 15.6 14.34 1.55 28.68-.52 43-.52 10.47 0 20.94 1 31.4-.51 9.36-1.39 21.38-9.12 24-22.07 4.24-21-13.770-45.52-24.270-58.37-10.69-13.1-23.39-19.48-36.59-20.85z" fill="url(#jfFace)"/>
      <path class="outerJelly" d="M340.52 295.71c-10.12 1.19-15.63-.12-20.38-1.64-3.63-1.17-6.84-2.44-11.37-2.83l-1-.06c-1-.06-2.05-.06-3.17 0a21.37 21.37 0 0 0-8 2.28c-1.27.59-2.6 1.21-4.09 1.82a42.23 42.23 0 0 1-10.6 3c-1 .16-2 .29-3.11.37-1.56.14-3.26.22-5.09.22h-.51c-1.74 0-3.35-.08-4.84-.2-.6 0-1.15-.08-1.7-.15a47.37 47.37 0 0 1-9.43-1.8 8.25 8.25 0 0 1-.92-.29 75 75 0 0 1-8-3.34L248 293a19.06 19.06 0 0 0-6.86-1.81c-1.27-.06-2.44-.12-3.56-.14h-1a51.6 51.6 0 0 0-9.87.67c-8 1.38-10.86 4.29-22.82 4.060-22.13 0-9.51-11.13-11-17.8-7.24-33.11-.69-63.69 18-83.91 14.65-15.86 35.74-24.25 61-24.25 23.56 0 43.94 8.81 59 25.44 19.21 21.29 27 53.84 20 83-1.67 6.46 10.68 14.95-10.37 17.45z" fill="url(#jfBell)" opacity=".62" stroke="url(#jfIrid)" stroke-width="2.6"/>
      <path class="freckle" fill="#f6c9de" d="M330 225.23a4.16 4.16 0 0 0-.1.55c-.52 3.79 3.9 6.73 5.91 3 2.42-4.46-4.66-8.14-5.81-3.55z"/>
      <path class="freckle" fill="#f6c9de" d="M322.89 215.5a3.94 3.94 0 0 0-1.32 3.61 3 3 0 1 0 5.91 0c.27-3.81-2.76-4.98-4.59-3.61z"/>
      <path class="freckle" fill="#f6c9de" d="M206.88 241.24c-.88 2-.11 4.56 3.36 4.27 3.87-.33 5.42-5.85.75-6.62a3.79 3.79 0 0 0-4.11 2.35z"/>
      <path class="freckle" fill="#f6c9de" d="M210.11 225.75c.83-.07 1.7.52 1.92 2.17.4 3-2.5 3.09-3.4.6a2 2 0 0 1 1.48-2.77z"/>
    </g>
    <g id="bubbles" fill="#fff">
      <path class="bubble" d="M384.85 167.41c-7.37 4.94-6.92 18 4.34 16.82a19.89 19.89 0 0 0 3.34-.71c13.54-4.17 9.8-20.35-3.66-17.77a10.52 10.52 0 0 0-4.02 1.660z" opacity=".67"/>
      <path class="bubble" d="M130.5 266.76c-6 4-5.590 14.59 3.51 13.61a15.22 15.22 0 0 0 2.7-.57c11-3.38 7.93-16.47-3-14.38a8.85 8.85 0 0 0-3.210 1.34z" opacity=".75"/>
      <path class="bubble" d="M424.53 152.72c2.41-6-5.11-13.82-12-7.41s2.41 15.31 9.3 10.64a7.19 7.19 0 0 0 2.7-3.23z" opacity=".89"/>
      <path class="bubble" d="M392.89 142.46c1.65-4.09-3.5-9.45-8.22-5.07s1.65 10.47 6.36 7.28a4.87 4.87 0 0 0 1.86-2.21z" opacity=".47"/>
      <path class="bubble" d="M114 242.88c-2-.26-4.34 1.09-3.68 4.42 1.68 8.05 11.35-3.48 3.68-4.42z" opacity=".54"/>
      <path class="bubble" d="M110.78 259.61c3.62-2.73 4.8-9.7-.42-12.31-7.07-3.53-12.93 6.88-6.75 11.86 2.68 2.16 5.26 1.890 7.17.45z" opacity=".94"/>
      <path class="bubble" d="M141.82 214.42c-2.7.07-5.63 2.5-4.54 5.75 1.68 4.62 9.19 2.19 8.37-2.49a3.6 3.6 0 0 0-3.83-3.26z" opacity=".77"/>
    </g>
    <g class="face-parts">
      <path class="eye" fill="#7f9aa8" d="M262 233.63a3.1 3.1 0 1 0-3 3.19 3.1 3.1 0 0 0 3-3.19z"/>
      <path class="eye" fill="#7f9aa8" d="M294 232.72a3.1 3.1 0 1 0-3 3.18 3.1 3.1 0 0 0 3-3.18z"/>
      <path class="mouth" d="M286.84 244s-.11-.12-.32-.31a9.91 9.91 0 0 1-.81-.76l-.5-.53c-.16-.2-.31-.41-.48-.61s-.27-.46-.41-.69a6.83 6.83 0 0 1-.29-.75 5.86 5.86 0 0 1-.06-3 7.71 7.71 0 0 1 .29-1.05 3.46 3.46 0 0 1 .13-.39.49.49 0 1 0-.8-.55 3.310 3.310 0 0 0-.33.38 5.42 5.42 0 0 0-.68 1.12 5.32 5.32 0 0 0-.53 2.93 4.34 4.34 0 0 0 .07.52h-.08a9.59 9.59 0 0 1-1.64.53 11.21 11.21 0 0 1-1.15.22 10.31 10.31 0 0 1-1.29.17 12 12 0 0 1-1.41.1c-.48 0-1.070.05-1.48 0l-1.46-.06c-.48 0-.94-.11-1.39-.15s-.88-.17-1.29-.23-.78-.2-1.13-.29-.65-.22-.93-.31a5 5 0 0 1-.67-.28 2.56 2.56 0 0 0 0-.27 5.080 5.08 0 0 0 0-1.1 6 6 0 0 0-1.12-3 2.650 2.65 0 0 0-.32-.39.5.5 0 0 0-.67-.15.49.49 0 0 0-.15.68 3.33 3.33 0 0 1 .12.39 9.13 9.13 0 0 1 .26 1.06 5.81 5.81 0 0 1-.14 3 6.81 6.81 0 0 1-.31.74l-.43.67c-.18.2-.34.41-.49.61l-.52.51a9 9 0 0 1-.83.74c-.21.18-.33.3-.33.3a.49.49 0 0 0 .5.81s.16-.05.44-.17a6.14 6.14 0 0 0 1.15-.56c.22-.15.48-.3.72-.49s.49-.43.73-.68.45-.57.67-.87.24-.49.35-.74a2.77 2.77 0 0 0 .42.27 7 7 0 0 0 1 .53 7.33 7.33 0 0 0 1.23.48 8.56 8.56 0 0 0 1.41.38c.5.08 1 .2 1.54.24l1.6.09c.61 0 1.05 0 1.58-.07a11.79 11.79 0 0 0 1.53-.18 9.58 9.58 0 0 0 1.44-.31 8.32 8.32 0 0 0 1.25-.42 6.92 6.92 0 0 0 1-.47 5.28 5.28 0 0 0 .6-.36c.09.19.18.37.26.55s.42.62.64.89.48.49.71.71.49.35.71.51a7.4 7.4 0 0 0 1.130.59l.44.18a.47.47 0 0 0 .51-.11.48.48 0 0 0 .01-.6z" fill="#9fb4c0" opacity=".8"/>
    </g>
`;
