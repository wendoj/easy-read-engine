// No `runtime` export: Cache Components runs route handlers on Node.js and rejects the segment option.
// The key and the cookie are never logged.
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
