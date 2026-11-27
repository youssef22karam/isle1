// TERRAIN DATA PATH — the regression test for the black-island bug
// (2026-11-27). Runs the REAL app data path in node, without a GPU:
//   ArchipelagoData (seed 504, island29's app seed) fill
//     -> tidewater's own bakeTerrainMaps (the exact function TerrainGPU
//        uploads to the terrain material's maps texture)
// and asserts the baked bytes at known sample points carry the colours the
// terrain shader needs: sand at the beach, rock at the peak, sand on the
// seabed, and NO all-zero channel the shader multiplies by (the AO channel
// in particular: engine lighting multiplies indirect diffuse by it).
//
// It also pins the seed-504 home-island descriptor to island29's own values
// (App.tsx: seed 504; part13 descriptor math) — the port previously ran
// seed 1337, a different archipelago entirely.

import { ArchipelagoData } from "../src/islands/ArchipelagoData.js";
import { islandDescriptor, WORLD_SEED } from "../src/islands/IslandGen.js";
import { bakeTerrainMaps } from "../src/world/terrain/TerrainBake.js";

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- the seed island29's app actually runs
check("WORLD_SEED is island29's app seed (504)", WORLD_SEED === 504);
const desc = islandDescriptor(0, 0, 504);
check("home descriptor span 7200 (island29 part13)", desc.span === 7200, `span=${desc.span}`);
check("home descriptor centre matches island29", Math.abs(desc.cx + 65.18) < 0.5 && Math.abs(desc.cz + 69.71) < 0.5, `cx=${desc.cx.toFixed(2)} cz=${desc.cz.toFixed(2)}`);
check("home descriptor per-island seed matches island29", desc.seed === 607922385, `seed=${desc.seed}`);

// ---- the real fill, exactly as islands-main does it
const data = new ArchipelagoData(2048, 1024, 504);
data.generateIsland(desc);
const spawn = data.findSpawn(desc);
check("spawn beach found on the seed-504 home island", !!spawn);
data.setOffset(Math.round(desc.cx + spawn.beach.x), Math.round(desc.cz + spawn.beach.z + 45));
for (const d of data.missingIslands()) data.generateIsland(d);
data.refill();

const R = data.res, H = data.heights;
let maxH = -1e9, maxK = -1;
for (let k = 0; k < H.length; k++) if (H[k] > maxH) { maxH = H[k]; maxK = k; }
check("home island peak in island29's range (400-520 m)", maxH > 400 && maxH < 520, `peak=${maxH.toFixed(1)} m`);

// ---- tidewater's own baker, the exact upload source: two RGBA8 arrays —
// normal: [nx, nz, rock mask, AO]; splat: [sand, path, gully/seagrass, rubble/scarp]
const { normal, splat: splatArr } = bakeTerrainMaps(data);
const splat = (k, ch) => splatArr[k * 4 + ch];
const rockAt = (k) => normal[k * 4 + 2];
const aoAt = (k) => normal[k * 4 + 3];

const gradAt = (k) => {
  const i = k % R, j = (k / R) | 0;
  const gx = (H[j * R + Math.min(i + 1, R - 1)] - H[j * R + Math.max(i - 1, 0)]) / (2 * data.texel);
  const gz = (H[Math.min(j + 1, R - 1) * R + i] - H[Math.max(j - 1, 0) * R + i]) / (2 * data.texel);
  return Math.hypot(gx, gz);
};

// beach point: gentle texel just above sea level (island29's forced sand band)
let beachK = -1;
for (let k = 0; k < H.length && beachK < 0; k++) if (H[k] > 0.8 && H[k] < 1.8 && gradAt(k) < 0.25) beachK = k;
check("beach texel exists (0.8-1.8 m, gentle)", beachK >= 0, beachK >= 0 ? `h=${H[beachK].toFixed(2)}` : "");
if (beachK >= 0) {
  const sand = splat(beachK, 0);
  // the shader: sandW = smoothstep(0.3, 0.72, sp.x + detail) — byte >= 185
  // already saturates it even with zero detail noise
  const sandW = sstep(0.3, 0.72, sand / 255);
  check("beach texel splat sand >= 200 (island29 beach = sand)", sand >= 200, `sand=${sand}`);
  check("beach texel shader sand weight saturates (>= 0.99)", sandW >= 0.99, `sandW=${sandW.toFixed(3)}`);
  check("beach texel AO >= 180 (not a black multiplier)", aoAt(beachK) >= 180, `ao=${aoAt(beachK)}`);
  // the robust form of the same invariant: beach texels as a class are
  // essentially unoccluded (with the full generator the first such texel
  // can sit beside a carved channel and dip to ~199)
  let aoSum = 0, aoN = 0;
  for (let k = 0; k < H.length; k++) if (H[k] > 0.8 && H[k] < 1.8 && gradAt(k) < 0.25) { aoSum += aoAt(k); aoN++; }
  check("mean beach AO >= 200", aoN > 0 && aoSum / aoN >= 200, `mean=${aoN ? (aoSum / aoN).toFixed(1) : "n/a"} over ${aoN}`);
}

// peak rock: among high texels, the rockiest must be solidly rock
let peakRock = 0;
for (let k = 0; k < H.length; k++) if (H[k] > 0.8 * maxH) peakRock = Math.max(peakRock, rockAt(k));
const rockW = sstep(0.25, 0.75, peakRock / 255); // shader: smoothstep(0.25, 0.75, rockMask)
check("high ground carries rock (max rock byte >= 150)", peakRock >= 150, `rock=${peakRock}`);
check("peak shader rock weight >= 0.5", rockW >= 0.5, `rockW=${rockW.toFixed(3)}`);

// seabed: 3-6 m down must be sand (island29's sandy seabed, not a black void)
let bedK = -1;
for (let k = 0; k < H.length && bedK < 0; k++) if (H[k] < -3 && H[k] > -6) bedK = k;
check("seabed texel exists (-3..-6 m)", bedK >= 0);
if (bedK >= 0) check("seabed texel splat sand >= 200", splat(bedK, 0) >= 200, `sand=${splat(bedK, 0)} h=${H[bedK].toFixed(2)}`);

// global guards: no multiply-by-zero channel, real beaches exist
let zeroAOAboveWater = 0, aboveWater = 0, sandy = 0;
for (let k = 0; k < H.length; k++) {
  if (H[k] > 0) { aboveWater++; if (aoAt(k) === 0) zeroAOAboveWater++; }
  if (splat(k, 0) >= 200) sandy++;
}
check("no zero-AO texel above water", zeroAOAboveWater === 0, `${zeroAOAboveWater} zero of ${aboveWater}`);
check("sandy texels cover > 2% of the window (beaches + seabed)", sandy / H.length > 0.02, `${(100 * sandy / H.length).toFixed(1)}%`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
