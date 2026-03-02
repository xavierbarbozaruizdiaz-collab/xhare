/** @type {import('next').NextConfig} */
const nextConfig = {
  // Desactivado en dev para reducir doble render y errores en WebView (Capacitor)
  reactStrictMode: process.env.NODE_ENV === 'production',
  eslint: {
    ignoreDuringBuilds: true,
  },
}

module.exports = nextConfig

