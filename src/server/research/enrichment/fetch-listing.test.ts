import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { fetchListingHtml } from "./fetch-listing";

let server: Server;
let baseUrl: string;

const permissive = async () => ({ safe: true as const });

before(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/ok") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body>Real listing, $42.00</body></html>");
      return;
    }
    if (url === "/blocked-403") {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    if (url === "/blocked-429") {
      res.writeHead(429);
      res.end("rate limited");
      return;
    }
    if (url === "/error-500") {
      res.writeHead(500);
      res.end("server error");
      return;
    }
    if (url === "/challenge") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body>Please complete the CAPTCHA to continue</body></html>");
      return;
    }
    if (url === "/slow") {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<html><body>slow</body></html>");
      }, 300);
      return;
    }
    if (url === "/big") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("x".repeat(1_000_000));
      return;
    }
    if (url === "/redirect-once") {
      res.writeHead(302, { location: "/ok" });
      res.end();
      return;
    }
    if (url === "/redirect-loop") {
      res.writeHead(302, { location: "/redirect-loop" });
      res.end();
      return;
    }
    if (url === "/redirect-no-location") {
      res.writeHead(302);
      res.end();
      return;
    }
    if (url === "/wrong-content-type") {
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end("%PDF-1.4");
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

test("fetches a normal 200 HTML page", async () => {
  const result = await fetchListingHtml(`${baseUrl}/ok`, { isUrlSafe: permissive });
  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.match(result.html, /\$42\.00/);
    assert.equal(result.finalUrl, `${baseUrl}/ok`);
  }
});

test("classifies 403 and 429 as blocked, not error", async () => {
  const forbidden = await fetchListingHtml(`${baseUrl}/blocked-403`, { isUrlSafe: permissive });
  assert.equal(forbidden.status, "blocked");
  const rateLimited = await fetchListingHtml(`${baseUrl}/blocked-429`, { isUrlSafe: permissive });
  assert.equal(rateLimited.status, "blocked");
});

test("classifies a 500 as error", async () => {
  const result = await fetchListingHtml(`${baseUrl}/error-500`, { isUrlSafe: permissive });
  assert.equal(result.status, "error");
});

test("classifies a 200 challenge page as blocked", async () => {
  const result = await fetchListingHtml(`${baseUrl}/challenge`, { isUrlSafe: permissive });
  assert.equal(result.status, "blocked");
});

test("times out a slow response rather than hanging", async () => {
  const result = await fetchListingHtml(`${baseUrl}/slow`, {
    isUrlSafe: permissive,
    timeoutMs: 50,
  });
  assert.equal(result.status, "error");
});

test("rejects a response over the byte cap instead of buffering it fully", async () => {
  const result = await fetchListingHtml(`${baseUrl}/big`, {
    isUrlSafe: permissive,
    maxBytes: 1000,
  });
  assert.equal(result.status, "error");
});

test("follows a single redirect to its final destination", async () => {
  const result = await fetchListingHtml(`${baseUrl}/redirect-once`, { isUrlSafe: permissive });
  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(result.finalUrl, `${baseUrl}/ok`);
  }
});

test("gives up on a redirect loop instead of looping forever", async () => {
  const result = await fetchListingHtml(`${baseUrl}/redirect-loop`, { isUrlSafe: permissive });
  assert.equal(result.status, "error");
});

test("errors on a redirect with no Location header", async () => {
  const result = await fetchListingHtml(`${baseUrl}/redirect-no-location`, {
    isUrlSafe: permissive,
  });
  assert.equal(result.status, "error");
});

test("rejects an unexpected content-type", async () => {
  const result = await fetchListingHtml(`${baseUrl}/wrong-content-type`, {
    isUrlSafe: permissive,
  });
  assert.equal(result.status, "error");
});

test("re-validates every redirect hop, not just the original URL", async () => {
  let calls = 0;
  const rejectSecondHop = async () => {
    calls += 1;
    return calls === 1 ? { safe: true as const } : { safe: false as const, reason: "blocked hop" };
  };
  const result = await fetchListingHtml(`${baseUrl}/redirect-once`, {
    isUrlSafe: rejectSecondHop,
  });
  assert.equal(result.status, "error");
  assert.equal(calls, 2);
});

test("uses the real SSRF guard by default and blocks a plain http/loopback URL", async () => {
  const result = await fetchListingHtml(`${baseUrl}/ok`);
  assert.equal(result.status, "error");
});
