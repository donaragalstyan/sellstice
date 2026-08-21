import { test } from "node:test";
import assert from "node:assert/strict";
import { extractImageUrl } from "./extract-image";

const PAGE_URL = "https://www.example.com/listing/123";

test("extracts a string Product.image from JSON-LD", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@type": "Product",
    image: "https://cdn.example.com/photo.jpg",
    offers: { price: "10.00", priceCurrency: "USD" },
  })}</script>`;
  assert.equal(extractImageUrl(html, PAGE_URL), "https://cdn.example.com/photo.jpg");
});

test("extracts the first entry from an array Product.image", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@type": "Product",
    image: ["https://cdn.example.com/one.jpg", "https://cdn.example.com/two.jpg"],
  })}</script>`;
  assert.equal(extractImageUrl(html, PAGE_URL), "https://cdn.example.com/one.jpg");
});

test("extracts a url field from an ImageObject Product.image", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@type": "Product",
    image: { "@type": "ImageObject", url: "https://cdn.example.com/obj.jpg" },
  })}</script>`;
  assert.equal(extractImageUrl(html, PAGE_URL), "https://cdn.example.com/obj.jpg");
});

test("falls back to og:image when no JSON-LD Product image exists", () => {
  const html = `<meta property="og:image" content="https://cdn.example.com/og.jpg">`;
  assert.equal(extractImageUrl(html, PAGE_URL), "https://cdn.example.com/og.jpg");
});

test("prefers og:image:secure_url over og:image", () => {
  const html = `<meta property="og:image" content="http://cdn.example.com/insecure.jpg">
    <meta property="og:image:secure_url" content="https://cdn.example.com/secure.jpg">`;
  assert.equal(extractImageUrl(html, PAGE_URL), "https://cdn.example.com/secure.jpg");
});

test("resolves a relative image URL against the page URL", () => {
  const html = `<meta property="og:image" content="/images/photo.jpg">`;
  assert.equal(extractImageUrl(html, PAGE_URL), "https://www.example.com/images/photo.jpg");
});

test("rejects a non-https image URL", () => {
  const html = `<meta property="og:image" content="http://cdn.example.com/photo.jpg">`;
  assert.equal(extractImageUrl(html, PAGE_URL), null);
});

test("returns null when no image is found anywhere", () => {
  assert.equal(extractImageUrl("<html><body>nothing here</body></html>", PAGE_URL), null);
});

test("ignores JSON-LD nodes that are not a Product", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@type": "BreadcrumbList",
    image: "https://cdn.example.com/should-not-be-used.jpg",
  })}</script>
  <meta property="og:image" content="https://cdn.example.com/fallback.jpg">`;
  assert.equal(extractImageUrl(html, PAGE_URL), "https://cdn.example.com/fallback.jpg");
});
