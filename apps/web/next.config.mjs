/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Плавающий значок Next в углу попадал на скриншоты и показ
  devIndicators: false,
  transpilePackages: ['@gamemarket/shared'],
};

export default nextConfig;
