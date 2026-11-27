import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Single self-contained HTML: every JS chunk and asset inlined.
export default defineConfig( {
	base: './',
	plugins: [ viteSingleFile() ],
	build: {
		target: 'esnext',
		chunkSizeWarningLimit: 8192,
		assetsInlineLimit: 100000000,
		cssCodeSplit: false,
		outDir: 'dist',
	},
	server: { port: 5191, strictPort: true, host: '127.0.0.1' },
} );
