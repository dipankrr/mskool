/* global process, URL */ // next.config runs in Node.

// Public site images are served from the public bucket's own address
// (ADR-063); next/image may only optimise hosts listed here.
const publicFiles = process.env.PUBLIC_FILES_BASE_URL
  ? new URL(process.env.PUBLIC_FILES_BASE_URL)
  : null;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["192.168.0.105", "sheep-puppy-enlighten.ngrok-free.dev"],
  images: {
    remotePatterns: [
      // Project cards may embed YouTube thumbnails (public sites, ADR-041).
      { protocol: "https", hostname: "img.youtube.com" },
      ...(publicFiles
        ? [
            {
              protocol: /** @type {"http" | "https"} */ (publicFiles.protocol.replace(":", "")),
              hostname: publicFiles.hostname,
              pathname: `${publicFiles.pathname.replace(/\/$/, "")}/**`,
            },
          ]
        : []),
    ],
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:4000/api/:path*",
      },
      {
        source: "/trpc/:path*",
        destination: "http://localhost:4000/trpc/:path*",
      },
    ];
  },
  // apps/api owns the database connection; this app never imports
  // @repo/db's client, only @repo/api's AppRouter *type* (zero runtime
  // import) for tRPC's end-to-end type inference.
};

export default nextConfig;
