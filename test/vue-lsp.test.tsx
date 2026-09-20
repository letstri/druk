import { expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { vuePluginLocation, VUE_TYPESCRIPT_PLUGIN } from '../src/lsp/project'
import { resolveServers } from '../src/lsp/servers'
import { fixture, launch, loadMarketExtensions, press, untilFrame } from './helpers'

loadMarketExtensions()

const HYBRID = join(import.meta.dir, 'fixtures', 'hybrid-lsp.ts')
const TSSERVER = join(import.meta.dir, 'fixtures', 'tsserver-lsp.ts')
const SYNC = join(import.meta.dir, 'fixtures', 'sync-lsp.ts')

const LSP_WAIT = 15_000

const SFC = `<script setup lang="ts">
const message = 'hello'
</script>
`

test('a .vue file is served by the vue server and by a tsserver beside it', () => {
  const resolved = resolveServers('vue', {}).map(server => server.id)
  expect(resolved).toContain('vue')
  expect(resolved).toContain('vue-typescript')

  const tsserver = resolveServers('vue', {}).find(server => server.id === 'vue-typescript')
  expect(tsserver?.command[0]).toBe('typescript-language-server')
  expect(tsserver?.install).toEqual({
    kind: 'npm',
    packages: ['typescript-language-server', VUE_TYPESCRIPT_PLUGIN, 'typescript@5'],
  })
})

test("the plugin location is a prefix, the project ahead of druk's own copy", () => {
  const project = fixture({ 'a.vue': SFC })
  const installed = fixture({ 'a.txt': '' })
  expect(vuePluginLocation(project, installed)).toBeNull()

  mkdirSync(join(installed, 'node_modules', VUE_TYPESCRIPT_PLUGIN), { recursive: true })
  expect(vuePluginLocation(project, installed)).toBe(installed)

  mkdirSync(join(project, 'node_modules', VUE_TYPESCRIPT_PLUGIN), { recursive: true })
  expect(vuePluginLocation(project, installed)).toBe(project)
})

test('a tsserver/request is relayed to the server that drives one', async () => {
  const dir = fixture({ 'a.vue': SFC })
  const t = await launch(
    dir,
    {
      lsp: true,
      lspServers: {
        'vue': [process.execPath, HYBRID],
        'vue-typescript': [process.execPath, TSSERVER],
      },
    },
    {},
    { openFile: join(dir, 'a.vue') },
  )

  await press(t, input => void input.typeText('hy'))
  await untilFrame(t, 'hybrid:{"ran":"_vue:projectInfo"}', LSP_WAIT)
}, 30_000)

test('a tsserver/request nobody can answer is still answered', async () => {
  const dir = fixture({ 'a.vue': SFC })
  const t = await launch(
    dir,
    // The relay target is disabled: unanswered, the vue server holds every completion open.
    { lsp: true, lspServers: { 'vue': [process.execPath, HYBRID], 'vue-typescript': [] } },
    {},
    { openFile: join(dir, 'a.vue') },
  )

  await press(t, input => void input.typeText('hy'))
  await untilFrame(t, 'hybrid:null', LSP_WAIT)
}, 30_000)

test('an edit still reaches the live server after a sibling dies', async () => {
  const dir = fixture({ 'a.vue': SFC })
  const t = await launch(
    dir,
    {
      lsp: true,
      lspServers: {
        'vue': [process.execPath, SYNC],
        'vue-typescript': ['druk-no-such-server'],
      },
    },
    {},
    { openFile: join(dir, 'a.vue') },
  )

  await untilFrame(t, 'not installed', LSP_WAIT)
  await press(t, input => void input.typeText('ab'))
  await untilFrame(t, 'abSync1', LSP_WAIT)
}, 30_000)

test('the item resolved is the one the answering server holds', async () => {
  const dir = fixture({ 'a.vue': SFC })
  writeFileSync(join(dir, 'def.ts'), 'export const drukLazy = 1\n')
  const t = await launch(
    dir,
    {
      lsp: true,
      lspServers: {
        'vue': [process.execPath, join(import.meta.dir, 'fixtures', 'silent-lsp.ts')],
        'vue-typescript': [process.execPath, join(import.meta.dir, 'fixtures', 'fake-lsp.ts')],
      },
    },
    {},
    { openFile: join(dir, 'a.vue') },
  )

  await press(t, input => void input.typeText('drukLazy'))
  await untilFrame(t, 'resolve-import', LSP_WAIT)
  await press(t, input => input.pressEnter())
  await untilFrame(t, 'import { drukLazy } from "druk"', LSP_WAIT)
}, 30_000)
