// ArchipelagoData provider tests — plain node, no deps.
// Run: node test/archipelago.test.mjs
import { ArchipelagoData } from '../src/islands/ArchipelagoData.js';
import { WORLD_SEED, cellHasIsland, islandDescriptor } from '../src/islands/IslandGen.js';

let fails = 0;
const ok = ( cond, name, info = '' ) => {

	console.log( ( cond ? 'PASS ' : 'FAIL ' ) + name + ( info ? ' — ' + info : '' ) );
	if ( ! cond ) fails ++;

};

// ---------------------------------------------------------- interface audit
// Every member tidewater's consumers read/call on the terrain-data object
// (grep audit of Terrain.js, TerrainGPU.js, terrain/TerrainBake.js,
// ShoreField.js, Breakers.js, Player.js, BoatController.js, WaterQuery path):
const d = new ArchipelagoData();
for ( const f of [ 'size', 'res', 'texel', 'origin', 'heights', 'rock', 'sand', 'path', 'gully', 'seagrass', 'rubble', 'scarp', 'pads' ] )
	ok( d[ f ] !== undefined, 'interface field ' + f );
for ( const m of [ 'heightAt', 'normalAt', 'boundsFor', 'buildMinMax' ] )
	ok( typeof d[ m ] === 'function', 'interface method ' + m );
ok( d.heights.length === d.res * d.res && d.rock.length === d.res * d.res, 'array sizes = res^2' );
ok( d.sand.length === d.res * d.res && d.seagrass.length === d.res * d.res, 'mask sizes = res^2' );

// ---------------------------------------------------------- streaming decisions
let missing = d.missingIslands();
ok( missing.length === 1 && missing[ 0 ].isHome, 'at origin only the home island is missing', missing.map( m => m.key ).join( ' ' ) );
const t0 = performance.now();
for ( const desc of missing ) d.generateIsland( desc );
console.log( 'INFO home island generated in ' + ( performance.now() - t0 ).toFixed( 0 ) + ' ms' );
ok( d.missingIslands().length === 0, 'nothing missing after generation' );

d.refill();
let sum = 0;
for ( let i = 0; i < d.heights.length; i += 997 ) sum += d.heights[ i ];
const sumA = sum;
d.refill();
sum = 0;
for ( let i = 0; i < d.heights.length; i += 997 ) sum += d.heights[ i ];
ok( sum === sumA, 'refill is deterministic' );

// home island terrain is in the window: land above water + beach + sea floor
let mx = - Infinity, beach = 0, sea = 0;
for ( let i = 0; i < d.heights.length; i ++ ) {

	const h = d.heights[ i ];
	if ( h > mx ) mx = h;
	if ( h > 0.2 && h < 1.6 ) beach ++;
	if ( h < - 6 ) sea ++;

}
ok( mx > 40, 'window contains island peaks', 'max=' + mx.toFixed( 1 ) );
ok( beach > 200, 'window contains beach texels', 'beach=' + beach );
ok( sea > 200, 'window contains sea floor texels', 'sea=' + sea );

// ---------------------------------------------------------- CPU vs data consistency
// heightAt (what Player / BoatController / Breakers read) must equal the
// archipelago truth (worldHeightAt at virtual coords) inside the window,
// because the GPU samples the same heights[] the CPU filled from it.
let worst = 0;
let rngState = 1234567;
const rnd = () => { rngState = ( rngState * 1103515245 + 12345 ) & 0x7fffffff; return rngState / 0x7fffffff; };
for ( let i = 0; i < 400; i ++ ) {

	const x = rnd() * 1980 - 990;
	const z = rnd() * 1980 - 990;
	const a = d.heightAt( x, z );
	const b = d.worldHeightAt( x + d.offsetX, z + d.offsetZ );
	worst = Math.max( worst, Math.abs( a - b ) );

}
ok( worst < 2.01, 'heightAt == worldHeightAt inside window (texel quantisation only)', 'worst=' + worst.toFixed( 3 ) + ' m' );
ok( d.heightAt( 5000, 0 ) === - 90, 'heightAt outside window = -90 (the game convention)' );

// normalAt returns a unit vector
const n = { v: null, set( x, y, z ) { this.v = [ x, y, z ]; return this; }, normalize() { const l = Math.hypot( ... this.v ); this.v = this.v.map( c => c / l ); return this; } };
d.normalAt( 0, 0, n );
ok( Math.abs( Math.hypot( ... n.v ) - 1 ) < 1e-9 && n.v[ 1 ] > 0, 'normalAt unit + upward' );

