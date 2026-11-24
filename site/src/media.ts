import manifest from './media-manifest.json';

/** URL of a file under public/ with its content hash, so a changed clip never hides behind the browser's cache (scripts/media-manifest.mjs writes the hashes). */
export const media = (p: string): string => `/${p}?v=${(manifest as Record<string, string>)[p] ?? '0'}`;
