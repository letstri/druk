import { Outlet, createRootRoute, HeadContent, Scripts } from '@tanstack/react-router'
import { Analytics } from '@vercel/analytics/react'
import type { ReactNode } from 'react'

import css from '../styles.css?url'

const SITE = 'https://druk.sh'

const LD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  'name': 'druk',
  'applicationCategory': 'DeveloperApplication',
  'operatingSystem': 'macOS, Linux, Windows',
  'url': SITE,
  'downloadUrl': `${SITE}/install`,
  'softwareHelp': 'https://github.com/letstri/druk',
  'description':
    'A code editor that lives in your terminal. One self-contained binary — tree-sitter syntax, language servers, git, search, vim mode, extensions.',
  'license': 'https://github.com/letstri/druk/blob/main/LICENSE',
  'offers': { '@type': 'Offer', 'price': '0', 'priceCurrency': 'USD' },
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'druk — a code editor in your terminal' },
      {
        name: 'description',
        content:
          'druk is a code editor that lives in your terminal. One self-contained binary — tree-sitter syntax, language servers, git, search, vim mode, extensions. No Node, no Electron, no window.',
      },
      { name: 'theme-color', content: '#0d1117' },
      { name: 'author', content: 'letstri' },
      { property: 'og:site_name', content: 'druk' },
      { property: 'og:title', content: 'druk — a code editor in your terminal' },
      {
        property: 'og:description',
        content:
          'One self-contained binary. Tree-sitter syntax, language servers, git, search, vim mode, extensions.',
      },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: SITE },
      { property: 'og:image', content: `${SITE}/og.png` },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      {
        property: 'og:image:alt',
        content: 'druk — a code editor that lives in your terminal',
      },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: 'druk — a code editor in your terminal' },
      {
        name: 'twitter:description',
        content:
          'One self-contained binary. Tree-sitter syntax, language servers, git, search, vim mode, extensions.',
      },
      { name: 'twitter:image', content: `${SITE}/og.png` },
    ],
    links: [
      { rel: 'stylesheet', href: css },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(LD) }}
        />
      </head>
      <body>
        {children}
        <Analytics />
        <Scripts />
      </body>
    </html>
  )
}
