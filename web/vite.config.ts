import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    tanstackStart({
      prerender: {
        crawlLinks: true,
        enabled: true,
      },
    }),
    viteReact(),
    nitro({
      routeRules: {
        '/install': {
          redirect: {
            status: 301,
            to: 'https://raw.githubusercontent.com/letstri/druk/main/install',
          },
        },
      },
    }),
  ],
  server: {
    // The extensions page imports the repository's own extensions/index.json,
    // which sits above web/ and is otherwise outside the dev server's allow list.
    fs: { allow: ['..'] },
    port: 3000,
  },
})
