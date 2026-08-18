import { prisma } from "@/lib/prisma";
import { imageStorage } from "@/server/storage";
import { inferImageMediaType } from "@/server/storage/image-validation";

/**
 * Core authorization + serving logic for GET /api/photos/[id], factored out
 * of the route handler so it's directly testable without a running HTTP
 * server or a mocked auth() — callers pass the already-resolved session
 * user id (or null when unauthenticated) rather than this function deriving
 * it itself.
 *
 * Every failure path (missing session, unknown id, wrong owner, unreadable
 * file) returns the same generic 404 — deliberately not distinguishing
 * "doesn't exist" from "exists but isn't yours", matching how the rest of
 * the app treats cross-user access (see items/[id]/page.tsx's notFound()).
 */
export async function servePhotoResponse(
  photoId: string,
  userId: string | null,
): Promise<Response> {
  if (!userId) return notFound();

  const photo = await prisma.itemPhoto.findUnique({
    where: { id: photoId },
    include: { item: true },
  });
  if (!photo || photo.item.userId !== userId) return notFound();

  const mediaType = inferImageMediaType(photo.storageKey);
  if (!mediaType) return notFound();

  let buffer: Buffer;
  try {
    buffer = await imageStorage.read(photo.storageKey);
  } catch (err) {
    console.error("Failed to read stored photo", photoId, err);
    return notFound();
  }

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": mediaType,
      // Per-user content behind auth — never let a shared/proxy cache serve
      // one user's photo bytes to another user's request for the same URL.
      "Cache-Control": "private, no-store",
    },
  });
}

function notFound(): Response {
  return new Response(null, { status: 404 });
}
