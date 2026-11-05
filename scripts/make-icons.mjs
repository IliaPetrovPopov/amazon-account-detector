// Draws the extension icon: a person on a Trackerbot-blue tile.
// Plain Node, no dependencies. Usage: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = 'static/icons';
const SAMPLES = 5;

const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
const TOP = hex('#2B87FF');
const BOTTOM = hex('#0057E6');
const WHITE = hex('#FFFFFF');

const mix = (a, b, t) => a.map((channel, i) => channel + (b[i] - channel) * t);

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function insideRoundedSquare(x, y, radius) {
  const dx = Math.max(radius - x, x - (1 - radius), 0);
  const dy = Math.max(radius - y, y - (1 - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
}

function insidePerson(x, y) {
  const head = (x - 0.5) ** 2 + (y - 0.365) ** 2 <= 0.148 ** 2;
  const shoulders = (x - 0.5) ** 2 / 0.29 ** 2 + (y - 0.875) ** 2 / 0.27 ** 2 <= 1 && y <= 0.79;
  return head || shoulders;
}

/** Colour of one sample point, or null outside the tile. */
function sample(x, y) {
  if (!insideRoundedSquare(x, y, 0.24)) return null;
  if (insidePerson(x, y)) return WHITE;
  return mix(TOP, BOTTOM, y);
}

function render(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let offset = 0;
  for (let py = 0; py < size; py += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let px = 0; px < size; px += 1) {
      const sum = [0, 0, 0];
      let covered = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const color = sample((px + (sx + 0.5) / SAMPLES) / size, (py + (sy + 0.5) / SAMPLES) / size);
          if (!color) continue;
          covered += 1;
          for (let channel = 0; channel < 3; channel += 1) sum[channel] += color[channel];
        }
      }
      for (let channel = 0; channel < 3; channel += 1) {
        raw[offset] = covered ? Math.round(sum[channel] / covered) : 0;
        offset += 1;
      }
      raw[offset] = Math.round((covered / (SAMPLES * SAMPLES)) * 255);
      offset += 1;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const size of [16, 32, 48, 128]) writeFileSync(`${OUT}/icon-${size}.png`, render(size));
console.log(`Icons written to ${OUT}`);
