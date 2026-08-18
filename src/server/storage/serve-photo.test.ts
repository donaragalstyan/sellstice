import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { imageStorage } from "@/server/storage";
import { servePhotoResponse } from "./serve-photo";

// Integration coverage for the authorization gap the security audit found:
// uploaded photos used to be served as static files with no auth check at
// all. These tests exercise servePhotoResponse against the real dev
// database with two throwaway users, standing in for User A/User B from
// the audit, and clean up everything they create.
const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

let userA: { id: string };
let userB: { id: string };
let itemA: { id: string };
let photoA: { id: string; storageKey: string };

before(async () => {
  userA = await prisma.user.create({
    data: { email: `serve-photo-test-a-${runId}@example.test`, passwordHash: "unused" },
  });
  userB = await prisma.user.create({
    data: { email: `serve-photo-test-b-${runId}@example.test`, passwordHash: "unused" },
  });
  itemA = await prisma.item.create({ data: { userId: userA.id } });

  const saved = await imageStorage.save({
    buffer: Buffer.from("fake-jpeg-bytes"),
    contentType: "image/jpeg",
    folder: itemA.id,
  });
  const photo = await prisma.itemPhoto.create({
    data: { itemId: itemA.id, storageKey: saved.storageKey, order: 0 },
  });
  photoA = { id: photo.id, storageKey: photo.storageKey };
});

after(async () => {
  await imageStorage.delete(photoA.storageKey);
  // Cascades away Item + ItemPhoto for both users; nothing else was created.
  await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
});

test("the owning user can retrieve their own photo", async () => {
  const res = await servePhotoResponse(photoA.id, userA.id);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/jpeg");
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(bytes.toString(), "fake-jpeg-bytes");
});

test("a different authenticated user is denied (cross-user access)", async () => {
  const res = await servePhotoResponse(photoA.id, userB.id);
  assert.equal(res.status, 404);
});

test("an unauthenticated request (no session) is denied", async () => {
  const res = await servePhotoResponse(photoA.id, null);
  assert.equal(res.status, 404);
});

test("a nonexistent photo id is denied", async () => {
  const res = await servePhotoResponse("does-not-exist", userA.id);
  assert.equal(res.status, 404);
});

test("a path-traversal-shaped id is denied without ever touching the filesystem", async () => {
  const res = await servePhotoResponse("../../../../etc/passwd", userA.id);
  assert.equal(res.status, 404);
});
