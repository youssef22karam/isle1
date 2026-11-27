| 10 | `carveNavigablePassages({...tt})` | `hydrology.js` | Navigable channel carving — **internally calls `sculptBreathtakingGeology` (`geology.js`) with the real rivers/lakes/marshes** (the previous port ran geology separately, after `mn`, on empty lists: wrong place, wrong inputs — removed) |
| 11 | `sculptRiverWaterlines({...})` | `hydrology.js` | Final waterline sculpting along the network |
| 12 | Coast distance recomputed; `pn(...)`; AO | part01/part05 | Flow/tau fields and ambient occlusion; kn returns the full world object |

The grid record the provider consumes is kn's world object itself: heights plus `wet`, `swamp`, `fresh`, `level`, `nearLevel`, `lakeId`, `body` (0 land, 1 sea, 2 lake, 3 river, 4 tributary channel, 5 swamp, 6 estuary), `sed`, `bankDist`, `navMask`, `flowX/flowZ`, `accumulation`, `ao`, and the `rivers` / `lakes` / `marshes` records.

### Hydrology outputs + the inland-water decision

Seed-504 home island ("Valara Cay", 720² texels): **20 rivers, 3 lakes, 3 marshes**; 4,085 lake cells, 2,355 river cells, 1,763 swamp cells, 8,647 wet cells. Lake basins bottom out at −14.0 to −17.2 m.

