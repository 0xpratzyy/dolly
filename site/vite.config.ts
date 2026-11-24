import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Subtle (caption engine + styles): the copy vendored in the studio, the same one the studio uses. Override with SUBTLE_DIR.
const subtle = path.resolve(process.env.SUBTLE_DIR ?? path.resolve(__dirname, '../studio/vendor/subtle'));
const nm = (p: string) => path.resolve(__dirname, 'node_modules', p);

export default defineConfig({
  plugins: [react()],
  resolve: {
    // The composition lives in ../studio/src and is imported as-is (never edited from here). One copy of react and
    // remotion, the site's, or the Player's timeline context breaks.
    alias: {
      '@studio': path.resolve(__dirname, '../studio/src'),
      '@subtle': path.join(subtle, 'template/src'),
      '@subtle-styles': path.join(subtle, 'styles'),
      '@demo': path.resolve(__dirname, '../studio/demo/refs-tour'),
      remotion: nm('remotion'),
      react: nm('react'),
      'react-dom': nm('react-dom'),
      '@remotion/layout-utils': nm('@remotion/layout-utils'),
    },
    dedupe: ['react', 'react-dom', 'remotion'],
  },
  server: {fs: {allow: [path.resolve(__dirname, '..'), subtle]}},
  build: {target: 'es2022', chunkSizeWarningLimit: 900},
});
