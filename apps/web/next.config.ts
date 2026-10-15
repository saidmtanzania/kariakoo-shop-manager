import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Server-side address of the NestJS API. The browser only ever talks to this
// Next.js origin; /api/* is forwarded so cookies stay first-party.
const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Container images use the standalone server (deploy/docker/web.Dockerfile).
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  poweredByHeader: false,
  transpilePackages: ['@ksm/shared'],
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${apiInternalUrl}/api/:path*` },
    ];
  },
};

export default withNextIntl(nextConfig);
