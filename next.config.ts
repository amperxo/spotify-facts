import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'i.scdn.co',
      },
      {
        protocol: 'https',
        hostname: 'i.discogs.com',
      },
      {
        protocol: 'https',
        hostname: '*.mzstatic.com',
      },
    ],
  },
};

export default nextConfig;
