export type ListingUrlClassification = "listing" | "non_listing" | "off_domain" | "malformed";

interface MarketplaceUrlRules {
  hostname: string;
  listingPathPattern: RegExp;
  /** Checked before listingPathPattern — catches non-listing pages that would
   * otherwise slip past a purely positive match (e.g. Mercari's curated
   * /us/shop/<slug>/ collection pages, which the pilot found mixed into
   * search results alongside real /item/mNNN listings). */
  rejectPathPatterns?: RegExp[];
}

// Conservative, structural URL-shape checks only — carried over from the
// Brave marketplace pilot (scripts/brave-marketplace-pilot.ts), which
// validated these shapes against real search results.
const MARKETPLACE_URL_RULES: Record<string, MarketplaceUrlRules> = {
  "vinted.com": {
    hostname: "vinted.com",
    listingPathPattern: /^\/items\/\d+(?:-|\/|$)/,
  },
  "depop.com": {
    hostname: "depop.com",
    listingPathPattern: /^\/products\/[^/]+\/?$/,
  },
  "poshmark.com": {
    hostname: "poshmark.com",
    listingPathPattern: /^\/listing\/[^/]+-[0-9a-f]{20,24}\/?$/i,
  },
  "mercari.com": {
    hostname: "mercari.com",
    listingPathPattern: /^\/(?:us\/)?item\/m\d+/i,
    rejectPathPatterns: [/^\/(?:us\/)?shop\//i],
  },
  "ebay.com": {
    hostname: "ebay.com",
    // Real item pages: /itm/<numericId> or /itm/<title-slug>/<numericId>.
    // Rejects /sch/ (search results), /str/ (storefronts), /b/ (browse
    // nodes) and other non-listing sections via the positive-only pattern.
    listingPathPattern: /^\/itm\/(?:[^/]+\/)?\d{9,}(?:[/?]|$)/,
  },
};

/** The marketplace ids this classifier (and the Brave adapter) knows about. */
export const KNOWN_MARKETPLACES = Object.keys(MARKETPLACE_URL_RULES);

/**
 * Structural relevance filter: does this URL look like an individual
 * listing page for the given marketplace? Deliberately separate from
 * enrichment/url-safety.ts's isFetchableUrl — that's a security guard (is
 * this safe to fetch), this is a semantic/structural filter (does this look
 * like a real listing), and conflating them would make the SSRF threat
 * model harder to audit in isolation. Both run on a URL, but at different
 * layers: this runs first, cheap and network-free, purely to drop obviously
 * wrong candidates before they ever reach enrichComparables, which is what
 * calls isFetchableUrl for the real safety check.
 *
 * Throws on an unregistered marketplace id — that's a config/programmer
 * error (e.g. a typo'd marketplace string wired into an adapter), not
 * untrusted input, and should fail loud rather than silently misclassifying
 * every candidate from a misconfigured adapter as "malformed".
 */
export function classifyListingUrl(marketplace: string, rawUrl: string): ListingUrlClassification {
  const rules = MARKETPLACE_URL_RULES[marketplace];
  if (!rules) {
    throw new Error(`classifyListingUrl: unregistered marketplace "${marketplace}"`);
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "malformed";
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== rules.hostname) return "off_domain";

  if (rules.rejectPathPatterns?.some((pattern) => pattern.test(url.pathname))) {
    return "non_listing";
  }
  return rules.listingPathPattern.test(url.pathname) ? "listing" : "non_listing";
}
