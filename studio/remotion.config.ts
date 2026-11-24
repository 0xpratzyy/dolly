// Remotion CLI config: lets the composition import Subtle's caption engine unchanged (alias @subtle -> subtle/template/src),
// the same way Subtle's own site does. One copy of react/remotion for both.
import {Config} from '@remotion/cli/config';
import path from 'node:path';

const here = process.cwd(); // the CLI runs from studio/ (dolly.mjs sets cwd)
// The vendored copy (studio/vendor/subtle) by default; set SUBTLE_DIR to use your own Subtle checkout.
const subtle = path.resolve(process.env.SUBTLE_DIR ?? path.join(here, 'vendor/subtle'));
const nm = (p: string) => path.join(here, 'node_modules', p);

Config.overrideWebpackConfig((c) => ({
  ...c,
  resolve: {
    ...c.resolve,
    alias: {
      ...(c.resolve?.alias as Record<string, string> | undefined),
      '@subtle': path.join(subtle, 'template/src'),
      remotion: nm('remotion'),
      react: nm('react'),
      'react-dom': nm('react-dom'),
      '@remotion/layout-utils': nm('@remotion/layout-utils'),
    },
  },
}));
