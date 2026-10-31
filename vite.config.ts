import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build`          -> regular static site in dist/ (relative paths, works on any static host)
// `npm run build:preview`  -> one self-contained HTML file in dist-preview/ (used for shareable previews)
export default defineConfig(({ mode }) => {
  const single = mode === 'singlefile';
  return {
    base: './',
    plugins: [react(), ...(single ? [viteSingleFile()] : [])],
    build: {
      outDir: single ? 'dist-preview' : 'dist',
      target: 'es2022',
      chunkSizeWarningLimit: 2000,
    },
    server: { host: true },
    // Dev harness pages import the same deps; scan them up front so Vite never re-optimises mid-session.
    optimizeDeps: { entries: ['index.html', 'dev/*.html'] },
  };
});
