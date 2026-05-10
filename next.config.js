/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '30mb',
    },
    serverComponentsExternalPackages: ['twilio', 'jsonwebtoken'],
  },
};

module.exports = nextConfig;
