import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// No nonces: Sellstice has no per-request dynamic script/style injection to
// justify the dynamic-rendering cost of a nonce-based CSP (see
// src/proxy.ts/next.config.ts history — static header chosen deliberately).
// 'unsafe-inline' on script-src is required because Next.js injects inline
// <script> tags for RSC hydration payloads without a nonce configured.
// 'unsafe-inline' on style-src is required because at least one component
// (src/app/dashboard/goal-summary.tsx) sets a dynamic inline `style` attribute.
const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""};
  style-src 'self' 'unsafe-inline';
  img-src 'self';
  font-src 'self';
  connect-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests;
`
  .replace(/\s{2,}/g, " ")
  .trim();

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // Photo uploads (item creation and the item detail "Add photos" form)
      // go straight through a Server Action as multipart FormData, so the
      // request body has to fit the app's own declared limits: up to
      // MAX_PHOTOS_PER_ITEM (8) files at MAX_IMAGE_BYTES (8MB) each — see
      // src/server/storage/image-validation.ts. Next's 1MB default silently
      // rejected any real upload; this covers the worst case plus multipart
      // boundary overhead.
      bodySizeLimit: "65mb",
    },
    // src/proxy.ts (auth gating) runs on every route including the upload
    // forms, and Next enforces its own, separate cap on how much body a
    // proxy/middleware function is allowed to read before truncating it —
    // independent of serverActions.bodySizeLimit above. Left at the 10MB
    // default, it silently truncates a multipart body mid-boundary, which
    // surfaces downstream as "Unexpected end of form" rather than a clear
    // size error. Matches bodySizeLimit so the proxy layer never truncates
    // anything the Server Action layer would otherwise accept.
    proxyClientMaxBodySize: "65mb",
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: cspHeader },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
