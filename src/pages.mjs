// Human and agent facing pages: landing page, agent instructions, readable report.
import { buyerAction } from './rank.mjs';

export const MPPX = 'npx -y mppx@0.17.4';
export const EXAMPLE = {
  vehicles: [{ make: 'Volkswagen', model: 'Passat' }, { make: 'Skoda', model: 'Octavia' }],
  yearFrom: 2007, yearTo: 2015, priceMaxEur: 6000, county: 'Dublin',
};

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Look: black ground, monospace text, thin double-ruled boxes and one amber accent.
// The wordmark is drawn as a dot matrix, like a roadside message sign.
const MONO = 'ui-monospace, SFMono-Regular, "IBM Plex Mono", "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace';
const DARK = '--bg:#050505; --panel:#0d0d0d; --text:#e4e4e4; --muted:#999999; --line:#242424; --line2:#3d3d3d; --wire:#5c5c5c; --strong:#ffffff; --accent:#ffb000; --good:#7ee787; --warn:#e3b341; --bad:#ff7b72;';
const LIGHT = 'color-scheme: light; --bg:#fafaf7; --panel:#ffffff; --text:#1c1c1c; --muted:#626262; --line:#dddddd; --line2:#bcbcbc; --wire:#767676; --strong:#000000; --accent:#9a4e00; --good:#1a7f37; --warn:#825800; --bad:#cf222e;';
const STYLE = `
:root { color-scheme: dark; ${DARK} }
:root[data-theme="light"] { ${LIGHT} }
@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) { ${LIGHT} } }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.7 ${MONO}; overflow-x:hidden; }
::selection { background: var(--accent); color: var(--bg); }
header.bar { padding:18px 20px; display:flex; justify-content:space-between; align-items:center; font-size:13px; }
header.bar .brand { color:var(--strong); text-decoration:none; display:flex; align-items:center; gap:10px; letter-spacing:.08em; text-transform:uppercase; }
header.bar .brand i { width:9px; height:9px; background:var(--accent); display:block; }
header.bar nav a { color:var(--muted); text-decoration:none; margin-left:20px; }
header.bar nav a:hover { color:var(--strong); }
header.bar .brand:hover { color:var(--accent); }
header.bar .left { display:flex; align-items:center; gap:20px; }
header.bar .source { color:var(--strong); text-decoration:none; display:flex; align-items:center; gap:8px; }
header.bar .source:hover { color:var(--accent); }
main { max-width: 720px; margin: 0 auto; padding: 48px 16px 96px; }
h1 { font-size: 30px; font-weight: 400; line-height: 1.25; margin: 0 0 12px; color: var(--strong); overflow-wrap:anywhere; }
h2 { font-size: 13px; font-weight: 400; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin: 44px 0 12px; }
h3 { font-weight: 400; }
.lead { color: var(--text); margin: 0 0 24px; max-width: 64ch; }
a { color: var(--strong); text-underline-offset: 3px; text-decoration-color: var(--line2); }
a:hover { text-decoration-color: var(--accent); }
a:focus-visible, button:focus-visible, summary:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
.muted { color: var(--muted); font-size: 13px; }
.warn { color: var(--warn); } .bad { color: var(--bad); }
code { font-family: inherit; }
p code, li code, dd code { border:1px solid var(--line); padding: 0 4px; }

/* Landing page */
.landing main { padding-top: 36px; }
.wordmark { margin:0; font: 900 clamp(46px, 12.4vw, 96px)/.9 Impact, Haettenschweiler, "Arial Narrow Bold", "Helvetica Neue Condensed Bold", "Roboto Condensed", sans-serif; text-transform:uppercase; letter-spacing:.012em;
  color: var(--accent); background: radial-gradient(circle at center, var(--accent) 0 1.35px, transparent 1.7px) 0 0 / 4px 4px; -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 0 14px color-mix(in srgb, var(--accent) 38%, transparent)); }
.tagline { margin:10px 0 22px; font-size:clamp(16px, 2.4vw, 20px); color:var(--strong); letter-spacing:.01em; }
.example mark { background:none; color:var(--accent); text-decoration:underline wavy var(--accent); text-underline-offset:4px; }
.landing .lead { font-size:17px; line-height:1.75; color:var(--strong); margin: 24px 0 16px; max-width:none; }
.landing h2 { font-size:22px; letter-spacing:0; text-transform:none; color:var(--strong); margin: 56px 0 16px; }
.landing h2.step { counter-increment: section; }
.landing h2.step::before { content: counter(section, decimal-leading-zero); color:var(--accent); font-size:12px; letter-spacing:.1em; margin-right:14px; }
.landing main { counter-reset: section; }
.status { list-style:none; display:flex; flex-wrap:wrap; gap:4px 14px; margin:0; padding:12px 0; border-block:1px solid var(--line); font-size:12px; line-height:1.6; color:var(--muted); }
.status li { white-space:nowrap; }
.status li:first-child { display:flex; align-items:center; gap:9px; color:var(--text); }
.status b { font-weight:400; color:var(--strong); }
.status b.off { color:var(--warn); }
.example { margin:28px 0 24px; border:1px solid var(--line2); border-left:2px solid var(--accent); background:var(--panel); padding:16px 18px; }
.example h2 { margin:5px 0 8px; font-size:18px; }
.example p { margin:0 0 8px; }
.example p:last-child { margin-bottom:0; }
.example .asking { color:var(--accent); white-space:nowrap; }
.limits { padding-left:1.4em; }
.lamp { width:7px; height:7px; border-radius:50%; background:var(--good); box-shadow:0 0 0 0 var(--good); animation: lamp 2.4s ease-out infinite; }
@keyframes lamp { 0% { box-shadow:0 0 0 0 color-mix(in srgb, var(--good) 70%, transparent); } 100% { box-shadow:0 0 0 9px transparent; } }
dl.spec { margin:0; border-bottom:1px solid var(--line); }
dl.spec div { display:grid; grid-template-columns: 150px 1fr; gap:16px; padding:13px 0; border-top:1px solid var(--line); }
dl.spec dt { color:var(--muted); font-size:13px; padding-top:1px; }
dl.spec dd { margin:0; }
.links { display:flex; flex-wrap:wrap; gap:10px; margin:0; padding:0; list-style:none; }
.links a { display:block; border:1px solid var(--line2); padding:6px 12px; text-decoration:none; font-size:13px; }
.links a:hover { border-color:var(--accent); }

/* Flow diagram: a wide drawing on large screens, a stacked list on small screens */
.diagram { width: min(1130px, calc(100vw - 32px)); margin: 28px 0 40px 50%; transform: translateX(-50%); }
.diagram svg { display:block; width:100%; height:auto; overflow:visible; }
.diagram text { font-family: ${MONO}; }
.diagram .outer { fill:none; stroke:var(--line2); }
.diagram .inner { fill:var(--panel); stroke:var(--line); }
.diagram .frame { fill:none; stroke:var(--line); }
.diagram .wire { fill:none; stroke:var(--wire); }
.diagram .port { fill:var(--bg); stroke:var(--wire); }
.diagram .name { fill:var(--strong); font-size:15px; }
.diagram .note { fill:var(--muted); font-size:12px; }
.diagram .caption { fill:var(--muted); font-size:11px; letter-spacing:.1em; text-transform:uppercase; }
.diagram .hot { fill:none; stroke:var(--accent); }
.diagram .hot.done { stroke:var(--good); }
.diagram .dot { fill:currentColor; color:var(--strong); filter: drop-shadow(0 0 5px currentColor); }
.diagram .dot.pay { color:var(--accent); } .diagram .dot.report { color:var(--good); }
/* Small drawings at the right end of the four boxes. Each one loops alone. */
.glyph * { fill:none; stroke:var(--wire); stroke-linecap:round; stroke-linejoin:round; }
.glyph .faint { stroke:var(--line2); }
.glyph .solid { fill:var(--muted); stroke:none; }
.glyph .trend { stroke:var(--text); stroke-dasharray:32; animation: trend 5.2s ease-in-out infinite; }
.glyph .find { fill:var(--accent); stroke:none; animation: find 5.2s ease-out infinite; }
.glyph .ring { stroke:var(--accent); transform-box:fill-box; transform-origin:center; animation: ring 5.2s ease-out infinite; }
@keyframes trend { 0% { stroke-dashoffset:32; opacity:1; } 34%, 90% { stroke-dashoffset:0; opacity:1; } 100% { stroke-dashoffset:0; opacity:0; } }
@keyframes find { 0%, 36% { opacity:.25; } 44%, 90% { opacity:1; } 100% { opacity:.25; } }
@keyframes ring { 0%, 40% { transform:scale(.4); opacity:0; } 46% { opacity:.9; } 78%, 100% { transform:scale(2.6); opacity:0; } }
.glyph .feed { animation: feed 3.6s linear infinite; }
.glyph .feed .hit rect { stroke:var(--accent); }
@keyframes feed { to { transform: translateY(-18px); } }
.glyph .band { fill:#2f62d8; stroke:none; }
.glyph .plate { stroke:var(--text); }
.glyph text { fill:var(--text); stroke:none; font-size:6.5px; letter-spacing:.04em; }
.glyph .scan { stroke:var(--accent); filter: drop-shadow(0 0 2px var(--accent)); animation: scan 2.6s ease-in-out infinite alternate; }
@keyframes scan { from { transform: translateX(-13px); } to { transform: translateX(13px); } }
.glyph .seal { stroke:var(--good); stroke-dasharray:70; animation: seal 4.6s ease-in-out infinite; }
.glyph .tick { stroke:var(--good); stroke-dasharray:17; animation: tick 4.6s ease-in-out infinite; }
@keyframes seal { 0% { stroke-dashoffset:70; opacity:1; } 42%, 88% { stroke-dashoffset:0; opacity:1; } 100% { stroke-dashoffset:0; opacity:0; } }
@keyframes tick { 0%, 42% { stroke-dashoffset:17; opacity:1; } 58%, 88% { stroke-dashoffset:0; opacity:1; } 100% { stroke-dashoffset:0; opacity:0; } }
@media (prefers-reduced-motion: reduce) { .thumb, .mainstage .win { transition:none; } .diagram .dot, .diagram .hot { display:none; } .lamp, .glyph * { animation:none; } }
.flow { display:none; font-size:13px; }
.node { border:1px solid var(--line2); background:var(--panel); padding:10px 12px; outline:1px solid var(--line); outline-offset:3px; }
.node b { display:block; font-weight:400; color:var(--strong); }
.node small { display:block; color:var(--muted); font-size:11.5px; line-height:1.4; margin-top:2px; }
.group { border:1px solid var(--line); padding:22px 14px 14px; position:relative; display:grid; gap:14px; }
.group > span { position:absolute; top:-10px; left:10px; background:var(--bg); padding:0 6px; color:var(--muted); font-size:11.5px; }
.edge { display:grid; grid-template-columns:1fr 1fr; padding:10px 0 10px 18px; color:var(--muted); font-size:11px; letter-spacing:.08em; text-transform:uppercase; }
.edge div { border-left:1px solid var(--wire); padding:8px 0 8px 12px; min-height:38px; position:relative; }
.edge .right { color:var(--accent); }
.edge .right::after { content:""; position:absolute; left:-5px; bottom:-1px; border:4px solid transparent; border-top:6px solid var(--wire); border-bottom:0; }
.edge .left::after { content:""; position:absolute; left:-5px; top:-1px; border:4px solid transparent; border-bottom:6px solid var(--wire); border-top:0; }
@media (max-width: 899px) { .diagram { margin-top:44px; margin-bottom:44px; } .diagram svg { display:none; } .flow { display:grid; grid-template-columns:1fr; } }

/* Code boxes */
.code { border: 1px solid var(--line); background: var(--panel); margin: 16px 0; }
.code.prompt { border-left:2px solid var(--accent); }
.tabs { display:flex; align-items:center; gap:4px; padding:0 6px; border-bottom:1px solid var(--line); font-size:12px; overflow-x:auto; }
.tabs button { background:none; border:0; color:var(--muted); font:inherit; padding:9px 10px; cursor:pointer; white-space:nowrap; }
.tabs button:hover { color:var(--text); }
.tabs .copy:hover { color:var(--accent); }
.tabs button:focus-visible { outline-offset:-2px; }
.tabs button[aria-selected="true"] { color:var(--strong); box-shadow: inset 0 -1px var(--accent); }
.tabs .label { padding:7px 10px; color:var(--muted); }
.tabs .copy { margin-left:auto; color:var(--strong); }
pre { margin:0; padding:16px 18px; overflow-x:auto; font-size:13px; line-height:1.6; white-space:pre-wrap; word-break:break-word; color:var(--strong); }
pre[hidden] { display:none; }

/* Report page */
.card { background: var(--panel); border: 1px solid var(--line); padding: 14px 16px; margin: 12px 0; overflow-wrap:anywhere; }
.card.warn, .card.bad { font-size:13px; line-height:1.6; border-left:2px solid currentColor; }
.report h2 { color:var(--strong); font-size:18px; letter-spacing:0; text-transform:none; }
.report .lead { margin-bottom:12px; }
.report .snapshot { margin:0 0 20px; }
.tag { display:inline-block; font-size:12px; line-height:1.5; color:var(--muted); margin:0 10px 2px 0; }
.tag::before { content: "["; } .tag::after { content: "]"; }
.find { display:flex; gap:16px; align-items:flex-start; outline:1px solid var(--line); outline-offset:3px; margin:16px 0; }
.find > div { min-width:0; overflow-wrap:anywhere; }
.find img { width: 132px; background:var(--bg); height: 99px; object-fit: cover; flex: none; border:1px solid var(--line); }
.find h3 { margin: 0 0 4px; font-size: 17px; }
.find p { margin:6px 0 0; }
.find .action { margin:10px 0 6px; }
.find .action ul { margin:3px 0; padding-left:18px; }
.report details > summary { cursor:pointer; padding:4px 0; }
.report details > summary:hover { color:var(--strong); }
.report details[open] > summary { margin-bottom:6px; }
.find details { margin:6px 0; }
.find .muted { line-height:1.6; }
.find details ul { margin:4px 0; padding-left:18px; }
/* Live view in the manner of a stage: thumbnails of the three browser windows in a column, the chosen
   window on the main stage. All are cut from the same single picture, so it costs nothing extra. */
.stage { display:grid; grid-template-columns: 112px 1fr; gap: 20px; align-items:center; border:1px solid var(--line); background:var(--panel); padding:16px; min-height: 340px; }
.strip { display:flex; flex-direction:column; gap:18px; perspective: 700px; }
.thumb { border:0; padding:0; background:none; cursor:pointer; position:relative; transform: rotateY(24deg) scale(.96); transform-origin: left center; transition: transform .25s ease, opacity .25s ease; opacity:.72; }
.thumb:hover, .thumb[aria-pressed="true"] { transform: rotateY(8deg) scale(1.02); opacity:1; }
.thumb:focus-visible { opacity:1; outline-offset:6px; }
.thumb span { display:block; position:absolute; left:4px; bottom:-14px; font-size:10.5px; color:var(--muted); }
/* The picture is 1280x720; each window is a third. Rows 120-680 skip the blacked-out top band and the dock. */
.win { width:100%; aspect-ratio: 427/560; background-color: var(--bg); background-repeat:no-repeat; background-size: 300% 128.57%; border:1px solid var(--line); box-shadow: 0 6px 18px rgba(0,0,0,.35); }
.thumb[aria-pressed="true"] .win { border-color: var(--strong); }
.mainstage { display:flex; justify-content:center; }
.mainstage .win { width: min(100%, calc(62vh * 427 / 560)); transition: background-position .2s ease; }
.stage .hint { grid-column: 1 / -1; color:var(--muted); font-size:13px; text-align:center; }
.stage.ready .hint { display:none; }
.stage:not(.ready) .strip, .stage:not(.ready) .mainstage { opacity:.25; }
@media (max-width: 560px) {
  .stage { grid-template-columns: 1fr; }
  .strip { flex-direction:row; justify-content:center; perspective:none; padding-bottom:16px; }
  .thumb { width: 76px; transform:none; }
  .thumb:hover, .thumb[aria-pressed="true"] { transform: translateY(-3px); }
}
footer { border-top:1px solid var(--line); margin-top:72px; padding-top:16px; }
@media (max-width: 560px) {
  .find { flex-direction: column; } .find img { width: 100%; height: 190px; } h1 { font-size: 24px; }
  header.bar { padding-inline:16px; font-size:11.5px; }
  header.bar nav a { margin-left:10px; }
  .landing main { padding-top:24px; }
  .landing h2.step { margin-top:44px; } .landing .lead { font-size:15.5px; }
  dl.spec div { grid-template-columns:1fr; gap:2px; }
}
`;

