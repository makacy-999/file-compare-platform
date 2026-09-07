import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  basePath: process.env.GITHUB_PAGES ? '/file-compare-platform' : '',
  assetPrefix: process.env.GITHUB_PAGES ? '/file-compare-platform/' : '',
  trailingSlash: true,
};

export default nextConfig;
