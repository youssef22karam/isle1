// InputFacade + LookCam logic tests — plain node, stubbed real Input/camera.
// Run: node test/hud.test.mjs
import { InputFacade, LookCam } from '../src/islands/Hud.js';
import { Vector3 } from '../src/engine/index.js';

let fails = 0;
const ok = ( c, n ) => { console.log( ( c ? 'PASS ' : 'FAIL ' ) + n ); if ( ! c ) fails ++; };

const real = {
	keys: new Set(), pressed: new Set(), look: { x: 0, y: 0 }, wheel: 0,
	down( c ) { return this.keys.has( c ); },
	hit( c ) { return this.pressed.has( c ); },
	consumeLook() { const l = { ... this.look }; this.look = { x: 0, y: 0 }; return l; },
	consumeWheel() { const w = this.wheel; this.wheel = 0; return w; },
	endFrame() { this.pressed.clear(); },
};
const f = new InputFacade( real );

// real keys pass through
real.keys.add( 'KeyW' );
ok( f.down( 'KeyW' ) === true && f.down( 'KeyA' ) === false, 'real keys pass through down()' );

// synthetic holds
f.setHeld( 'ShiftLeft', true );
ok( f.down( 'ShiftLeft' ) === true, 'synthetic hold reads as down' );
f.setHeld( 'ShiftLeft', false );
ok( f.down( 'ShiftLeft' ) === false, 'synthetic release clears down' );

// taps fire once
f.tap( 'KeyE' );
ok( f.hit( 'KeyE' ) === true, 'tap fires hit once' );
ok( f.hit( 'KeyE' ) === false, 'tap does not refire' );

// look/wheel accumulate across real + synthetic
real.look = { x: 5, y: 7 };
f.addLook( 3, - 2 );
const l = f.consumeLook();
ok( l.x === 8 && l.y === 5, 'consumeLook merges real + touch look' );
real.wheel = 2;
f.addWheel( - 0.5 );
ok( f.consumeWheel() === 1.5, 'consumeWheel merges real + pinch' );

// analog stick -> keys + magnitude (facade coords: +y = forward)
real.keys.delete( 'KeyW' ); // stop the real-key stub polluting the stick checks
f.setStick( 0, 1 ); // full forward
ok( f.down( 'KeyW' ) && f.stickActive && Math.abs( f.stickMag - 1 ) < 1e-9, 'stick full forward holds KeyW at mag 1' );
f.setStick( 0.8, 0.8 ); // forward-right diagonal
ok( f.down( 'KeyD' ) && f.down( 'KeyW' ) && ! f.down( 'KeyS' ), 'stick diagonal holds KeyW+KeyD' );
f.setStick( 0.8, - 0.8 ); // back-right diagonal
ok( f.down( 'KeyD' ) && f.down( 'KeyS' ) && ! f.down( 'KeyW' ), 'stick back-diagonal holds KeyD+KeyS' );
f.setStick( 0.1, 0.1 ); // inside dead zone
ok( ! f.stickActive && ! f.down( 'KeyW' ) && ! f.down( 'KeyD' ), 'stick dead zone releases keys' );
f.setStick( - 1, 0 );
ok( f.down( 'KeyA' ), 'stick full left holds KeyA' );
f.clearStick();
ok( ! f.down( 'KeyA' ) && f.stickMag === 0, 'clearStick resets' );

