import convert from "heic-convert";

// ISOBMFF ("ftyp" box) brand codes used by HEIC/HEIF files — checked
// directly against the file's own bytes rather than trusted metadata.
// Browsers report wildly inconsistent (often empty) MIME types and
// extensions for HEIC uploads depending on OS and browser, so `file.type`
// alone can't be relied on to detect one.
const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1"]);

export function looksLikeHeic(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  if (buffer.toString("ascii", 4, 8) !== "ftyp") return false;
  return HEIC_BRANDS.has(buffer.toString("ascii", 8, 12));
}

export class HeicConversionError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "HeicConversionError";
  }
}

// 0.9: visually near-lossless, keeps the re-encoded JPEG well under the
// original HEIC's typical size rather than ballooning it.
const JPEG_QUALITY = 0.9;

export async function convertHeicToJpeg(buffer: Buffer): Promise<Buffer> {
  try {
    const output = await convert({ buffer, format: "JPEG", quality: JPEG_QUALITY });
    return Buffer.from(output);
  } catch (err) {
    throw new HeicConversionError("Could not convert this HEIC/HEIF photo.", err);
  }
}
