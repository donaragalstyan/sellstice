import { test } from "node:test";
import assert from "node:assert/strict";
import { looksLikeHeic, convertHeicToJpeg, HeicConversionError } from "./heic";

function ftypBuffer(brand: string, extra: number[] = []): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt32BE(0, 0); // box size, irrelevant to the check
  header.write("ftyp", 4, "ascii");
  header.write(brand, 8, "ascii");
  return Buffer.concat([header, Buffer.from(extra)]);
}

// --- looksLikeHeic -------------------------------------------------------

test("looksLikeHeic recognizes a standard heic brand", () => {
  assert.equal(looksLikeHeic(ftypBuffer("heic")), true);
});

test("looksLikeHeic recognizes other real-world HEIF brand codes", () => {
  for (const brand of ["heix", "hevc", "mif1", "msf1"]) {
    assert.equal(looksLikeHeic(ftypBuffer(brand)), true, brand);
  }
});

test("looksLikeHeic rejects a JPEG's magic bytes", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(looksLikeHeic(jpeg), false);
});

test("looksLikeHeic rejects an unrelated ISOBMFF brand (e.g. a plain MP4)", () => {
  assert.equal(looksLikeHeic(ftypBuffer("isom")), false);
});

test("looksLikeHeic rejects a buffer too short to contain a ftyp box", () => {
  assert.equal(looksLikeHeic(Buffer.from([0, 1, 2])), false);
});

// --- convertHeicToJpeg -----------------------------------------------------

test("convertHeicToJpeg wraps a decode failure in HeicConversionError", async () => {
  const garbage = ftypBuffer("heic", [1, 2, 3, 4, 5]);
  await assert.rejects(() => convertHeicToJpeg(garbage), HeicConversionError);
});
