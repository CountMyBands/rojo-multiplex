import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pngToIco from "png-to-ico";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "electron", "assets");
const source = path.join(output, "icon-source.png");

await fs.mkdir(output, { recursive: true });
await sharp(source).resize(256, 256, { kernel: "lanczos3" }).png().toFile(path.join(output, "icon.png"));
const icoPngs = [];
for (const size of [16, 24, 32, 48, 64, 128, 256]) {
  const destination = path.join(output, `icon-${size}.png`);
  await sharp(source).resize(size, size, { kernel: "lanczos3" }).png().toFile(destination);
  icoPngs.push(destination);
}
await fs.writeFile(path.join(output, "icon.ico"), await pngToIco(icoPngs));
console.log(`Generated Rojo Multiplex icons in ${output}`);
