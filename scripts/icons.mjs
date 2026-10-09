import sharp from "sharp";
import { mkdir } from "node:fs/promises";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#193f30"/><path d="M155 332V183l101 100 101-100v149" fill="none" stroke="#f0f6db" stroke-width="37" stroke-linejoin="round" stroke-linecap="round"/><circle cx="363" cy="126" r="16" fill="#cfdfac"/></svg>`;
await mkdir("public/icons", { recursive: true });
for (const [name, size] of [
  ["icon-192", 192],
  ["icon-512", 512],
  ["maskable-512", 512],
  ["apple-touch-icon", 180],
])
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(`public/icons/${name}.png`);
console.log("Generated four PWA icons.");
