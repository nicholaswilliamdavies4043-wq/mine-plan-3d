/**
 * Renders the PNG app icons in public/icons from the Portal logo geometry.
 * Run from the repository root after changing the logo:  node client/scripts/render-icons.cjs
 * (needs Playwright with Chromium).
 */
const path = require('path');
const { chromium } = require('playwright');

const OUTER = 'M128 392 V262 A128 128 0 0 1 384 262 V392 Z';
const OPENING = 'M238 392 V300 A52 52 0 0 1 342 300 V392 Z';
const TILE = '#eef2f8', INK = '#15202f';
/** rounded: tile with corners (any-purpose icons); maskable: full bleed, mark inside the 80% safe zone. */
const svg = (rounded, maskable) => {
  const s = maskable ? 0.72 : 1, o = (512 - 512 * s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
    <rect width="512" height="512" rx="${rounded ? 118 : 0}" fill="${TILE}"/>
    <g transform="translate(${o} ${o + (maskable ? 8 : 0)}) scale(${s})">
      <path d="${OUTER}" fill="${INK}" stroke="${INK}" stroke-width="28" stroke-linejoin="round"/>
      <path d="${OPENING}" fill="${TILE}"/></g></svg>`;
};
const out = path.join(__dirname, '..', 'public', 'icons');
const jobs = [
  ['icon-192.png', 192, true, false], ['icon-512.png', 512, true, false],
  ['maskable-512.png', 512, false, true], ['apple-touch-icon.png', 180, false, true], ['favicon-32.png', 32, true, false],
];
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [name, size, rounded, maskable] of jobs) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg(rounded, maskable)}`);
    await page.screenshot({ path: path.join(out, name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log('wrote', name);
  }
  await browser.close();
})();
