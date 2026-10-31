import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build`          -> regular static site in dist/ (relative paths, works on any static host)
// `npm run build:preview`  -> one self-contained HTML file in dist-preview/ (used for shareable previews)
// `npm run build:showcase` -> the shelf (showcase.html) as one self-contained file in dist-showcase/.
//                             The site build above never includes it.
export default defineConfig(({ mode }) => {
  const single = mode === 'singlefile';
  const showcase = mode === 'showcase';
  return {
    base: './',
    plugins: [react(), ...(single || showcase ? [viteSingleFile()] : [])],
    build: {
      outDir: showcase ? 'dist-showcase' : single ? 'dist-preview' : 'dist',
      target: 'es2022',
      chunkSizeWarningLimit: 2000,
      ...(showcase ? { rollupOptions: { input: 'showcase.html' } } : {}),
    },
    server: { host: true },
    // Dev harness pages import the same deps; scan them up front so Vite never re-optimises mid-session.
    optimizeDeps: { entries: ['index.html', 'showcase.html', 'dev/*.html'] },
  };
});
