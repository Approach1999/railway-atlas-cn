import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // The client embeds the region registry at build time; the dev server may read that one directory.
    fs: {allow: ['..', '../../../config']},
    proxy: Object.fromEntries(
      ['/dataset.json', '/palette.json', '/stations.geojson', '/lines.json', '/objects.json', '/catalog.json', '/snapshots', '/tiles', '/details', '/basemap.json']
        .map(path => [path, 'http://127.0.0.1:8766']),
    ),
  },
  build: {target: 'es2022'},
});
