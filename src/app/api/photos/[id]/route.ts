import { auth } from "@/lib/auth";
import { servePhotoResponse } from "@/server/storage/serve-photo";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const session = await auth();
  return servePhotoResponse(id, session?.user?.id ?? null);
}