// LookCam: orbits its target, zooms with clamps, never below ground
const cam = { position: new Vector3(), lookTarget: null, lookAt( x, y, z ) { this.lookTarget = new Vector3( x, y, z ); } };
const lc = new LookCam();
lc.dist = 50;
lc.pitch = 0.3;
const target = new Vector3( 100, 2, - 40 );
for ( let i = 0; i < 120; i ++ ) lc.update( 1 / 60, target, cam, () => - 40 );
const d = Math.hypot( cam.position.x - target.x, cam.position.z - target.z );
ok( Math.abs( Math.hypot( d, cam.position.y - target.y ) - 50 ) < 2, 'look camera settles at orbit distance', );
ok( cam.position.y > target.y, 'look camera rides above the target at pitch 0.3' );
lc.zoom( 1000 );
ok( lc.dist === 4000, 'zoom clamps at 4000 m' );
lc.zoom( 0.0001 );
ok( lc.dist === 4, 'zoom clamps at 4 m' );
lc.pitch = 0.01;
lc.dist = 30;
lc.init = false;
lc.update( 1 / 60, target, cam, () => 25 ); // ground above the orbit height
ok( cam.position.y >= 26.2 - 1e-6, 'look camera stays above terrain', );

// ------------------------------------------------------------ EnvControls
// The sun/time, clouds + weather binding layer (islands/EnvControls.js):
// its preset table, slider ranges and push semantics are tidewater's own
// panel (ui/AppUI.js). Fakes stand in for the live systems with the same
// shapes/defaults as the real OceanFFT / ShoreWaves / Breakers / Clouds,
// so a write through the controls must land in the very objects passed in.
const { createEnvControls, SEA_PRESETS, ENV_SLIDERS, TIME_SPEED_STEPS, formatTimeOfDay } = await import( '../src/islands/EnvControls.js' );

const approx = ( a, b ) => Math.abs( a - b ) < 1e-9;
const vecFake = ( ...a ) => ( {
	v: [ ...a ],
	set( ...b ) { this.v = [ ...b ]; return this; },
	multiplyScalar( k ) { this.v = this.v.map( ( x ) => x * k ); return this; },
} );
const fakeG = {
	windDir: { value: vecFake( 0.35, 0.94 ) },
	windSpeed: { value: 7 },
	waterAbsorption: { value: vecFake( 0.42, 0.075, 0.035 ) },
	waterScattering: { value: vecFake( 0.012, 0.018, 0.024 ) },
};
const fakeFft = {
	local: { windSpeed: 7, windDirection: 25, fetch: 120 }, // OceanFFT's own defaults
	swell: { scale: 0.48 },
	choppiness: { value: 0.9 },
	foamBias: { value: 0.58 },
	foamDecay: { value: 0.35 },
	spectrumCalls: 0,
	updateSpectrumUniforms() { this.spectrumCalls ++; },
};
const fakeShore = { amplitude: { value: 0.34 }, period: { value: 9 }, gamma: { value: 0.8 }, curl: { value: 0.6 } };
const fakeBreakers = { params: { spray: { value: 1 }, sheet: { value: 1 } } };
const fakeCaustics = { strength: { value: 1 } };
const fakeClouds = { coverage: { value: 0.45 }, cirrus: { value: 0.5 } }; // Clouds.js's own defaults
const fakeSettings = { timeOfDay: 10.5, sunAzimuth: 0, timeSpeed: 0 };
const fakeMath = { degToRad: ( d ) => d * Math.PI / 180, clamp: ( v, a, b ) => Math.min( b, Math.max( a, v ) ) };
const env = createEnvControls( { settings: fakeSettings, fft: fakeFft, shore: fakeShore, breakers: fakeBreakers, caustics: fakeCaustics, clouds: fakeClouds, globals: fakeG, math: fakeMath } );
const es = env.state;

// the preset table is AppUI's SEA table, verbatim
ok( JSON.stringify( SEA_PRESETS ) === JSON.stringify( {
	Calm: { wind: 3.5, fetch: 40, chop: 0.75, swell: 0.28, surf: 0.18, period: 11, whitecaps: 0.2 },
	Breezy: { wind: 7, fetch: 120, chop: 0.9, swell: 0.48, surf: 0.34, period: 9, whitecaps: 0.5 },
	Choppy: { wind: 12, fetch: 300, chop: 1.05, swell: 0.68, surf: 0.56, period: 8.5, whitecaps: 0.75 },
	Storm: { wind: 20, fetch: 900, chop: 1.2, swell: 1.0, surf: 0.9, period: 12, whitecaps: 1 },
} ), 'SEA presets match AppUI.js verbatim' );

