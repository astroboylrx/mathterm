const esbuild = require('esbuild');

const nodeBuiltinStubs = {
  fs: 'export default {}',
  path: 'export default {}',
  os: 'export default {}',
  'node-pty': 'export default {}',
  electron: 'export default {}'
};

esbuild.build({
  entryPoints: ['src/renderer.js', 'src/preferences.js'],
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
  console.log('Built dist/renderer.js and dist/preferences.js');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
