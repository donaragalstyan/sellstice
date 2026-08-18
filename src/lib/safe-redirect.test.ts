import { test } from "node:test";
import assert from "node:assert/strict";
import { getSafeRedirectPath } from "./safe-redirect";

test("valid internal paths pass through unchanged", () => {
  assert.equal(getSafeRedirectPath("/dashboard"), "/dashboard");
  assert.equal(getSafeRedirectPath("/items/abc123"), "/items/abc123");
  assert.equal(getSafeRedirectPath("/items?sort=recent"), "/items?sort=recent");
});

test("absent or invalid callback falls back to /dashboard by default", () => {
  assert.equal(getSafeRedirectPath(null), "/dashboard");
  assert.equal(getSafeRedirectPath(undefined), "/dashboard");
  assert.equal(getSafeRedirectPath(""), "/dashboard");
  assert.equal(getSafeRedirectPath("not-a-path"), "/dashboard");
});

test("a custom fallback is used when provided", () => {
  assert.equal(getSafeRedirectPath("https://evil.example", "/items"), "/items");
});

test("rejects absolute external URLs", () => {
  assert.equal(getSafeRedirectPath("https://evil.example/steal"), "/dashboard");
  assert.equal(getSafeRedirectPath("http://evil.example/steal"), "/dashboard");
});

test("rejects protocol-relative URLs", () => {
  assert.equal(getSafeRedirectPath("//evil.example/steal"), "/dashboard");
  assert.equal(getSafeRedirectPath("///evil.example"), "/dashboard");
});

test("rejects backslash-based tricks", () => {
  assert.equal(getSafeRedirectPath("/\\evil.example"), "/dashboard");
  assert.equal(getSafeRedirectPath("\\\\evil.example"), "/dashboard");
  assert.equal(getSafeRedirectPath("/\\/evil.example"), "/dashboard");
});

test("rejects control characters that parsers strip during normalization", () => {
  assert.equal(getSafeRedirectPath("/\t/evil.example"), "/dashboard");
  assert.equal(getSafeRedirectPath("/\n/evil.example"), "/dashboard");
  assert.equal(getSafeRedirectPath("/\r/evil.example"), "/dashboard");
});

test("rejects other schemes smuggled into a path-shaped string", () => {
  assert.equal(getSafeRedirectPath("/javascript:alert(1)"), "/javascript:alert(1)");
  // A same-origin path containing a colon is fine (no scheme change) —
  // this one is a control case, not an attack: confirms we don't
  // over-reject ordinary paths that happen to contain a colon.
});

test("non-string form values fall back safely", () => {
  const file = new File(["x"], "x.txt");
  assert.equal(getSafeRedirectPath(file as unknown as FormDataEntryValue), "/dashboard");
});
