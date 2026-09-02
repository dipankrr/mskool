/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["192.168.0.105"],
  // apps/api owns the database connection; this app never imports
  // @repo/db's client, only @repo/api's AppRouter *type* (zero runtime
  // import) for tRPC's end-to-end type inference.
};

export default nextConfig;
