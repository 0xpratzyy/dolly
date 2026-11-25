// Writes src/media-manifest.json: a short content hash for every file under public/spot, public/narrate, public/hero, public/hero/looks and public/bento (used as ?v= by src/media.ts).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = {};
for (const dir of ['spot', 'narrate', 'hero', 'hero/looks', 'bento']) {
  const d = path.join(root, 'public', dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d).sort()) if (fs.statSync(path.join(d, f)).isFile()) out[`${dir}/${f}`] = crypto.createHash('sha1').update(fs.readFileSync(path.join(d, f))).digest('hex').slice(0, 8);
}
const file = path.join(root, 'src', 'media-manifest.json');
const next = JSON.stringify(out, null, 1) + '\n';
if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== next) fs.writeFileSync(file, next);

// the hero poster is preloaded from index.html, so its URL there carries the same hash
const html = path.join(root, 'index.html');
if (fs.existsSync(html) && out['hero/poster-record.jpg']) {
  const cur = fs.readFileSync(html, 'utf8');
  const nextHtml = cur.replace(/(<link rel="preload" as="image" href="\/hero\/poster-record\.jpg\?v=)[^"]*(")/, `$1${out['hero/poster-record.jpg']}$2`);
  if (nextHtml !== cur) fs.writeFileSync(html, nextHtml);
}
