import type { NextConfig } from 'next';

// GitHub Pages serves project sites from /<repo-name>/. The deploy workflow
// injects that prefix; a user site (or local build) leaves it empty.
const basePath = process.env.PAGES_BASE_PATH ?? '';

const nextConfig: NextConfig = {
  output: 'export',
  basePath,
  assetPrefix: basePath || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
