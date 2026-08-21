import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyListingUrl } from "./listing-url-shape";

test("classifies a real Vinted listing URL", () => {
  assert.equal(
    classifyListingUrl("vinted.com", "https://www.vinted.com/items/3952370293-zara-neoprene-zip-up-hoodie"),
    "listing",
  );
});

test("classifies a Vinted category page as non_listing", () => {
  assert.equal(
    classifyListingUrl("vinted.com", "https://www.vinted.com/catalog/1550-hoodies/brand/12-zara"),
    "non_listing",
  );
});

test("classifies a real Depop listing URL", () => {
  assert.equal(
    classifyListingUrl("depop.com", "https://www.depop.com/products/theohill1234-zara-dark-green-zip-up/"),
    "listing",
  );
});

test("classifies a Depop theme page as non_listing", () => {
  assert.equal(classifyListingUrl("depop.com", "https://www.depop.com/theme/vintage-levis-501/"), "non_listing");
});

test("classifies a real Poshmark listing URL", () => {
  assert.equal(
    classifyListingUrl("poshmark.com", "https://poshmark.com/listing/Zara-Green-Hoodie-684c1ee9310f1cd2f0d5a4fc"),
    "listing",
  );
});

test("classifies a Poshmark brand page as non_listing", () => {
  assert.equal(classifyListingUrl("poshmark.com", "https://poshmark.com/brand/Zara-Women"), "non_listing");
});

test("classifies a real Mercari listing URL", () => {
  assert.equal(classifyListingUrl("mercari.com", "https://www.mercari.com/us/item/m70335360089/"), "listing");
});

test("classifies a Mercari curated shop page as non_listing, not listing", () => {
  assert.equal(
    classifyListingUrl("mercari.com", "https://www.mercari.com/us/shop/zara-green-hoodies-for-men/"),
    "non_listing",
  );
});

test("classifies a real eBay listing URL with a title slug", () => {
  assert.equal(
    classifyListingUrl("ebay.com", "https://www.ebay.com/itm/Zara-Green-Zip-Up-Hoodie-Size-Medium/145678901234"),
    "listing",
  );
});

test("classifies a real eBay listing URL with no title slug", () => {
  assert.equal(classifyListingUrl("ebay.com", "https://www.ebay.com/itm/145678901234"), "listing");
});

test("classifies an eBay search results page as non_listing", () => {
  assert.equal(
    classifyListingUrl("ebay.com", "https://www.ebay.com/sch/i.html?_nkw=zara+hoodie"),
    "non_listing",
  );
});

test("classifies an eBay storefront page as non_listing", () => {
  assert.equal(classifyListingUrl("ebay.com", "https://www.ebay.com/str/somestore"), "non_listing");
});

test("classifies an off-domain URL as off_domain", () => {
  assert.equal(
    classifyListingUrl("vinted.com", "https://www.evil.com/items/3952370293-zara-neoprene-zip-up-hoodie"),
    "off_domain",
  );
});

test("strips a www. prefix before comparing hosts", () => {
  assert.equal(classifyListingUrl("vinted.com", "https://vinted.com/items/123-test"), "listing");
});

test("classifies an unparsable URL as malformed", () => {
  assert.equal(classifyListingUrl("vinted.com", "not a url"), "malformed");
});

test("throws on an unregistered marketplace id", () => {
  assert.throws(() => classifyListingUrl("etsy.com", "https://etsy.com/listing/123"));
});
