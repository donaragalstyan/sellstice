import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPrice } from "./extract-price";

function page(bodyHtml: string): string {
  return `<!doctype html><html><head></head><body>${bodyHtml}</body></html>`;
}

// --- JSON-LD -----------------------------------------------------------

test("extracts a price from a single JSON-LD Product/Offer", () => {
  const html = page(`
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Product","name":"Zara Sweater",
     "offers":{"@type":"Offer","price":"42.99","priceCurrency":"USD"}}
    </script>
  `);
  const result = extractPrice(html);
  assert.deepEqual(result, { evidence: "STRUCTURED_DATA", priceCents: 4299, currency: "USD", availability: "UNKNOWN" });
});

test("finds the Product node inside an array of mixed JSON-LD types", () => {
  const html = page(`
    <script type="application/ld+json">
    [
      {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]},
      {"@context":"https://schema.org","@type":"Product","offers":{"price":25,"priceCurrency":"USD"}}
    ]
    </script>
  `);
  const result = extractPrice(html);
  assert.deepEqual(result, { evidence: "STRUCTURED_DATA", priceCents: 2500, currency: "USD", availability: "UNKNOWN" });
});

test("finds a Product nested inside @graph", () => {
  const html = page(`
    <script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[
      {"@type":"WebPage"},
      {"@type":"Product","offers":{"price":"18.00","priceCurrency":"USD"}}
    ]}
    </script>
  `);
  const result = extractPrice(html);
  assert.deepEqual(result, { evidence: "STRUCTURED_DATA", priceCents: 1800, currency: "USD", availability: "UNKNOWN" });
});

test("reads price from priceSpecification when offers.price is absent", () => {
  const html = page(`
    <script type="application/ld+json">
    {"@type":"Product","offers":{"priceSpecification":{"price":"30.50","priceCurrency":"USD"}}}
    </script>
  `);
  const result = extractPrice(html);
  assert.deepEqual(result, { evidence: "STRUCTURED_DATA", priceCents: 3050, currency: "USD", availability: "UNKNOWN" });
});

test("does not throw on malformed JSON-LD, falls through instead", () => {
  const html = page(`
    <script type="application/ld+json">{ this is not valid json </script>
  `);
  const result = extractPrice(html);
  assert.equal(result.evidence, "UNVERIFIED");
  assert.equal(result.priceCents, null);
});

test("reports ambiguous when JSON-LD has multiple conflicting prices", () => {
  const html = page(`
    <script type="application/ld+json">
    {"@type":"Product","offers":[
      {"price":"20.00","priceCurrency":"USD"},
      {"price":"25.00","priceCurrency":"USD"}
    ]}
    </script>
  `);
  const result = extractPrice(html);
  assert.equal(result.evidence, "UNVERIFIED");
  if (result.evidence === "UNVERIFIED") assert.match(result.reason, /multiple distinct prices/);
});

test("reports ambiguous for a non-USD JSON-LD price and does not fall through to meta tags", () => {
  const html = page(`
    <script type="application/ld+json">
    {"@type":"Product","offers":{"price":"20.00","priceCurrency":"EUR"}}
    </script>
    <meta property="og:price:amount" content="22.00">
    <meta property="og:price:currency" content="USD">
  `);
  const result = extractPrice(html);
  assert.equal(result.evidence, "UNVERIFIED");
  if (result.evidence === "UNVERIFIED") assert.match(result.reason, /EUR/);
});

test("reports ambiguous when JSON-LD price has no currency at all", () => {
  const html = page(`
    <script type="application/ld+json">
    {"@type":"Product","offers":{"price":"20.00"}}
    </script>
  `);
  const result = extractPrice(html);
  assert.equal(result.evidence, "UNVERIFIED");
});

// --- Meta tags (only reached when JSON-LD found nothing) -------------------