const SCRIPT = `<script>
for (const box of document.querySelectorAll('.code')) {
  const tabs = [...box.querySelectorAll('.tabs [role="tab"]')];
  const panes = [...box.querySelectorAll('pre')];
  tabs.forEach((tab, i) => tab.addEventListener('click', () => {
    tabs.forEach((t, j) => t.setAttribute('aria-selected', String(i === j)));
    panes.forEach((p, j) => (p.hidden = i !== j));
  }));
  const copy = box.querySelector('.copy');
  copy?.addEventListener('click', async () => {
    const text = panes.find((p) => !p.hidden).innerText;
    try { await navigator.clipboard.writeText(text); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select text'; }
    setTimeout(() => (copy.textContent = 'Copy'), 1500);
  });
}
</script>`;

function page(title, body, extraHead = '', bodyClass = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><style>${STYLE}</style>${extraHead}</head><body${bodyClass ? ` class="${bodyClass}"` : ''}>
<header class="bar"><div class="left"><a class="source" href="https://github.com/useribraim/SecondLookMpp" rel="noopener noreferrer" aria-label="Source code on GitHub"><svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg></a></div><nav><a href="/agents.md">agents.md</a><a href="/openapi.json">openapi</a></nav></header>
<main>${body}<footer class="muted">Tempo testnet payments use test money · <a href="/llms.txt">llms.txt</a></footer></main>${SCRIPT}</body></html>`;
}

// One loop of the flow diagram. Times are fractions of the loop.
const LOOP = '9s';
const PHASE = { pay: [0.03, 0.17], collect: [0.21, 0.4], ads: [0.47, 0.66], report: [0.72, 0.86] };
const fraction = (value) => Number(value.toFixed(3));

// A point of light that travels along a wire during one phase of the loop.
function pulse(kind, path, [from, to], reverse = false) {
  const [start, end] = reverse ? [1, 0] : [0, 1];
  return `<circle class="dot ${kind}" r="3.5" opacity="0"><animateMotion dur="${LOOP}" repeatCount="indefinite" calcMode="linear" keyTimes="0;${from};${to};1" keyPoints="${start};${start};${end};${end}" path="${path}"/>${fade([from, to], 0)}</circle>`;
}

// Raise the opacity of the parent element during one phase of the loop.
function fade([from, to], rest) {
  const edge = 0.012;
  return `<animate attributeName="opacity" dur="${LOOP}" repeatCount="indefinite" keyTimes="0;${from};${fraction(from + edge)};${fraction(to - edge)};${to};1" values="${rest};${rest};1;1;${rest};${rest}"/>`;
}

// A box with a double rule. The optional highlight is lit during one phase.
function box(x, y, width, height, highlight = '') {
  return `<rect class="outer" x="${x + 0.5}" y="${y + 0.5}" width="${width}" height="${height}"/><rect class="inner" x="${x + 4.5}" y="${y + 4.5}" width="${width - 8}" height="${height - 8}"/>${highlight}`;
}

// Small drawings for the four boxes on the right, drawn around the point (0, 0) in a 30 by 30 area.
const GLYPHS = [
  // DoneDeal: prices against age, a trend line, and one ad below the line.
  `<path class="faint" d="M-14,-13 V13 H14"/>${[[-9, -8], [-5, -4], [-1, -3], [3, 2], [7, 4], [11, 8]].map(([x, y]) => `<circle class="solid" cx="${x}" cy="${y}" r="1.3"/>`).join('')}
<path class="trend" d="M-12,-10 L13,9"/><circle class="ring" cx="-4" cy="6" r="2"/><circle class="find" cx="-4" cy="6" r="1.9"/>`,
  // Facebook: a browser window that scrolls through ads; every second ad is a find.
  `<clipPath id="glyph-window"><rect x="-13" y="-5.5" width="26" height="17"/></clipPath>
<rect class="faint" x="-14" y="-12" width="28" height="24"/><path class="faint" d="M-14,-6 H14"/><circle class="solid" cx="-11" cy="-9" r=".9"/><circle class="solid" cx="-8" cy="-9" r=".9"/>
<g clip-path="url(#glyph-window)"><g class="feed">${[0, 1, 2, 3, 4].map((i) => `<g${i % 2 ? ' class="hit"' : ''}><rect x="-10.5" y="${-3.5 + i * 9}" width="7" height="6"/></g><path d="M-1,${-2 + i * 9} H10 M-1,${1 + i * 9} H6"/>`).join('')}</g></g>`,
  // Inspection: a scan line reads the year and county from an Irish number plate.
  `<path class="faint" d="M-14,-6 V-10 H-10 M10,-10 H14 V-6 M14,6 V10 H10 M-10,10 H-14 V6"/>
<rect class="plate" x="-11" y="-5" width="22" height="10" rx="1"/><rect class="band" x="-10.5" y="-4.5" width="3.5" height="9"/><text x="2.5" y="2.3" text-anchor="middle">07-D</text>
<path class="scan" d="M0,-9 V9"/>`,
  // gov.ie: the record check completes and a tick is drawn.
  `<circle class="faint" r="11"/><circle class="seal" r="11" transform="rotate(-90)"/><path class="tick" d="M-5,0.5 L-1.5,4 L5.5,-4"/>`,
];

const FLOW_SOURCES = [
  ['DoneDeal', 'ads + asking prices'],
  ['Facebook', 'Marketplace listings'],
  ['inspection', 'text + photos when available'],
  ['gov.ie', 'NCT + tax when available'],
];

function flowDiagram(price) {
  const request = 'M230,150 H400';
  // Four boxes on the right: two sources and two checks. Box tops at 22 + 66i, height 50, centres at 47 + 66i.
  const rows = [47, 113, 179, 245];
  const branches = rows.map((y) => `M660,150 H800 C828,150 822,${y} 850,${y}`);
  const working = `<rect class="hot" x="400.5" y="100.5" width="260" height="100" opacity="0">${fade([PHASE.pay[1], PHASE.report[0]], 0)}</rect>`;
  const delivered = `<rect class="hot done" x="0.5" y="118.5" width="230" height="64" opacity="0">${fade([PHASE.report[1], 0.97], 0)}</rect>`;
  return `<svg viewBox="0 -14 1130 314" aria-hidden="true">
<text class="note" x="800" y="-2">sources + checks</text>
<rect class="frame" x="800.5" y="6.5" width="329" height="282"/>
<path class="wire" d="${request}"/>
${branches.map((d) => `<path class="wire" d="${d}"/>`).join('')}
<text class="caption" x="315" y="136" text-anchor="middle">pay ${escape(price)} · testnet</text>
<text class="caption" x="315" y="174" text-anchor="middle">report</text>
<text class="caption" x="730" y="136" text-anchor="middle">collect</text>
<text class="caption" x="730" y="174" text-anchor="middle">evidence</text>
${box(0, 118, 230, 64, delivered)}
<text class="name" x="22" y="146">your agent</text><text class="note" x="22" y="166">testnet wallet · mppx</text>
${box(400, 100, 260, 100, working)}
<text class="name" x="422" y="146">second look</text><text class="note" x="422" y="166">ranks by worth calling</text>
${FLOW_SOURCES.map(([name, note], i) => `${box(850, 22 + i * 66, 264, 50)}<text class="name" x="872" y="${44 + i * 66}">${name}</text><text class="note" x="872" y="${61 + i * 66}">${escape(note)}</text><g class="glyph" transform="translate(1086 ${rows[i]})">${GLYPHS[i]}</g>`).join('')}
<circle class="port" cx="230" cy="150" r="3.5"/><circle class="port" cx="400" cy="150" r="3.5"/><circle class="port" cx="660" cy="150" r="3.5"/>
${rows.map((y) => `<circle class="port" cx="850" cy="${y}" r="3.5"/>`).join('')}
${pulse('pay', request, PHASE.pay)}
${branches.map((d) => pulse('', d, PHASE.collect)).join('')}
${branches.map((d) => pulse('', d, PHASE.ads, true)).join('')}
${pulse('report', request, PHASE.report, true)}
</svg>`;
}

// A code box with tabs; each tab is [label, text]. One tab is a plain box with a Copy button.
function codeTabs(tabs, kind = '') {
  const labels = tabs.length === 1
    ? `<span class="label">${escape(tabs[0][0])}</span>`
    : `<div role="tablist">${tabs.map(([label], i) => `<button type="button" role="tab" aria-selected="${i === 0}">${escape(label)}</button>`).join('')}</div>`;
  const panes = tabs.map(([, text], i) => `<pre${i ? ' hidden' : ''}><code>${escape(text)}</code></pre>`).join('');
  return `<div class="code${kind ? ` ${kind}` : ''}"><div class="tabs">${labels}<button type="button" class="copy" aria-live="polite">Copy</button></div>${panes}</div>`;
}

// One line, in the convention MPP uses for agents ("Read https://tempo.xyz/SKILL.md and ...").
export function agentPrompt(origin) {
  return `Read ${origin}/SKILL.md and find me a used Volkswagen Passat or Skoda Octavia, 2007-2015, under €6,000 near Dublin.`;
}

const cardPrice = (card) => `${card.currency === 'eur' ? '€' : card.currency === 'usd' ? '$' : card.currency.toUpperCase() + ' '}${Number(card.price).toFixed(2)}`;

export function landingPage({ origin, price, card, queueLength, completed, refunded, facebookEnabled, classifierEnabled }) {
  const wallet = `${MPPX} account create --account car-search --network testnet
${MPPX} account fund --account car-search --network testnet`;
  const pay = `${MPPX} ${origin}/v1/searches --account car-search --network testnet \\
  -J '${JSON.stringify(EXAMPLE)}'`;
  const poll = `curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" \\
  ${origin}/v1/searches/$SEARCH_ID
# Or open ${origin}/searches/<searchId> and enter the access token.`;
  const state = (enabled) => `<b class="${enabled ? '' : 'off'}">${enabled ? 'on' : 'off'}</b>`;
  const description = 'A used-car shortlist for Ireland. Compare asking prices and see which ads are worth a call. Try it with your agent on Tempo testnet.';
  const shareHead = `<meta name="description" content="${escape(description)}">
<meta property="og:type" content="website"><meta property="og:title" content="Second Look">
<meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${escape(origin)}/">
<meta property="og:image" content="${escape(origin)}/share.png"><meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Second Look · Your sleepless broker for used cars in Ireland">
<meta name="twitter:card" content="summary_large_image">`;
  return page('Second Look', `
<h1 class="wordmark">Second Look</h1>
<p class="tagline">Your sleepless broker for used cars in Ireland.</p>
<div class="diagram" role="img" aria-label="Your agent pays ${escape(price)} test pathUSD for a Second Look report. The service reads DoneDeal and, when available, Facebook Marketplace ads. It inspects text and available photos and may look up NCT and motor tax when it can read a full Irish plate.">
  ${flowDiagram(price)}
  <div class="flow" aria-hidden="true">
    <div class="node"><b>your agent</b><small>testnet wallet · mppx</small></div>
    <div class="edge"><div class="right">pay ${escape(price)} · testnet</div><div class="left">report</div></div>
    <div class="node"><b>second look</b><small>ranks by worth calling</small></div>
    <div class="edge"><div class="right">collect</div><div class="left">evidence</div></div>
    <div class="group"><span>sources + checks</span>
      ${FLOW_SOURCES.map(([name, note]) => `<div class="node"><b>${name}</b><small>${escape(note)}</small></div>`).join('')}
    </div>
  </div>
</div>
${codeTabs([['Paste into your coding agent', agentPrompt(origin)]], 'prompt')}
<p class="lead">Your agent pays once. Second Look finds the ads other buyers miss and ranks the cars worth a call.</p>

<section class="example" aria-labelledby="example-title">
  <p class="muted">Real find from a paid testnet search · <time datetime="2026-11-10">10 Nov 2026</time></p>
  <h2 id="example-title">Volkswagen Pass<mark>s</mark>t B8 2015 · <span class="asking">€3,795 asking</span></h2>
  <p>The seller misspelled "Passat", so a normal search does not show this ad. The price was 42% below our €6,595 estimate from 434 comparable ads.</p>
</section>

<ul class="status" aria-label="Service status">
  <li><span class="lamp"></span>Tempo testnet</li>
  <li><b>${escape(price)}</b> test pathUSD per search</li>
${card ? `  <li>or <b>${escape(cardPrice(card))}</b> by card</li>
` : ''}  <li>searches completed <b>${completed}</b></li>
</ul>

<h2 class="step">what one payment buys</h2>
<dl class="spec">
<div><dt>sources</dt><dd>DoneDeal and, when available, Facebook Marketplace.</dd></div>
<div><dt>price</dt><dd>An estimate from comparable DoneDeal asking prices.</dd></div>
<div><dt>inspection</dt><dd>Claude reads the text and photos. A readable plate may get a gov.ie NCT and motor tax check.</dd></div>
<div><dt>report</dt><dd>Who to call first and what to check.</dd></div>
<div><dt>refund</dt><dd>If a required source fails, the service attempts a refund.</dd></div>
<div><dt>network</dt><dd>Tempo testnet: no real money moves.${card ? ` A card payment is a ${card.test ? 'test payment' : 'real charge'} of ${escape(cardPrice(card))}${card.test ? ' in a Stripe sandbox' : ''}.` : ''}</dd></div>
</dl>
<p class="muted">Estimates use asking prices. This demo has no data licence from the listing sites. Check the car in person before buying.</p>

<h2 class="step">try it by hand</h2>
${codeTabs([['1 wallet', wallet], ['2 pay', pay], ['3 report', poll]])}
`, shareHead, 'landing');
}

