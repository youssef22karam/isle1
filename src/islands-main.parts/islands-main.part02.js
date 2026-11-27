			throttle: this.boatCtl.throttle,
		} );
		this.hud.setEnvTime( this.settings.timeOfDay );
		this._shiftCheckT -= dt;
		if ( this._shiftCheckT <= 0 ) { this._shiftCheckT = 0.5; this.maybeShift(); this.maybeFollowShoreSim(); }

		setFrameCamera( camera, engine.width, engine.height );
		this.shadows.render( this.scene, engine.meshRenderer, this.shadows.update( camera, G.sunDir.value ) );
		this.sceneRenderer.render();
		const view = GPU.context.getCurrentTexture().createView();
		this.present.render( { colorViews: [ view ], clear: [ 0, 0, 0, 1 ] } );
		GPU.submit();

	}

	// island29's analog rule — speed follows the push. tidewater's Player
	// reads boolean keys, so after its update we cap the walker's horizontal
	// speed at the stick's fraction of the mode's full speed (direction and
	// physics are untouched; desktop keys never trigger this).
	applyStickSpeedCap() {

		const f = this.input;
		if ( ! f.stickActive || f.stickMag >= 0.97 ) return;
		const p = this.player;
		if ( p.mode !== 'walk' && p.mode !== 'swim' ) return;
		const run = f.down( 'ShiftLeft' ) || f.down( 'ShiftRight' );
		const full = p.mode === 'swim' ? 2.9 : run ? 6.2 : 3.0; // Player's own speed constants
		const cap = full * f.stickMag;
		const hs = Math.hypot( p.velocity.x, p.velocity.z );
		if ( hs > cap && hs > 1e-4 ) {

			const s = cap / hs;
			p.velocity.x *= s;
			p.velocity.z *= s;

		}

	}

}

// ---------------------------------------------------------------- boot helpers
function nextFrame() {

	return new Promise( ( r ) => requestAnimationFrame( r ) );

}
function showLoader( msg ) {

	const l = document.getElementById( 'loader' );
	if ( l ) { l.style.display = ''; document.getElementById( 'loader-text' ).textContent = msg; }

}
function hideLoader() {

	const l = document.getElementById( 'loader' );
	if ( l ) l.style.display = 'none';

}

const loaderText = document.getElementById( 'loader-text' );
const app = new IslandsApp( document.getElementById( 'app' ) );
window.__islands = app;
app.init( ( msg ) => { if ( loaderText ) loaderText.textContent = msg; } ).then( () => {

	hideLoader();

} ).catch( ( err ) => {

	console.error( err );
	if ( loaderText ) {

		const msg = err && err.message ? err.message : String( err );
		const gpuFailure = ! navigator.gpu || /webgpu|adapter/i.test( msg );
		loaderText.innerHTML = 'Could not start.<br>' + msg +
			( gpuFailure ? '<br><br>This experience needs WebGPU (a recent Chrome/Edge, or Safari 26+).' : '' );
		loaderText.style.color = '#ffb4a2';

	}

} );