test("falls through to og:price:amount/currency meta tags when there is no JSON-LD", () => {
  const html = page(`
    <meta property="og:price:amount" content="15.99">
    <meta property="og:price:currency" content="USD">
  `);
  const result = extractPrice(html);
  assert.deepEqual(result, { evidence: "META_TAG", priceCents: 1599, currency: "USD", availability: "UNKNOWN" });
});

test("reads product:price:amount/currency meta tags regardless of attribute order", () => {
  const html = page(`<meta content="9.50" property="product:price:amount">
    <meta content="USD" property="product:price:currency">`);
  const result = extractPrice(html);
  assert.deepEqual(result, { evidence: "META_TAG", priceCents: 950, currency: "USD", availability: "UNKNOWN" });
});

test("meta price without a currency tag is unverified, not assumed USD", () => {
  const html = page(`<meta property="og:price:amount" content="15.99">`);
  const result = extractPrice(html);
  assert.equal(result.evidence, "UNVERIFIED");
});

test("meta price in a non-USD currency is unverified", () => {
  const html = page(`
    <meta property="og:price:amount" content="15.99">
    <meta property="og:price:currency" content="GBP">
  `);
  const result = extractPrice(html);
  assert.equal(result.evidence, "UNVERIFIED");
});

// --- Microdata (only reached when JSON-LD and meta tags found nothing) -----

test("falls through to microdata when there is no JSON-LD or meta tags", () => {
  const html = page(`
    <span itemprop="price" content="12.00">$12.00</span>
    <span itemprop="priceCurrency" content="USD"></span>
  `);
  const result = extractPrice(html);
  assert.deepEqual(result, { evidence: "MICRODATA", priceCents: 1200, currency: "USD", availability: "UNKNOWN" });
});

test("microdata price without an unambiguous USD currency marker is unverified", () => {
  const html = page(`<span itemprop="price" content="12.00">$12.00</span>`);
  const result = extractPrice(html);
  assert.equal(result.evidence, "UNVERIFIED");
});

test("conflicting microdata prices are unverified", () => {
  const html = page(`
    <span itemprop="price" content="12.00">$12.00</span>
    <span itemprop="price" content="14.00">$14.00</span>
    <span itemprop="priceCurrency" content="USD"></span>
  `);
  const result = extractPrice(html);
  assert.equal(result.evidence, "UNVERIFIED");
});

// --- No signal at all --------------------------------------------------

test("a page with no structured price data of any kind is unverified", () => {
  const html = page(`<h1>Great vintage sweater</h1><p>Ask for details.</p>`);
  const result = extractPrice(html);
  assert.deepEqual(result, {
    evidence: "UNVERIFIED",
    priceCents: null,
    reason: "no price found in structured data, meta tags, or microdata",
  });
});

test("an absurdly large or malformed price string is treated as not found", () => {
  const html = page(`
    <meta property="og:price:amount" content="not-a-price">
    <meta property="og:price:currency" content="USD">
  `);
  const result = extractPrice(html);
  assert.equal(result.evidence, "UNVERIFIED");
});

// --- Real marketplace shapes (Phase 10.4 recon, live-verified 2026-08-21) --
//
// Phase 10.4's roadmap worried that a listing page's crossed-out/retail,
// shipping, bundle, or unrelated prices could get picked up alongside the
// real one. Live listings across eBay, Poshmark, Depop, Vinted, and Mercari
// were pulled and inspected: in every case the structured data these three
// strategies read is already a single, clean, current price — shipping
// price lives under a key path (`offers.shippingDetails`) none of the
// strategies read, and a visible "was $X" retail price never makes it into
// structured data at all (it's plain text, invisible to all three
// strategies, which never scrape visible text for prices). These fixtures
// pin that down as regression coverage rather than leaving it unverified.

