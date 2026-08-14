import { expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { vuePluginLocation, VUE_TYPESCRIPT_PLUGIN } from '../src/lsp/project'
import { resolveServers } from '../src/lsp/servers'
import { fixture, launch, loadMarketExtensions, press, untilFrame } from './helpers'

// The vue extension is a market one: without this nothing serves `.vue` at all.
loadMarketExtensions()

const HYBRID = join(import.meta.dir, 'fixtures', 'hybrid-lsp.ts')
const TSSERVER = join(import.meta.dir, 'fixtures', 'tsserver-lsp.ts')
const SYNC = join(import.meta.dir, 'fixtures', 'sync-lsp.ts')

/** Two servers and a relay between them cross process boundaries twice. */
const LSP_WAIT = 15_000

const SFC = `<script setup lang="ts">
const message = 'hello'
</script>
`

test('a .vue file is served by the vue server and by a tsserver beside it', () => {
  const resolved = resolveServers('vue', {}).map(server => server.id)
  expect(resolved).toContain('vue')
  expect(resolved).toContain('vue-typescript')

  // The tsserver half is what carries the plugin, and the plugin is what makes
  // it read a single-file component rather than skip it.
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

  // The project's own copy is the one its `.vue` files are written against.
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

  // The hybrid server answers completion only once its relayed question came
  // back, and the label carries the body it got — so this asserts the whole
  // round trip, not merely that a menu opened.
  await press(t, input => void input.typeText('hy'))
  await untilFrame(t, 'hybrid:{"ran":"_vue:projectInfo"}', LSP_WAIT)
}, 30_000)

test('a tsserver/request nobody can answer is still answered', async () => {
  const dir = fixture({ 'a.vue': SFC })
  const t = await launch(
    dir,
    // The relay target is disabled, which is the shape of a machine that never
    // installed it. The request must still be answered — left pending, the vue
    // server holds every completion open and the menu never opens at all.
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
        // A healthy server that refuses a duplicate didOpen, the way real ones
        // do — beside a sibling whose binary is missing, the shape of a linter
        // extension installed without its linter. The dead client used to make
        // the first edit *re-open* the document instead of syncing it: the
        // live server refused the didOpen, kept its stale text, and answered
        // every completion one edit behind.
        'vue': [process.execPath, SYNC],
        'vue-typescript': ['druk-no-such-server'],
      },
    },
    {},
    { openFile: join(dir, 'a.vue') },
  )

  // The death is what arms the bug, so it must land before the edit does.
  await untilFrame(t, 'not installed', LSP_WAIT)
  await press(t, input => void input.typeText('ab'))
  // The label names the word at the cursor as the server sees it, and how many
  // didOpens it took: stale text or a second didOpen would spell differently.
  await untilFrame(t, 'abSync1', LSP_WAIT)
}, 30_000)

test('the item resolved is the one the answering server holds', async () => {
  // Two servers for one filetype, and the second is the one that answers: a
  // resolve aimed at the first would come back without the auto-import edit.
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
  // The detail, not the label: the label is also the text just typed, so a wait
  // on it would pass before the menu had opened.
  await untilFrame(t, 'resolve-import', LSP_WAIT)
  await press(t, input => input.pressEnter())
  // The edit arrives through completionItem/resolve, which only the server that
  // listed the item can serve.
  await untilFrame(t, 'import { drukLazy } from "druk"', LSP_WAIT)
}, 30_000)