// slider ranges are AppUI's (key: [min, max, step, unit, log])
const sliderSpec = {
	time: [ 0, 24, 0.05 ], azimuth: [ - 180, 180, 1 ], clouds: [ 0, 1, 0.01 ], cirrus: [ 0, 1, 0.01 ],
	wind: [ 0.5, 30, 0.1 ], windDir: [ 0, 360, 1 ], fetch: [ 5, 2000, 1 ], chop: [ 0, 1.6, 0.01 ],
	swell: [ 0, 2, 0.01 ], whitecaps: [ 0, 1, 0.01 ], clarity: [ 0.3, 2, 0.01 ], surf: [ 0, 1.4, 0.01 ],
	period: [ 5, 16, 0.1 ], gamma: [ 0.5, 1.1, 0.01 ], curl: [ 0, 1.5, 0.01 ], spray: [ 0, 2, 0.01 ],
	lip: [ 0, 1.5, 0.01 ], caustics: [ 0, 2, 0.01 ],
};
let rangesOk = true;
for ( const [ k, [ mn, mx, st ] ] of Object.entries( sliderSpec ) ) {

	const d = ENV_SLIDERS.find( ( s ) => s.key === k );
	if ( ! d || d.min !== mn || d.max !== mx || d.step !== st ) rangesOk = false;

}
ok( rangesOk, 'ENV_SLIDERS ranges/steps match AppUI.js' );
ok( ENV_SLIDERS.find( ( s ) => s.key === 'fetch' ).log === true, 'Fetch slider is logarithmic (AppUI)' );
ok( ENV_SLIDERS.find( ( s ) => s.key === 'wind' ).unit === 'm/s' && ENV_SLIDERS.find( ( s ) => s.key === 'period' ).unit === 's', 'slider units match AppUI.js' );

// initial state is read from the live systems (AppUI's initialisation)
ok( es.wind === 7 && es.windDir === 25 && es.fetch === 120 && es.swell === 0.48 && es.chop === 0.9, 'initial sea state reads the live FFT values' );
ok( es.surf === 0.34 && es.period === 9 && es.spray === 1 && es.lip === 1 && es.caustics === 1, 'initial shore/breaker values read live' );
ok( es.whitecaps === 0.5 && es.clarity === 1 && es.preset === 'Breezy', 'AppUI literal defaults: whitecaps 0.5, clarity 1, Breezy active' );
ok( es.clouds === 0.45 && es.cirrus === 0.5 && es.time === 10.5, 'initial cloud/time state reads live' );
ok( env.systems.fft === fakeFft && env.systems.shore === fakeShore && env.systems.clouds === fakeClouds && env.systems.settings === fakeSettings, 'controls hold the very system objects passed in (identity)' );

// the cycle runs from load, at the gentle default rate
ok( es.advance === true && es.timeSpeed === 0.01 && fakeSettings.timeSpeed === 0.01, 'cycle running from load at 0.01 h/s (40 min/day)' );
ok( TIME_SPEED_STEPS.every( ( s ) => s.value >= 0.002 && s.value <= 1 ), 'speed steps inside AppUI\'s timeSpeed range (0.002..1 h/s)' );

// presets push AppUI's values into the live systems
env.applyPreset( 'Storm' );
ok( fakeFft.local.windSpeed === 20 && fakeFft.local.fetch === 900 && fakeFft.swell.scale === 1.0, 'Storm preset writes wind/fetch/swell into the FFT' );
ok( fakeFft.choppiness.value === 1.2 && fakeShore.amplitude.value === 0.9 && fakeShore.period.value === 12, 'Storm preset writes chop/surf/period' );
ok( approx( fakeFft.foamBias.value, 0.78 ) && approx( fakeFft.foamDecay.value, 0.25 ), 'Storm whitecaps push: foamBias 0.78, foamDecay 0.25 (AppUI formulas)' );
ok( fakeG.windSpeed.value === 20 && fakeFft.spectrumCalls > 0, 'spectrum() pushed (G.windSpeed + updateSpectrumUniforms)' );
ok( es.preset === 'Storm', 'Storm is the active preset' );
env.applyPreset( 'Calm' );
ok( fakeFft.local.windSpeed === 3.5 && approx( fakeFft.foamBias.value, 0.497 ) && approx( fakeFft.foamDecay.value, 0.53 ), 'Calm preset writes its values + derived foam terms' );

