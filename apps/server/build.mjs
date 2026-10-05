// Bundles the server (dist/index.js) and its commands (dist/cli.js) with @agora/shared; npm deps stay external.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts', 'src/cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outdir: 'dist',
  sourcemap: true,
  plugins: [
    {
      name: 'externalize-npm',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) =>
          args.path.startsWith('@agora/') ? undefined : { path: args.path, external: true },
        );
      },
    },
  ],
});
console.log('server built');
