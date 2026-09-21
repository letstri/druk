import {
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
} from '@tanstack/react-router'
import { Analytics } from '@vercel/analytics/react'
import type { ReactNode } from 'react'

import css from '../styles.css?url'

const SITE = 'https://druk.sh'

const LD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  applicationCategory: 'DeveloperApplication',
  description:
    'A code editor that lives in your terminal. One self-contained binary — tree-sitter syntax, language servers, git, search, vim mode, extensions.',
  downloadUrl: `${SITE}/install`,
  license: 'https://github.com/letstri/druk/blob/main/LICENSE',
  name: 'druk',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  operatingSystem: 'macOS, Linux, Windows',
  softwareHelp: 'https://github.com/letstri/druk',
  url: SITE,
}

export const Route = createRootRoute({
  component: RootComponent,
  head: () => ({
    links: [
      { href: css, rel: 'stylesheet' },
      { href: '/favicon.svg', rel: 'icon', type: 'image/svg+xml' },
    ],
    meta: [
      { charSet: 'utf-8' },
      { content: 'width=device-width, initial-scale=1', name: 'viewport' },
      { title: 'druk — a code editor in your terminal' },
      {
        content:
          'druk is a code editor that lives in your terminal. One self-contained binary — tree-sitter syntax, language servers, git, search, vim mode, extensions. No Node, no Electron, no window.',
        name: 'description',
      },
      { content: '#0d1117', name: 'theme-color' },
      { content: 'letstri', name: 'author' },
      { content: 'druk', property: 'og:site_name' },
      {
        content: 'druk — a code editor in your terminal',
        property: 'og:title',
      },
      {
        content:
          'One self-contained binary. Tree-sitter syntax, language servers, git, search, vim mode, extensions.',
        property: 'og:description',
      },
      { content: 'website', property: 'og:type' },
      { content: SITE, property: 'og:url' },
      { content: `${SITE}/og.png`, property: 'og:image' },
      { content: '1200', property: 'og:image:width' },
      { content: '630', property: 'og:image:height' },
      {
        content: 'druk — a code editor that lives in your terminal',
        property: 'og:image:alt',
      },
      { content: 'summary_large_image', name: 'twitter:card' },
      {
        content: 'druk — a code editor in your terminal',
        name: 'twitter:title',
      },
      {
        content:
          'One self-contained binary. Tree-sitter syntax, language servers, git, search, vim mode, extensions.',
        name: 'twitter:description',
      },
      { content: `${SITE}/og.png`, name: 'twitter:image' },
    ],
  }),
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
