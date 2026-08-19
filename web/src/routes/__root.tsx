import { Outlet, createRootRoute, HeadContent, Scripts } from '@tanstack/react-router'
import { Analytics } from '@vercel/analytics/react'
import type { ReactNode } from 'react'

import css from '../styles.css?url'

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
      { property: 'og:title', content: 'druk — a code editor in your terminal' },
      {
        property: 'og:description',
        content:
          'One self-contained binary. Tree-sitter syntax, language servers, git, search, vim mode, extensions.',
      },
      { property: 'og:type', content: 'website' },
    ],
    links: [{ rel: 'stylesheet', href: css }],
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
      </head>
      <body>
        {children}
        <Analytics />
        <Scripts />
      </body>
    </html>
  )
}