export function agentInstructions({ origin, price, card }) {
  // Card steps for an agent that holds a Link agent wallet. The command comes from Stripe's MPP guide.
  const cardSteps = card ? `## 2b. Pay by card instead (only when the user asks)

The same route accepts a Stripe Shared Payment Token (SPT). The 402 challenge lists two methods:
\`tempo\` (${price} test pathUSD) and \`stripe\` (${cardPrice(card)}). Your client answers the method that it supports.
An SPT lets this one seller charge one amount, one time. You never send a card number.

\`\`\`bash
npx @stripe/link-cli auth login
npx @stripe/link-cli mpp pay ${origin}/v1/searches${card.test ? ' --test' : ''} --method POST \\
  --header "Content-Type: application/json" \\
  --data '${JSON.stringify(EXAMPLE)}' \\
  --context "One used-car search on Second Look for my user, who asked for it and approved the ${cardPrice(card)} card charge for this search."
\`\`\`

The user approves the spend request in Link. The response is the same 202 with \`searchId\` and \`accessToken\`.
${card.test ? 'This service runs in a Stripe sandbox: a card payment is a test payment and no real money moves.' : `This is a real charge of ${cardPrice(card)}.`}

` : '';
  return `---\nname: second-look\ndescription: Rank Irish used-car listings for one testnet MPP charge.\n---\n\n# Second Look: instructions for AI agents

Service: ${origin}
Purpose: compare asking prices and shortlist used cars in Ireland from DoneDeal and, when available, Facebook Marketplace.
Payment: one MPP charge of ${price} test pathUSD on Tempo testnet (chain 42431). No real money.${card ? `\nCard: the same search costs ${cardPrice(card)} by card through a Stripe Shared Payment Token (see step 2b). ${card.test ? 'Stripe sandbox: no real money.' : 'This is real money.'}` : ''}

## Rules

- Use Tempo **testnet** only. Always pass \`--network testnet\`. Never pay on mainnet.
${card ? `- Pay by card only when the user asks for it and approves the ${cardPrice(card)} charge. Never create a Shared Payment Token without that approval.\n` : ''}- Make **one** paid request per user request. Never repeat a payment because a search failed.
  Check the status response for the refund state.
- Do not pay more than ${price}. If the 402 challenge asks for more, stop and tell the user.
- Ask the user for criteria you cannot infer. Defaults: county Dublin, years 2007-${new Date().getUTCFullYear()}.

## 1. Testnet wallet (once)

\`\`\`bash
${MPPX} account create --account car-search --network testnet
${MPPX} account fund --account car-search --network testnet
\`\`\`

If the account already exists, skip creation. \`fund\` gives free test tokens.

## 2. Pay for one search

Criteria JSON fields:
- \`vehicles\` (required): 1-4 objects \`{ "make": "...", "model": "..." }\` (model optional)
- \`priceMaxEur\` (required), \`priceMinEur\`
- \`yearFrom\`, \`yearTo\`, \`mileageMaxKm\`, \`seatsMin\`, \`engineLitres\` (for example 3.0)
- \`fuelTypes\`: any of Petrol, Diesel, Electric, Petrol Hybrid, Diesel Hybrid, Petrol Plug-in Hybrid
- \`county\`: an Irish county, for example Dublin
- \`sources\`: \`["donedeal", "facebook"]\` (default both). Every requested source is required.

Check the price and current source availability with the criteria you plan to submit:

\`\`\`bash
curl -sS ${origin}/v1/searches/quote -H 'Content-Type: application/json' \\
  -d '${JSON.stringify(EXAMPLE)}'
\`\`\`

If \`canPay\` is false, explain the reason. If a requested source is unavailable, ask the user
before switching to a smaller source set. Quote again after changing the criteria.

\`\`\`bash
${MPPX} ${origin}/v1/searches --account car-search --network testnet \\
  -J '${JSON.stringify(EXAMPLE)}'
\`\`\`

A 400 response means the criteria are invalid; nothing was paid. Fix them and try again.
A 503 response includes the reason the search was refused. Nothing was paid.
A 202 response means the payment succeeded. It contains \`searchId\`, \`accessToken\`, \`progressPage\` and \`message\`.
Give the user the \`progressPage\` link. It carries the access token and opens the live progress page directly.
Keep the token private. It expires after 24 hours.

${cardSteps}## 3. Wait for the report (free)

\`\`\`bash
curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" \\
  ${origin}/v1/searches/$SEARCH_ID
\`\`\`

Poll every 10 seconds. \`state\` goes \`queued\` → \`running\` → \`done\` (or \`failed\`).
\`queuePosition\` shows how many searches are ahead. One search takes about 1-2 minutes.
If a required source fails after payment, the job fails and the service attempts a testnet refund.
Check the refund state on the same status endpoint.

## 4. Report to the user

From \`report\`:
- \`shortlist\`: IDs of up to three candidates in \`confident\`, in call order. Each find's
  \`nextStep\` gives checks to make before a viewing.
- \`confident\`: cars worth calling about, best first. Ranking weighs a capped discount against comparable
  asking prices plus NCT, mileage and service history signals from the available evidence.
- \`uncertain\`: promising finds; \`reasons\` lists what is missing or unclear.
- \`cheapForAReason\`: big discounts with stated damage, no valid NCT or a failed NCT. Mention them only
  as project cars, with their \`reasons\`.
- \`cautions\` on any find: things to ask the seller (mileage, NCT date, an unusually low price).
- Each find has \`url\`, \`priceEur\`, \`facts\` (make, model, year, mileage and where each came from),
  \`valuation\` when enough comparable ads match (median, middle-half asking-price range, and example ads),
  \`condition\` (flags, summary), and \`foundOutsideSiteFilter\` (collected in a broader search).
- \`facts.plate\` (year and county decoded from a readable Irish number plate) and \`official\`
  (the Government of Ireland vehicle record: make, model, colour, NCT and motor tax expiry) when available.
  An official record that disagrees with the ad moves the find to \`uncertain\`; an expired official
  NCT moves it to \`cheapForAReason\`.

Tell the user about the shortlist in order and include each find's next checks. Mention uncertain finds only with
their reasons, and cheap-for-a-reason cars only as project cars. The human-readable report at
${origin}/searches/<searchId> prompts for the access token. Keep the token out of links and shared logs.
Be honest: the valuation is an estimate from listings, not an inspection. The user must view the car.
`;
}

