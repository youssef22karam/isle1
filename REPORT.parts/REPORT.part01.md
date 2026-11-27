# Tidewater Islands — build report

**Output:** `tidewater-islands.html` — one self-contained file, **695,568 bytes**, zero external requests (the only URL in the file is the tidewater repo link inside the license comment). Built with Vite 8 + vite-plugin-singlefile. Neither source tree was touched: `git status` in `~/workspace/tidewater` is clean, and `~/workspace/island29-update/` was only read. **Not committed to GitHub.**

The recipe, exactly as ordered: tidewater's **sea, boat, shoreline waves, sky, sun and lighting** + island29's **infinite island generation and its terrains** + **island29's controls**. Nothing else.

## ⚠ Verification limit — read this first

**WebGPU does not run in this sandbox** (same finding as the earlier tidewater-sea build: `requestAdapter()` returns null in every headless configuration tried). The shipped file, loaded in headless Chrome 157, executes its whole module graph and stops at GPU initialisation with exactly the intended graceful message — "Could not start. No WebGPU adapter found. This experience needs WebGPU…" — and no other console errors. **Everything past GPU init (the actual rendering, sailing, walking) is UNVERIFIED and must be judged on a real device.** What *was* verified without a GPU is listed at the end — including the game's real ShoreField, Breakers station scan and terrain bake running against the archipelago in node.

## Architecture as built

tidewater's engine renders terrain from **one** heightfield domain (`TerrainData`: 2048 m across, centred on the world origin — `Terrain.js` centres its CDLOD there and the GPU samples heights from textures by world position). An infinite world therefore uses a **floating origin**:

