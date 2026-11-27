// WETNESS CONTRACT GUARD — the regression test for the black-island bug's
// root cause (2026-11-27). islands-main installs a `terrainWetness` WGSL
// hook into tidewater's Terrain material. Terrain.js calls it with a fixed
// contract — fn terrainWetness( xz: vec2f, h: f32 ) -> vec2f — and the
// ShoreSim functions it may call have fixed signatures in ShoreSim.js.
// A hand-written variant with a different signature compiled to NOTHING:
// the terrain fragment shader failed WGSL compilation, the async pipeline
// was marked failed, and MeshRenderer silently skipped the terrain mesh
// every frame (island silhouette from the water plane only, land black /
// mottled with the sea's caustics). This test pins the contract statically
// so a paraphrased hook can never ship again. (The same composition is
// additionally compiler-checked with Dawn during development — see
// REPORT.md; this static guard is what runs in the test suite.)

import fs from "node:fs";
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };

const main = read("../src/islands-main.js");
const terrain = read("../src/world/Terrain.js");
const shoreSim = read("../src/ocean/ShoreSim.js");

// extract the installed wetness WGSL from islands-main
const wi = main.indexOf("terrain.wetness");
const wStart = main.indexOf("`", main.indexOf("code:", wi)) + 1;
const wetness = main.slice(wStart, main.indexOf("`", wStart));

check("islands-main installs a wetness hook", wi >= 0 && wetness.length > 50);
check(
  "wetness signature matches Terrain.js's contract ( xz: vec2f, h: f32 ) -> vec2f",
  /fn terrainWetness\(\s*xz: vec2f,\s*h: f32\s*\) -> vec2f/.test(wetness),
);
check(
  "Terrain.js really calls it that way (terWetFoam forwards xz, h — 2 args)",
  terrain.includes("fn terWetFoam( xz: vec2f, h: f32 ) -> vec2f") && terrain.includes("return terrainWetness( xz, h );"),
);
check(
  "ShoreSim's sandFoam keeps its 3-arg signature",
  /fn shoreSimSandFoam\(\s*xz: vec2f,\s*s: vec4f,\s*h: f32\s*\) -> f32/.test(shoreSim),
);
check(
  "ShoreSim's sample is xz -> vec4f (s.y = sand wetness)",
  /fn shoreSimSample\(\s*xz: vec2f\s*\) -> vec4f/.test(shoreSim),
);
check(
  "ShoreSim's inside test takes uv and returns f32",
  /fn shoreSimInside\(\s*uv: vec2f\s*\) -> f32/.test(shoreSim),
);
const foamCall = wetness.match(/shoreSimSandFoam\(([^)]*)\)/);
check(
  "the hook calls shoreSimSandFoam with exactly 3 arguments",
  !!foamCall && foamCall[1].split(",").length === 3,
  foamCall ? foamCall[0] : "no call found",
);
check(
  "the hook returns vec2f (wetness, foam)",
  /return vec2f\(/.test(wetness),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
