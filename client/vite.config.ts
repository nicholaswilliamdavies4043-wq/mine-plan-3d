import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Writes precache-manifest.json (every built file) for the offline service worker. */
function precacheManifest(): Plugin {
  return {
    name: 'mineplan-precache-manifest',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map')).map((f) => '/' + f);
      this.emitFile({ type: 'asset', fileName: 'precache-manifest.json', source: JSON.stringify({ files, built: new Date().toISOString() }) });
    },
    writeBundle(opts) {
      // stamp the service worker with a build id so browsers pick up the new app shell
      const sw = path.join(opts.dir ?? 'dist', 'sw.js');
      if (fs.existsSync(sw)) fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace("const VERSION = 'dev';", `const VERSION = '${Date.now().toString(36)}';`));
    },
  };
}

const rootPkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')) as { version: string };

export default defineConfig({
  plugins: [react(), precacheManifest()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000' },
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
});