- Everything in the engine lives in **local** coordinates inside a 2048 m window (1024² texels, 2 m texels) centred on the origin.
- Only my terrain provider knows the **virtual offset**: `virtual = local + offset`. Its grid is filled by sampling the archipelago at virtual coordinates.
- When the player strays **820 m** from the local origin, the app shifts: offset advances by a multiple of 256 m (bringing the player back near the origin), any not-yet-generated islands intersecting the new window are generated (with a "Raising new islands…" overlay), the window refills, the new heights/maps/shore-field are **uploaded into the existing TerrainGPU textures** (no mesh/material rebuild — the terrain CDLOD reads bounds from the provider live), and the player/boat/camera/shore-sim state is translated by the same delta. Virtual positions never change, so the ground underfoot is identical before and after (proven in tests: shifting away and back reproduces the window bit-for-bit).
- ShoreSim recentres on the player at each shift (its `min` uniform is live; the shore direction texture is rebuilt via the game's own `buildDirTexture`). Breakers are rebuilt on each shift so their station scan re-rigs along whatever shore is now near the domain centre.
- The window **starts at the spawn beach**, not at the island centre: the initial offset places the beach at local (0, −45). This matters because tidewater's `buildStations` — by the game's own design — scans one south-facing shore transect near the domain centre (x ∈ [−175, 195], z from +12 north to −110). With the window centred on the island, that transect sits in the island's interior and finds nothing (verified: 0 stations; a 60-seed search confirmed no world seed fixes this — the home island is 7.2 km wide, its coasts are kilometres from its centre). Centred on the beach, the game's real scan finds **155 breaker stations** along the spawn shore.

## Provenance — what came from where

### From tidewater, verbatim (byte-identical to `~/workspace/tidewater/src`)
Verified by `diff -rq`: **zero differing files** among everything kept. The kept set: the whole `engine/`, `core/`, `materials/GroundBounce.js`, `util/`; the sea — `ocean/OceanFFT.js`, `WaterSurface.js`, `WaterMaterial.js`, `SeaDetail.js`, `FoamTexture.js`, `Caustics.js`, `WaterQuery.js`, `WakeSim.js`, `UnderwaterLighting.js` (the water's own lighting hook, as in the sea build), plus `RefractionPass.js` and `WhaleWater.js` **only because WaterMaterial imports a constant/WGSL from them** — neither pass is constructed, no whale exists; shoreline — `ocean/ShoreWaves.js`, `ShoreSim.js`, `SurfFoam.js`, `Breakers.js`, `fx/Spray.js`, `world/ShoreField.js`, `world/TerrainGPU.js`, `world/Terrain.js`, `world/terrain/*`; sky/sun/lighting — `sky/Atmosphere.js`, `Sky.js`, `Environment.js`, the engine's `SunShadows`; the boat — `world/BoatModel.js`, `world/boat/*`, `player/BoatController.js`, `player/BoatSpray.js`; the walker — `player/Player.js`, `world/Colliders.js` (an empty instance: no pier/village geometry exists here), `world/WorldLayout.js` (kept verbatim; the app sets its `start`/`spawn`/`boatDock` fields at runtime to the archipelago's beach — runtime configuration of the game's own layout object, not an edit).

Construction and per-frame order follow tidewater's `App.js` (boat physics → player → sun/atmosphere → FFT/query → sims → world → shadows → render), as in the earlier sea build. Wiring lives in my `src/islands-main.js`.

### From island29
- `src/islands/IslandGen.js` — a faithful port of the archipelago: the cell hash `ra`, occupancy `Or` (cell (0,0) always; else hash < **0.72**), descriptors `Mn` (**8,000 m cells**, spans 3200/4000/4800/5400 m, home island 7200 m, centre jitter, per-cell seed) from `engine/island/part13.js`; the Perlin class and helpers from the terrain worker (`engine/terrain/part01.js`); the island heightfields from the worker's generator `kn` (`engine/terrain/part05.js`) — archetype setup (4 island archetypes: lobe fields, bays, peak cones, coastal lobes), the main fill (domain-warped ridged/fbm noise, smooth-min lobe blending, seabed profile, edge falloff), meadow smoothing, sea-connectivity fixup, coast distance transform and the `mn` beach-shaping pass; and `sculptBreathtakingGeology` copied from the readable `engine/geology.js` (karst mountains, lake/river bluffs inert — see exclusions — coastal karst headlands and sea stacks active), run per island with empty river/lake/marsh lists.
- World seed: **1337** (my constant in IslandGen.js).

### Mine (glue, in `src/islands/`)
- `ArchipelagoData.js` — the archipelago behind tidewater's TerrainData interface (details below).
- `Hud.js` — island29's control scheme: `InputFacade` (presents tidewater's Input interface, merging real keyboard/mouse with synthetic touch keys/look), `Hud` (DOM), `LookCam` (orbit camera for Look mode).
- `Quality.js` — the sea build's performance profiles, adapted: **no default renders above 1× CSS resolution** (phone auto → Light, desktop auto → Balanced at 1.0×; High, up to 1.5×, is opt-in from the HUD). Live changes (render scale, shadow toggle) apply instantly; construction-time changes reload, as before.
- `islands-main.js` — the app (based on the sea build's main, minus its beach/props/panel, plus boat/player/archipelago/shift logic).

## The terrain provider (ArchipelagoData)

- Interface: `size/res/texel/origin`, `heights`, `rock`, `sand/path/gully/seagrass/rubble/scarp`, `pads`, `heightAt`, `normalAt`, `buildMinMax`, `boundsFor` — the last four are the game's own code ported verbatim from `world/TerrainData.js` (the same port the sea build verified bit-identical). A grep audit of every consumer (Terrain, TerrainGPU, TerrainBake, ShoreField, Breakers, Player, BoatController) confirms every member they touch exists; the audit is a test (`test/archipelago.test.mjs`).
- Fill: each window texel samples the archipelago at virtual coordinates — the containing island's generated grid (bilinear, island29's own texel convention), blended at the island square's rim to the open-sea floor (−40 m + a gentle large-scale swell noise that fades out near islands, so it can never lift a beach). Island grids are generated lazily, cached forever, ~0.8–1.6 s each (home island 720² ≈ 1.6 s in node).
- Masks are re-derived from the filled heights in tidewater's mask semantics: rock from slope/altitude (the karst sculpt is all slope), sand on the beach band and shallow seabed, seagrass patches in tidewater's own 1.5–12 m band, rubble aprons below rocky shores. `path/gully/scarp` stay 0 — no village paths, no river gullies, no bay scarp in an open-sea archipelago.
- Consistency: `heightAt` (CPU: player, boat grounding, breaker scan) reads the same `heights[]` the GPU textures are uploaded from — tested equal to the archipelago truth at 400 random points (worst deviation 2.01 m = the window's 2 m texel quantisation vs the islands' 10 m grid + rim blend, at the steepest karst texels; typical ≪ 0.1 m). Heights are continuous across cell borders and island rims (worst 2 m step: 0.03 m open sea, 0.06 m at a rim).

## Scale / sea-level reconciliation

None needed — and that is stated plainly because it was checked, not assumed: island29's terrain is in metres with **sea level y = 0** and tidewater's sea level is y = 0. Island heights are copied 1:1. Two honest consequences: (1) island29's islands are *big* — spans up to 7.2 km and peaks up to ~550 m on the home island (its own geology sculpt) — so the 2048 m window shows a coastal slice, and tidewater's sun-shadow splits (10/60/400 m) and 2048 m terrain domain were designed for a smaller island; distant peaks outside the window simply aren't terrain (the ocean runs to the horizon regardless). (2) island29's deep water inside an island square reaches ≈ −48 m (its seabed profile sums to 46.6 m + relief) while the open-sea floor between islands is −40 m + swell — both far below anything the boat (draft ~1 m) or the shore machinery (maxDepth 25 m) can perceive.

## Controls mapping (island29 → here)

| island29 | here |
|---|---|
| Round menu button, top-left; HUD hidden by default; play controls never hide | Same: ☰ button toggles the HUD (modes/quality/hints); joystick, run button and boat pads are outside the HUD and never hide |
| Mode buttons Look / Walk / Boat | Same three buttons (top-centre). **Look** = damped orbit camera following the player (drag orbit, pinch/wheel zoom 4–600 m, terrain-clamped). **Walk** = tidewater's Player on foot (walk/wade/swim, and walking the deck when aboard). **Boat** = from anywhere: `enterBoat()` (board + take the helm, the game's own method); from Boat, Walk steps ashore via the game's `exitBoat()` |
| Analog stick bottom-left, speed follows push | Same stick → synthetic WASD through the InputFacade; magnitude caps the walker's horizontal speed after Player.update (Player reads boolean keys; direction/physics untouched — my one control adaptation, in `islands-main.js`) |
| Hold-to-run | Hold button (») injects Shift — the game's own sprint (3.0 → 6.2 m/s walk) |
| Boat pads: steer ◀ ▶, throttle ▲ ▼ | Same pads → KeyA/KeyD/KeyW/KeyS holds into the game's helm controls; HUD gauge shows knots + throttle (island29-style) |
| Interact prompts (E …) | tidewater's own prompts ("E · Board boat", "E · Take the helm", "E · Step ashore") shown as a tappable pill — tap = E. On deck, walking to the helm + E (or the Boat button) takes the wheel |
| Touch drag look / pinch | Drag on canvas looks (walk/boat), orbits (Look); pinch zooms (Look) or dollies the boat chase camera |
| Desktop | WASD/arrows via the game's Input, mouse drag or click-to-pointer-lock look, Space jump/swim-up, E, V boat camera (helm ⇄ chase), 1/2/3 modes, H interface |

