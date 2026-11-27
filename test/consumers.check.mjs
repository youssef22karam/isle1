// Real tidewater consumers against the provider, in the app's boot layout.
import { ArchipelagoData } from '../src/islands/ArchipelagoData.js';
import { islandDescriptor, WORLD_SEED } from '../src/islands/IslandGen.js';
import { computeShoreField } from '../src/world/ShoreField.js';
import { buildStations } from '../src/ocean/Breakers.js';
import { bakeTerrainMaps, buildShadowHeights } from '../src/world/terrain/TerrainBake.js';

const d = new ArchipelagoData(2048, 1024);
const home = islandDescriptor(0, 0, WORLD_SEED);
d.generateIsland(home);
const spawn = d.findSpawn(home);
console.log('spawn found:', !!spawn);
const beachV = { x: home.cx + spawn.beach.x, z: home.cz + spawn.beach.z };
d.setOffset(Math.round(beachV.x), Math.round(beachV.z + 45));
for (const desc of d.missingIslands()) d.generateIsland(desc);
d.refill();
const beachLocal = { x: beachV.x - d.offsetX, z: beachV.z - d.offsetZ };
console.log('beach local:', beachLocal, 'height:', d.heightAt(beachLocal.x, beachLocal.z).toFixed(2));
let t = performance.now();
const f = computeShoreField(d, { res: 512, swellDir: [-0.119, -0.993] });
let finite = true;
for (let i = 0; i < f.data.length; i++) if (!Number.isFinite(f.data[i])) { finite = false; break; }
console.log('shorefield finite:', finite, 'in', (performance.now()-t).toFixed(0), 'ms');
const st = buildStations(d);
console.log('breaker stations:', st.count);
t = performance.now();
const maps = bakeTerrainMaps(d);
console.log('bake ok:', !!maps.normal, !!maps.splat, 'in', (performance.now()-t).toFixed(0), 'ms');
const sh = buildShadowHeights(d, 4);
console.log('shadow heights levels:', sh.levels.length, 'max', sh.maxHeight.toFixed(1));