// boundsFor brackets the heights under random CDLOD-style boxes
let bracket = true;
for ( let i = 0; i < 300; i ++ ) {

	// CDLOD-style boxes: aligned to the min/max tile grid (16 m), samples inset
	const x0 = - 1024 + ( i * 37 % 100 ) * 16, z0 = - 1024 + ( i * 91 % 100 ) * 16;
	const x1 = x0 + 64 + ( i % 7 ) * 32, z1 = z0 + 64 + ( i % 5 ) * 32;
	const [ mn, mxB ] = d.boundsFor( x0, z0, x1, z1 );
	for ( let z = z0 + 2; z <= z1 - 2; z += 7 ) for ( let x = x0 + 2; x <= x1 - 2; x += 7 ) {

		const h = d.heightAt( x, z );
		if ( h < mn - 0.01 || h > mxB + 0.01 ) bracket = false;

	}

}
ok( bracket, 'boundsFor brackets sampled heights (300 boxes)' );

// ---------------------------------------------------------- seams
// worldHeightAt must be continuous across archipelago cell borders (open
// sea) and across an island square rim.
const jump = ( fn, x0, z0, x1, z1, steps ) => {

	let worstJ = 0, prev = fn( x0, z0 );
	for ( let i = 1; i <= steps; i ++ ) {

		const t = i / steps;
		const v = fn( x0 + ( x1 - x0 ) * t, z0 + ( z1 - z0 ) * t );
		worstJ = Math.max( worstJ, Math.abs( v - prev ) );
		prev = v;

	}
	return worstJ;

};
const seaJump = jump( ( x, z ) => d.worldHeightAt( x, z ), 3700, 1234, 4300, 1234, 300 ); // crosses cell border x=4000
ok( seaJump < 1.5, 'no seam across a cell border in open sea', 'worst 2m step=' + seaJump.toFixed( 3 ) + ' m' );
const home = islandDescriptor( 0, 0, WORLD_SEED );
const rimJump = jump( ( x, z ) => d.worldHeightAt( x, z ), home.cx + home.half - 300, home.cz, home.cx + home.half + 300, home.cz, 300 );
ok( rimJump < 3, 'no seam across the island square rim', 'worst 2m step=' + rimJump.toFixed( 3 ) + ' m' );

// ---------------------------------------------------------- spawn
const spawn = d.findSpawn( home );
ok( !! spawn, 'findSpawn found a beach on the home island' );
if ( spawn ) {

	const bx = home.cx + spawn.beach.x, bz = home.cz + spawn.beach.z;
	const bh = d.worldHeightAt( bx, bz );
	ok( bh > 0.2 && bh < 1.8, 'spawn beach height in [0.2, 1.8]', 'h=' + bh.toFixed( 2 ) );
	const boatH = d.worldHeightAt( home.cx + spawn.boat.x, home.cz + spawn.boat.z );
	ok( boatH < - 3.5, 'boat spot is deep enough', 'h=' + boatH.toFixed( 2 ) );

}

// ---------------------------------------------------------- shifted window
d.setOffset( 8000, 0 );
const miss2 = d.missingIslands();
ok( miss2.every( m => cellHasIsland( m.ix, m.iz, WORLD_SEED ) ), 'shifted window: missing islands all real cells' );
for ( const desc of miss2 ) d.generateIsland( desc );
d.refill();
let land2 = 0;
for ( let i = 0; i < d.heights.length; i += 13 ) if ( d.heights[ i ] > 1 ) land2 ++;
console.log( 'INFO cell (1,0) hasIsland=' + cellHasIsland( 1, 0, WORLD_SEED ) + ', land texels in shifted window (sampled)=' + land2 );
ok( cellHasIsland( 1, 0, WORLD_SEED ) ? land2 > 50 : true, 'shifted window shows the neighbour island when one exists' );
// shifting back reproduces the original window exactly
d.setOffset( 0, 0 );
d.refill();
sum = 0;
for ( let i = 0; i < d.heights.length; i += 997 ) sum += d.heights[ i ];
ok( sum === sumA, 'shifting away and back reproduces the window exactly' );

console.log( fails === 0 ? 'ALL TESTS PASSED' : fails + ' FAILURES' );
process.exit( fails === 0 ? 0 : 1 );
