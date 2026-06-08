import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

const nextConfig: NextConfig = {
  output: 'export',
  basePath: '/edtts',
  trailingSlash: true,
  async rewrites() {
    // Les rewrites ne fonctionnent qu'en dev (next dev).
    // En production (output: 'export'), c'est NEXT_PUBLIC_API_BASE qui prend le relais.
    return [
      {
        source: '/api/:path*',
        destination: `${API_URL}/api/:path*`,
        basePath: false,
      },
    ];
  },
};

export default nextConfig;