Swimming is tidewater's own (wade in past 1.35 m and you swim; look down + W or C to dive under, Space to rise) — it comes with the Player the recipe's boat/walk controls required; there is no island29 Dive *mode* and no underwater content.

## Excluded, per the recipe

Kelp/underwater system (island29's kelp modules and tidewater's `post/Underwater.js` are not present; `ocean/UnderwaterLighting.js` remains because tidewater's *water surface* uses it for its own shading, as in the sea build), all vegetation (island29's scatter/props stage and tidewater's `Vegetation.js` — not ported/not kept; islands are bare terrain + beach + the rock that is part of the terrain's own sculpt/masks), tidewater's village/pier/props/rocks-scatter/fish/fishing game/audio/UI/PostFX (a plain exposure+ACES+sRGB present pass stands in for PostFX, as in the sea build), clouds (the game's supported no-cloud configuration), the refraction pass (never constructed — `WATER_REFRACTION 0` path, as in the sea build), the sea slider panel, and island29's river/lake/wetland stages: the worker's `fn` (hydrology design), `un` (droplet erosion), `He` (thermal erosion) and `hydrology.js` carving were **not ported** — they are the stages that create and carve the river/lake network, so the islands keep their archetype + geology terrain character (mountains, bays, headlands, sea stacks, beaches) without any inland water. `geology.js`'s river/lake bluff sections run with empty lists and are inert.

