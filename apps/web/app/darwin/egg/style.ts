// The Darwin easter egg: a Frutiger Aero aquarium lamp (bottom left) with a water ring toss inside
// it and a shell on the sand that opens "Shel in Frutiger Aero". The parallax layers are inline
// SVG tiles, so nothing is fetched.

const svg = (w: number, h: number, body: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${body}</svg>`)}")`;

// Far: pale reef silhouettes. Mid: a distant school of fish. Near: swaying seaweed and pebbles.
const FAR = svg(250, 144, `<g fill='#9FE3F2' opacity='.55'>
  <path d='M0 144 C10 110 22 104 30 118 C36 96 50 92 56 120 C64 112 72 116 76 144Z'/>
  <path d='M120 144 C126 120 140 112 146 126 C152 104 168 100 172 128 C180 118 192 122 196 144Z'/>
  <circle cx='214' cy='128' r='16'/><circle cx='96' cy='134' r='12'/></g>`);
const MID = svg(250, 144, `<g fill='#3D9FC0' opacity='.38'>
  ${[[30, 40], [44, 46], [38, 54], [140, 30], [154, 36], [148, 26], [210, 70], [222, 64]]
    .map(([x, y]) => `<path d='M${x} ${y} q4 -3 8 0 l3 -2 v4 l-3 -2 q-4 3 -8 0z'/>`).join("")}</g>`);
const NEAR = svg(250, 144, `<g fill='none' stroke-linecap='round'>
  <path d='M20 144 C14 124 26 112 18 92' stroke='#2FAE5E' stroke-width='4'/>
  <path d='M28 144 C34 128 24 116 32 102' stroke='#57C84D' stroke-width='3'/>
  <path d='M150 144 C144 122 158 110 150 84' stroke='#2FAE5E' stroke-width='4'/>
  <path d='M232 144 C238 126 228 118 236 104' stroke='#57C84D' stroke-width='3'/></g>
  <g fill='#7FA7B8' opacity='.6'><ellipse cx='60' cy='141' rx='8' ry='4'/><ellipse cx='196' cy='142' rx='10' ry='4'/></g>`);

export const EGG_STYLE = `
.aq{position:fixed;left:28px;bottom:28px;width:256px;z-index:12;user-select:none;-webkit-user-select:none;
  filter:drop-shadow(0 10px 18px rgb(0 50 110/.28))}
.aq .lid{height:14px;margin:0 6px;border-radius:12px 12px 4px 4px;position:relative;
  background:linear-gradient(180deg,rgb(255 255 255/.75),rgb(255 255 255/.15) 50%,transparent 51%),linear-gradient(180deg,var(--accent-hi),var(--accent-lo));
  box-shadow:inset 0 0 0 1px rgb(255 255 255/.5)}
.aq .lid::after{content:"";position:absolute;left:18px;right:18px;bottom:2px;height:3px;border-radius:3px;background:#FFFBE0;
  box-shadow:0 0 8px 2px rgb(255 248 200/.9);transition:opacity .4s}
.aq.off .lid::after{opacity:.15;box-shadow:none}

.aq .tank{position:relative;height:150px;border-radius:6px;overflow:hidden;border:3px solid rgb(255 255 255/.85);
  background:linear-gradient(180deg,#9EEBFF 0%,#3FC1EA 45%,#1693CF 100%);
  box-shadow:0 0 26px 4px rgb(90 215 255/.55);transition:box-shadow .5s,filter .5s}
.aq.off .tank{box-shadow:none;filter:brightness(.5) saturate(.6)}
.aq .tank *{animation-play-state:running}
.aq.off .tank *,.aq.off .tank::before{animation-play-state:paused!important}
.aq .layer{position:absolute;inset:0;background-repeat:repeat-x;background-size:250px 100%;animation:aqSlide linear infinite}
.aq .far{background-image:${FAR};animation-duration:50s}
.aq .mid{background-image:${MID};animation-duration:35s}
.aq .near{background-image:${NEAR};animation-duration:22s;z-index:5;pointer-events:none}
@keyframes aqSlide{to{background-position-x:-250px}}
/* light rays from the lamp */
.aq .tank::before{content:"";position:absolute;inset:0 -30%;pointer-events:none;z-index:1;opacity:.6;
  background:repeating-linear-gradient(100deg,rgb(255 255 255/.18) 0 12px,transparent 12px 38px);
  -webkit-mask-image:linear-gradient(180deg,#000,transparent 78%);mask-image:linear-gradient(180deg,#000,transparent 78%);
  animation:aqRays 12s ease-in-out infinite alternate}
@keyframes aqRays{to{transform:translateX(12%)}}
.aq .sand{position:absolute;left:0;right:0;bottom:0;height:16px;z-index:2;
  background:radial-gradient(circle at 20% 30%,rgb(255 255 255/.5) 1px,transparent 2px) 0 0/9px 7px,linear-gradient(180deg,#F6E3B4,#E0C385)}
.aq .toy{position:absolute;inset:0;z-index:3;pointer-events:none}

.aq .fish{position:absolute;left:0;z-index:4;animation:aqSwim linear infinite;cursor:pointer}
.aq .fish > span{display:block;animation:aqBob 2.6s ease-in-out infinite}
.aq .fish.rev > span{animation-name:aqBob2}
.aq .fish svg{display:block;filter:drop-shadow(0 1px 1px rgb(0 40 80/.25))}
.aq .fish.dash > span > svg{animation:aqDash .6s var(--spring)}
@keyframes aqSwim{from{transform:translateX(-36px)}to{transform:translateX(286px)}}
@keyframes aqSwimRev{from{transform:translateX(286px)}to{transform:translateX(-36px)}}
@keyframes aqBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
@keyframes aqBob2{0%,100%{transform:translateY(-3px) scaleX(-1)}50%{transform:translateY(3px) scaleX(-1)}}
@keyframes aqDash{0%{transform:scale(1)}30%{transform:scale(1.35) rotate(-8deg)}100%{transform:scale(1)}}
.aq .fish.rev{animation-name:aqSwimRev}

.aq .ring{position:absolute;left:0;top:0;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;z-index:6;pointer-events:none;
  border:4px solid var(--c);box-shadow:inset 0 1px 1px rgb(255 255 255/.8),0 1px 2px rgb(0 40 80/.3);will-change:transform}
.aq .ring::after{content:"";position:absolute;left:1px;top:-3px;width:5px;height:2px;border-radius:2px;background:rgb(255 255 255/.85)}
.aq .bub{position:absolute;z-index:5;width:var(--s,6px);height:var(--s,6px);border-radius:50%;pointer-events:none;
  background:radial-gradient(circle at 32% 30%,#fff 0 18%,rgb(255 255 255/.15) 40%,rgb(255 255 255/.55) 72%,transparent 74%);
  animation:aqRise var(--d,4s) linear infinite}
.aq .bub.jet{animation:aqJet .9s ease-out forwards}
@keyframes aqRise{from{transform:translateY(0)}to{transform:translateY(-170px)}}
@keyframes aqJet{from{transform:translate(0,0) scale(.6);opacity:1}to{transform:translate(var(--dx,0),-90px) scale(1.2);opacity:0}}

.aq .shell{position:absolute;left:112px;bottom:5px;z-index:7;width:24px;height:20px;padding:0;border:0;background:none;cursor:pointer;
  filter:drop-shadow(0 1px 1px rgb(120 30 70/.35));transition:transform .3s var(--spring)}
.aq .shell:hover{transform:scale(1.25) rotate(-6deg)}
.aq .shell::after{content:"";position:absolute;right:-2px;top:-2px;width:7px;height:7px;opacity:0;
  background:radial-gradient(circle,#fff 0 25%,transparent 30%),linear-gradient(90deg,transparent 45%,#fff 45% 55%,transparent 55%),linear-gradient(0deg,transparent 45%,#fff 45% 55%,transparent 55%);
  animation:aqTwinkle 6s ease-in-out infinite}
@keyframes aqTwinkle{0%,82%,100%{opacity:0;transform:scale(.4)}90%{opacity:1;transform:scale(1.2)}}

/* glass overlay: inset white edges and a gloss sweep */
.aq .glass{position:absolute;inset:0;z-index:8;pointer-events:none;
  box-shadow:inset 0 0 0 1.5px rgb(255 255 255/.75),inset 0 10px 16px rgb(255 255 255/.35),inset 0 -6px 12px rgb(0 60 120/.25);
  background:linear-gradient(115deg,rgb(255 255 255/.45) 0%,rgb(255 255 255/.08) 22%,transparent 23%,transparent 70%,rgb(255 255 255/.12) 71%,transparent 80%)}
.aq .won .glass,.aq .tank.won .glass{animation:aqWon 1.2s ease-in-out 3}
@keyframes aqWon{50%{box-shadow:inset 0 0 0 3px #FFE58A,inset 0 0 30px rgb(255 230 140/.9)}}

.aq .base{position:relative;height:50px;margin:0 -4px;border-radius:6px 6px 18px 18px;display:flex;align-items:center;gap:8px;padding:0 10px;
  background:linear-gradient(180deg,rgb(255 255 255/.7),rgb(255 255 255/.12) 46%,transparent 47%),linear-gradient(180deg,var(--accent-hi),var(--accent-lo));
  box-shadow:inset 0 0 0 1px rgb(255 255 255/.55),inset 0 -3px 6px rgb(0 30 80/.25)}
.aq .base button{border:0;padding:0;cursor:pointer;flex:none;border-radius:50%;display:grid;place-items:center;color:#fff;
  transition:transform .2s var(--spring),filter .2s}
.aq .base button:hover{filter:brightness(1.08)}
.aq .base button:active,.aq .base button.held{transform:scale(.88)}
.aq .base button:disabled{filter:grayscale(.7) brightness(.85);cursor:default}
.aq .jet{width:32px;height:32px;
  background:radial-gradient(circle at 35% 28%,rgb(255 255 255/.95),#FF9BB5 30%,#F2456F 72%,#B81E4A);
  box-shadow:0 2px 4px rgb(80 0 30/.35),inset 0 -2px 3px rgb(80 0 30/.3)}
.aq .jet svg{width:14px;height:14px}
.aq .pwr{width:26px;height:26px;
  background:radial-gradient(circle at 35% 28%,rgb(255 255 255/.95),#A8E86B 32%,#3FAE3A 75%,#1F7A24);
  box-shadow:0 2px 4px rgb(0 50 20/.35),0 0 10px rgb(150 255 120/.6)}
.aq.off .pwr{background:radial-gradient(circle at 35% 28%,rgb(255 255 255/.9),#D3DCE5 35%,#8A9BAD 80%);box-shadow:0 2px 4px rgb(0 30 60/.35)}
.aq .pwr svg{width:13px;height:13px}
.aq .label{flex:1;min-width:0;text-align:center;color:#fff;line-height:1.1;text-shadow:0 1px 2px rgb(0 40 100/.45)}
.aq .label b{display:block;font-size:12px;letter-spacing:.14em;font-weight:700}
.aq .label span{font-size:11px;opacity:.95;font-variant-numeric:tabular-nums;white-space:nowrap}
.aq .label .rs{display:inline-block;width:auto;height:auto;border-radius:4px;margin-left:6px;background:none;border:0;color:#fff;font-size:12px;cursor:pointer;padding:0 2px;text-shadow:inherit}

body.has-dock.aq-on #toasts{bottom:268px}
@media (max-width:1360px){ .aq{bottom:106px} body.has-dock.aq-on #toasts{bottom:346px} }
@media (max-width:700px){ .aq{display:none} body.has-dock.aq-on #toasts{bottom:76px} }
@media (prefers-reduced-motion:reduce){ .aq .layer,.aq .tank::before,.aq .bub{animation:none} }

/* Shel: a glass window over the page */
.shel-veil{position:fixed;inset:0;z-index:60;display:grid;place-items:center;background:rgb(10 60 120/.28);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);
  animation:shelIn .35s var(--ease)}
@keyframes shelIn{from{opacity:0}}
.shel-win{width:min(708px,calc(100vw - 24px))}
.shel-win .bar{display:flex;align-items:center;gap:8px}
.shel-win .bar .hint{font-size:12px;opacity:.85;margin-left:6px}
.shel-win .bar .x{margin-left:auto;width:24px;height:24px;border-radius:50%;border:0;font-size:15px;line-height:24px;text-align:center;color:#fff;cursor:pointer;
  background:rgb(255 255 255/.2);box-shadow:inset 0 0 0 1px rgb(255 255 255/.5)}
.shel-win .bar .x:hover{background:rgb(255 255 255/.35)}
.shel-win .body{padding:14px}
.shel-cv{display:block;width:100%;aspect-ratio:2/1;border-radius:10px;image-rendering:pixelated;outline:none;touch-action:none;
  box-shadow:0 0 0 2px #fff,0 6px 18px rgb(0 50 110/.3)}
.shel-win .pad{display:flex;gap:10px;margin-top:12px;align-items:center}
.shel-win .pad button{width:52px;height:44px;border:0;border-radius:14px;font-size:18px;color:#fff;cursor:pointer;touch-action:none;
  background:linear-gradient(180deg,rgb(255 255 255/.55),rgb(255 255 255/.12) 49%,transparent 50%),linear-gradient(180deg,var(--accent-hi),var(--accent-lo));
  box-shadow:inset 0 0 0 1px rgb(255 255 255/.5),0 2px 4px rgb(0 40 100/.3)}
.shel-win .pad button:active{transform:scale(.94)}
.shel-win .pad .jump{margin-left:auto;width:72px}
.shel-win .keys{margin:10px 0 0;font-size:12px;color:var(--ink-2)}
.shel-win .mute{background:none!important;box-shadow:none!important;color:var(--ink-2)!important;width:auto!important;font-size:13px!important}
`;
