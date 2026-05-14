#!/usr/bin/env node
// One-time extractor: pulls transparent layer PNGs out of the Figma PDF.
//
// Usage:
//   1. Save your Figma PDF as ./design.pdf (or pass a path).
//   2. From the repo root: `npm install && npm run extract`
//   3. The 7 layered PNGs land in ./assets/.

import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import zlib from "node:zlib";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

// (width x height) → output filename. 360x360 is ambiguous — disambiguated
// by encounter order on page 1 of the Figma export (hat appears before bow).
const BY_DIMS = {
  "194x230":  "head-2.png",
  "821x1192": "head-1.png",
  "755x350":  "glasses.png",
  "512x512":  "head-3.png",
  "783x1068": "head-4.png",
};

function nameOf(node) {
  if (!node) return null;
  if (typeof node.encodedName === "string") return node.encodedName.replace(/^\//, "");
  return null;
}

function decodeStream(stream) {
  const filter = stream.dict.lookup(PDFName.of("Filter"));
  const raw = stream.contents;
  const filterName = nameOf(filter);
  if (filterName === "DCTDecode") {
    // JPEG-encoded
    return { kind: "jpeg", bytes: Buffer.from(raw) };
  }
  if (filterName === "FlateDecode") {
    return { kind: "raw", bytes: zlib.inflateSync(Buffer.from(raw)) };
  }
  if (!filterName) {
    return { kind: "raw", bytes: Buffer.from(raw) };
  }
  return { kind: filterName, bytes: Buffer.from(raw) };
}

function rgbaFromImage(decoded, width, height) {
  if (decoded.kind === "jpeg") {
    const dec = jpeg.decode(decoded.bytes, { useTArray: true, formatAsRGBA: true });
    return Buffer.from(dec.data); // RGBA
  }
  if (decoded.kind === "raw") {
    // Likely 3-channel RGB
    const expected = width * height * 3;
    if (decoded.bytes.length === expected) {
      const out = Buffer.alloc(width * height * 4);
      for (let i = 0, j = 0; i < decoded.bytes.length; i += 3, j += 4) {
        out[j]     = decoded.bytes[i];
        out[j + 1] = decoded.bytes[i + 1];
        out[j + 2] = decoded.bytes[i + 2];
        out[j + 3] = 255;
      }
      return out;
    }
    // 4-channel
    if (decoded.bytes.length === width * height * 4) return decoded.bytes;
    // 1-channel grayscale
    if (decoded.bytes.length === width * height) {
      const out = Buffer.alloc(width * height * 4);
      for (let i = 0, j = 0; i < decoded.bytes.length; i++, j += 4) {
        out[j] = out[j + 1] = out[j + 2] = decoded.bytes[i];
        out[j + 3] = 255;
      }
      return out;
    }
  }
  return null;
}

function alphaFromMask(decoded, width, height) {
  if (decoded.kind === "raw") {
    if (decoded.bytes.length === width * height) return decoded.bytes;
  }
  if (decoded.kind === "jpeg") {
    const dec = jpeg.decode(decoded.bytes, { useTArray: true, formatAsRGBA: false });
    // jpeg-js returns RGB for grayscale-source — take R channel as alpha
    const out = Buffer.alloc(width * height);
    for (let i = 0, j = 0; i < dec.data.length; i += dec.data.length / (width * height), j++) {
      out[j] = dec.data[Math.floor(i)];
    }
    return out;
  }
  return null;
}

async function main() {
  const pdfPath = process.argv[2] || path.join(REPO_ROOT, "design.pdf");
  try { await fs.access(pdfPath); }
  catch {
    console.error(`PDF not found: ${pdfPath}`);
    console.error("Put your Figma PDF at ./design.pdf or pass a path:");
    console.error("  node scripts/extract-from-pdf.mjs /path/to/design.pdf");
    process.exit(1);
  }

  const bytes = await fs.readFile(pdfPath);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const outDir = path.join(REPO_ROOT, "assets");
  await fs.mkdir(outDir, { recursive: true });

  const seenDims = {};
  let written = 0;

  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const subtype = nameOf(obj.dict.lookup(PDFName.of("Subtype")));
    if (subtype !== "Image") continue;

    const widthNode = obj.dict.lookup(PDFName.of("Width"));
    const heightNode = obj.dict.lookup(PDFName.of("Height"));
    if (!widthNode || !heightNode) continue;
    const width = widthNode.numberValue;
    const height = heightNode.numberValue;
    const key = `${width}x${height}`;

    let outName = BY_DIMS[key];
    if (key === "360x360") {
      const idx = seenDims[key] || 0;
      outName = idx === 0 ? "hat.png" : "bow.png";
      seenDims[key] = idx + 1;
    }
    if (!outName) {
      // Skip images we don't recognize (e.g. SMasks themselves)
      continue;
    }

    const decoded = decodeStream(obj);
    const rgba = rgbaFromImage(decoded, width, height);
    if (!rgba) {
      console.warn(`skip ${outName}: couldn't decode (${decoded.kind}, ${decoded.bytes.length} bytes)`);
      continue;
    }

    // Optional soft mask (alpha)
    const smaskNode = obj.dict.get(PDFName.of("SMask"));
    if (smaskNode) {
      const smaskStream = doc.context.lookup(smaskNode);
      if (smaskStream instanceof PDFRawStream) {
        const sw = smaskStream.dict.lookup(PDFName.of("Width")).numberValue;
        const sh = smaskStream.dict.lookup(PDFName.of("Height")).numberValue;
        if (sw === width && sh === height) {
          const sdec = decodeStream(smaskStream);
          const alpha = alphaFromMask(sdec, width, height);
          if (alpha) {
            for (let i = 0; i < width * height; i++) rgba[i * 4 + 3] = alpha[i];
          }
        }
      }
    }

    const png = new PNG({ width, height });
    png.data = rgba;
    await fs.writeFile(path.join(outDir, outName), PNG.sync.write(png));
    console.log(`wrote ${outName}  (${width}x${height})`);
    written++;
  }

  console.log(`Done. ${written} layers written to ./assets/`);
}

main().catch((err) => { console.error(err); process.exit(1); });