One deliberate consequence: tidewater's Breakers, by the game's own design, rig plunging breakers only along a south-facing shore inside its fixed transect near the domain centre. They rig at the spawn beach (155 stations) and re-rig after each origin shift to whatever suitable shore is then near the centre — but most island coasts (north/east/west-facing, or far from the centre) get their shoreline waves from ShoreWaves + ShoreSim + SurfFoam, which work on every coast via the global shore field. That is the game's architecture, not a porting shortcut.

## Verification (this sandbox)

- ✅ `node test/islandgen.test.mjs` — determinism (bit-identical grids across runs), occupancy **0.7186** over 41×41 cells (target 0.72), spans/N from the allowed sets, home + sample island profiles (peaks > 40 m, beach ring present, rim at −40, edge continuity 0.022 m max 2 m-step).
- ✅ `node test/archipelago.test.mjs` — full interface audit; streaming decisions (only the home island missing at boot); refill determinism; heightAt == worldHeightAt inside the window; boundsFor brackets heights on 300 CDLOD-style boxes; no seams across cell borders/rims; findSpawn yields a beach at h = 1.34 m with the boat spot at −3.7 m; shift-away-and-back reproduces the window exactly.
- ✅ `node test/consumers.check.mjs` — the game's **real** `computeShoreField` (finite everywhere, 312 ms), **real** `buildStations` (**155 stations** at the spawn beach), **real** `bakeTerrainMaps` and `buildShadowHeights` all run against the provider.
- ✅ `node test/hud.test.mjs` — InputFacade (key pass-through, synthetic holds, one-shot taps, look/wheel merging, stick→keys + dead zone) and LookCam (orbit settle, zoom clamps 4/600 m, terrain clamp).
- ✅ Vite build clean; **diff vs the pristine tidewater clone: 0 differing files** (kept modules byte-identical; differences are only my additions and the deliberate deletions).
- ✅ Headless Chrome 157 load of the final file: module graph executes, stops only at the WebGPU adapter gate with the graceful message, zero external requests, no other console errors.
- ❌ **Not verified:** anything visual or interactive on a real GPU — rendering, wave/foam/breaker look, boat handling, walking, frame rate. First run must be on the user's phone.

## First playtest guidance

