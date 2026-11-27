// generator-fidelity.test.mjs — the fidelity gate for the full island29
// generator port. The fixture test/fixtures/home-kn-504.bin is the height
// field produced by island29's ORIGINAL generator (kn from
// island29-update/raw/src/engine/terrain/part05.js) run in node with the
// exact payload island29's worker receives for the seed-504 home island:
// { seed: 607922385, N: 720, cell: 10, isHome: true }.
//
// The port drives the same code with the same inputs, so the heights must
// be BIT-IDENTICAL (this guards the wrapper: descriptor → payload mapping,
// stage order, no re-implementation drift). The previous partial port
// (archetype fill + geology on empty lists, hydrology skipped) measured,
// against this same fixture: seabed mean |Δ| 0.885 m, beach band 9.330 m,
// interior (3-60 m) 28.824 m, high ground 71.009 m, all-cell 10.406 m,
// peak 460.88 m vs the original's 471.47 m.
//
// The second half asserts the hydrology outputs exist and are sane:
// rivers reach the sea or a lake, lake basins sit below their water
// level, marsh centres are low wet ground, and every inland water level
// is sea level (the archipelago's design — see REPORT.md).

import { readFileSync } from "node:fs";
import { islandDescriptor, generateIslandGrid } from "../src/islands/IslandGen.js";
import { ArchipelagoData } from "../src/islands/ArchipelagoData.js";

let failures = 0;
const check = (name, cond, info = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${info ? " — " + info : ""}`);
  if (!cond) failures++;
};

// ---------------------------------------------------------------- home island
const desc = islandDescriptor(0, 0, 504);
const t0 = Date.now();
const grid = generateIslandGrid(desc);
console.log(`INFO home island generated in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const fixture = new Float32Array(readFileSync(new URL("./fixtures/home-kn-504.bin", import.meta.url)).buffer);
check("fixture size matches the grid", fixture.length === grid.heights.length, `${fixture.length} vs ${grid.heights.length}`);

let diffs = 0, maxD = 0;
for (let i = 0; i < fixture.length; i++) {
  const d = Math.abs(fixture[i] - grid.heights[i]);
  if (d > 0) diffs++;
  if (d > maxD) maxD = d;
}
check("heights bit-identical to island29's original kn", diffs === 0, `${diffs} differing texels, max |Δ| ${maxD}`);

function band(name, pred) {
  let n = 0, sum = 0;
  for (let i = 0; i < fixture.length; i++) if (pred(fixture[i])) { n++; sum += Math.abs(fixture[i] - grid.heights[i]); }
  console.log(`INFO band ${name}: n=${n} mean |Δ| = ${(sum / Math.max(n, 1)).toFixed(4)} m`);
  return sum / Math.max(n, 1);
}
check("beach band (-1..3 m) mean |Δ| < 1 m", band("beach", (h) => h >= -1 && h <= 3) < 1);
check("interior (3..60 m) mean |Δ| < 1 m", band("interior", (h) => h > 3 && h <= 60) < 1);
check("seabed (< -1 m) mean |Δ| < 1 m", band("seabed", (h) => h < -1) < 1);
check("high ground (> 60 m) mean |Δ| < 1 m", band("high", (h) => h > 60) < 1);
check("peak matches the original", Math.abs(grid.maxHeight - 471.47) < 0.5, `peak ${grid.maxHeight.toFixed(2)}`);

// ---------------------------------------------------------------- hydrology
const { N, cell, half, body, heights, level } = grid;
const at = (x, z) => {
  const ix = Math.round((x + half) / cell - 0.5), iz = Math.round((z + half) / cell - 0.5);
  return (ix < 0 || iz < 0 || ix >= N || iz >= N) ? -1 : iz * N + ix;
};

check("rivers exist", grid.rivers.length > 0, `${grid.rivers.length} rivers`);
// the network is a tree: trunk rivers (bodyKind 6) end in the sea,
// tributaries end in their parent river's channel (body 3) or a lake
// (body 2). Sanity = every end cell is water/channel AND the outlet
// chain (by name) terminates at the sea or a lake.
const riverByName = new Map(grid.rivers.map((r) => [r.name, r]));
const lakeNames = new Set(grid.lakes.map((l) => l.name));
let riversHome = 0;
for (const r of grid.rivers) {
  const k = at(r.pts[r.pts.length - 2], r.pts[r.pts.length - 1]);
  const endOk = k >= 0 && (body[k] === 1 || body[k] === 2 || body[k] === 3 || body[k] === 6);
  let cur = r, chainOk = false;
  for (let hop = 0; hop < 24 && cur; hop++) {
    if (cur.outlet === "Sea" || lakeNames.has(cur.outlet)) { chainOk = true; break; }
    cur = riverByName.get(cur.outlet);
  }
  if (endOk && chainOk) riversHome++;
}
check("every river drains to the sea or a lake (outlet chain)", riversHome === grid.rivers.length, `${riversHome}/${grid.rivers.length}`);

check("lakes exist", grid.lakes.length > 0, `${grid.lakes.length} lakes`);
for (const l of grid.lakes) {
  let mn = Infinity;
  const R = Math.ceil(l.r / cell);
  const ck = at(l.x, l.z);
  const cx = (ck % N), cz = Math.floor(ck / N);
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const x = cx + dx, z = cz + dz;
    if (x < 0 || z < 0 || x >= N || z >= N) continue;
    const d = Math.hypot(dx, dz) * cell;
    if (d <= l.r) mn = Math.min(mn, heights[z * N + x]);
  }
  check(`lake ${l.name}: basin below its level`, mn < l.level - 3, `min ${mn.toFixed(1)} m vs level ${l.level}`);
}

