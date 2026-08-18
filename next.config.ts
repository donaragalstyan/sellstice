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