1. You spawn **on a beach** on the home island, facing the sea, the boat floating ~100 m out in deep water. The surf in front of you is the full shoreline stack: shore waves, swash sim, foam — and the plunging **breakers** rig along this beach.
2. **Walk** the island (stick/WASD): inland the bare karst mountains rise (no trees or grass — by design). Wade out and you swim, tidewater-style.
3. Swim/walk to the boat, tap **E · Board boat**, walk the deck to the helm, **E · Take the helm** — or just press **Boat**. Sail with ▲/◀/▶ (or WASD); **V** switches helm/chase camera. The boat floats on the real FFT sea (buoyancy, wake, bow spray are tidewater's).
4. **Cross to a neighbouring island:** (updated for seed 504 — see the playtest-fix section below) all eight neighbouring cells hold islands; sail any direction. Open sea between islands is ~3–6 km. As you travel, the world streams: brief "Raising new islands…" pauses are new islands generating; the terrain window recentres invisibly underneath you.
5. **Look** mode orbits you/the boat — good for inspecting a new island's coast before landing.
6. If it feels heavy on the phone: it boots at **Light** there by default (1× resolution, shadows off, smaller sims). Open the ☰ menu → Quality → Balanced for shadows and bigger sims; High is there if the phone can take it.

## Playtest fix: black terrain + island fidelity (2026-11-27)

Nino's playtest of the first build: "The whole island is black — no terrains, no mountains, no sand beach", and from the Look-mode screenshot: the sea renders fine, the seabed around the island is a black void, and the island itself shows a mottled teal/white caustics-like pattern with no sand ring and no rock. Two root causes, both in my glue code — **no verbatim tidewater module was changed** (the byte-identical diff still holds).

### Root cause 1 — the terrain shader never compiled (the black)

Terrain colour in tidewater comes from one fragment shader that Terrain.js composes, into which the app installs a `terrainWetness` WGSL hook. The game's contract (documented in Terrain.js and honoured by the game's own App.js) is:

```
fn terrainWetness( xz: vec2f, h: f32 ) -> vec2f   // x = wetness, y = sand foam
```

calling `shoreSimSample( xz ) -> vec4f`, `shoreSimInside( shoreSimUvOf( xz ) ) -> f32` and `shoreSimSandFoam( xz, s, h ) -> f32`. The hook I shipped in `islands-main.js` was a hand-written variant with a different signature — `fn terrainWetness( wp: vec3f, nrm: vec3f, sand: f32 ) -> vec3f` — calling `shoreSimSandFoam` with 4 wrongly-typed arguments and using the f32 result of `shoreSimInside(...)` as an `if` condition: at least three independent WGSL type errors. The terrain fragment shader therefore never compiled; tidewater creates mesh pipelines asynchronously and, on failure, just marks the pipeline failed (console.error only, no on-screen error) and skips the draw. **The terrain mesh was never drawn at all** — no sand, no rock, no shading, and no depth. What filled the island's footprint on screen was the only thing left that covers it: the water surface (its caustics/foam detail = the mottled pattern, stretched flat where a 3D island should occlude it) and deep-water shading / clear colour where the missing terrain should have been (the black surroundings). The CPU data path was proven innocent first: provider fill → tidewater's own `bakeTerrainMaps` produced healthy bytes (beach splat sand 230/255, AO 246/255, peak rock 217/255), and an exact JS emulation of the sun-shadow kernel showed 97.6% of above-water points fully lit.

**Proof, not just inspection:** this sandbox's headless Chrome exposes a SwiftShader WebGPU adapter, so the game's own `buildMeshShader` + `composeShader` were run against a real Terrain material and the composed WGSL handed to Dawn's compiler (`getCompilationInfo`). The shipped hook: **error — "too many arguments in call to 'shoreSimSandFoam', expected 3, got 4"** (Tint stops at the first error). The game's original hook: **0 errors**. After the fix, the shipped hook also compiles with **0 errors** and produces a byte-length-identical shader (88,212 chars) to the original's.

**Fix:** `islands-main.js` now installs tidewater's own wetness code, verbatim from the game's App.js, with a comment warning never to paraphrase it. A static guard test (`test/wetness-contract.test.mjs`) pins the contract — hook signature, Terrain.js's call site, and ShoreSim's arities — so a reworded hook fails the suite instead of the playtest.

### Root cause 2 — wrong world seed (the "not my islands")

