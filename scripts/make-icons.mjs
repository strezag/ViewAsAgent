#!/usr/bin/env node
/**
 * Generates the extension icons.
 *
 * The mark is two bars: a full-width one and a half-width one below it — the
 * page, and the part of it an agent actually receives. It has to survive being
 * 16 pixels wide in a toolbar, so it is two shapes and two colours, nothing
 * more. Rendered at 4x and box-downsampled for antialiasing.
 *
 *   npm run icons
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SIZES = [16, 32, 48, 128];
const OUT_DIR = join(process.cwd(), 'public', 'icon');
const SUPERSAMPLE = 4;

const BACKGROUND = [15, 23, 42, 255]; // slate-900
const FULL_BAR = [56, 189, 248, 255]; // sky-400
const SHORT_BAR = [251, 191, 36, 255]; // amber-400

// ---------------------------------------------------------------------------
// A very small RGBA canvas
// ---------------------------------------------------------------------------

function createCanvas(size) {
  return { size, data: new Uint8Array(size * size * 4) };
}

function setPixel(canvas, x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) return;
  const offset = (y * canvas.size + x) * 4;
  canvas.data[offset] = r;
  canvas.data[offset + 1] = g;
  canvas.data[offset + 2] = b;
  canvas.data[offset + 3] = a;
}

function fillRoundedRect(canvas, x0, y0, width, height, radius, color) {
  for (let y = Math.floor(y0); y < Math.ceil(y0 + height); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x0 + width); x++) {
      if (insideRoundedRect(x + 0.5, y + 0.5, x0, y0, width, height, radius)) {
        setPixel(canvas, x, y, color);
      }
    }
  }
}

function insideRoundedRect(px, py, x0, y0, width, height, radius) {
  const x1 = x0 + width;
  const y1 = y0 + height;
  if (px < x0 || px > x1 || py < y0 || py > y1) return false;

  const cx = Math.min(Math.max(px, x0 + radius), x1 - radius);
  const cy = Math.min(Math.max(py, y0 + radius), y1 - radius);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= radius * radius + 0.0001;
}

/** Average each SUPERSAMPLE x SUPERSAMPLE block down to one pixel. */
function downsample(canvas, factor) {
  const size = canvas.size / factor;
  const out = createCanvas(size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const offset = ((y * factor + sy) * canvas.size + (x * factor + sx)) * 4;
          const alpha = canvas.data[offset + 3];
          // Weight colour by alpha so transparent pixels do not darken edges.
          r += canvas.data[offset] * alpha;
          g += canvas.data[offset + 1] * alpha;
          b += canvas.data[offset + 2] * alpha;
          a += alpha;
        }
      }
      const weight = a || 1;
      const count = factor * factor;
      setPixel(out, x, y, [
        Math.round(r / weight),
        Math.round(g / weight),
        Math.round(b / weight),
        Math.round(a / count),
      ]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// PNG encoding
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(canvas) {
  const { size, data } = canvas;

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // colour type: RGBA
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  // Each scanline is prefixed with its filter byte; 0 means "no filter".
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    Buffer.from(data.buffer, y * size * 4, size * 4).copy(raw, rowStart + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// The mark
// ---------------------------------------------------------------------------

function drawIcon(size) {
  const scale = size * SUPERSAMPLE;
  const canvas = createCanvas(scale);
  const unit = scale / 16;

  fillRoundedRect(canvas, 0, 0, scale, scale, unit * 3.5, BACKGROUND);

  const barHeight = unit * 2;
  const left = unit * 3;
  const fullWidth = unit * 10;
  const radius = barHeight / 2;

  fillRoundedRect(canvas, left, unit * 4.5, fullWidth, barHeight, radius, FULL_BAR);
  fillRoundedRect(canvas, left, unit * 9.5, fullWidth * 0.5, barHeight, radius, SHORT_BAR);

  return downsample(canvas, SUPERSAMPLE);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const png = encodePng(drawIcon(size));
  const path = join(OUT_DIR, `${size}.png`);
  writeFileSync(path, png);
  console.log(`${path}  ${png.length} bytes`);
}
console.log('\nIcons written. Rebuild to pick them up.');
