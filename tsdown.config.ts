import { defineConfig } from 'tsdown';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  entry: ['src/index.ts', 'src/jq/index.ts', 'src/overlay/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  define: {
    __PACKAGE_VERSION__: JSON.stringify(pkg.version),
  },
});
