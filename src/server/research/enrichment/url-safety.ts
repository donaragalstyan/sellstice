import { promises as dnsPromises } from "node:dns";
import net from "node:net";

export type UrlSafetyResult = { safe: true } | { safe: false; reason: string };

export interface DnsLookupResult {
  address: string;
  family: number;
}

export type DnsLookupFn = (hostname: string) => Promise<DnsLookupResult[]>;

const defaultLookup: DnsLookupFn = (hostname) => dnsPromises.lookup(hostname, { all: true });

const BLOCKED_HOSTNAMES = new Set(["localhost"]);
const BLOCKED_HOSTNAME_SUFFIXES = [".local", ".internal", ".localhost"];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

// CIDR ranges that must never be fetched: loopback, RFC1918 private space,
// link-local (which includes the 169.254.169.254 cloud metadata endpoint
// used by AWS/GCP/Azure), CGNAT, documentation/reserved, and multicast.
// Deliberately conservative — a range we didn't need to block costs
// nothing, a range we forgot to block is an SSRF hole.
const BLOCKED_IPV4_RANGES: Array<{ base: string; bits: number }> = [
  { base: "0.0.0.0", bits: 8 },
  { base: "10.0.0.0", bits: 8 },
  { base: "100.64.0.0", bits: 10 },
  { base: "127.0.0.0", bits: 8 },
  { base: "169.254.0.0", bits: 16 },
  { base: "172.16.0.0", bits: 12 },
  { base: "192.0.0.0", bits: 24 },
  { base: "192.0.2.0", bits: 24 },
  { base: "192.168.0.0", bits: 16 },
  { base: "198.18.0.0", bits: 15 },
  { base: "198.51.100.0", bits: 24 },
  { base: "203.0.113.0", bits: 24 },
  { base: "224.0.0.0", bits: 4 },
  { base: "240.0.0.0", bits: 4 },
];

function isBlockedIpv4(ip: string): boolean {
  const target = ipv4ToInt(ip);
  return BLOCKED_IPV4_RANGES.some(({ base, bits }) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (target & mask) === (ipv4ToInt(base) & mask);
  });
}

// Covers the realistic threat model (loopback, unique-local, link-local
// incl. the IPv6 cloud metadata address, IPv4-mapped addresses embedding a
// blocked v4 range) but is not exhaustive against exotic IPv6 transition
// mechanisms (6to4, Teredo, etc.) — flagged as a residual gap, not silently
// claimed as complete.
function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (/^fe[89ab][0-9a-f]:/.test(normalized)) return true; // fe80::/10 (link-local)
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true; // fc00::/7 (unique local)
  // IPv4-mapped addresses: WHATWG URL's parser normalizes these to hex
  // group form (::ffff:7f00:1), not the dotted form (::ffff:127.0.0.1) —
  // handle both, since values from other sources (e.g. dns.lookup results)
  // could arrive in either shape.
  const mappedDotted = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedDotted) return isBlockedIpv4(mappedDotted[1]);
  const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const combined = (parseInt(mappedHex[1], 16) << 16) | parseInt(mappedHex[2], 16);
    const ipv4 = [24, 16, 8, 0].map((shift) => (combined >>> shift) & 0xff).join(".");
    return isBlockedIpv4(ipv4);
  }
  return false;
}

function stripBrackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

/**
 * Guards every URL a discovered candidate points at before fetch-listing.ts
 * is allowed to request it. The URL comes from an LLM's web-search output,
 * not a fixed allowlist, so it has to be treated as untrusted input: a
 * malformed or adversarially-influenced result could point at a cloud
 * metadata endpoint, loopback, or other internal infrastructure. Checks the
 * literal host first (cheap, no network), then resolves and checks every
 * returned address (a DNS-rebinding domain could return a public address in
 * one lookup and a private one in another — reject if *any* resolved
 * address is blocked).
 */
export async function isFetchableUrl(
  rawUrl: string,
  lookup: DnsLookupFn = defaultLookup,
): Promise<UrlSafetyResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { safe: false, reason: "not a valid URL" };
  }

  if (url.protocol !== "https:") {
    return { safe: false, reason: `unsupported protocol ${url.protocol}` };
  }
  // URL normalizes away the port when it matches the scheme's default, so
  // any non-empty port here is an explicit, non-standard one.
  if (url.port !== "") {
    return { safe: false, reason: "non-standard port" };
  }

  const hostname = url.hostname.toLowerCase();
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    return { safe: false, reason: "blocked hostname" };
  }

  const bareHost = stripBrackets(hostname);
  const ipVersion = net.isIP(bareHost);
  if (ipVersion === 4 && isBlockedIpv4(bareHost)) {
    return { safe: false, reason: `blocked IPv4 host ${bareHost}` };
  }
  if (ipVersion === 6 && isBlockedIpv6(bareHost)) {
    return { safe: false, reason: `blocked IPv6 host ${bareHost}` };
  }
  if (ipVersion !== 0) {
    // A literal, non-blocked IP — nothing left to resolve.
    return { safe: true };
  }

  let resolved: DnsLookupResult[];
  try {
    resolved = await lookup(bareHost);
  } catch {
    return { safe: false, reason: "DNS lookup failed" };
  }
  if (resolved.length === 0) {
    return { safe: false, reason: "DNS lookup returned no addresses" };
  }
  for (const { address, family } of resolved) {
    if (family === 4 && isBlockedIpv4(address)) {
      return { safe: false, reason: `hostname resolves to blocked address ${address}` };
    }
    if (family === 6 && isBlockedIpv6(address)) {
      return { safe: false, reason: `hostname resolves to blocked address ${address}` };
    }
  }
  return { safe: true };
}
