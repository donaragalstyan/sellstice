import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { fetchListingImage } from "./fetch-image";

let server: Server;
let baseUrl: string;

const permissive = async () => ({ safe: true as const });

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const WEBP_BYTES = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP"),
  Buffer.from([0x00, 0x00]),
]);

before(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/photo.jpg") {
      res.writeHead(200, { "content-type": "image/jpeg" });
      res.end(JPEG_BYTES);
      return;
    }
    if (url === "/photo.png") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(PNG_BYTES);
      return;
    }
    if (url === "/photo.webp") {
      res.writeHead(200, { "content-type": "image/webp" });
      res.end(WEBP_BYTES);
      return;
    }
    if (url === "/fake.jpg") {
      // Claims to be a JPEG via extension and Content-Type, but isn't one.
      res.writeHead(200, { "content-type": "image/jpeg" });
      res.end("<html><body>not an image</body></html>");
      return;
    }
    if (url === "/blocked-403") {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    if (url === "/error-500") {
      res.writeHead(500);
      res.end("server error");
      return;
    }
    if (url === "/big") {
      res.writeHead(200, { "content-type": "image/jpeg" });
      res.end(Buffer.concat([JPEG_BYTES, Buffer.alloc(2_000_000)]));
      return;
    }
    if (url === "/redirect-once") {
      res.writeHead(302, { location: "/photo.jpg" });
      res.end();
      return;
    }
    if (url === "/redirect-loop") {
      res.writeHead(302, { location: "/redirect-loop" });
      res.end();
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

test("fetches and identifies a real JPEG by magic bytes", async () => {
  const result = await fetchListingImage(`${baseUrl}/photo.jpg`, { isUrlSafe: permissive });
  assert.equal(result.status, "ok");
  if (result.status === "ok") assert.equal(result.mediaType, "image/jpeg");
});

test("fetches and identifies a real PNG by magic bytes", async () => {
  const result = await fetchListingImage(`${baseUrl}/photo.png`, { isUrlSafe: permissive });
  assert.equal(result.status, "ok");
  if (result.status === "ok") assert.equal(result.mediaType, "image/png");
});

test("fetches and identifies a real WEBP by magic bytes", async () => {
  const result = await fetchListingImage(`${baseUrl}/photo.webp`, { isUrlSafe: permissive });
  assert.equal(result.status, "ok");
  if (result.status === "ok") assert.equal(result.mediaType, "image/webp");
});

test("rejects content that claims to be an image via extension/Content-Type but isn't one", async () => {
  const result = await fetchListingImage(`${baseUrl}/fake.jpg`, { isUrlSafe: permissive });
  assert.equal(result.status, "error");
});

test("classifies 403 as blocked, not error", async () => {
  const result = await fetchListingImage(`${baseUrl}/blocked-403`, { isUrlSafe: permissive });
  assert.equal(result.status, "blocked");
});

test("classifies a 500 as error", async () => {
  const result = await fetchListingImage(`${baseUrl}/error-500`, { isUrlSafe: permissive });
  assert.equal(result.status, "error");
});

test("rejects a response over the byte cap instead of buffering it fully", async () => {
  const result = await fetchListingImage(`${baseUrl}/big`, { isUrlSafe: permissive, maxBytes: 1000 });
  assert.equal(result.status, "error");
});

test("follows a single redirect to its final destination", async () => {
  const result = await fetchListingImage(`${baseUrl}/redirect-once`, { isUrlSafe: permissive });
  assert.equal(result.status, "ok");
});

test("gives up on a redirect loop instead of looping forever", async () => {
  const result = await fetchListingImage(`${baseUrl}/redirect-loop`, { isUrlSafe: permissive });
  assert.equal(result.status, "error");
});

test("re-validates every redirect hop, not just the original URL", async () => {
  let calls = 0;
  const rejectSecondHop = async () => {
    calls += 1;
    return calls === 1 ? { safe: true as const } : { safe: false as const, reason: "blocked hop" };
  };
  const result = await fetchListingImage(`${baseUrl}/redirect-once`, { isUrlSafe: rejectSecondHop });
  assert.equal(result.status, "error");
  assert.equal(calls, 2);
});

test("uses the real SSRF guard by default and blocks a plain http/loopback URL", async () => {
  const result = await fetchListingImage(`${baseUrl}/photo.jpg`);
  assert.equal(result.status, "error");
});
