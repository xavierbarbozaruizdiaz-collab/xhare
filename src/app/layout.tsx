import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import ActiveRideBar from '@/components/ActiveRideBar'
import OfferAcceptedNotifier from '@/components/OfferAcceptedNotifier'
import ErrorBoundary from '@/components/ErrorBoundary'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Xhare - Transporte de Pasajeros',
  description: 'Sistema de transporte compartido con minibuses',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es">
      <body className={inter.className}>
        <ActiveRideBar />
        <OfferAcceptedNotifier />
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  )
}

