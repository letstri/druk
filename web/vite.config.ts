import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 3000,
    // The extensions page imports the repository's own extensions/index.json,
    // which sits above web/ and is otherwise outside the dev server's allow list.
    fs: { allow: ['..'] },
  },
  plugins: [
    tanstackStart({
      prerender: {
        enabled: true,
        crawlLinks: true,
      },
    }),
    viteReact(),
    nitro({
      routeRules: {
        '/install': {
          redirect: {
            to: 'https://raw.githubusercontent.com/letstri/druk/main/install',
            status: 301,
          },
        },
      },
    }),
  ],
})