island29's app runs **seed 504** (App.tsx: `seed: 504`, and `?seed=` honoured, defaulting to 504). The port had hardcoded `WORLD_SEED = 1337` — a completely different archipelago. The descriptor math itself was verified byte-faithful to island29's part13 (same spans, jitter, occupancy hash, home cell), so this one constant was the whole divergence. **Fix:** `WORLD_SEED = 504`; `ArchipelagoData` now takes the seed as a constructor parameter (its seabed/grass noises derive from it too), and `islands-main.js` parses `?seed=` exactly like island29's App.tsx and passes one seed to both the provider and the home descriptor. Seed-504 home island, pinned by test: span 7200, centre ≈ (−65.18, −69.71), per-island seed 607922385, peak 445 m in the spawn window.

**Fidelity check against island29's own generator** (the real `kn` run in node on the home island, same descriptor): seabed is faithful (mean |Δ| 0.89 m where the original is below −1 m; only 2.9% of cells differ by > 1 m) and the rim matches at −40 m; peaks 471.5 m (original) vs 460.9 m (port), ~2%. The interior and the exact coastline placement differ more (all-cell mean |Δ| 10.4 m; beach band mean |Δ| 9.3 m) — because the original runs its hydrology/erosion stages (`fn` design incl. coastal-lowland flooding, `un` droplet erosion, `Ve`/`He`) between the heightfield fill and the beach shaping, and those stages are precisely the river/lake stages this project's recipe excludes. They stay excluded; the gap is stated here plainly rather than hidden: same islands, same beaches and profiles in character, not metre-identical coastlines.

### Surface realignment — island29's appearance rules

The provider's mask derivation (`ArchipelagoData.fillMasks`) was rewritten to encode island29's own terrain-colouring rules (its part12 shader) through tidewater's splat contract: sand forced below h 0.6 (the beach band); vegetation takeover as smoothstep(2.2, 6.8, h) on gentle slopes (sand channel fades so tidewater's meadow shows); rock = island29's far-rock + coastal-cliff + mountain-cliff masks (slope = 1 − N.y against height bands); seabed = sand at full strength near shore thinning with depth (previously capped at 0.55, which read as murk). Also, `findSpawn`'s boat spot now falls back to the deepest point along the seaward ray on gently shelving beaches (the seed-504 spawn beach never reaches −4.5 m within 320 m; the boat now starts at the deepest spot found instead of a blind 60 m / −3.39 m).

### Verification

