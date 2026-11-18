import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Native / WASM database and hashing packages must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite", "@node-rs/argon2", "pg"],
  // DATABASE_SSL_CA_PATH is resolved at runtime, so Next.js cannot infer this
  // file as a dependency while tracing the server bundle for Vercel.
  outputFileTracingIncludes: {
    "/*": ["./certs/supabase-ca-2021.crt"],
  },
  experimental: {
    // Document uploads go through Server Actions; files are capped at 25 MB in src/lib/file-rules.ts.
    serverActions: { bodySizeLimit: "26mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return [
      { source: "/staff", destination: "/crm", permanent: true },
      { source: "/staff/:path*", destination: "/crm/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
