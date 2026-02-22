import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Toaster } from 'sonner'
import { Providers } from '@/components/Providers'
import { CookieConsent } from '@/components/CookieConsent'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  metadataBase: new URL('https://sessionforge.dev'),
  title: 'SessionForge — Remote AI Session Management',
  description:
    'Manage all your AI coding sessions from anywhere. Monitor, start, stop, and get alerts on every Claude Code instance across all your machines.',
  keywords: ['claude code', 'remote sessions', 'AI development', 'machine management'],
  openGraph: {
    title: 'SessionForge',
    description: 'Manage Claude from anywhere',
    type: 'website',
    url: 'https://sessionforge.dev',
    siteName: 'SessionForge',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'SessionForge — Remote AI Session Management',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SessionForge — Remote AI Session Management',
    description:
      'Manage all your AI coding sessions from anywhere. Monitor, start, stop, and get alerts on every Claude Code instance across all your machines.',
    images: ['/og-image.png'],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-[#0a0a0f] text-white antialiased`}>
        <Providers>
          {children}
        </Providers>
        <CookieConsent />
        <Toaster
          position="top-right"
          theme="dark"
          toastOptions={{
            style: {
              background: '#111118',
              border: '1px solid #1e1e2e',
              color: '#ffffff',
            },
          }}
        />
      </body>
    </html>
  )
}