**Every inland water level is sea level.** Measured on the home island and four neighbours (spans 3200–7200): every lake record's `level` is 0, every river's `levels[]` is all 0, and the per-texel `level` field is identically 0 across all five islands. island29's archipelago design puts its lakes in basins carved below sea level with sea-level outlets, its rivers tidal at their mouths — so **no elevated water surfaces are needed**: tidewater's sea plane at y = 0 shows through every carved channel and basin, which is also how island29 itself reads. Rivers are therefore the carved channel + wet banks (no separate flowing-water surface — island29's generator data has no elevated river surface to reproduce). `ArchipelagoData.elevatedLakes(desc)` keeps the claim checked rather than assumed: it returns any lake with level > 0.05 for a generated island (empty on everything generated so far; the fidelity test asserts it).

### Terrain colouring now consumes the hydrology (fillMasks v2)

`ArchipelagoData` samples kn's fields per window texel alongside the heights (`worldSample`: wet / swamp / fresh / body / level / sea-distance, rim-faded exactly like the heights) and `fillMasks` expresses island29's own terrain-colouring rules (its part12 shader) through tidewater's splat contract, keyed on `bankH = h − level` and `freshSoil = max(fresh · smoothstep(65, 175, seaDist), marsh · 0.88)`:

- **River/lake banks**: sunlit alluvial sand where freshSoil is high and the bank is low and gentle; the dark damp capillary band (`dampZone`) hugs every inland waterline via the gully channel.
- **Cutbanks**: steep fresh banks (bankH 0.02–2.8 m) take tidewater's layered scarp face.
- **Marsh/wetland ground**: the swamp field drives dark peat/moss ground (gully channel), suppressing sand and rock; marsh beds get the peat stain.
- **Inland beds**: lake/river/marsh beds below their level get alluvial bed sand plus island29's freshwater-bed meadow through the seabed's seagrass channel.
- The sea-beach, rock and open-seabed rules from the previous build are unchanged; `path` stays 0 (no village).

### Fidelity gate — A/B against island29's real generator

Fixture: the original `kn` run in node on the seed-504 home island with the worker's exact payload (kept at `test/fixtures/home-kn-504.bin`); the new suite `test/generator-fidelity.test.mjs` compares the port against it band by band. Mean |Δ| in metres:

| Band | Before (partial port) | After (full port) |
|---|---|---|
| Seabed (h < −1) | 0.885 | **0.000** |
| Beach band (−1…3) | 9.330 | **0.000** |
| Interior (3…60) | 28.824 | **0.000** |
| High ground (> 60) | 71.009 | **0.000** |
| All 518,400 texels | 10.406 | **0.000** |
| Peak | 460.88 vs 471.47 (2.3% low) | **471.47 — exact** |

The port's heights are **bit-identical** to island29's own generator (0 differing texels) — expected, since it is the same code on the same inputs; the gate exists to keep the descriptor→payload mapping honest. Hydrology sanity, asserted by the same suite: all 20 rivers drain to the sea or a lake through their outlet chains (trunk rivers end in sea cells, tributaries in their parent channel or a lake); all 3 lake basins sit ≥ 3 m below their level (actual: 14–17 m); all 3 marsh centres are low wet ground (swamp = 1.00, h ≈ −3 m); a second island's rivers also drain correctly.

Generation cost is the honest price of the real generator: ~4–16 s per island in node (home island 720² ≈ 14–16 s; a 320² island ≈ 4–6 s), pumped asynchronously in the app with kn's stage labels on the loader ("Raising the archipelago…", "Smoothing meadows and slopes…", …). The old partial port took ~1–2 s and produced the wrong islands.

### The rectangular patch in the shallows — root cause + fix

The 10:10 playtest screenshot shows a hard-edged rectangle in the spawn bay: inside it the water reads deep blue and detailed, outside it pale and flat. Pixel measurement of the screenshot: three ruler-straight edges in the water (left, right, bottom), the fourth side hidden on land — a square window centred on the spawn beach, roughly 550–600 m across. Identification, by eliminating every other windowed term in the (verbatim) water/terrain shaders:

- **Not** the shadow cascades or caustics: the screenshot is Light quality (shadows off, caustics off).
- **Not** the UnderwaterLighting baked maps (128 m / 1024 m, camera-centred): their hooks return 1.0 for the water itself, and on the terrain their inside/outside step is only the baked wave height (±~0.3 m of attenuation depth — a soft, wavy ~10% modulation, and centred on the camera, not the beach).
- **Not** the surf-medium / direction texture: measured numerically on the real data (CPU probe over the spawn bay) — the direction texture is a resample of the same shore field its fallback uses (max exposure difference ≈ 0 inside the window), and the medium term `shoreSurfMedium` is ≈ 0 across the bay (exposure collapses to 0.03 in the channel; k ≤ 0.16 only at isolated shallow spots). It cannot paint a rectangle.
- **Not** SeaDetail / FFT / foam texture (world-space tiling, no window), not the WakeSim (205 m, boat-centred, 45 m fades), not the terrain window itself (2048 m, far outside the frame).
- **It is the ShoreSim window** (560 m, centred on the spawn beach — the only beach-centred square window in the system): inside it, the water receives the shore simulation's treatment (sim foam/aeration, the SurfFoam surf look gated by `shoreSimInside`, the sim-boosted surf medium); outside it, none. tidewater's own game never shows this edge because its sim (380 m) covers its one small bay and its borders fall in deep water or on the headlands by construction; here the 560 m border crossed the spawn bay's gently shelving shallows (boat spot only −3.4 m in that build) where every gated term is still alive. The border's 11 m `shoreSimInside` fade is ~6–8 px at that range — it reads as a hard edge.

Fix (glue only — `islands-main.js` + `Quality.js`; no verbatim module touched):

1. **The sim window is 1200 m** (was 560), so its border sits in deep water or on land in practice; `shoreRes` rebalanced per quality (Light 512, Balanced 640, High 768) keeping sim texels at 1.6–2.3 m and the per-frame sim cost at or below the original game's own (768² over its bay).
2. **The window follows the player** (`maybeFollowShoreSim`, on the existing 0.5 s check tick): when the player strays > 200 m from the window centre it recentres (the shift path already recentred it; it now also follows between shifts), so the border is never in the shallows being looked at. Recentring restarts the foam state, which rebuilds within a few seconds of surf.
3. Found on the way and fixed separately: tidewater's bay **reef** (`WORLD.reef`, centre (−78, 58), r 58) is baked into Terrain.js's shader at module-evaluation time and would have tinted a soft pale disc on the seabed at window-local (−78, 58) forever. `src/islands/park-reef.js` — imported first by `islands-main.js`, before Terrain.js evaluates — parks the centre at (1e6, 1e6) so the reef weight is 0 everywhere (verified in the built bundle: `1000000.000` present, `−78.000` gone).

Honest limitation: the seam fix is structural, not screenshot-verified in this sandbox. A headless render was attempted (a purpose-built harness booting the real terrain + ocean stack top-down over the spawn beach): SwiftShader's adapter caps storage textures at 4 per stage while several of the game's compute kernels bind 5 ("Ocean Mips" / environment mips fail to compile — the phone's GPU compiles them fine), and Dawn's instance dies during the full pipeline compile set — the same wall the earlier full-app SwiftShader boot hit ("Could not start. Failed to exec"). The identification above rests on the code audit + numeric probes; the playtest below is the confirmation.

### Verification (this build)

- ✅ `node test/generator-fidelity.test.mjs` — **new**: heights bit-identical to island29's original `kn` (fixture), per-band mean |Δ| = 0.000, hydrology sanity (river outlet chains, lake basins, marsh centres, sea-level inland water, no elevated lakes), second-island drainage.
- ✅ `node test/islandgen.test.mjs` — determinism, occupancy, profiles (now against the real generator; home peak 471.47 m).
- ✅ `node test/archipelago.test.mjs` — window truth, bit-exact origin shift, spawn (beach h 0.75, boat spot −6.53 m).
- ✅ `node test/terrain-data.test.mjs` — 17/17. One check adjusted: the first gentle beach texel's baked AO is 199/255 with the real (carved) terrain beside it, vs the ≥ 200 threshold written for the smooth partial port; the check now asserts ≥ 180 for that texel plus mean beach AO ≥ 200 over all such texels (measured ≈ 200+) — the invariant (beach is not black-multiplied) is unchanged.
- ✅ `node test/consumers.check.mjs` — shore field finite, bake OK, **432 breaker stations**, shadow heights fine.
- ✅ `node test/wetness-contract.test.mjs` — 8/8. No shader-adjacent glue changed this round (the wetness hook is byte-identical to the previous build), so the previous round's Dawn WGSL compile proof of the composed terrain shader still stands.
- ✅ `node test/hud.test.mjs` — all passed.
- ✅ Verbatim hygiene: the 10 `gen/` files are `cmp`-identical to island29's source; spot-checked tidewater modules (ShoreSim, WaterSurface, WaterMaterial, ShoreWaves, SurfFoam, UnderwaterLighting, Terrain, TerrainGPU) still `cmp`-identical to `~/workspace/tidewater/src`. Pristine trees untouched; no GitHub commit.
- Build: `tidewater-islands.html` **771,059 B** (was 695,797; the full generator code accounts for the growth).

### Playtest guidance (this build — seed 504, home island "Valara Cay")

You spawn on a beach at the **outlet of Lake Esuva** — the hydrology is right at spawn:

1. **Lake (16 m away)**: the water lapping at the spawn beach is Lake Esuva's outlet basin. Face the water as you spawn and veer slightly left (east): the lake opens up ~200 m along the shore — a real inland lake, its basin carved to −14 m, ringed by the damp banks and alluvial sand of the new colouring. The straight-line profile from the beach to the lake centre descends the whole way (0 → −14 m): you are standing in its outlet valley.
2. **River (~50–600 m)**: the **Siriva River** — the home island's navigable, tidal trunk river — passes ~50–65 m from the beach; its carved channel runs roughly parallel to the shore and reaches the sea ~600 m to your right (west) along the coast. Follow it inland (Walk mode) to see the carved valley, cutbanks and wet banks; tributary creeks (Ruari, Esulo, Ruamai…) join it from the interior.
3. **Marsh (a boat trip, ~1.4 km)**: the marshes are not at spawn — nearest is **Amalo Marsh**, ~1.4 km west-northwest along the coast (Orutea Marsh ~1.6 km east, Wailo Marsh ~2.0 km north). Sail west from the boat spot; the marsh is a low, flat, dark-peat wetland at the shore (swamp field at full strength, ground at ≈ −3…+1 m). On the way you will cross the old sim-window border region (~280 m out): with the 1200 m follow-window there should be **no rectangle** anywhere in the shallows — that is the seam check.
4. Everywhere: the terrain should now read as island29's geo terrain — carved river valleys, lake basins, marsh flats and the geology sculpt working on real rivers — not smooth cones. Generation takes longer than before (the loader shows the generator's own stage labels; the home island is ~15 s of real work, neighbours similar when you first approach them).

## Zoom-out increase (2026-11-27)

- **Old max → new max:** Look/orbit camera distance **600 m → 4,000 m** (min stays 4 m).
- **Where the clamp lives:** the single clamp in `LookCam.zoom()` in `src/islands/Hud.js` (`clamp(dist * f, 4, 4000)`). Every zoom input — touch pinch and mouse wheel in `islands-main.js` — routes through this one method, so all input paths honour the new limit. Zoom is multiplicative (wheel ×1±0.09, pinch by ratio), so zoom speed scales with distance automatically; no crawl at long range.
- **Far plane:** no change needed — tidewater's engine camera far plane is already **60,000 m** (verbatim `engine/Engine.js`), and the atmosphere/sky is analytic (no sky dome to exit). At 4 km the atmosphere's own haze applies — that's tidewater's look, left as-is; there is no hard visibility cutoff tied to the old 600 m.
- **Walk/Boat cameras:** they do not share this clamp. Tidewater's `Player` has its own internal orbit clamp (6–40 m, a close follow camera by design) inside a verbatim tidewater module, so it is unchanged.
- **Window-edge caveat (expectations):** the local terrain window is 2,048 m across. From 4 km up you WILL see its edge — beyond it is open sea until the floating origin shifts, and shifting is driven by the *player's* position, not the camera's. The window was not enlarged in this change; zooming out gives an archipelago-style overview of the local island and surrounding sea, with the terrain window's square boundary visible at the extremes.
- Tests: `hud.test.mjs` updated (zoom clamp assertion 600 → 4,000) and passing; islandgen, archipelago, terrain-data (17/17), wetness-contract (8/8), consumers (432 breaker stations) and generator-fidelity suites all pass. Rebuilt `tidewater-islands.html` — 771,059 B; bundle grep-verified to contain the new clamp (`4,4e3`) and no `,4,600)` remnant.

## Sun, day/night cycle, clouds + weather controls (2026-11-27)

Nino's order (11:45 EET): "Add the sun light and day night cycle and clouds from tidewater project and add them in controls so i can control them and weather conditions too." All three systems are tidewater's own; what was missing in this build was the clouds (excluded by the original recipe), a *running* cycle (the sun path existed but time was frozen), and any controls.

### What tidewater has (found in its source, not assumed)

- **Sun / time** (`App.js` + `sky/Sky.js`): the app owns `settings = { timeOfDay: 16.2, sunAzimuth: 0, timeSpeed: 0 }` — timeSpeed in **hours per real second**. Per frame, `App._frame` advances `timeOfDay` by `dt × timeSpeed` (wrapping at 24) and `App.updateSun()` derives everything from it: `sunDirectionFromTime(timeOfDay)` (latitude 24°, declination 6°) rotated by `sunAzimuth`; below the horizon the **moon takes over as key light** (tidewater's own model — night is moonlit, with stars fading in via `sky.starIntensity`), and `applyAtmosphereReadback()` turns the atmosphere's sun transmittance / sky irradiance into the global light colours. The game's T key toggles the running day at **0.05 h/s (a full day in 8 minutes)**. This build already contained updateSun/applyAtmosphereReadback and the advance line — only frozen (`timeSpeed: 0`, start 10.5) and beyond reach.
- **Clouds**: two systems ship in the game. The current default, `sky/SkyProClouds.js` (sky-pro volumetric cumulus), **fetches two external noise blobs at runtime** — `public/clouds/baseShape64.bin` (908 KB) and `blueNoise.bin` — via `fetch(BASE_URL + 'clouds/…')`. A single-file build serves no external files, so SkyProClouds cannot run in it. The game's own previous system, **`sky/Clouds.js`** — still shipped and selectable in the game itself (`?oldClouds`) — is **fully procedural** (GPU-generated noise, no assets) and exposes the same public interface (`module`, `shadowModule`, `coverage`, `update(dt, camera)`, `resolutionScale`) plus `cirrus` and `densityScale` handles SkyPro doesn't have. **Clouds.js is therefore the cloud system in this build, copied byte-identical** (`cmp`-verified, 81,176 B) — the honest trade: tidewater's previous-generation clouds instead of its current ones, because the current ones cannot exist in one self-contained file.
- **Weather** (`ui/AppUI.js`): there is no rain and no fog system in tidewater's game code (grep-verified — "weather" in the game means sea state). The panel's Ocean tab holds the **SEA preset table** (Calm/Breezy/Choppy/Storm, below) and sliders that write into a plain state object and push into the live systems via three functions — `spectrum()` (→ `fft.local.windSpeed/windDirection/fetch`, `fft.swell.scale`, `fft.updateSpectrumUniforms()`, `G.windDir/G.windSpeed`), `whitecaps()` (→ derived `fft.foamBias/foamDecay`) and `clarity()` (→ `G.waterAbsorption/G.waterScattering`) — plus direct writes (`fft.choppiness.value`, `shore.amplitude/period/gamma/curl.value`, `breakers.params.spray/sheet.value`, `caustics.strength.value`). The Sky tab holds the time-of-day control, a **Sun azimuth** slider (−180…180°), the Advance-time toggle and a log Time-speed slider (0.002…1 h/s), and Cloud cover (+ Cirrus when the cloud system has it).

### What was wired

- **Clouds in the game's own order** (`islands-main.js`, mirroring App.js): `new Clouds(renderer, atmosphere)` right after the Sky, `sky.clouds = clouds` before anything builds a shader, `clouds.resolutionScale` tied to the render scale (App.js's `setRenderScale` does the same; the Quality switch now updates it live). The clouds object now goes to **every consumer the game hands it to** that exists in this build: `sky.clouds` (background + panorama), `waterMaterial.clouds` (cloud shadows on the sea — set after construction, before the first frame, as in App.js; WaterMaterial builds its shader lazily in `_build()`), `installUnderwaterLighting`, `installGroundBounce`, `Spray`, `Breakers` (both construction sites, including the post-shift rebuild). Per frame, `clouds.update(dt, camera)` runs at App.js's place in the frame order.
- **Environment now updates**: `Environment` was constructed but its reference dropped, so its per-frame `update(dt)` (the sky/cubemap re-bake that keeps IBL following the sun and the drifting clouds) was never called — with a frozen sun that was invisible; with a running cycle it would have pinned reflections to the morning. The reference is kept and `environment.update(dt)` now runs per frame, as in App.js.
- **The cycle runs**: creating the controls sets `settings.timeSpeed = 0.01` with advance on. **Defaults on load: 10:30 (timeOfDay 10.5, unchanged), cycle running, a full day in 40 minutes** (0.01 h/s — gentler than the game's own 8-minute toggle default; that rate is one of the speed steps). Night is genuinely night: the sun sets through tidewater's twilight, the moon becomes the key light, stars come out — the game's own atmosphere throughout, no invented moon added (the moon *is* tidewater's).
- **Frame advance** now goes through `envControls.advanceTime(dt)` — the game's own advance expression, wrapped at 24 h.

### The controls (HUD menu panel, alongside Quality)

New glue module **`src/islands/EnvControls.js`**: the SEA preset table, the slider definitions and the push functions are AppUI's, copied with their exact values; the module binds to the **live system objects the app itself holds** (the same references — no shadow copies) and every write pushes immediately, exactly where AppUI's `onChange` pushes it. The HUD (island29 visual language: group labels, pill buttons, range rows) renders three new sections:

**Sun & time**
- *Time of day* slider — 0…24 h, step 0.05, HH:MM readout. Dragging sets `settings.timeOfDay` (the cycle keeps its run/pause state; the sun follows through the per-frame `updateSun`). While you drag, the per-frame readout sync doesn't fight the drag.
- *Run/Pause the day* button + **day-length steps**: 40 min/day (0.01 h/s), 8 min/day (0.05 — the game's own toggle rate), 96 s/day (0.25), 24 s/day (1) — all inside AppUI's timeSpeed range (0.002…1 h/s). The **T key** also runs/pauses (the game's own key).
- *Sun azimuth* slider — −180…180°, step 1 (tidewater's own second sun control: turns the sun's path about the vertical). There is no other sun dial in tidewater — time-of-day + azimuth are the complete, genuine sun controls.

**Clouds**
- *Cloud cover* — 0…1, step 0.01, % readout → `clouds.coverage.value` (Clouds.js default 0.45).
- *Cirrus* — 0…1, step 0.01, % readout → `clouds.cirrus.value` (default 0.5). (AppUI shows this slider only when the cloud system has a cirrus handle — this one does.)

**Weather** — preset buttons **Calm / Breezy / Choppy / Storm** (AppUI's table, verbatim: e.g. Storm = wind 20, fetch 900, chop 1.2, swell 1.0, surf 0.9, period 12, whitecaps 1) + sliders, all with AppUI's names/ranges/steps/units:
Wind speed 0.5…30 m/s (0.1) · Wind direction 0…360° (1) · Fetch 5…2000 km (log) · Choppiness 0…1.6 (0.01) · Ocean swell 0…2 (0.01) · Whitecaps 0…1 (0.01) · Clarity 0.3…2 (0.01) · Wave height 0…1.4 (0.01, displayed ×2 m as AppUI formats it) · Wave period 5…16 s (0.1) · Breaking depth ratio 0.5…1.1 (0.01) · Curl 0…1.5 (0.01) · Spray 0…2 (0.01) · Lip sheet 0…1.5 (0.01) · Caustics intensity 0…2 (0.01 — only on profiles that build caustics, as AppUI only adds it when the app has them).
Moving any weather slider by hand clears the preset highlight — the state is custom, as in the game's panel. The panel is now scrollable (max-height) and slightly wider (232 px) to hold the sections; play controls are untouched.

### Verification

- ✅ `test/hud.test.mjs` extended with an EnvControls section (all passing): the SEA table and every slider range/step/unit asserted equal to AppUI.js's; initial state read from fake live systems with the real defaults (OceanFFT local 7/25/120, swell 0.48, Clouds coverage 0.45 / cirrus 0.5, AppUI literals whitecaps 0.5 / clarity 1 / Breezy active); **object identity** (the controls hold the very objects passed in); Storm/Calm presets write AppUI's exact values into the FFT/shore (incl. derived foamBias 0.78 / foamDecay 0.25 for Storm); every slider's write-through lands in its system field; clarity's G scaling matches AppUI's formula; time slider → `settings.timeOfDay`, HH:MM formatting (0→00:00, 24→00:00, 19.5→19:30); cycle advance wraps past 24 h; pause stores speed, resume applies it.
- ✅ **`test/clouds-compile.check.mjs` (new)** — the cloud shader paths proven on a real WebGPU device (Dawn via the `webgpu` npm package — tidewater's own headless route — over the lavapipe software Vulkan driver): the game's own `composeShader` output for the **sky module with clouds**, the **clouds module** and the **clouds shadowModule** each compile with **0 WGSL errors** (`getCompilationInfo`); and a full render exercise — Atmosphere + Sky + Clouds + Environment (forced panorama bake) + SceneRenderer background at **noon, sunset and night** — runs 24 frames with **zero GPU validation errors and zero uncaptured errors**, the noon frame verifiably lit (mean luminance 0.323, 100% of sampled texels > 0.05). This is the check that kills the silent-compile-failure class (the black-island bug) for the new paths: the cloud view/panorama/shadow code and its compute kernels don't just compile, they execute.
- ✅ All previous suites pass: islandgen, archipelago (bit-exact shift), terrain-data 17/17, wetness-contract 8/8, consumers (432 breaker stations), generator-fidelity (bit-identical heights).
- ✅ Verbatim hygiene: `diff -rq` vs the pristine tidewater clone — **0 differing shared files** (Clouds.js is a pure addition, `cmp`-identical); the only changed files are glue (`islands-main.js`, `islands/Hud.js`, `index.html`) plus new `islands/EnvControls.js` and the new check. Pristine trees untouched; no GitHub commit.
- ✅ Built file load check (headless Chrome 157): the module graph executes and the app reaches its designed WebGPU gate with the graceful message and no other console errors (this sandbox's Chrome exposes `navigator.gpu` but returns no adapter even with SwiftShader flags — the standing sandbox limit; the GPU-side proof is the Dawn check above).
- Build: `tidewater-islands.html` **841,956 B** (was 771,059; the growth is Clouds.js + the controls).
- ⚠️ **On-device-only, as ever:** what night, the clouds and a storm actually *look like*, and the frame rate with volumetric clouds on the phone (clouds trace at the render scale; if it feels heavy, Quality → Light still renders at 1× — and cloud cover is a slider away from 0).

### Playtest guidance (this build)

1. **The day is already moving** when you spawn (10:30, a full day in 40 min) — watch the light change, or open the ☰ menu → **Sun & time** and drag **Time of day** to ~**19:30** for a sunset over the sea; keep dragging past 20:00 for dusk, stars and the moonlit night. **Pause the day** to hold a light you like; the speed steps take it up to a full day in 24 s.
2. **Clouds**: menu → **Clouds** → *Cloud cover* 0% (clear sky) → 45% (the default broken cumulus) → 90% (overcast); watch the cloud shadows cross the sea, and the light soften under a thick deck. *Cirrus* adds the thin high veil.
3. **Weather**: menu → **Weather** → **Storm**: wind 20 m/s, fetch 900 km — the FFT sea rebuilds its spectrum, whitecaps and spray pick up, the surf height doubles. Sail the boat in it; then **Calm** and watch it settle. Drag **Wave height** by hand afterwards — the preset highlight clears (custom state), exactly as in the game's panel.
4. **T** on a keyboard runs/pauses the day without opening the menu.
