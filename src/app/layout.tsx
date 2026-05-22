import type { Metadata } from 'next'
import { Montserrat } from 'next/font/google'
import './globals.css'
import ActiveRideBar from '@/components/ActiveRideBar'
import OfferAcceptedNotifier from '@/components/OfferAcceptedNotifier'
import ErrorBoundary from '@/components/ErrorBoundary'
import PushRegistration from '@/components/PushRegistration'
import WebRoleGate from '@/components/WebRoleGate'
import { siteMetadata } from '@/lib/brand'

const montserrat = Montserrat({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: siteMetadata.title,
  description: siteMetadata.description,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es">
      <body className={montserrat.className}>
        <WebRoleGate />
        <ActiveRideBar />
        <OfferAcceptedNotifier />
        <PushRegistration />
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  )
}

