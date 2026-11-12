/**
 * /api/access: the judge access key (design "Protecting the live quota").
 * GET reports the access state, POST checks a key and sets the access cookie,
 * DELETE clears it. All logic is in `src/access`. The key is never logged.
 *
 * GET reads the request's `Cookie` header, so under Cache Components it runs
 * at request time and is never prerendered.
 *
 * No `runtime` export: Cache Components runs route handlers on Node.js and
 * rejects the segment option (see app/api/check/route.ts).
 */
import { handleAccessDelete, handleAccessGet, handleAccessPost } from "@/src/access";

export function GET(request: Request): Response {
  return handleAccessGet(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleAccessPost(request);
}

export function DELETE(request: Request): Response {
  return handleAccessDelete(request);
}
