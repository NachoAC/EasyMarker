// Renders the extension icons and the Chrome Web Store promo tile from inline SVG/HTML.
// Usage: npm run icons   (needs the Playwright Chromium: npx playwright install chromium)

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const ICONS_DIR = path.join(ROOT, 'extension', 'icons');
const STORE_DIR = path.join(ROOT, 'store');

// Artwork drawn on a 96×96 grid: rounded square + bookmark ribbon + check mark.
const ARTWORK = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6d63ff"/>
      <stop offset="1" stop-color="#4338ca"/>
    </linearGradient>
  </defs>
  <rect width="96" height="96" rx="24" fill="url(#bg)"/>
  <path d="M30 17h36a4 4 0 0 1 4 4v58L48 65 26 79V21a4 4 0 0 1 4-4z" fill="#fff"/>
  <path d="M37.5 40.5l7.5 7.5 14-15" fill="none" stroke="#4f46e5" stroke-width="7"
        stroke-linecap="round" stroke-linejoin="round"/>`;

/**
 * Chrome Web Store guidelines: the 128px icon is 96px of artwork with 16px of transparent
 * padding. Toolbar sizes use (almost) the whole canvas so they stay legible.
 */
function iconSvg(size) {
  const padding = size === 128 ? 16 : size * 0.03;
  const scale = (size - padding * 2) / 96;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <g transform="translate(${padding} ${padding}) scale(${scale})">${ARTWORK}</g>
  </svg>`;
}

const PROMO_TILE = `
  <div style="width:440px;height:280px;display:flex;align-items:center;gap:20px;padding:0 30px;
              box-sizing:border-box;background:linear-gradient(135deg,#f5f4ff,#e4e2ff);
              font-family:system-ui,'Segoe UI',Roboto,sans-serif;color:#1b1840">
    <svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">${ARTWORK}</svg>
    <div>
      <div style="font-size:36px;font-weight:700;letter-spacing:-0.02em">EasyMarker</div>
      <div style="margin-top:6px;font-size:16px;line-height:1.4;color:#4b4880">
        Marcadores siempre al día:<br>actualiza los que cambian,<br>borra los que ya no existen.
      </div>
    </div>
  </div>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await mkdir(ICONS_DIR, { recursive: true });
  await mkdir(STORE_DIR, { recursive: true });

  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0;background:transparent">${iconSvg(size)}</body>`);
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await writeFile(path.join(ICONS_DIR, `icon${size}.png`), png);
  }

  await page.setViewportSize({ width: 440, height: 280 });
  await page.setContent(`<body style="margin:0">${PROMO_TILE}</body>`);
  await writeFile(path.join(STORE_DIR, 'promo-small-440x280.png'), await page.screenshot());

  console.log('Icons written to extension/icons/, promo tile to store/');
} finally {
  await browser.close();
}
