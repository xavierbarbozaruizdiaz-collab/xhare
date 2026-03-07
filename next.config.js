/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: process.env.NODE_ENV === 'production',
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config, { isServer }) => {
    // Evitar que el build (Node) ejecute o empaquete @capacitor; solo se cargan en cliente vía dynamic import
    if (isServer) {
      const externals = config.externals || [];
      config.externals = [...externals, '@capacitor/core', '@capacitor/app', '@capacitor/browser', '@capacitor/app-launcher', '@capacitor/geolocation', '@capacitor/preferences', '@capacitor/push-notifications'];
    }
    return config;
  },
}

module.exports = nextConfig

