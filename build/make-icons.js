'use strict';
// Generates assets/icon.png (256), assets/tray.png (32) and assets/icon.ico
// without any external dependency: a battery glyph drawn into an RGBA buffer
// and encoded as PNG by hand.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- tiny rasteriser -------------------------------------------------------
function makeCanvas(size) {
  return { size, data: Buffer.alloc(size * size * 4, 0) };
}
function blend(c, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= c.size || y >= c.size) return;
  const i = (y * c.size + x) * 4;
  const da = c.data[i + 3] / 255;
  const na = a + da * (1 - a);
  if (na <= 0) return;
  c.data[i] = Math.round((r * a + c.data[i] * da * (1 - a)) / na);
  c.data[i + 1] = Math.round((g * a + c.data[i + 1] * da * (1 - a)) / na);
  c.data[i + 2] = Math.round((b * a + c.data[i + 2] * da * (1 - a)) / na);
  c.data[i + 3] = Math.round(na * 255);
}
// rounded rectangle with 4x supersampling for soft edges
function roundRect(c, x0, y0, w, h, rad, rgb, alpha = 1) {
  const ss = 4;
  for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) {
      let cover = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const px = x + (sx + 0.5) / ss, py = y + (sy + 0.5) / ss;
        if (px < x0 || py < y0 || px > x0 + w || py > y0 + h) continue;
        const cx = Math.max(x0 + rad, Math.min(px, x0 + w - rad));
        const cy = Math.max(y0 + rad, Math.min(py, y0 + h - rad));
        const dx = px - cx, dy = py - cy;
        if (dx * dx + dy * dy <= rad * rad) cover++;
      }
      if (cover) blend(c, x, y, rgb[0], rgb[1], rgb[2], alpha * cover / (ss * ss));
    }
  }
}

function drawIcon(size) {
  const c = makeCanvas(size);
  const u = size / 64;
  // background rounded square
  roundRect(c, 2 * u, 2 * u, 60 * u, 60 * u, 14 * u, [24, 27, 34], 1);
  // battery body
  roundRect(c, 10 * u, 20 * u, 40 * u, 24 * u, 5 * u, [232, 236, 240], 1);
  roundRect(c, 13 * u, 23 * u, 34 * u, 18 * u, 3 * u, [24, 27, 34], 1);
  // battery cap
  roundRect(c, 50 * u, 27 * u, 5 * u, 10 * u, 2 * u, [232, 236, 240], 1);
  // fill level (green)
  roundRect(c, 15 * u, 25 * u, 22 * u, 14 * u, 2.5 * u, [74, 222, 128], 1);
  // bluetooth-ish accent dot
  roundRect(c, 44 * u, 10 * u, 10 * u, 10 * u, 5 * u, [96, 165, 250], 1);
  return c;
}

function makeIco(pngBuffers) {
  // ICO container with PNG-compressed entries
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngBuffers.length, 4);
  const dir = [];
  let offset = 6 + 16 * pngBuffers.length;
  for (const { size, buf } of pngBuffers) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; e[1] = size >= 256 ? 0 : size;
    e[2] = 0; e[3] = 0;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8); e.writeUInt32LE(offset, 12);
    offset += buf.length;
    dir.push(e);
  }
  return Buffer.concat([header, ...dir, ...pngBuffers.map(p => p.buf)]);
}

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
const sizes = [16, 32, 48, 64, 128, 256];
const pngs = sizes.map(s => { const c = drawIcon(s); return { size: s, buf: encodePNG(s, s, c.data) }; });
fs.writeFileSync(path.join(out, 'icon.png'), pngs.find(p => p.size === 256).buf);
fs.writeFileSync(path.join(out, 'tray.png'), pngs.find(p => p.size === 32).buf);
fs.writeFileSync(path.join(out, 'tray@2x.png'), pngs.find(p => p.size === 64).buf);
fs.writeFileSync(path.join(out, 'icon.ico'), makeIco(pngs));
console.log('icons written to', out);
