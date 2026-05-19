import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

function readRgbaAlphas(path: string): number[] {
  const data = readFileSync(path);
  let offset = 8;
  let width = 0;
  let height = 0;
  let idat = Buffer.alloc(0);

  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString("ascii");
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      expect(chunk[8]).toBe(8);
      expect(chunk[9]).toBe(6);
    }

    if (type === "IDAT") {
      idat = Buffer.concat([idat, chunk]);
    }
  }

  const bytes = inflateSync(idat);
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const alphas: number[] = [];
  let readOffset = 0;
  let previous = new Uint8Array(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = bytes[readOffset];
    readOffset += 1;
    const scanline = bytes.subarray(readOffset, readOffset + stride);
    readOffset += stride;
    const reconstructed = new Uint8Array(stride);

    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? reconstructed[x - bytesPerPixel] : 0;
      const up = previous[x];
      const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      let predictor = 0;

      if (filter === 1) {
        predictor = left;
      } else if (filter === 2) {
        predictor = up;
      } else if (filter === 3) {
        predictor = Math.floor((left + up) / 2);
      } else if (filter === 4) {
        const paeth = left + up - upLeft;
        const pa = Math.abs(paeth - left);
        const pb = Math.abs(paeth - up);
        const pc = Math.abs(paeth - upLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }

      reconstructed[x] = (scanline[x] + predictor) & 0xff;
    }

    for (let x = 3; x < stride; x += bytesPerPixel) {
      alphas.push(reconstructed[x]);
    }
    previous = reconstructed;
  }

  return alphas;
}

describe("tray icon asset", () => {
  it("is a real template mask with transparent and visible pixels", () => {
    const trayIconPath = fileURLToPath(new URL("../assets/icon/tray-template.png", import.meta.url));
    const alphas = readRgbaAlphas(trayIconPath);

    expect(alphas.some((alpha) => alpha === 0)).toBe(true);
    expect(alphas.some((alpha) => alpha > 0)).toBe(true);
    expect(alphas.every((alpha) => alpha === 255)).toBe(false);
  });
});
