import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Toaster } from 'sonner'
import { Providers } from '@/components/Providers'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'SessionForge — Remote AI Session Management',
  description:
    'Manage all your AI coding sessions from anywhere. Monitor, start, stop, and get alerts on every Claude Code instance across all your machines.',
  keywords: ['claude code', 'remote sessions', 'AI development', 'machine management'],
  openGraph: {
    title: 'SessionForge',
    description: 'Manage Claude from anywhere',
    type: 'website',
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
