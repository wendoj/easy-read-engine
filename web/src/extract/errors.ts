/**
 * Error codes, HTTP statuses and plain messages for `/api/extract`
 * (design "Web route handlers" and "Error Handling"). Messages are fixed text
 * and never include anything from the uploaded file.
 */

export type ExtractErrorCode =
  | "invalid_request"
  | "unsupported_type"
  | "too_large"
  | "too_many_pages"
  | "no_text_layer"
  | "handwriting"
  | "unreadable"
  | "model_output_invalid"
  | "providers_unavailable";

/** Largest file accepted. Matches Next.js's default buffered body size and keeps base64 images under Groq's 20 MB request limit. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Letters are 1 to 2 pages. The 1,500-word limit (R1.7) is applied later, at convert. */
export const MAX_PDF_PAGES = 10;

export const EXTRACT_ERRORS: Record<ExtractErrorCode, { status: number; message: string }> = {
  invalid_request: {
    status: 400,
    message: "Send 1 file in a form field called file.",
  },
  unsupported_type: {
    status: 400,
    message: "This type of file can't be read. Upload a PDF, or a photo saved as JPEG, PNG or WebP.",
  },
  too_large: {
    status: 413,
    message: "This file is too big. Upload a file smaller than 10 MB.",
  },
  too_many_pages: {
    status: 400,
    message: `This PDF has more than ${MAX_PDF_PAGES} pages. Upload only the pages of the letter.`,
  },
  no_text_layer: {
    status: 422,
    message:
      "This PDF is a scan, so it has no text to copy. Take a photo of each page and upload the photo, or paste the text.",
  },
  handwriting: {
    status: 422,
    message: "This letter is handwritten. Handwritten letters can't be read yet. You can type or paste the text.",
  },
  unreadable: {
    status: 422,
    message: "The text in this file can't be read. Upload a clearer photo, or paste the text.",
  },
  model_output_invalid: {
    status: 502,
    message: "Reading the photo went wrong. Try again in a minute.",
  },
  providers_unavailable: {
    status: 503,
    message: "The service that reads photos is busy. Try again in a few minutes, or paste the text.",
  },
};
