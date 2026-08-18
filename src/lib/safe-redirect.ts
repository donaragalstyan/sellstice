const TRUSTED_BASE = "http://sellstice.internal";

// Plain char-code comparisons rather than a regex literal with escaped
// control-character ranges, to keep the check unambiguous and easy to
// verify by inspection. True for any C0 control (0x00-0x1F) or DEL (0x7F).
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Reduces an arbitrary, client-supplied callback value to a same-origin
 * path safe to pass to redirect(), or falls back to `fallback`.
 *
 * Deliberately layered rather than a single substring check (e.g. rejecting
 * "://") — that alone misses "//evil.example" (protocol-relative), and
 * browsers/parsers do their own normalization (stripping control
 * characters, folding "\" to "/" for special schemes) that can smuggle an
 * external destination past a naive prefix check. Each layer below closes
 * one of those gaps; the final URL-parse-and-compare-origin step is the
 * backstop for anything the string checks didn't anticipate.
 */
export function getSafeRedirectPath(
  callbackUrl: FormDataEntryValue | null | undefined,
  fallback = "/dashboard",
): string {
  if (typeof callbackUrl !== "string" || callbackUrl.length === 0) return fallback;

  // Must be a plain root-relative path: not absolute ("https://..."), not
  // scheme-relative ("//evil.example"), not a bare "\\evil.example".
  if (!callbackUrl.startsWith("/")) return fallback;
  if (callbackUrl.startsWith("//")) return fallback;

  // Reject any backslash anywhere. Some browsers normalize "\" to "/" when
  // parsing a URL against a "special" scheme (http/https), so a value like
  // "/\evil.example" or "/\/evil.example" can resolve to a different origin
  // even though it doesn't match the "//" check above.
  if (callbackUrl.includes("\\")) return fallback;

  // Reject control characters (including tab/CR/LF). The WHATWG URL parser
  // strips these before parsing, which can turn something that looks like
  // an internal path into a scheme change once normalized.
  if (hasControlCharacter(callbackUrl)) return fallback;

  // Belt and suspenders: actually parse it against a fixed, trusted base
  // and require the result to still be same-origin. Catches anything the
  // structural checks above didn't anticipate.
  let parsed: URL;
  try {
    parsed = new URL(callbackUrl, TRUSTED_BASE);
  } catch {
    return fallback;
  }
  if (parsed.origin !== TRUSTED_BASE) return fallback;

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
