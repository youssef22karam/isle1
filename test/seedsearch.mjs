import { islandDescriptor, generateIslandGrid, sampleIslandGrid, cellHasIsland } from '../src/islands/IslandGen.js';
import { buildStations } from '../src/ocean/Breakers.js';

for (let seed = 1; seed <= 60; seed++) {
  const desc = islandDescriptor(0, 0, seed);
  const grid = generateIslandGrid(desc);
  const terrain = { heightAt: (x, z) => sampleIslandGrid(grid, x - desc.cx, z - desc.cz) };
  const st = buildStations(terrain);
  if (st.count >= 15) {
    // findSpawn-like check: any beach texel near the transect?
    console.log('seed', seed, 'stations', st.count, 'home centre', desc.cx.toFixed(0), desc.cz.toFixed(0));
    if (st.count >= 40) { console.log('ACCEPT', seed); break; }
  }
}
console.log('done');