// manual slider moves write through and clear the preset (custom state)
env.setValue( 'wind', 12 );
ok( fakeFft.local.windSpeed === 12 && es.preset === null, 'manual wind move writes through and clears the preset' );
env.setValue( 'surf', 0.7 );
ok( fakeShore.amplitude.value === 0.7, 'wave height slider writes shore.amplitude' );
env.setValue( 'gamma', 0.9 );
ok( fakeShore.gamma.value === 0.9, 'breaking depth ratio writes shore.gamma' );
env.setValue( 'spray', 1.5 );
ok( fakeBreakers.params.spray.value === 1.5, 'spray slider writes breakers.params.spray' );
env.setValue( 'lip', 0.4 );
ok( fakeBreakers.params.sheet.value === 0.4, 'lip sheet slider writes breakers.params.sheet' );
env.setValue( 'caustics', 0.5 );
ok( fakeCaustics.strength.value === 0.5, 'caustics slider writes caustics.strength' );
env.setValue( 'clouds', 0.8 );
ok( fakeClouds.coverage.value === 0.8, 'cloud cover slider writes clouds.coverage (same object)' );
env.setValue( 'cirrus', 0.2 );
ok( fakeClouds.cirrus.value === 0.2, 'cirrus slider writes clouds.cirrus' );
env.setValue( 'clarity', 2 );
ok( approx( fakeG.waterAbsorption.value.v[ 0 ], 0.42 * 0.8 ) && approx( fakeG.waterScattering.value.v[ 0 ], 0.012 * 0.25 ), 'clarity push scales G.waterAbsorption/Scattering (AppUI formula)' );

// time: slider mapping + formatting + the cycle's wrap
env.setValue( 'time', 19.5 );
ok( fakeSettings.timeOfDay === 19.5 && es.time === 19.5, 'time slider writes settings.timeOfDay' );
ok( formatTimeOfDay( 19.5 ) === '19:30' && formatTimeOfDay( 0 ) === '00:00' && formatTimeOfDay( 24 ) === '00:00' && formatTimeOfDay( 10.52 ) === '10:31', 'time-of-day readout formats HH:MM (0..24 wraps)' );
env.setValue( 'azimuth', - 90 );
ok( fakeSettings.sunAzimuth === - 90, 'sun azimuth writes settings.sunAzimuth' );
env.setValue( 'time', 23.999 );
env.setSpeed( 1 );
ok( fakeSettings.timeSpeed === 1, 'speed step applies while advancing' );
env.advanceTime( 0.01 );
ok( approx( fakeSettings.timeOfDay, 0.009 ), 'cycle advance wraps past 24 h' );
env.setAdvance( false );
ok( fakeSettings.timeSpeed === 0, 'pause zeroes settings.timeSpeed' );
const frozen = fakeSettings.timeOfDay;
env.advanceTime( 10 );
ok( fakeSettings.timeOfDay === frozen, 'paused cycle does not advance' );
env.setSpeed( 0.25 );
ok( fakeSettings.timeSpeed === 0 && es.timeSpeed === 0.25, 'speed chosen while paused is stored, not applied' );
env.setAdvance( true );
ok( fakeSettings.timeSpeed === 0.25, 'resuming applies the stored speed' );

console.log( fails === 0 ? 'ALL TESTS PASSED' : fails + ' FAILURES' );
process.exit( fails ? 1 : 0 );
