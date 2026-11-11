/**
 * File type from magic bytes. The file name and the client's MIME type are
 * never trusted: they are set by the browser or by whoever sends the request.
 */

export type FileKind = "pdf" | "jpeg" | "png" | "webp";
export type ImageKind = Exclude<FileKind, "pdf">;

export const IMAGE_MIME: Record<ImageKind, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

function ascii(text: string): number[] {
  return [...text].map((c) => c.charCodeAt(0));
}

/**
 * Some PDF writers put a few bytes before `%PDF-`. The PDF spec lets readers
 * look for it in the first 1,024 bytes, and pdf.js does the same.
 */
function isPdf(bytes: Uint8Array): boolean {
  const sig = ascii("%PDF-");
  const limit = Math.min(bytes.length - sig.length, 1024);
  for (let i = 0; i <= limit; i++) {
    if (startsWith(bytes, sig, i)) return true;
  }
  return false;
}

export function detectFileType(bytes: Uint8Array): FileKind | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, PNG)) return "png";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "webp";
  if (isPdf(bytes)) return "pdf";
  return null;
}
