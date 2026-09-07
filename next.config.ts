import type { NextConfig } from 'next';

const isGithubPages = process.env.GITHUB_PAGES === 'true';

const nextConfig: NextConfig = {
  // 静态导出，支持 GitHub Pages 部署
  output: isGithubPages ? 'export' : undefined,
  // GitHub Pages 部署时的 basePath
  basePath: isGithubPages ? '/file-compare-platform' : undefined,
  assetPrefix: isGithubPages ? '/file-compare-platform/' : undefined,
  trailingSlash: true,
  allowedDevOrigins: ['*.dev.coze.site'],
  images: {
    unoptimized: isGithubPages ? true : undefined,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
