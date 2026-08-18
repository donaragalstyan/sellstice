import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalImageStorage } from "./local-image-storage";

// storageKey is never client-supplied in the running app (it only ever
// comes from a DB row written by save() itself), but read()/delete() guard
// against a malicious key regardless, as defense in depth. These tests
// exercise that guard directly with the kind of values an attacker would
// try if they ever did get to influence a storage key.
const storage = new LocalImageStorage();

test("read() rejects a storage key that escapes the upload root via ../", async () => {
  await assert.rejects(
    () => storage.read("../../../../etc/passwd"),
    /Invalid storage key/,
  );
});

test("read() rejects an absolute filesystem path", async () => {
  await assert.rejects(() => storage.read("/etc/passwd"), /Invalid storage key/);
});

test("delete() rejects a storage key that escapes the upload root via ../", async () => {
  await assert.rejects(
    () => storage.delete("uploads/itemA/../../../../etc/passwd"),
    /Invalid storage key/,
  );
});

test("read() rejects a traversal attempt disguised inside a plausible-looking key", async () => {
  await assert.rejects(
    () => storage.read("uploads/itemA/../../../secret.env"),
    /Invalid storage key/,
  );
});
