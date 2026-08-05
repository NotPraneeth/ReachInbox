/** @type {import('next').NextConfig} */
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:4000";

const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` },
      { source: "/auth/:path*", destination: `${BACKEND_URL}/auth/:path*` },
    ];
  },
};

export default nextConfig;
