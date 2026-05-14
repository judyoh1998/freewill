#!/usr/bin/env node
// One-time extractor: pulls transparent layer PNGs out of the Figma PDF.

import { PDFDocument, PDFName, PDFRawStream, PDFArray } from "pdf-lib";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import zlib from "node:zlib";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

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

function filterNames(stream) {
  const f = stream.dict.lookup(PDFName.of("Filter"));
  if (!f) return [];
  if (f instanceof PDFArray) {
    return f.array.map((n) => nameOf(n)).filter(Boolean);
  }
  const n = nameOf(f);
  return n ? [n] : [];
}

function isJPEG(bytes) {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function rgbaFromImage(streamBytes, filters, width, height) {
  // Try JPEG by filter name OR magic-byte sniff.
  if (filters.includes("DCTDecode") || isJPEG(streamBytes)) {
    const dec = jpeg.decode(streamBytes, { useTArray: true, formatAsRGBA: true });
    return Buffer.from(dec.data);
  }
  // Flate-decoded raw pixels.
  let raw = streamBytes;
  if (filters.includes("FlateDecode")) {
    try { raw = zlib.inflateSync(streamBytes); } catch { /* fall through */ }
  }
  const totalPx = width * height;
  if (raw.length === totalPx * 4) return Buffer.from(raw);
  if (raw.length === totalPx * 3) {
    const out = Buffer.alloc(totalPx * 4);
    for (let i = 0, j = 0; i < raw.length; i += 3, j += 4) {
      out[j]     = raw[i];
      out[j + 1] = raw[i + 1];
      out[j + 2] = raw[i + 2];
      out[j + 3] = 255;
    }
    return out;
  }
  if (raw.length === totalPx) {
    const out = Buffer.alloc(totalPx * 4);
    for (let i = 0, j = 0; i < raw.length; i++, j += 4) {
      out[j] = out[j + 1] = out[j + 2] = raw[i];
      out[j + 3] = 255;
    }
    return out;
  }
  return null;
}

function alphaFromMask(streamBytes, filters, width, height) {
  // Soft masks may also be DCTDecode (greyscale JPEG) or FlateDecode raw.
  if (filters.includes("DCTDecode") || isJPEG(streamBytes)) {
    const dec = jpeg.decode(streamBytes, { useTArray: true, formatAsRGBA: true });
    // R channel of decoded RGBA = luminance for grayscale JPEGs
    const out = Buffer.alloc(width * height);
    for (let i = 0; i < width * height; i++) out[i] = dec.data[i * 4];
    return out;
  }
  let raw = streamBytes;
  if (filters.includes("FlateDecode")) {
    try { raw = zlib.inflateSync(streamBytes); } catch { /* fall through */ }
  }
  if (raw.length === width * height) return Buffer.from(raw);
  return null;
}

async function main() {
  const pdfPath = process.argv[2] || path.join(REPO_ROOT, "design.pdf");
  try { await fs.access(pdfPath); }
  catch {
    console.error(`PDF not found: ${pdfPath}`);
    process.exit(1);
  }
  const bytes = await fs.readFile(pdfPath);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const outDir = path.join(REPO_ROOT, "assets");
  await fs.mkdir(outDir, { recursive: true });

  const seenDims = {};
  const writtenForName = new Set();
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
    if (!outName) continue;
    if (writtenForName.has(outName)) continue; // skip duplicates (page 2 etc)

    const streamBytes = Buffer.from(obj.contents);
    const filters = filterNames(obj);
    const rgba = rgbaFromImage(streamBytes, filters, width, height);
    if (!rgba) {
      console.warn(`skip ${outName}: couldn't decode (filters=${filters.join(",") || "none"}, ${streamBytes.length} bytes)`);
      continue;
    }

    const smaskNode = obj.dict.get(PDFName.of("SMask"));
    if (smaskNode) {
      const smaskStream = doc.context.lookup(smaskNode);
      if (smaskStream instanceof PDFRawStream) {
        const sw = smaskStream.dict.lookup(PDFName.of("Width")).numberValue;
        const sh = smaskStream.dict.lookup(PDFName.of("Height")).numberValue;
        if (sw === width && sh === height) {
          const sb = Buffer.from(smaskStream.contents);
          const sFilters = filterNames(smaskStream);
          const alpha = alphaFromMask(sb, sFilters, sw, sh);
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
    writtenForName.add(outName);
    written++;
  }

  console.log(`Done. ${written} layers written to ./assets/`);
}

main().catch((err) => { console.error(err); process.exit(1); });
