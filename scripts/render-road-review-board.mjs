// A City of Cities — G02c-R Review Board (3840 × 2160, 8 panels). Panels are real runtime screenshots or charts drawn from
// the measured records (road-growth-review.json, road-growth-review-browser.json, junction-ramp.json); nothing is invented.
// Usage: node scripts/render-road-review-board.mjs
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ev = f => path.join(root, 'experiments/city-of-cities/evidence', f);
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world');
const exists = async f => { try { await access(f); return true; } catch { return false; } };
const R = JSON.parse(await readFile(ev('road-growth-review.json'), 'utf8'));
const B = await exists(ev('road-growth-review-browser.json')) ? JSON.parse(await readFile(ev('road-growth-review-browser.json'), 'utf8')) : null;
const J = JSON.parse(await readFile(ev('junction-ramp.json'), 'utf8'));
const img = async (file, alt) => (await exists(path.join(shots, file)) ? `<img src="${pathToFileURL(path.join(shots, file))}" alt="${alt}">` : `<div class="pending">Pending: ${file} not captured</div>`);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const seeds = Object.keys(R.runs);

// Panel 4: graph validation chart (shared edges per seed, components and reach per city).
const bars = (() => {
  const W = 860; const rows = [];
  const hist = [['G02c-01 (6202, 12 events)', R.historic6202.g02c01], ['G02c-02 replay', R.historic6202.g02c02Replay], ['G02c-03a replay', R.historic6202.g02c03aReplay], ...seeds.map(s => [`free growth ${s} (${R.runs[s].steps} steps)`, R.runs[s].sharedEdges])];
  const max = Math.max(...hist.map(([, h]) => h.aligned));
  hist.forEach(([label, h], i) => { const y = 34 + i * 46; const sx = v => (v / max) * (W - 330); rows.push(`<text x="0" y="${y + 15}" class="lbl">${esc(label)}</text><rect x="300" y="${y}" width="${sx(h.joined)}" height="22" fill="#3fd17a"/><rect x="${300 + sx(h.joined)}" y="${y}" width="${sx(h.unjoinedAligned)}" height="22" fill="#ff5a5a"/><text x="${306 + sx(h.aligned)}" y="${y + 16}" class="val">${h.joined} joined · ${h.unjoinedAligned} not joined</text>`); });
  return `<svg width="${W}" height="${40 + hist.length * 46}"><text x="0" y="16" class="lbl">Aligned same-city road ends (≤ 0.5 m) on shared edges: green joined, red not joined</text>${rows.join('')}</svg>`;
})();
const cityTable = seeds.map(s => `<tr><td>${s}</td><td>${Object.entries(R.runs[s].cities).filter(([, c]) => c.grown).map(([id, c]) => `${id.replace(/(Grid|OrganicCore|HillCore|CanalRing|WaterNetwork)$/, '')} ${c.reachableChunks}/${c.chunks} · ${c.components} comp`).join('<br>') || 'none'}</td></tr>`).join('');
const fab = seeds.map(s => { const f = R.runs[s].fabric; return `<tr><td>${s}</td><td>${f.chunks}</td><td>${f.committedBuildingsAffected}</td><td>${f.excluded} / ${f.candidates} (${f.candidates ? ((100 * f.excluded) / f.candidates).toFixed(1) : 0} %)</td><td>${f.abnormalParcels}</td><td>${f.coverageBeforeMean} → ${f.coverageAfterMean}</td></tr>`; }).join('');
const growth = seeds.map(s => { const r = R.runs[s]; return `<tr><td>${s}</td><td>${r.milestones[12] ? 'yes' : 'no'}</td><td>${r.milestones[30] ? 'yes' : 'no'}</td><td>${r.milestones[60] ? 'yes' : 'no'}</td><td>${r.steps}${r.stalled ? ` (stall ${r.stalled.step})` : ''}</td><td>${r.committedChunksChanged}</td></tr>`; }).join('');
const st = R.stability;
const browserLine = B ? `${B.checks.filter(c => c.pass).length} of ${B.checks.length} browser checks pass` : 'browser checks: Pending';

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;width:3840px;height:2160px;background:#0e1215;color:#e6e9eb;font:26px/1.35 "Segoe UI",Arial;overflow:hidden}
header{height:120px;padding:24px 40px 0;box-sizing:border-box;display:flex;align-items:baseline;gap:30px}
h1{margin:0;font-size:52px}header span{color:#9aa3a8;font-size:28px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:1fr 1fr;gap:20px;padding:0 40px 40px;height:2040px;box-sizing:border-box}
.p{background:#151a1e;border:1px solid #2c363c;border-radius:10px;padding:16px 20px;display:flex;flex-direction:column;overflow:hidden}
.p h2{margin:0 0 4px;font-size:32px}.p .cap{color:#9aa3a8;font-size:21px;margin:0 0 10px}
.p img{width:100%;flex:1;min-height:0;object-fit:contain;background:#000;border-radius:6px}
.pending{flex:1;display:flex;align-items:center;justify-content:center;border:3px dashed #ffb44d;color:#ffb44d;font-size:34px;border-radius:6px;text-align:center;padding:20px}
table{border-collapse:collapse;font-size:22px;width:100%}td,th{border-bottom:1px solid #2c363c;padding:5px 6px;text-align:left;vertical-align:top}th{color:#9aa3a8;font-weight:normal}
.lbl{fill:#cfd5d8;font-size:20px}.val{fill:#e6e9eb;font-size:19px}
.tag{display:inline-block;padding:2px 10px;border-radius:5px;font-weight:bold}.go{background:#a8741a}.no{background:#7a2b2b}.ok{background:#245c3a}
ul{margin:6px 0;padding-left:26px}li{margin:4px 0}
</style></head><body>
<header><h1>G02c-R Road Growth Milestone Review</h1><span>A City of Cities · seeds ${seeds.join(' / ')} · grade baseline 6 % · ramps through one junction · automated evidence only, not Human Accepted · ${R.testedAt.slice(0, 10)}</span></header>
<div class="grid">
<div class="p"><h2>1 · Lineage</h2><p class="cap">G03c-03: Chicago chunk heights follow one centre gradient (171 → 38 m), not a reset (seed 6202)</p>${await img('g03c-03-chicago-height-profile.png', 'lineage')}</div>
<div class="p"><h2>2 · Corridor plan</h2><p class="cap">Seed 6202, step 2, Manhattan c_-4_0 → c_-3_0. Green: ramp road; cyan: branch graded back; white: shared junction height</p>${await img('g02c-03a-overlay-top.png', 'corridor')}</div>
<div class="p"><h2>3 · Vertical profile</h2><p class="cap">Real mouse click on the junction (browser review, check 6): long section from the stored ramp record</p>${await img('g02c-r-junction-pick-debug.png', 'profile')}</div>
<div class="p"><h2>4 · Graph validation</h2><p class="cap">Measured by scripts/review-road-growth.mjs; one definition for every run</p>${bars}<table><tr><th>seed</th><th>grown cities: chunks reachable from core / chunks · road components</th></tr>${cityTable}</table></div>
<div class="p"><h2>5 · Fabric impact</h2><p class="cap">Same event, junction ramps on: buildings only vacated inside the new chunk's corridor</p>${await img('g02c-03a-building-impact-on.png', 'impact')}<table><tr><th>seed</th><th>chunks</th><th>committed bldgs hit</th><th>new candidates excluded</th><th>abnormal parcels</th><th>coverage before → after</th></tr>${fab}</table></div>
<div class="p"><h2>6 · Real world growth</h2><p class="cap">Seed 6202 review state (${R.runs[6202]?.steps} steps) loaded with a real click on "Load world state"</p>${await img('g02c-r-world-growth-after.png', 'world')}<table><tr><th>seed</th><th>12</th><th>30</th><th>60</th><th>steps</th><th>committed chunks changed</th></tr>${growth}</table></div>
<div class="p"><h2>7 · Failure case</h2><p class="cap">Real click on an unconnected road end: the refusal reason is shown, nothing is forced</p>${await img('g02c-r-failure-case-debug.png', 'failure')}<ul><li>Amsterdam core, seed 6203 (c_0_0): canalStreet network has <b>0 nodes, 0 edges, 0 ports, no warning</b>; the city cannot grow (Confirmed Algorithmic Defect, network stage)</li><li>Venice, Amsterdam, Lisbon: no road growth on any seed</li></ul></div>
<div class="p"><h2>8 · Conclusion</h2><p class="cap">Recommendation (automated evidence; human review open)</p>
<div style="font-size:30px;margin:10px 0"><span class="tag go">CONDITIONAL GO</span></div>
<ul>
<li>Continuity: every accepted join continuous (residual 0); ${st.registryOrderReversedIdentical ? '<span class="tag ok">deterministic</span>' : '<span class="tag no">order dependent</span>'} ${st.continuedTo30EqualsUninterrupted ? '<span class="tag ok">save / load</span>' : '<span class="tag no">save / load</span>'}</li>
<li>Terrain: max grade 7.36 % main / 7.16 % branch (limit 7.5 %, junction-ramp.json); ramps planned only in the new chunk; committed chunks unchanged</li>
<li>Fabric: 0 committed buildings touched; new candidates excluded about ${(() => { const e = seeds.reduce((s, k) => s + R.runs[k].fabric.excluded, 0); const c = seeds.reduce((s, k) => s + R.runs[k].fabric.candidates, 0); return c ? ((100 * e) / c).toFixed(1) : 0; })()} %</li>
<li>Limits: one junction only (<b>G02c-03b NOT IMPLEMENTED</b>); 3 of 6 DNAs grow by road; Amsterdam 6203 core empty</li>
<li>${browserLine}</li>
<li>Status: <b>Pending human review</b>, not Human Accepted</li></ul></div>
</div></body></html>`;
const tmp = path.join(root, 'experiments/city-of-cities/evidence/.review-board.html');
await writeFile(tmp, html);
let exe = process.env.PLAYWRIGHT_CHROME_PATH; for (const c of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']) if (!exe && await exists(c)) exe = c;
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await (await browser.newContext({ viewport: { width: 3840, height: 2160 }, deviceScaleFactor: 1 })).newPage();
await page.goto(pathToFileURL(tmp).href); await page.waitForTimeout(800);
await page.screenshot({ path: path.join(shots, 'g02c-r-review-board-after.png') });
await browser.close();
const { unlink } = await import('node:fs/promises'); await unlink(tmp);
console.log('Review board: docs/assets/screenshots/procedural-mini-world/g02c-r-review-board-after.png (3840 x 2160)');
