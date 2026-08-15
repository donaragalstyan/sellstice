import { test } from "node:test";
import assert from "node:assert/strict";
import { isFetchableUrl } from "./url-safety";

async function expectSafe(url: string) {
  const result = await isFetchableUrl(url, async () => [{ address: "93.184.216.34", family: 4 }]);
  assert.equal(result.safe, true, `expected ${url} to be safe: ${JSON.stringify(result)}`);
}

async function expectBlocked(url: string, lookup?: Parameters<typeof isFetchableUrl>[1]) {
  const result = await isFetchableUrl(url, lookup);
  assert.equal(result.safe, false, `expected ${url} to be blocked`);
}

// --- Protocol / port -------------------------------------------------------

test("rejects a non-https URL", async () => {
  await expectBlocked("http://example.com/listing/1");
  await expectBlocked("ftp://example.com/listing/1");
});

test("rejects an explicit non-standard port", async () => {
  await expectBlocked("https://example.com:8080/listing/1");
});

test("accepts an implicit default port", async () => {
  await expectSafe("https://example.com/listing/1");
});

test("rejects an unparseable URL", async () => {
  await expectBlocked("not a url");
});

// --- Blocked hostnames -------------------------------------------------------

test("rejects localhost and .internal/.local/.localhost suffixes", async () => {
  await expectBlocked("https://localhost/foo");
  await expectBlocked("https://printer.local/foo");
  await expectBlocked("https://db.internal/foo");
  await expectBlocked("https://anything.localhost/foo");
});

// --- Literal IPv4 -----------------------------------------------------------

test("rejects a literal loopback IPv4 host", async () => {
  await expectBlocked("https://127.0.0.1/foo");
});

test("rejects the literal cloud metadata IPv4 address", async () => {
  await expectBlocked("https://169.254.169.254/latest/meta-data");
});

test("rejects literal RFC1918 private IPv4 hosts", async () => {
  await expectBlocked("https://10.0.0.5/foo");
  await expectBlocked("https://172.16.0.5/foo");
  await expectBlocked("https://192.168.1.1/foo");
});

test("accepts a literal public IPv4 host", async () => {
  await expectSafe("https://93.184.216.34/foo");
});

// --- Literal IPv6 -----------------------------------------------------------

test("rejects a literal IPv6 loopback host", async () => {
  await expectBlocked("https://[::1]/foo");
});

test("rejects a literal IPv6 link-local host", async () => {
  await expectBlocked("https://[fe80::1]/foo");
});

test("rejects a literal IPv6 unique-local host", async () => {
  await expectBlocked("https://[fd00::1]/foo");
});

test("rejects an IPv4-mapped IPv6 host embedding a blocked address", async () => {
  await expectBlocked("https://[::ffff:127.0.0.1]/foo");
});

// --- DNS resolution (rebinding-style checks via injected lookup) ------------

test("accepts a hostname whose DNS lookup returns only public addresses", async () => {
  const result = await isFetchableUrl("https://shop.example.com/listing/1", async () => [
    { address: "93.184.216.34", family: 4 },
  ]);
  assert.equal(result.safe, true);
});

test("rejects a hostname whose DNS lookup returns a private address (rebinding)", async () => {
  const result = await isFetchableUrl("https://shop.example.com/listing/1", async () => [
    { address: "10.0.0.1", family: 4 },
  ]);
  assert.equal(result.safe, false);
});

test("rejects a hostname whose DNS lookup returns any blocked address among several", async () => {
  const result = await isFetchableUrl("https://shop.example.com/listing/1", async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ]);
  assert.equal(result.safe, false);
});

test("rejects a hostname when DNS lookup fails", async () => {
  const result = await isFetchableUrl("https://nonexistent.invalid/foo", async () => {
    throw new Error("ENOTFOUND");
  });
  assert.equal(result.safe, false);
});

test("rejects a hostname when DNS lookup returns no addresses", async () => {
  const result = await isFetchableUrl("https://shop.example.com/foo", async () => []);
  assert.equal(result.safe, false);
});
