import { FRAME_SAMPLING_LIMITS } from "../model.ts";
import { FrameDecoderFailure } from "./decoder.ts";
import { inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export class BoundedRgbPngFailure extends Error {
  readonly reason: "invalid_png" | "dimensions_exceeded";

  constructor(reason: "invalid_png" | "dimensions_exceeded", message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BoundedRgbPngFailure";
    this.reason = reason;
  }
}

export interface BoundedRgbPngLimits {
  maxWidthPx: number;
  maxHeightPx: number;
  maxPixels: number;
}

export interface DecodedBoundedRgbPng {
  width: number;
  height: number;
  /** Ordered row-major RGB24 bytes after PNG scanline filters are reversed. */
  pixels: Buffer;
}

function paeth(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

/** Shared bounded RGB PNG decoder. Domain wrappers retain their own failure vocabulary. */
export function decodeBoundedRgbPng(
  bytes: Buffer,
  limits: BoundedRgbPngLimits,
): DecodedBoundedRgbPng {
  if (
    bytes.length < 57 ||
    !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
  ) {
    throw new BoundedRgbPngFailure("invalid_png", "Stored image is not an 8-bit RGB PNG");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let sawHeader = false;
  let sawEnd = false;
  const imageData: Buffer[] = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new BoundedRgbPngFailure("invalid_png", "Stored PNG has a truncated chunk");
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (!Number.isSafeInteger(end) || end > bytes.length) {
      throw new BoundedRgbPngFailure("invalid_png", "Stored PNG chunk exceeds its content envelope");
    }
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const typedData = bytes.subarray(offset + 4, offset + 8 + length);
    if (crc32(typedData) !== bytes.readUInt32BE(offset + 8 + length)) {
      throw new BoundedRgbPngFailure("invalid_png", "Stored PNG chunk failed CRC verification");
    }
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (!sawHeader) {
      if (
        type !== "IHDR" || length !== 13 ||
        data[8] !== 8 || data[9] !== 2 ||
        data[10] !== 0 || data[11] !== 0 || data[12] !== 0
      ) {
        throw new BoundedRgbPngFailure("invalid_png", "Stored image is not a non-interlaced 8-bit RGB PNG");
      }
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      sawHeader = true;
    } else if (type === "IHDR") {
      throw new BoundedRgbPngFailure("invalid_png", "Stored PNG repeats its header");
    }
    if (type === "IDAT") imageData.push(data);
    if (type === "IEND") {
      if (length !== 0 || end !== bytes.length) {
        throw new BoundedRgbPngFailure("invalid_png", "Stored PNG has an invalid terminal chunk");
      }
      sawEnd = true;
    }
    offset = end;
  }
  if (
    !sawHeader || !sawEnd || imageData.length === 0 ||
    width < 1 || height < 1 ||
    width > limits.maxWidthPx ||
    height > limits.maxHeightPx ||
    width * height > limits.maxPixels
  ) {
    throw new BoundedRgbPngFailure("dimensions_exceeded", "Stored image exceeds output dimension limits");
  }
  const expectedRawBytes = height * (1 + width * 3);
  let pixels: Buffer;
  try {
    pixels = inflateSync(Buffer.concat(imageData), { maxOutputLength: expectedRawBytes });
  } catch (cause) {
    throw new BoundedRgbPngFailure("invalid_png", "Stored PNG pixel stream failed bounded decompression", { cause });
  }
  if (pixels.length !== expectedRawBytes) {
    throw new BoundedRgbPngFailure("invalid_png", "Stored PNG pixel stream has the wrong RGB24 size");
  }
  const pixelRowBytes = width * 3;
  const rowBytes = 1 + pixelRowBytes;
  const decoded = Buffer.allocUnsafe(height * pixelRowBytes);
  for (let row = 0; row < height; row += 1) {
    const filter = pixels[row * rowBytes];
    if (filter > 4) {
      throw new BoundedRgbPngFailure("invalid_png", "Stored PNG uses an invalid scanline filter");
    }
    const encodedOffset = row * rowBytes + 1;
    const decodedOffset = row * pixelRowBytes;
    const priorOffset = decodedOffset - pixelRowBytes;
    for (let column = 0; column < pixelRowBytes; column += 1) {
      const encoded = pixels[encodedOffset + column];
      const left = column >= 3 ? decoded[decodedOffset + column - 3] : 0;
      const above = row > 0 ? decoded[priorOffset + column] : 0;
      const upperLeft = row > 0 && column >= 3 ? decoded[priorOffset + column - 3] : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? above
            : filter === 3 ? Math.floor((left + above) / 2)
              : paeth(left, above, upperLeft);
      decoded[decodedOffset + column] = (encoded + predictor) & 0xff;
    }
  }
  return { width, height, pixels: decoded };
}

/** Shared bounded RGB PNG verifier. Domain wrappers retain their own failure vocabulary. */
export function inspectBoundedRgbPng(
  bytes: Buffer,
  limits: BoundedRgbPngLimits,
): { width: number; height: number } {
  const { width, height } = decodeBoundedRgbPng(bytes, limits);
  return { width, height };
}

export function inspectRgbPng(bytes: Buffer): { width: number; height: number } {
  try {
    return inspectBoundedRgbPng(bytes, {
      maxWidthPx: FRAME_SAMPLING_LIMITS.maxOutputWidthPx,
      maxHeightPx: FRAME_SAMPLING_LIMITS.maxOutputHeightPx,
      maxPixels: FRAME_SAMPLING_LIMITS.maxOutputPixels,
    });
  } catch (cause) {
    if (cause instanceof BoundedRgbPngFailure) {
      throw new FrameDecoderFailure(
        cause.reason === "dimensions_exceeded" ? "decoded_frame_oversized" : "decoder_failed",
        cause.message.replace("Stored image", "Stored frame"),
        { cause },
      );
    }
    throw cause;
  }
}
