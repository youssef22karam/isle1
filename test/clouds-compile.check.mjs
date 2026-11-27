// clouds-compile.check.mjs — WGSL compile + render proof for the cloud
// shader paths (sky background with clouds, the cloud view/panorama/
// shadow modules, the cloud compute kernels, the environment panorama),
// run on a real WebGPU device (Dawn) in node. This is the check that
// catches the silent-failure class of the black-island bug: a shader
// that fails to compile is skipped at runtime with only a console error.
//
// Requires the `webgpu` npm package (Dawn bindings — the same package
// tidewater's own test/headless.mjs uses). It is resolved, in order,
// from: $WEBGPU_PKG (a package dir), this project's node_modules,
// ~/workspace/tidewater/node_modules, /tmp/wgpu-harness/node_modules.
// If none is found the check SKIPs (exit 2) rather than failing.
//
// Run: node test/clouds-compile.check.mjs
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

let webgpu = null;
const roots = [ process.env.WEBGPU_PKG, new URL( '..', import.meta.url ).pathname, '/home/hatch/workspace/tidewater', '/tmp/wgpu-harness' ].filter( Boolean );
for ( const root of roots ) {

	try {

		const req = createRequire( root.replace( /\/?$/, '/' ) + 'package.json' );
		webgpu = req( 'webgpu' );
		if ( webgpu ) break;

	} catch ( e ) { /* try the next root */ }

}
if ( ! webgpu ) {

	console.log( 'SKIP: `webgpu` package not found (set WEBGPU_PKG or npm i webgpu in a scratch dir)' );
	process.exit( 2 );

}

// Dawn globals, exactly as tidewater's test/headless.mjs installs them.
// Backend: this sandbox has no Vulkan driver, so probe the Dawn backends
// and keep the first that yields an adapter (OpenGL over Mesa's software
// GL works here; on a machine with Vulkan the default wins).
Object.assign( globalThis, webgpu.globals );
let gpuObj = null, backendUsed = null;
for ( const flag of [ '', 'backend=opengl', 'backend=vulkan' ] ) {

	const candidate = webgpu.create( flag ? [ flag ] : [] );
	try {

		const adapter = await candidate.requestAdapter();
		if ( adapter ) { gpuObj = candidate; backendUsed = flag || 'default'; break; }

	} catch ( e ) { /* try the next backend */ }

}
if ( ! gpuObj ) { console.log( 'SKIP: Dawn found no WebGPU adapter on any backend' ); process.exit( 2 ); }
console.log( 'Dawn backend: ' + backendUsed );
Object.defineProperty( globalThis, 'navigator', { value: { gpu: gpuObj }, configurable: true } );
globalThis.location = { search: '' };

let fails = 0;
const ok = ( c, n ) => { console.log( ( c ? 'PASS ' : 'FAIL ' ) + n ); if ( ! c ) fails ++; };

const { GPU } = await import( '../src/engine/gpu/GPU.js' );
await GPU.init( { headless: true } );
const uncaptured = [];
GPU.device.onuncapturederror = ( e ) => uncaptured.push( ( e.error && e.error.message ) || String( e.error || e ) );

const { composeShader } = await import( '../src/engine/gpu/Shader.js' );
const E = await import( '../src/engine/index.js' );
const { Atmosphere } = await import( '../src/sky/Atmosphere.js' );
const { Sky, sunDirectionFromTime } = await import( '../src/sky/Sky.js' );
const { Clouds } = await import( '../src/sky/Clouds.js' );
const { Environment } = await import( '../src/sky/Environment.js' );
const { MeshRenderer } = await import( '../src/engine/render/MeshRenderer.js' );
const { SceneRenderer } = await import( '../src/engine/render/SceneRenderer.js' );
const { G, setFrameCamera } = await import( '../src/engine/render/Frame.js' );
const { readTexture } = await import( '../src/engine/gpu/Readback.js' );

const W = 640, H = 400;
const atmosphere = new Atmosphere();
const sky = new Sky( atmosphere );
const clouds = new Clouds( null, atmosphere ); // renderer null + outputSize: tidewater's own harness configuration
clouds.outputSize = { x: W, y: H };
sky.clouds = clouds;

