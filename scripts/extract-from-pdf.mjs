#!/usr/bin/env node
// One-time extractor: pulls the transparent layer PNGs out of the Figma PDF.
//
// Usage:
//   1. Put your Figma PDF export next to this repo (default: ./design.pdf,
//      or pass any path as the first arg).
//   2. From the repo root: `npm install && npm run extract`
//   3. The 7 layered PNGs land in ./assets/.
//
// Then run the app — the head stacks will pick them up automatically.

import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { PNG } from "pngjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

// PDF page-1 image dimensions (extracted ahead of time) → output filename.
// 360x360 is ambiguous (hat + bow) — disambiguated by order of appearance.
const BY_DIMS = {
  "194x230":  "head-2.png",   // Kierkegaard, bare face
  "821x1192": "head-1.png",   // Beauvoir, bare face
  "755x350":  "glasses.png",
  "512x512":  "head-3.png",   // lightbulb
  "783x1068": "head-4.png",   // Sartre, bare face
};

async function main() {
  const pdfPath = process.argv[2] || path.join(REPO_ROOT, "design.pdf");

  try {
    await fs.access(pdfPath);
  } catch {
    console.error(`PDF not found: ${pdfPath}`);
    console.error("Put your Figma PDF at ./design.pdf or pass a path:");
    console.error("  node scripts/extract-from-pdf.mjs /path/to/design.pdf");
    process.exit(1);
  }

  const buf = await fs.readFile(pdfPath);
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const page = await pdf.getPage(1);
  const opList = await page.getOperatorList();
  const OPS = pdfjsLib.OPS;

  const outDir = path.join(REPO_ROOT, "assets");
  await fs.mkdir(outDir, { recursive: true });

  let smallSquareCount = 0;

  for (let i = 0; i < opList.fnArray.length; i++) {
    if (opList.fnArray[i] !== OPS.paintImageXObject) continue;
    const name = opList.argsArray[i][0];
    if (!page.objs.has(name)) continue;

    const img = await new Promise((resolve) =>
      page.objs.get(name, resolve)
    );
    const { width, height, data } = img;
    const key = `${width}x${height}`;
    let outName = BY_DIMS[key];

    if (key === "360x360") {
      // First 360x360 is the party hat, second is the bow (order on page 1).
      outName = smallSquareCount === 0 ? "hat.png" : "bow.png";
      smallSquareCount += 1;
    }
    if (!outName) continue;

    // pdfjs-dist returns RGBA Uint8ClampedArray for compositied transparent images.
    if (data.length !== width * height * 4) {
      console.warn(`skipping ${outName}: unexpected channel layout (${data.length} bytes)`);
      continue;
    }

    const png = new PNG({ width, height });
    png.data = Buffer.from(data);
    const outPath = path.join(outDir, outName);
    await fs.writeFile(outPath, PNG.sync.write(png));
    console.log(`wrote ${outName} (${width}x${height})`);
  }

  console.log("Done. Layered PNGs are in ./assets/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