test("eBay: shippingDetails on the offer is ignored, not conflated with the item price", () => {
  const html = page(`
    <script type="application/ld+json">
    {"@type":"Product","name":"Lululemon Women's Leggings - Black","offers":
      {"@type":"Offer","priceCurrency":"USD","price":"59.99","availability":"https://schema.org/InStock",
       "shippingDetails":[{"@type":"OfferShippingDetails",
         "shippingRate":{"@type":"MonetaryAmount","value":"6.24","currency":"USD"},
         "shippingDestination":{"@type":"DefinedRegion","addressCountry":"USA"}}]}}
    </script>
  `);
  const result = extractPrice(html);
  assert.deepEqual(result, { evidence: "STRUCTURED_DATA", priceCents: 5999, currency: "USD", availability: "AVAILABLE" });
});

test("eBay: a multi-item 'lot' listing has one unambiguous price for the lot", () => {
  const html = page(`
    <script type="application/ld+json">
    {"@type":"Product","name":"Lululemon Leggings Lot of 3","offers":
      {"@type":"Offer","priceCurrency":"USD","price":"129.99","availability":"https://schema.org/InStock"}}
    </script>
  `);
  const result = extractPrice(html);
  assert.deepEqual(result, { evidence: "STRUCTURED_DATA", priceCents: 12999, currency: "USD", availability: "AVAILABLE" });
});

test("Poshmark: a visible crossed-out retail price outside structured data is never picked up", () => {
  const html = page(`
    <script type="application/ld+json">
    {"@type":"Product","name":"Lululemon Align High-Rise Pant","offers":
      {"@type":"Offer","priceCurrency":"USD","price":"35.0","itemCondition":"https://schema.org/UsedCondition"}}
    </script>
    <div class="price-now">$35</div>
    <div class="price-original">$98</div>
  `);
  const result = extractPrice(html);
  assert.deepEqual(result, { evidence: "STRUCTURED_DATA", priceCents: 3500, currency: "USD", availability: "UNKNOWN" });
});

test("Depop: clean single-offer listing with no meta tags or microdata present", () => {
  const html = page(`
    <script type="application/ld+json">
    {"@type":"Product","name":"Black Lululemon Align leggings","offers":
      {"@type":"Offer","priceCurrency":"USD","price":"11.00","itemCondition":"https://schema.org/UsedCondition"}}
    </script>
  `);
  const result = extractPrice(html);
  assert.deepEqual(result, { evidence: "STRUCTURED_DATA", priceCents: 1100, currency: "USD", availability: "UNKNOWN" });
});

test("Vinted: a numeric (not string) price with non-URL condition/availability values", () => {
  const html = page(`
    <script type="application/ld+json">
    {"@type":"Product","name":"Lululemon align mini flare leggings","offers":
      {"@type":"Offer","priceCurrency":"USD","price":15,"availability":"InStock","itemCondition":"UsedCondition"}}
    </script>
  `);
  const result = extractPrice(html);
  assert.deepEqual(result, { evidence: "STRUCTURED_DATA", priceCents: 1500, currency: "USD", availability: "AVAILABLE" });
});

// --- Availability signal (Phase 10.4, SOLD verification) -------------------
//
// Live-verified against real Poshmark listings: an active listing's offer
// availability is "https://schema.org/InStock"; a confirmed-sold one
// (checked via Poshmark's own "Sold Items" search filter) is
// "https://schema.org/OutOfStock" — used downstream (providers/
// brave-discovery.ts) to downgrade an AI-claimed SOLD priceType that this
// deterministic signal contradicts.

test("Poshmark: an active listing's InStock availability maps to AVAILABLE", () => {
  const html = page(`
    <script type="application/ld+json">
    {"@type":"Product","offers":{"price":"35.0","priceCurrency":"USD","availability":"https://schema.org/InStock"}}
    </script>
  `);
  const result = extractPrice(html);
  assert.equal(result.evidence, "STRUCTURED_DATA");
  if (result.evidence === "STRUCTURED_DATA") assert.equal(result.availability, "AVAILABLE");
});