// ------------------------------------------------------------ WGSL compile
async function compileCheck( name, modules ) {

	let wgsl;
	try { wgsl = composeShader( { modules } ).code; } catch ( e ) { ok( false, name + ' — composeShader threw: ' + e.message ); return; }
	const mod = GPU.device.createShaderModule( { code: wgsl } );
	const info = await mod.getCompilationInfo();
	const errs = info.messages.filter( ( m ) => m.type === 'error' );
	ok( errs.length === 0, name + ( errs.length ? ' — ' + errs.map( ( m ) => m.message ).join( ' | ' ) : ' (0 errors)' ) );

}
await compileCheck( 'sky module WITH clouds (skyBackground -> cloudsSampleView)', [ sky.module ] );
await compileCheck( 'clouds module (cloudsSample / cloudsSampleView / cloudsShadow)', [ clouds.module ] );
await compileCheck( 'clouds shadowModule (cloudsShadow alone)', [ clouds.shadowModule ] );

// ------------------------------------------------------------ render exercise
const scene = new E.Scene();
const camera = new E.PerspectiveCamera( 55, W / H, 0.1, 60000 );
camera.position.set( 0, 3, 0 );
camera.lookAt( 0.3, 3.6, - 1 );
camera.updateMatrixWorld();
const mr = new MeshRenderer();
const sr = new SceneRenderer( mr, scene, camera );
sr.setSize( W, H );
sr.background = sky.background;
const env = new Environment( mr, scene, sky );

// the app's own sun wiring (islands-main updateSun), minus the readback
function setSun( hours ) {

	const dir = sunDirectionFromTime( hours );
	atmosphere.sunDir.value.copy( dir );
	const night = E.MathUtils.smoothstep( - dir.y, 0.02, 0.18 );
	G.night.value = night;
	sky.starIntensity.value = night;
	const moon = new E.Vector3( - dir.x, Math.abs( dir.y ) * 0.8 + 0.25, - dir.z ).normalize();
	sky.moonDir.value.copy( moon );
	G.sunDir.value.copy( dir.y > - 0.07 ? dir : moon );

}

async function runCase( name, hours, frames ) {

	setSun( hours );
	GPU.device.pushErrorScope( 'validation' );
	for ( let f = 0; f < frames; f ++ ) {

		GPU.beginFrame();
		atmosphere.update( 1 / 60, camera.position.y );
		clouds.update( 1 / 60, camera );
		if ( f === 0 ) env.update( 0, true ); // forced full panorama bake (skyRadianceWithClouds)
		setFrameCamera( camera, W, H );
		sr.render();
		GPU.submit();

	}
	await GPU.queue.onSubmittedWorkDone();
	const err = await GPU.device.popErrorScope();
	ok( ! err, name + ( err ? ' — GPU validation error: ' + err.message : '' ) );

}

await runCase( 'noon render: atmosphere + clouds + environment + sky background (12.5 h)', 12.5, 12 );

// the rendered sky is actually lit (not a black/empty frame)
const half = ( h ) => {

	const s = ( h & 0x8000 ) ? - 1 : 1, e = ( h >> 10 ) & 0x1f, f = h & 0x3ff;
	if ( e === 0 ) return s * ( f / 1024 ) * Math.pow( 2, - 14 );
	if ( e === 31 ) return f ? NaN : s * Infinity;
	return s * ( 1 + f / 1024 ) * Math.pow( 2, e - 15 );

};
const { data, width, height } = await readTexture( sr.sceneRT.texture );
const u16 = new Uint16Array( data );
let sum = 0, n = 0, lit = 0;
for ( let i = 0; i + 2 < u16.length; i += 4 * 613 ) {

	const lum = 0.2126 * half( u16[ i ] ) + 0.7152 * half( u16[ i + 1 ] ) + 0.0722 * half( u16[ i + 2 ] );
	if ( Number.isFinite( lum ) ) { sum += lum; n ++; if ( lum > 0.05 ) lit ++; }

}
ok( n > 100 && sum / n > 0.02 && lit / n > 0.5, `noon sky frame is lit (mean luminance ${( sum / n ).toFixed( 3 )}, ${( 100 * lit / n ).toFixed( 0 )}% of sampled texels > 0.05, ${width}x${height})` );

await runCase( 'sunset render (18.2 h)', 18.2, 6 );
await runCase( 'night render (22.5 h)', 22.5, 6 );
ok( uncaptured.length === 0, 'no uncaptured GPU errors' + ( uncaptured.length ? ' — ' + uncaptured.join( ' | ' ) : '' ) );

console.log( fails === 0 ? 'ALL CHECKS PASSED' : fails + ' FAILURES' );
process.exit( fails ? 1 : 0 );