function money(value) {
  return value === undefined || value === null ? '?' : `€${Number(value).toLocaleString('en-IE')}`;
}

function findCard(find) {
  const { valuation } = find;
  const action = find.nextStep ?? buyerAction(find);
  let estimate = escape(find.valuationNote ?? 'No asking-price estimate');
  if (valuation && !valuation.rangeEur) {
    const discount = Math.round(valuation.discount * 100);
    const estimatedPrice = money(valuation.expectedEur);
    const comparison = discount
      ? `${Math.abs(discount)}% ${discount > 0 ? 'below' : 'above'} estimated ${estimatedPrice}`
      : `Estimated ${estimatedPrice}`;
    const method = valuation.method === 'regression' ? 'modelled by year and mileage'
      : valuation.method === 'median-of-year' ? 'median of similar years' : valuation.method;
    estimate = `${comparison} (${escape(method)}, ${escape(valuation.comparables)} observations)`;
  }
  const facts = [find.facts.yearMin && (find.facts.yearMin === find.facts.yearMax ? find.facts.yearMin : `${find.facts.yearMin}-${find.facts.yearMax}`),
    find.facts.make, find.facts.model].filter(Boolean).join(' ') || find.title;
  const km = find.facts.mileageKm ? `${find.facts.mileageKm.toLocaleString('en-IE')} km` : 'mileage unknown';
  return `<article class="card find">
${find.photo ? `<img src="${escape(find.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
<div>
<h3>${/^https:\/\//i.test(find.url) ? `<a href="${escape(find.url)}" rel="noopener noreferrer" target="_blank">${escape(facts)}</a>` : escape(facts)}</h3>
<div><b>${find.priceEur ? `${money(find.priceEur)} asking` : 'Asking price unknown'}</b> · ${escape(km)}${find.facts.seats ? ` · ${escape(find.facts.seats)} seats listed` : ''}${find.county ? ` · ${escape(find.county)}` : ''}</div>
<div class="action"><strong>${escape(action.label)}</strong><ul>${action.checks.map((check) => `<li>${escape(check)}</li>`).join('')}</ul></div>
${valuation?.rangeEur ? `<div class="muted">Middle half of ${escape(valuation.comparables)} comparable asks: ${money(valuation.rangeEur.low)}–${money(valuation.rangeEur.high)} · median ${money(valuation.expectedEur)}</div>
${valuation.reason ? `<p class="muted">${escape(valuation.reason)}</p>` : ''}
${valuation.examples?.length ? `<details class="muted"><summary>Example comparable ads</summary><ul>
${valuation.examples.map((ad) => `<li><a href="${escape(ad.url)}" rel="noopener noreferrer" target="_blank">${escape(ad.year)} · ${escape(ad.mileageKm.toLocaleString('en-IE'))} km · ${money(ad.priceEur)}</a></li>`).join('')}
</ul></details>` : ''}` : `<div class="muted">${estimate}</div>`}
<div><span class="tag">${escape(find.source)}</span>${find.foundOutsideSiteFilter ? '<span class="tag">broader search</span>' : ''}${(find.condition.flags ?? []).map((flag) => `<span class="tag">${escape(flag)}</span>`).join('')}</div>
<p class="muted">Ad review · ${escape(find.condition.summary)}</p>
${find.facts.nctExpiry ? `<p class="muted">Ad lists NCT expiry · ${escape(find.facts.nctExpiry)}</p>` : ''}
${find.facts.plate ? `<p class="muted">Plate read from ad · ${escape(find.facts.plate.year)}${find.facts.plate.half ? ` (${find.facts.plate.half === 1 ? 'Jan-Jun' : 'Jul-Dec'})` : ''} · ${escape(find.facts.plate.county)}</p>` : ''}
${find.official ? `<p class="muted">gov.ie lookup · ${escape(find.official.make)} ${escape(find.official.model)}${find.official.colour ? `, ${escape(find.official.colour.toLowerCase())}` : ''} · NCT expiry ${escape(find.official.nctExpiry ?? 'unavailable')} · motor tax expiry ${escape(find.official.taxExpiry ?? 'unavailable')}</p>` : ''}
${find.verdict === 'uncertain' ? `<p class="muted warn">Uncertain: ${escape(find.reasons.join('; '))}</p>` : ''}${find.verdict === 'project' ? `<p class="muted warn">Cheap for a reason: ${escape(find.reasons.join('; '))}</p>` : ''}
${find.notes ? `<p class="muted">Note: ${escape(find.notes)}</p>` : ''}
${find.cautions ? `<p class="muted warn">Caution: ${escape(find.cautions.join('; '))}</p>` : ''}
</div></article>`;
}

// Live search page: Marketplace windows sit beside the current search results.
// The page polls /v1/searches/{id}/events. Client script uses no template literals (it sits in one).
const LIVE_STYLE = `<style>
.live main { max-width: 1120px; }
.live-workspace { display:grid; grid-template-columns:240px minmax(0, 1fr); gap:24px; align-items:start; }
.live-workspace:has(> .worker-rail[hidden]) { grid-template-columns:minmax(0, 1fr); }
.search-stage { min-width:0; border:1px solid var(--line); background:var(--panel); padding:20px; }
.tiles { display:flex; gap:12px; overflow-x:auto; padding-bottom:5px; margin-bottom:12px; }
.tiles:empty { display:none; }
.tiles > .group { flex:1 0 126px; }
.group { position:relative; }
.group .badge { display:none; }
.tile { border:1px solid var(--line); background:var(--panel); font-size:11.5px; line-height:1.45; overflow:hidden;
  animation: tile-in .45s cubic-bezier(.2,.9,.3,1.2) both; transition: opacity .4s ease, transform .35s ease, margin .35s ease, border-color .3s; }
.tile + .tile { margin-top:12px; }
.tile header { display:flex; justify-content:space-between; gap:8px; padding:5px 8px; border-bottom:1px solid var(--line); color:var(--muted); text-transform:uppercase; letter-spacing:.06em; font-size:10px; }
.tile header .lamp { width:7px; height:7px; border-radius:50%; background:var(--accent); align-self:center; animation: lamp 1s ease-in-out infinite; }
.tile.ended { opacity:.45; } .tile.ended header .lamp { background:var(--muted); animation:none; }
.tile.good { border-color: var(--good); } .tile.bad { border-color: var(--bad); }
.tile .body { padding:8px; min-height:52px; }
.tile .big { color:var(--strong); font-size:13px; }
.tile .detail { color:var(--muted); overflow-wrap:anywhere; }
.tile .plate { display:inline-block; margin:4px 0; padding:1px 8px; border:1px solid var(--strong); background:#fff; color:#111; font-weight:600; letter-spacing:.08em; }
.tile .shot { display:block; width:100%; aspect-ratio:427/360; object-fit:cover; object-position:top; background-color:var(--bg); }
.tile .shot.wait { background-image: repeating-linear-gradient(90deg, transparent 0 12px, rgba(127,127,127,.08) 12px 24px); animation: wait 1.2s linear infinite; }
.group.stacked { cursor:pointer; padding-top:18px; }
.group.stacked .badge { display:block; position:absolute; top:0; left:0; font-size:10.5px; color:var(--accent); letter-spacing:.06em; text-transform:uppercase; }
.group.stacked:not(.open) { display:grid; padding-bottom: 22px; }
.group.stacked:not(.open) .tile { grid-area: 1 / 1; margin-top:0; transform: translate(calc(var(--i) * -4px), calc(var(--i) * 4px)) rotate(calc(var(--i) * -1.5deg)); box-shadow: 0 6px 16px rgba(0,0,0,.4); }
.group.stacked:not(.open):hover .tile { transform: translate(calc(var(--i) * -7px), calc(var(--i) * 7px)) rotate(calc(var(--i) * -2.5deg)); }
.group.stacked:not(.open) .tile:not(:last-child) .body { visibility:hidden; }
/* Boat windows: a slim, sticky rail in the style of Stage Manager. The rail width never changes,
   so the results panel stays in place. A selected window straightens and floats beside the rail. */
.worker-rail { min-width:0; position:sticky; z-index:5; top:16px; max-height:calc(100vh - 32px); overflow-y:auto; overflow-x:hidden; scrollbar-width:thin; }
.workers-head { display:grid; gap:2px; margin:0 4px 10px; font-size:10.5px; letter-spacing:.06em; color:var(--muted); }
.workers-head b { font-weight:400; color:var(--text); text-transform:uppercase; }
.workers:empty::before { content:'Windows appear here when Marketplace opens'; display:block; margin:0 4px; padding:14px 10px; border:1px dashed var(--line2); border-radius:8px; color:var(--muted); font-size:11px; line-height:1.4; }
.workers .group { display:grid; gap:14px; padding:6px 14px 14px 4px; }
.workers .tile + .tile { margin-top:0; }
.worker { container-type:inline-size; position:relative; display:flex; flex-direction:column; cursor:zoom-in; overflow:hidden;
  border:1px solid var(--line2); border-radius:8px; background:var(--panel);
  box-shadow:0 12px 24px -10px rgba(0,0,0,.6), 0 2px 6px rgba(0,0,0,.25);
  transform:perspective(700px) rotateY(16deg) scale(.94); transform-origin:left center;
  transition:transform .35s cubic-bezier(.2,.8,.2,1), box-shadow .35s ease, border-color .2s ease; }
.worker:hover, .worker:focus-visible { transform:perspective(700px) rotateY(6deg) scale(.98); border-color:var(--muted); }
.worker:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
.worker.ended { opacity:1; }
.worker[data-state="failed"] { border-color:var(--bad); }
/* The status pill sits on the picture with fixed colours, so it stays readable at thumbnail size in both themes. */
.worker .bar { position:absolute; z-index:1; top:6px; left:6px; max-width:calc(100% - 12px); display:flex; align-items:center; gap:6px; padding:3px 9px 3px 7px;
  border-radius:999px; background:rgba(0,0,0,.74); box-shadow:0 1px 3px rgba(0,0,0,.4); color:#fff; font-size:11px; font-weight:600; line-height:1.3; white-space:nowrap; }
.worker .lamp { flex:none; width:8px; height:8px; border-radius:50%; background:#ffb000; animation: lamp 1s ease-in-out infinite; }
.worker .name { min-width:0; overflow:hidden; text-overflow:ellipsis; }
.worker .long { display:none; }
.worker .short { display:none; }
.worker .state { color:#ffb000; }
.worker[data-state="running"] .lamp { background:#7ee787; animation-duration:2s; }
.worker[data-state="running"] .state { color:#7ee787; }
.worker[data-state="finished"] .lamp { background:#c9c9c9; animation:none; }
.worker[data-state="finished"] .state { color:#d9d9d9; }
.worker[data-state="failed"] .lamp { background:#ff7b72; animation:none; }
.worker[data-state="failed"] .state { color:#ff9d96; }
.worker .view { position:relative; flex:1 0 auto; aspect-ratio:16/10; overflow:hidden; background:var(--bg); }
.worker .shot { position:absolute; inset:0; width:100%; height:100%; aspect-ratio:auto; object-fit:cover; object-position:top; transition: opacity .4s ease, filter .4s ease; }
.worker.ended .shot { opacity:.45; filter:grayscale(1); }
.worker .caption { display:none; position:absolute; left:0; right:0; bottom:0; padding:18px 10px 6px; font-size:12px; color:#fff; background:linear-gradient(transparent, rgba(0,0,0,.82)); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; pointer-events:none; }
.worker.selected { position:fixed; z-index:30; top:var(--stage-top, 16px); left:var(--stage-left, 200px); width:min(560px, calc(100vw - var(--stage-left, 200px) - 24px));
  transform:none; cursor:zoom-out; border-color:var(--strong); box-shadow:0 28px 64px -16px rgba(0,0,0,.75), 0 4px 12px rgba(0,0,0,.3); }
.worker.selected .view { aspect-ratio:4/5; max-height:calc(100vh - var(--stage-top, 16px) - 24px); }
.worker.selected .shot { object-fit:contain; }
.worker.selected .long { display:inline; }
.worker.selected .caption:not(:empty) { display:block; }
.worker.selected .bar::after { content:'· click to return'; font-weight:400; color:#bdbdbd; }
::view-transition-group(*) { animation-duration:.28s; }
.goal { font-size:18px; color:var(--strong); margin:0 0 4px; }
.goal::after { content:'▍'; color:var(--accent); animation: lamp 1s steps(1) infinite; margin-left:4px; }
.done .goal::after { display:none; }
.phase { color:var(--muted); font-size:13px; margin:0 0 16px; min-height:1.7em; }
.ads { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
.ad { border:1px solid var(--line); background:var(--panel); padding:8px 12px; display:grid; grid-template-columns: 64px 1fr auto; gap:12px; align-items:start;
  animation: ad-in .35s ease both; transition: opacity .5s ease, border-color .3s; }
.ad img, .ad .nophoto { width:64px; height:48px; object-fit:cover; background:var(--bg); display:block; }
.ad .t { color:var(--strong); overflow-wrap:anywhere; } .ad .t a { text-decoration:none; }
.ad .meta { color:var(--muted); font-size:12px; }
.ad .line { font-size:12.5px; } .ad .line.old { color:var(--muted); font-size:11.5px; }
.ad .v { font-size:10.5px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); white-space:nowrap; }
.ad.confident { border-color: var(--good); } .ad.confident .v { color:var(--good); }
.ad.uncertain .v { color:var(--warn); } .ad.project .v { color:var(--muted); }
.ad.flash { animation: flash .8s ease; }
.ad.rejected { opacity:.5; } .ad.rejected .t, .ad.rejected .meta { text-decoration: line-through; text-decoration-color: var(--bad); } .ad.rejected .v { color:var(--bad); }
.ad.gone { opacity:0; transform: translateX(24px); transition: opacity .5s ease, transform .5s ease; }
.counts { color:var(--muted); font-size:12px; margin-top:16px; }
@keyframes tile-in { from { opacity:0; transform: translateX(-24px) scale(.9); } }
@keyframes ad-in { from { opacity:0; transform: translateY(-8px); } }
@keyframes flash { 0% { border-color: var(--accent); } 100% { } }
@keyframes lamp { 50% { opacity:.25; } }
@keyframes wait { to { background-position: 24px 0; } }
@media (max-width: 640px) {
  .live-workspace { grid-template-columns:minmax(0, 1fr); gap:16px; }
  .worker-rail { position:static; max-height:none; overflow:visible; }
  .workers-head { display:flex; justify-content:space-between; flex-wrap:wrap; margin-bottom:4px; }
  .workers-head span::after { content:' · swipe for more'; }
  .workers .group { display:flex; gap:10px; min-height:104px; overflow-x:auto; overscroll-behavior-x:contain; scroll-snap-type:x mandatory; scroll-padding-inline:4px; padding:8px 16px 10px 4px; scrollbar-width:none; }
  .workers .group::-webkit-scrollbar { display:none; }
  .worker { flex:0 0 140px; scroll-snap-align:start; transform:perspective(600px) rotateY(10deg) scale(.96); }
  .worker:hover, .worker:focus-visible { transform:perspective(600px) rotateY(4deg) scale(.98); }
  .worker.selected { top:auto; bottom:12px; left:12px; right:12px; width:auto; }
  .worker.selected .view { aspect-ratio:16/10; max-height:55vh; }
  .worker.selected .bar::after { content:'· tap to return'; }
  .search-stage { padding:12px; }
}
@media (max-width: 760px) {
  .ad { grid-template-columns: 48px 1fr; } .ad img, .ad .nophoto { width:48px; height:36px; } .ad .v { grid-column: 2; }
}
@media (prefers-reduced-motion: reduce) { .tile, .ad, .goal::after, .tile header .lamp, .tile .shot.wait, .worker, .worker .lamp, .worker .shot { animation:none !important; transition:none !important; } }
</style>`;

export function reportAccessPage() {
  return page('Open a car search', `<h1>Open a car search</h1>
<p>Enter the access token from your paid search response.</p>
<form id="unlock" method="post" autocomplete="off">
  <label>Access token <input id="access-token" type="password" required></label>
  <button type="submit">Open report</button>
</form>
<p id="unlock-error" role="status"></p>
<script>
document.getElementById('unlock').addEventListener('submit', async function (event) {
  event.preventDefault();
  var form = event.currentTarget, input = document.getElementById('access-token');
  var token = input.value;
  input.value = '';
  var read = function (path, signal) {
    var url = new URL(path, location.href);
    if (url.origin !== location.origin) throw new Error('Search unavailable');
    return fetch(url, { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store', redirect: 'error', signal: signal });
  };
  var show = async function () {
    var response = await read(location.pathname);
    if (!response.ok) throw new Error('Search unavailable');
    var html = await response.text();
    window.readSearch = read;
    window.showSearch = show;
    document.open();
    document.write(html);
    document.close();
  };
  var button = form.querySelector('button');
  button.disabled = true;
  try { await show(); }
  catch (error) { document.getElementById('unlock-error').textContent = 'Search unavailable. Check your access token.'; }
  finally { button.disabled = false; }
});
// A progress link carries the token in its fragment. Take it, clear it from the address bar, and open the search.
var linked = /^#access=([A-Za-z0-9_-]{43})$/.exec(location.hash);
if (linked) {
  history.replaceState(null, '', location.pathname);
  document.getElementById('access-token').value = linked[1];
  document.getElementById('unlock').requestSubmit();
}
</script>`);
}

function livePage(job, wanted) {
  const script = `<script>
(function () {
var id = ${JSON.stringify(job.id)};
var MAX_VISIBLE = 6;
var LABEL = { donedeal: 'DoneDeal', facebook: 'Marketplace', plate: 'Number plate', nct: 'NCT check' };
var ORDER = { donedeal: 0, facebook: 1, plate: 2, nct: 3 };
var RANK = { confident: 0, uncertain: 1, project: 2 };
var VERDICT = { confident: 'worth a call', uncertain: 'uncertain', project: 'cheap for a reason', rejected: 'rejected' };
var WORKER_STATE = { add: 'opening', update: 'running', end: 'finished' };
var tilesBox = document.getElementById('tiles'), adsBox = document.getElementById('ads');
var workersBox = document.getElementById('workers'), workerRail = document.getElementById('worker-rail');
var goalBox = document.getElementById('goal'), phaseBox = document.getElementById('phase'), stateBox = document.getElementById('state');
var countsBox = document.getElementById('counts');
var after = 0, tiles = {}, groups = {}, ads = {}, rejected = 0, finishedReload = false;

function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function money(v) { return v ? '€' + Number(v).toLocaleString('en-IE') : 'price ?'; }

function group(kind) {
  if (groups[kind]) return groups[kind];
  var g = el('div', 'group'); g.dataset.kind = kind;
  g.appendChild(el('div', 'badge'));
  g.addEventListener('click', function () { if (g.classList.contains('stacked')) { g.classList.toggle('open'); layout(); } });
  if (kind === 'facebook') { workersBox.appendChild(g); workerRail.hidden = false; }
  else {
    var later = [].slice.call(tilesBox.children).find(function (x) { return ORDER[x.dataset.kind] > ORDER[kind]; });
    tilesBox.insertBefore(g, later || null);
  }
  groups[kind] = g;
  return g;
}
function layout() {
  // Only the source and check tiles can stack.
  var all = Object.keys(tiles).filter(function (k) { return tiles[k].dataset.kind !== 'facebook'; }).length;
  Object.keys(groups).forEach(function (kind) {
    var g = groups[kind], items = g.querySelectorAll('.tile');
    if (kind === 'facebook') return;
    var stack = all > MAX_VISIBLE && items.length > 1;
    g.classList.toggle('stacked', stack);
    if (!stack) g.classList.remove('open');
    g.querySelector('.badge').textContent = LABEL[kind] + ' ×' + items.length + (g.classList.contains('open') ? ' · click to stack' : ' · click to open');
    [].forEach.call(items, function (t, i) { t.style.setProperty('--i', items.length - 1 - i); });
  });
}
function setWorkerState(t, state) {
  if (t.classList.contains('ended') || t.dataset.state === state) return;
  t.dataset.state = state;
  t.querySelector('.state').textContent = state;
  t.setAttribute('aria-label', 'Marketplace worker ' + t.dataset.number + ', ' + state + ', view-only live preview');
}
// The enlarged window floats beside the rail, so the results panel never moves.
function placeStage() {
  var r = workerRail.getBoundingClientRect(), root = document.documentElement.style;
  root.setProperty('--stage-left', Math.round(r.right + 16) + 'px');
  root.setProperty('--stage-top', Math.round(Math.max(16, r.top)) + 'px');
}
addEventListener('resize', placeStage);
addEventListener('scroll', function () { if (workersBox.querySelector('.worker.selected')) placeStage(); }, { passive: true });
document.addEventListener('keydown', function (event) {
  var open = workersBox.querySelector('.worker.selected');
  if (event.key === 'Escape' && open) selectWorker(open);
});
// Enlarge one worker, or return it to its usual size. The other workers stay in view.
function selectWorker(t) {
  var g = groups.facebook, enlarge = !t.classList.contains('selected');
  function apply() {
    [].forEach.call(g.querySelectorAll('.worker'), function (w) {
      var chosen = enlarge && w === t;
      w.classList.toggle('selected', chosen); w.setAttribute('aria-pressed', String(chosen));
    });
    g.classList.toggle('has-selected', enlarge);
  }
  placeStage();
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(apply);
  else apply();
}
function workerEvent(e) {
  var t = tiles[e.id];
  if (!t) {
    var number = (e.index || 0) + 1;
    t = el('div', 'tile worker'); t.dataset.kind = 'facebook'; t.dataset.number = number;
    t.setAttribute('role', 'button'); t.tabIndex = 0; t.setAttribute('aria-pressed', 'false');
    t.style.viewTransitionName = 'worker-' + number;
    var bar = el('div', 'bar'), name = el('span', 'name');
    name.appendChild(el('span', 'long', 'Marketplace '));
    name.appendChild(el('span', 'short', 'Boat '));
    name.appendChild(document.createTextNode(String(number)));
    bar.appendChild(el('i', 'lamp')); bar.appendChild(name); bar.appendChild(el('span', 'state'));
    var view = el('div', 'view'), shot = el('canvas', 'shot wait');
    shot.dataset.index = e.index;
    shot.dataset.windows = e.windows;
    shot.setAttribute('aria-hidden', 'true');
    view.appendChild(shot); view.appendChild(el('div', 'caption'));
    t.appendChild(bar); t.appendChild(view);
    t.addEventListener('click', function () { selectWorker(t); });
    t.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectWorker(t); }
    });
    group('facebook').appendChild(t);
    tiles[e.id] = t;
    layout();
  }
  t.querySelector('.caption').textContent = e.text || '';
  setWorkerState(t, e.op === 'end' && e.state === 'bad' ? 'failed' : WORKER_STATE[e.op] || 'running');
  if (e.op === 'end') t.classList.add('ended');
}
function tileEvent(e) {
  if (e.kind === 'facebook') { workerEvent(e); return; }
  var t = tiles[e.id];
  if (!t) {
    t = el('div', 'tile'); t.dataset.kind = e.kind;
    var head = el('header'); head.appendChild(el('span', null, LABEL[e.kind])); head.appendChild(el('i', 'lamp'));
    t.appendChild(head);
    t.appendChild(el('div', 'body'));
    group(e.kind).appendChild(t);
    tiles[e.id] = t;
    layout();
  }
  var body = t.querySelector('.body'); body.textContent = '';
  if (e.kind === 'plate' && e.detail) { body.appendChild(el('div', 'plate', e.detail)); if (e.title) body.appendChild(el('div', 'detail', e.title)); body.appendChild(el('div', 'detail', e.text)); }
  else if (e.kind === 'nct' && e.detail) { body.appendChild(el('div', 'detail', e.detail)); body.appendChild(el('div', 'big', e.text)); (e.lines || []).forEach(function (l) { body.appendChild(el('div', null, l)); }); }
  else { body.appendChild(el('div', 'big', e.text)); if (e.detail) body.appendChild(el('div', 'detail', e.detail)); }
  t.classList.toggle('good', e.state === 'good'); t.classList.toggle('bad', e.state === 'bad');
  if (e.op === 'end') { t.classList.add('ended'); t.classList.remove('good', 'bad'); }
}
function sortAds() {
  var items = [].slice.call(adsBox.children);
  var before = new Map(items.map(function (x) { return [x, x.getBoundingClientRect().top]; }));
  items.sort(function (a, b) {
    var ra = RANK[a.dataset.verdict] != null ? RANK[a.dataset.verdict] : 3, rb = RANK[b.dataset.verdict] != null ? RANK[b.dataset.verdict] : 3;
    return ra - rb || (Number(b.dataset.score || -9) - Number(a.dataset.score || -9));
  });
  items.forEach(function (x) { adsBox.appendChild(x); });
  items.forEach(function (x) {
    var dy = before.get(x) - x.getBoundingClientRect().top;
    if (!dy) return;
    x.style.transform = 'translateY(' + dy + 'px)'; x.style.transition = 'none';
    requestAnimationFrame(function () { x.style.transition = 'transform .4s ease'; x.style.transform = ''; });
  });
}
function addLine(card, text) {
  var lines = card.querySelector('.lines');
  [].forEach.call(lines.children, function (l) { l.classList.add('old'); });
  lines.appendChild(el('div', 'line', text));
  while (lines.children.length > 3) lines.removeChild(lines.firstChild);
}
function adEvent(e) {
  var card = ads[e.id];
  if (e.op === 'add' && !card) {
    card = el('li', 'ad'); card.dataset.id = e.id;
    if (e.photo) { var img = el('img'); img.src = e.photo; img.alt = ''; img.referrerPolicy = 'no-referrer'; img.loading = 'lazy'; img.onerror = function () { img.replaceWith(el('div', 'nophoto')); }; card.appendChild(img); }
    else card.appendChild(el('div', 'nophoto'));
    var mid = el('div'), title = el('div', 't'), label = e.title || 'ad';
    if (typeof e.url === 'string' && e.url.startsWith('https://')) {
      var link = el('a', null, label);
      link.href = e.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; title.appendChild(link);
    } else title.textContent = label;
    mid.appendChild(title);
    mid.appendChild(el('div', 'meta', [money(e.priceEur), e.year, e.mileageKm ? Number(e.mileageKm).toLocaleString('en-IE') + ' km' : '', e.county, e.source === 'facebook' ? 'Facebook' : 'DoneDeal'].filter(Boolean).join(' · ')));
    mid.appendChild(el('div', 'lines'));
    card.appendChild(mid); card.appendChild(el('div', 'v', 'found'));
    adsBox.appendChild(card); ads[e.id] = card;
  }
  if (!card) return;
  if (e.line) addLine(card, e.line);
  if (e.verdict) { card.dataset.verdict = e.verdict; card.dataset.score = e.score; card.className = 'ad ' + e.verdict; card.querySelector('.v').textContent = VERDICT[e.verdict]; }
  if (e.op === 'update') { card.classList.add('flash'); setTimeout(function () { card.classList.remove('flash'); }, 800); }
  if (e.op === 'reject') {
    rejected += 1;
    setTimeout(function () { card.classList.add('gone'); setTimeout(function () { card.remove(); sortAds(); }, 500); }, 2600);
  }
  sortAds();
  var kept = Object.keys(ads).filter(function (k) { return ads[k].isConnected && !ads[k].classList.contains('rejected'); }).length;
  countsBox.textContent = kept + ' ads on the list · ' + rejected + ' rejected';
}
function handle(e) {
  if (e.type === 'goal') goalBox.textContent = e.text;
  else if (e.type === 'tile') tileEvent(e);
  else if (e.type === 'ad') adEvent(e);
  else if (e.type === 'ads') phaseBox.textContent = e.text;
  else if (e.type === 'ranked') phaseBox.textContent = 'Ranked: ' + e.confident.length + ' worth a call · ' + e.uncertain.length + ' uncertain · ' + e.cheapForAReason.length + ' cheap for a reason';
}
var preview;
async function streamShots(controller) {
  var response = await window.readSearch('/searches/' + id + '/live.frames', controller.signal);
  if (!response.ok) return;
  var reader = response.body.getReader(), pending = new Uint8Array(), newest, drawing = false;
  async function draw() {
    if (drawing) return;
    drawing = true;
    try {
      while (newest && !controller.signal.aborted) {
        var frame = newest;
        newest = undefined;
        var image = await createImageBitmap(new Blob([frame.jpeg], { type: 'image/jpeg' }));
        try {
          if (controller.signal.aborted) continue;
          document.querySelectorAll('.tile .shot').forEach(function (shot) {
            var columns = Number(shot.dataset.windows), index = Number(shot.dataset.index);
            var x = Math.floor(index * image.width / columns);
            var width = Math.floor((index + 1) * image.width / columns) - x;
            if (shot.width !== width) shot.width = width;
            if (shot.height !== image.height) shot.height = image.height;
            shot.getContext('2d').drawImage(image, x, 0, width, image.height, 0, 0, width, image.height);
            shot.classList.remove('wait');
          });
        } finally { image.close(); }
      }
    } finally { drawing = false; }
  }
  try {
    while (!controller.signal.aborted) {
      var chunk = await reader.read();
      if (chunk.done) break;
      var bytes = new Uint8Array(pending.length + chunk.value.length);
      bytes.set(pending);
      bytes.set(chunk.value, pending.length);
      var view = new DataView(bytes.buffer), offset = 0;
      while (bytes.length - offset >= 12) {
        var length = view.getUint32(offset);
        if (!length || length > 25000) return;
        if (bytes.length - offset < 12 + length) break;
        newest = { at: view.getFloat64(offset + 4), jpeg: bytes.subarray(offset + 12, offset + 12 + length) };
        offset += 12 + length;
      }
      pending = bytes.slice(offset);
      if (newest) draw().catch(function () {});
    }
  } finally {
    await reader.cancel().catch(function () {});
  }
}
function updatePreview(active) {
  if (!active || document.hidden) { if (preview) preview.abort(); return; }
  if (preview) return;
  var controller = new AbortController();
  preview = controller;
  streamShots(controller).catch(function () {}).finally(function () { preview = undefined; });
}
document.addEventListener('visibilitychange', function () {
  if (document.hidden) updatePreview(false);
});
async function tick() {
  try {
    if (!window.readSearch) return;
    var response = await window.readSearch('/v1/searches/' + id + '/events?after=' + after);
    if (response.status === 404) { location.reload(); return; }
    var r = await response.json();
    r.events.forEach(function (e) { after = e.seq; handle(e); });
    stateBox.textContent = r.state + (r.queuePosition ? ' · ' + r.queuePosition + ' ahead in the queue' : '') + ' · ' + (r.progress || '');
    updatePreview(r.live && !r.live.finished);
    if ((r.state === 'done' || r.state === 'failed') && !finishedReload) {
      finishedReload = true; document.body.classList.add('done');
      phaseBox.textContent = r.state === 'done' ? 'Done. Opening the shortlist…' : 'The search failed.';
      setTimeout(function () { window.showSearch().catch(function () { location.reload(); }); }, r.state === 'done' ? 2500 : 500);
      return;
    }
  } catch (err) {}
  setTimeout(tick, 1000);
}
tick();
})();
</script>`;
  return page('Car search', `<h1>${escape(wanted)}</h1>
<p class="lead muted">State: <b id="state">${escape(job.state)}${job.queuePosition ? ` · ${job.queuePosition} ahead in the queue` : ''} · ${escape(job.progress ?? '')}</b></p>
<div class="live-workspace">
  <aside class="worker-rail" id="worker-rail" aria-label="Boat windows, view-only live preview"${(job.criteria?.sources ?? []).includes('facebook') ? '' : ' hidden'}>
    <p class="workers-head"><b>Boat windows</b><span>View only · select to enlarge</span></p>
    <div class="workers" id="workers"></div>
  </aside>
  <section class="search-stage" aria-live="polite" aria-label="Current search results">
    <p class="goal" id="goal">Looking for a ${escape(wanted)}</p>
    <p class="phase" id="phase">Starting the search</p>
    <aside class="tiles" id="tiles" aria-label="Sources and checks at work"></aside>
    <ol class="ads" id="ads"></ol>
    <p class="counts" id="counts"></p>
  </section>
</div>
${script}`, LIVE_STYLE, 'live');
}

export function reportPage(job) {
  if (job.state !== 'done') {
    const failed = job.state === 'failed';
    const awaitingRefund = job.refund?.state === 'pending' || (job.refund?.state === 'sending' && job.refund.hash);
    const wanted = (job.criteria?.vehicles ?? []).map((v) => [v.make, v.model].filter(Boolean).join(' ')).join(' or ') || 'Car search';
    if (!failed) return livePage(job, wanted);
    const liveBlock = '';
    const script = awaitingRefund ? '<script>if (window.showSearch) setTimeout(function () { window.showSearch().catch(function () { location.reload(); }); }, 5000);</script>' : '';
    return page('Car search', `<h1>${escape(wanted)}</h1>
<p class="lead">State: <b id="state">${escape(job.state)}${job.queuePosition ? ` · ${job.queuePosition} ahead in the queue` : ''} · ${escape(job.progress ?? '')}</b></p>
${job.error ? `<div class="card bad">${escape(job.error)}</div>` : ''}
${job.refund ? `<div class="card">Refund: ${escape(job.refund.state)}${job.refund.hash ? ` · <a href="https://explore.testnet.tempo.xyz/tx/${escape(job.refund.hash)}">transaction</a>` : ''}</div>` : ''}
${liveBlock}${script}`);
  }
  const r = job.report;
  const c = r.criteria;
  const wanted = c.vehicles.map((v) => [v.make, v.model].filter(Boolean).join(' ')).join(' or ');
  const projects = r.cheapForAReason ?? [];
  const shortlist = r.shortlist ? r.confident.filter((find) => r.shortlist.includes(find.id)) : r.confident;
  const otherCalls = r.confident.slice(shortlist.length);
  const generatedAt = Date.parse(r.generatedAt);
  const date = Number.isFinite(generatedAt)
    ? new Intl.DateTimeFormat('en-IE', { dateStyle: 'medium', timeZone: 'Europe/Dublin' }).format(generatedAt)
    : '';
  return page('Car search report', `<h1>${escape(wanted)}</h1>
<p class="lead">${escape(c.yearFrom)}-${escape(c.yearTo)} · up to ${money(c.priceMaxEur)}${c.mileageMaxKm ? ` · up to ${c.mileageMaxKm.toLocaleString('en-IE')} km` : ''}${c.engineLitres ? ` · ${escape(Number(c.engineLitres).toFixed(1))} litre` : ''}${c.fuelTypes?.length ? ` · ${escape(c.fuelTypes.join(' or ').toLowerCase())}` : ''}${c.seatsMin ? ` · ${escape(c.seatsMin)}+ seats` : ''}${c.county ? ` · ${escape(c.county)}` : ''}</p>
<p class="muted snapshot">${date ? `<time datetime="${escape(r.generatedAt)}">${escape(date)}</time> · ` : ''}${r.inspected} ads inspected in ${Math.round(r.elapsedMs / 1000)} s</p>
<ul class="links" aria-label="Report sections">
  <li><a href="#calls">${r.shortlist ? 'Shortlist' : 'Worth a call'} · ${shortlist.length}</a></li>
  <li><a href="#uncertain">Uncertain · ${r.uncertain.length}</a></li>
  ${projects.length ? `<li><a href="#projects">Project cars · ${projects.length}</a></li>` : ''}
</ul>
<p class="muted">Price estimates come from comparable asking prices. Check the listing and inspect the car before buying.</p>
${r.cachedFrom ? `<p class="muted">Instant result: the same search ran ${Math.max(1, Math.round((Date.now() - Date.parse(r.cachedFrom)) / 60000))} min ago, so this report reuses it.</p>` : ''}${r.sharedWithIdenticalSearch ? '<p class="muted">An identical search was already running, so this report shares its result.</p>' : ''}
${(r.warnings ?? []).map((w) => `<div class="card warn">${escape(w)}</div>`).join('')}
<h2 id="calls">${r.shortlist ? 'Who to call first' : 'Worth calling about'} (${shortlist.length})</h2>
${shortlist.map(findCard).join('') || '<p class="muted">No cars made the shortlist.</p>'}
${otherCalls.length ? `<details><summary>More cars worth a call (${otherCalls.length})</summary>${otherCalls.map(findCard).join('')}</details>` : ''}
<h2 id="uncertain">Uncertain finds (${r.uncertain.length})</h2>
${r.uncertain.map(findCard).join('') || '<p class="muted">None.</p>'}
${projects.length ? `<h2 id="projects">Cheap for a reason (${projects.length})</h2>
<p class="muted">Project cars with damage or NCT issues.</p>
${projects.map(findCard).join('')}` : ''}
<p class="muted">${r.rejectedCount} ads rejected. Ranking weighs the price comparison and available NCT, mileage and service history evidence.</p>`, '', 'report');
}