test("Poshmark: a confirmed-sold listing's OutOfStock availability maps to SOLD", () => {
  const html = page(`
    <script type="application/ld+json">
    {"@type":"Product","offers":{"price":"89.0","priceCurrency":"USD","availability":"https://schema.org/OutOfStock"}}
    </script>
  `);
  const result = extractPrice(html);
  assert.equal(result.evidence, "STRUCTURED_DATA");
  if (result.evidence === "STRUCTURED_DATA") assert.equal(result.availability, "SOLD");
});

test("schema.org's literally-named SoldOut also maps to SOLD, even though only OutOfStock has been observed live", () => {
  const html = page(`
    <script type="application/ld+json">
    {"@type":"Product","offers":{"price":"20.0","priceCurrency":"USD","availability":"https://schema.org/SoldOut"}}
    </script>
  `);
  const result = extractPrice(html);
  if (result.evidence === "STRUCTURED_DATA") assert.equal(result.availability, "SOLD");
});

test("a schema.org availability value not seen in the wild (BackOrder) still maps to AVAILABLE, per the spec", () => {
  const html = page(`
    <script type="application/ld+json">
    {"@type":"Product","offers":{"price":"20.0","priceCurrency":"USD","availability":"https://schema.org/BackOrder"}}
    </script>
  `);
  const result = extractPrice(html);
  if (result.evidence === "STRUCTURED_DATA") assert.equal(result.availability, "AVAILABLE");
});

test("a missing availability field is UNKNOWN, not a guess either way", () => {
  const html = page(`
    <script type="application/ld+json">
    {"@type":"Product","offers":{"price":"20.0","priceCurrency":"USD"}}
    </script>
  `);
  const result = extractPrice(html);
  if (result.evidence === "STRUCTURED_DATA") assert.equal(result.availability, "UNKNOWN");
});

test("disagreeing availability across multiple offers with the same price downgrades to UNKNOWN, not a guess", () => {
  const html = page(`
    <script type="application/ld+json">
    {"@type":"Product","offers":[
      {"price":"20.00","priceCurrency":"USD","availability":"https://schema.org/InStock"},
      {"price":"20.00","priceCurrency":"USD","availability":"https://schema.org/OutOfStock"}
    ]}
    </script>
  `);
  const result = extractPrice(html);
  assert.equal(result.evidence, "STRUCTURED_DATA");
  if (result.evidence === "STRUCTURED_DATA") assert.equal(result.availability, "UNKNOWN");
});

test("meta-tag and microdata extraction carry no availability signal — always UNKNOWN", () => {
  const metaHtml = page(`
    <meta property="og:price:amount" content="15.99">
    <meta property="og:price:currency" content="USD">
  `);
  const metaResult = extractPrice(metaHtml);
  if (metaResult.evidence === "META_TAG") assert.equal(metaResult.availability, "UNKNOWN");

  const microdataHtml = page(`
    <span itemprop="price" content="12.00">$12.00</span>
    <span itemprop="priceCurrency" content="USD"></span>
  `);
  const microdataResult = extractPrice(microdataHtml);
  if (microdataResult.evidence === "MICRODATA") assert.equal(microdataResult.availability, "UNKNOWN");
});

test("Mercari: extra offer fields (priceValidUntil, return policy, object-shaped shippingDetails) are ignored", () => {
  const html = page(`
    <script type="application/ld+json">
    {"@type":"Product","name":"Lulu Lemon Leggings","offers":
      {"@type":"Offer","priceCurrency":"USD","price":"36","priceValidUntil":"2027-06-30",
       "shippingDetails":{"@type":"OfferShippingDetails","shippingRate":{"@type":"MonetaryAmount","value":5.66,"currency":"USD"}},
       "hasMerchantReturnPolicy":{"@type":"MerchantReturnPolicy","merchantReturnDays":3}}}
    </script>
  `);
  const result = extractPrice(html);
  assert.deepEqual(result, { evidence: "STRUCTURED_DATA", priceCents: 3600, currency: "USD", availability: "UNKNOWN" });
});
