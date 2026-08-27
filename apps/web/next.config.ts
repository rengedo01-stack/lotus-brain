import type { NextConfig } from "next";

const publicApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
if (process.env.NODE_ENV === "production" && (typeof publicApiBaseUrl !== "string" || publicApiBaseUrl.length === 0)) {
  throw new Error("NEXT_PUBLIC_API_BASE_URL must be configured for a production web build.");
}

const operationalNoStoreHeaders = [{ key: "Cache-Control", value: "private, no-store" }];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/",
        headers: operationalNoStoreHeaders,
      },
      {
        source: "/forbidden",
        headers: operationalNoStoreHeaders,
      },
      {
        source: "/master/:path*",
        headers: operationalNoStoreHeaders,
      },
      {
        source: "/purchases/:path*",
        headers: operationalNoStoreHeaders,
      },
      {
        source: "/stocktakes/:path*",
        headers: operationalNoStoreHeaders,
      },
      {
        source: "/productions/:path*",
        headers: operationalNoStoreHeaders,
      },
      {
        source: "/authorization",
        headers: operationalNoStoreHeaders,
      },
      {
        source: "/authorization/:path*",
        headers: operationalNoStoreHeaders,
      },
      {
        source: "/identity",
        headers: operationalNoStoreHeaders,
      },
      {
        source: "/identity/:path*",
        headers: operationalNoStoreHeaders,
      },
      {
        source: "/upload",
        headers: operationalNoStoreHeaders,
      },
      {
        source: "/verify-email",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        source: "/reset-password",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        source: "/forgot-password",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        source: "/accept-invitation",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        source: "/settings/passkeys",
        headers: [
          ...operationalNoStoreHeaders,
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
