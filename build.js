const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const DIST_DIR = path.join(__dirname, 'dist');

const nodeBuiltinStubs = {
  fs: 'export default {}',
  path: 'export default {}',
  os: 'export default {}',
  'node-pty': 'export default {}',
  electron: 'export default {}'
};

function copyHtmlEntries() {
  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'src', 'renderer', 'index.html'), path.join(DIST_DIR, 'index.html'));
  fs.copyFileSync(path.join(__dirname, 'src', 'preferences', 'preferences.html'), path.join(DIST_DIR, 'preferences.html'));
}

esbuild.build({
  entryPoints: ['src/renderer/renderer.js', 'src/preferences/preferences.js'],
  entryNames: '[name]',
  bundle: true,
  outdir: 'dist',
  platform: 'browser',
  format: 'iife',
  plugins: [
    {
      name: 'stub-node-builtins',
      setup(build) {
        for (const mod of Object.keys(nodeBuiltinStubs)) {
          build.onResolve({ filter: new RegExp('^' + mod + '$') }, () => ({
            path: mod,
            namespace: 'stub'
          }));
        }
        build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
          contents: nodeBuiltinStubs[args.path] || 'export default {}',
          loader: 'js'
        }));
      }
    }
  ]
}).then(() => {
  copyHtmlEntries();
  console.log('Built dist/renderer.js, dist/preferences.js, dist/index.html, and dist/preferences.html');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
