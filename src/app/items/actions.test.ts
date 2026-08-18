import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { imageStorage } from "@/server/storage";
import { deleteItemForUser, deletePhotoForUser } from "./actions";

// Cross-user regression coverage for the two highest-impact mutations
// audited for IDOR/BOLA: permanent item/photo deletion. Both are tested via
// their extracted *ForUser cores (see actions.ts) so the unauthorized path
// can be exercised directly with an explicit attacker userId, without
// mocking next-auth or Next's request/navigation context.
const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

let userA: { id: string };
let userB: { id: string };

before(async () => {
  userA = await prisma.user.create({
    data: { email: `items-actions-test-a-${runId}@example.test`, passwordHash: "unused" },
  });
  userB = await prisma.user.create({
    data: { email: `items-actions-test-b-${runId}@example.test`, passwordHash: "unused" },
  });
});

after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
});

test("deleteItemForUser: a different user cannot delete another user's item", async () => {
  const item = await prisma.item.create({ data: { userId: userA.id, brand: "Untouched" } });

  const deleted = await deleteItemForUser(item.id, userB.id);
  assert.equal(deleted, false);

  const stillThere = await prisma.item.findUnique({ where: { id: item.id } });
  assert.ok(stillThere, "item must still exist after a cross-user delete attempt");
  assert.equal(stillThere?.brand, "Untouched");

  await prisma.item.delete({ where: { id: item.id } });
});

test("deleteItemForUser: the owner can delete their own item", async () => {
  const item = await prisma.item.create({ data: { userId: userA.id } });

  const deleted = await deleteItemForUser(item.id, userA.id);
  assert.equal(deleted, true);

  const gone = await prisma.item.findUnique({ where: { id: item.id } });
  assert.equal(gone, null);
});

test("deletePhotoForUser: a different user cannot delete another user's photo", async () => {
  const item = await prisma.item.create({ data: { userId: userA.id } });
  const saved = await imageStorage.save({
    buffer: Buffer.from("fake-jpeg-bytes"),
    contentType: "image/jpeg",
    folder: item.id,
  });
  const photo = await prisma.itemPhoto.create({
    data: { itemId: item.id, storageKey: saved.storageKey, order: 0 },
  });

  const deletedFromItemId = await deletePhotoForUser(photo.id, userB.id);
  assert.equal(deletedFromItemId, null);

  const stillThere = await prisma.itemPhoto.findUnique({ where: { id: photo.id } });
  assert.ok(stillThere, "photo row must still exist after a cross-user delete attempt");

  await prisma.item.delete({ where: { id: item.id } }); // cascades the photo row
  await imageStorage.delete(saved.storageKey);
});

test("deletePhotoForUser: the owner can delete their own photo", async () => {
  const item = await prisma.item.create({ data: { userId: userA.id } });
  const saved = await imageStorage.save({
    buffer: Buffer.from("fake-jpeg-bytes"),
    contentType: "image/jpeg",
    folder: item.id,
  });
  const photo = await prisma.itemPhoto.create({
    data: { itemId: item.id, storageKey: saved.storageKey, order: 0 },
  });

  const deletedFromItemId = await deletePhotoForUser(photo.id, userA.id);
  assert.equal(deletedFromItemId, item.id);

  const gone = await prisma.itemPhoto.findUnique({ where: { id: photo.id } });
  assert.equal(gone, null);

  await prisma.item.delete({ where: { id: item.id } });
});