- ✅ `test/terrain-data.test.mjs` (new) — the real data path end-to-end in node: seed-504 descriptor pinned to island29's values; provider fill → `bakeTerrainMaps` → beach texel splat sand **255** (shader sand weight 1.000), AO **255**; high-ground rock byte **255** (rock weight 1.000); seabed texel (−3.2 m) sand **255**; **zero** zero-AO texels above water (of 809,138); sandy texels 29.7% of the window. 16/16.
- ✅ `test/wetness-contract.test.mjs` (new) — the WGSL contract guard above. 8/8.
- ✅ Dawn compiler check (SwiftShader WebGPU, game's own shader composition): shipped hook errored before the fix, **0 errors** after.
- ✅ All previous suites pass: islandgen, archipelago (incl. shift-away-and-back bit-exactness), consumers.check (ShoreField finite; **breaker stations now 309** at the seed-504 spawn beach; bake + shadow heights run clean), hud.
- ✅ Vite build clean; deliverable rebuilt: **695,797 B** (was 695,568).
- ⚠️ Still on-device-only: the actual rendered look (SwiftShader in this sandbox can compile the shaders and boot the app only very slowly — it is not a frame-rate or colour reference). The terrain pipeline compiling is now proven; what the island *looks like* is for the phone playtest.

### Playtest guidance (this build)

1. You spawn **on the seed-504 home island's beach** — island29's actual home island. Sand should be visible underfoot and as a ring at the waterline; walk inland and the ground turns to grass-green meadow, then grey rock on the steep high ground; the seabed under the shallows is sand, fading darker with depth — no black anywhere on land or seabed.
2. All eight neighbouring cells hold islands at seed 504 — sail any direction, open sea between islands is ~3–6 km.
3. If anything still looks wrong, screenshot the island **from the boat** and note whether ANY colour appears anywhere on land — that distinguishes a shading problem (some colour, wrong tones) from a draw problem (none at all).

## Full island29 generator port (2026-11-27, supersedes the hydrology exclusion above)

Nino's order after the seed-504 playtest (10:12 EET): the islands were "still not island28 islands terrains" and had no lakes, rivers or wetlands — the hydrology stages of island29's generator, excluded by the original recipe, had to be ported in full. They now are. This section supersedes the "From island29" bullet and the "Excluded, per the recipe" paragraph where they describe the generator: **nothing of island29's generator is excluded any more** (kelp, trees/grass/vegetation, the village and the fishing game remain excluded — those are not the generator).

### How it is ported: the original code, not a re-implementation

The previous `IslandGen.js` was a de-minified re-implementation of the generator's fill stage only. That approach is abandoned. `src/islands/IslandGen.js` now contains only the archipelago descriptors (unchanged: `cellHash` / `cellHasIsland` / `islandDescriptor`) plus a thin driver, and the generator itself is **island29's own code, copied byte-identical** into `src/islands/gen/` (verified with `cmp` against `~/workspace/island29-update/raw/src/engine/`):

- `gen/terrain/part01.js` … `part05.js` — the terrain worker parts (archetypes, Perlin, erosion, hydrology network builder, and the generator `kn` itself)
- `gen/hydrology.js`, `gen/hydro-design.js`, `gen/wetlands.js`, `gen/water-coverage.js`, `gen/geology.js`

`generateIslandGrid(desc)` drives the real `kn` with exactly the payload island29's own worker receives (`terrain/part09.js` posts `{ seed, N, cell, isHome }` from the descriptor — notably **no `erosionDroplets` key**, so droplet erosion uses its built-in default, exactly as in island29's app). `generateIslandGridAsync` pumps the same generator with frame yields so the loader can paint kn's own stage labels while an island rises; the boot and origin-shift paths use it. One environment note: `hydrology.js` imports `BufferGeometry` / `Float32BufferAttribute` from `three`, used only inside `buildFreshwaterGeometry` (river surface meshes for island29's own renderer), which `kn` never calls. A two-class inert stub at `node_modules/three/` satisfies the import for node tests and the Vite build (a fresh `npm ci`/`npm prune` would remove it — it must be restored if dependencies are ever reinstalled).

### Stage-by-stage provenance (kn's own order — nothing reordered, nothing summarised)

| # | Stage (kn, `gen/terrain/part05.js`) | Source | What it does |
|---|---|---|---|
| 1 | Archetype setup + main fill | part05 + part01 helpers | Lobe fields, bays, peak cones, coastal lobes, domain warp, smooth-min blending, seabed profile, edge falloff → heights + plain mask |
| 2 | `V = fn(...)` hydrology design | part01 | Drainage design: accumulation, flow directions, the river/lake network plan |
| 3 | `un(...)` droplet erosion | part01 | Particle erosion with sediment transport (default droplet count — see above) |
| 4 | Meadow smoothing ×4 | part05 inline | Weighted smoothing over the plain mask |
| 5 | `He(..., {passes: 10, conserve: true})` thermal erosion | part01 | Talus redistribution, mass-conserving |
| 6 | Sea-connectivity fixup + lowland smoothing ×3 | part05 inline | Flood fill from the borders; unconnected low cells raised |
| 7 | Wet mask + chamfer coast distance + `mn(...)` | part01/part05 | Beach shaping against the coast distance field |
| 8 | `tt = Ve(...)` river/lake network | part04 + `hydrology.js` (`refineRiverNetwork`) + `wetlands.js` (`finishHydrology`) + `hydro-design.js` + `water-coverage.js` | Carves the river network, digs lake basins, designates marshes/wetlands; outputs wet/swamp/body/lakeId/level fields + river, lake and marsh records |
| 9 | `He(..., {passes: 7, conserve: false, protect: tt.wet})` | part01 | Second thermal erosion, sparing the wet network |