check("marshes exist", grid.marshes.length > 0, `${grid.marshes.length} marshes`);
for (const m of grid.marshes) {
  const k = at(m.x, m.z);
  check(`marsh ${m.name}: centre is low wet ground`, k >= 0 && grid.swamp[k] > 0.3 && Math.abs(heights[k]) < 6,
    `swamp ${k >= 0 ? grid.swamp[k].toFixed(2) : "?"}, h ${k >= 0 ? heights[k].toFixed(1) : "?"}`);
}

let levelMax = 0;
for (const v of level) if (v > levelMax) levelMax = v;
check("inland water level field is sea level everywhere", levelMax === 0, `max ${levelMax}`);
const hist = new Array(7).fill(0);
for (const b of body) hist[b]++;
check("lake cells carved (body 2)", hist[2] > 0, `${hist[2]} cells`);
check("river cells carved (body 3)", hist[3] > 0, `${hist[3]} cells`);
check("swamp cells designated (body 5)", hist[5] > 0, `${hist[5]} cells`);

// the provider agrees: no elevated lakes to surface
const data = new ArchipelagoData(2048, 1024, 504);
data.islands.set(desc.key, { desc, grid });
check("provider reports no elevated lakes", (data.elevatedLakes(desc) || []).length === 0);

// ------------------------------------------------------- a second island
const desc2 = islandDescriptor(2, -1, 504);
const grid2 = generateIslandGrid(desc2);
const riverByName2 = new Map(grid2.rivers.map((r) => [r.name, r]));
const lakeNames2 = new Set(grid2.lakes.map((l) => l.name));
let home2 = 0;
for (const r of grid2.rivers) {
  const ix = Math.round((r.pts[r.pts.length - 2] + grid2.half) / grid2.cell - 0.5);
  const iz = Math.round((r.pts[r.pts.length - 1] + grid2.half) / grid2.cell - 0.5);
  const b = (ix < 0 || iz < 0 || ix >= grid2.N || iz >= grid2.N) ? 1 : grid2.body[iz * grid2.N + ix];
  let cur = r, chainOk = false;
  for (let hop = 0; hop < 24 && cur; hop++) {
    if (cur.outlet === "Sea" || lakeNames2.has(cur.outlet)) { chainOk = true; break; }
    cur = riverByName2.get(cur.outlet);
  }
  if ((b === 1 || b === 2 || b === 3 || b === 6) && chainOk) home2++;
}
check("second island: rivers drain to sea/lake", grid2.rivers.length === 0 || home2 === grid2.rivers.length,
  `${home2}/${grid2.rivers.length} rivers, ${grid2.lakes.length} lakes, ${grid2.marshes.length} marshes`);

console.log(failures ? `\n${failures} FAILURES` : "\nALL TESTS PASSED");
process.exit(failures ? 1 : 0);
