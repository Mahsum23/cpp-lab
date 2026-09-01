#!/usr/bin/env node
/**
 * gen-icons.mjs — renders the app icon set from one vector definition.
 *
 * The mark is a terminal prompt: a chevron in the accent violet and a cursor bar in
 * the streak orange. Drawn as strokes rather than text on purpose — the SVG
 * rasteriser has no fonts to fall back on, so a glyph would render as nothing.
 *
 * Run: npm run icons   (only needed when the mark itself changes)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const BG = '#0e1116';
const VIOLET = '#8b6cff';
const ORANGE = '#ff8a3d';

/** @param {{rounded?: boolean, scale?: number}} opts */
const svg = ({ rounded = true, scale = 1 } = {}) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <radialGradient id="glow" cx="50%" cy="34%" r="70%">
      <stop offset="0%" stop-color="#241f42"/>
      <stop offset="100%" stop-color="${BG}"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="url(#glow)"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)"
     fill="none" stroke-width="46" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="162,178 244,256 162,334" stroke="${VIOLET}"/>
    <line x1="284" y1="334" x2="352" y2="334" stroke="${ORANGE}"/>
  </g>
</svg>`;

const targets = [
  { file: 'icon-192.png', size: 192, svg: svg() },
  { file: 'icon-512.png', size: 512, svg: svg() },
  // Full-bleed, content pulled into the safe circle Android's mask can crop to.
  { file: 'maskable-512.png', size: 512, svg: svg({ rounded: false, scale: 0.74 }) },
  // iOS applies its own rounding and puts black behind any transparency, so this
  // one must be an opaque square.
  { file: 'apple-touch-icon.png', size: 180, svg: svg({ rounded: false }) },
];

for (const t of targets) {
  await sharp(Buffer.from(t.svg)).resize(t.size, t.size).png({ compressionLevel: 9 }).toFile(join(outDir, t.file));
  console.log(`  ${t.file}  ${t.size}×${t.size}`);
}

writeFileSync(join(outDir, 'favicon.svg'), `${svg().trim()}\n`);
console.log('  favicon.svg');
