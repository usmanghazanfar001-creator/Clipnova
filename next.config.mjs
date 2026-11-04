/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["bullmq", "ioredis", "bcryptjs"],
};

export default nextConfig;
