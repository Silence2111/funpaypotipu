/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@gamemarket/shared'],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
