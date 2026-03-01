import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/dashboard/', '/settings/', '/onboarding/'],
    },
    sitemap: 'https://sessionforge.dev/sitemap.xml',
  }
}
