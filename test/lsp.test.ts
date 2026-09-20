import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MARKET_DIR } from '../scripts/extensions'
import { problemFrom, problemsOn } from '../src/app/lsp'
import type { Problem } from '../src/app/lsp'
import { loadExtensions } from '../src/extensions'
import { DEPRECATED_GROUP, styleIdForGroup, styleIdOver } from '../src/languages/highlight'
import { spawnLspClient } from '../src/lsp/client'
import {
  availablePackageManagers,
  downloadServer,
  installServer,
  installedCommand,
  removeServer,
} from '../src/lsp/install'
import { projectCommand, typescriptMajor } from '../src/lsp/project'
import type { Diagnostic, RpcMessage } from '../src/lsp/protocol'
import { headline, isDeprecated, isUnnecessary, severityOf } from '../src/lsp/protocol'
import { installHint, resolveServer, resolveServers } from '../src/lsp/servers'
import { createDecoder, encodeMessage } from '../src/lsp/transport'
import { tempDir } from './temp'

const FAKE = join(import.meta.dir, 'fixtures', 'fake-lsp.ts')

function collector<T>() {
  const items: T[] = []
  const waiters: { count: number; resolve: () => void }[] = []
  return {
    items,
    push(item: T) {
      items.push(item)
      for (let at = waiters.length - 1; at >= 0; at--) {
        if (items.length >= waiters[at]!.count) {
          waiters[at]!.resolve()
          waiters.splice(at, 1)
        }
      }
    },
    atLeast(count: number): Promise<void> {
      if (items.length >= count) return Promise.resolve()
      const { promise, resolve } = Promise.withResolvers<void>()
      waiters.push({ count, resolve })
      return promise
    },
  }
}

describe('framing', () => {
  const collect = () => {
    const messages: RpcMessage[] = []
    return { messages, sink: createDecoder(message => void messages.push(message)) }
  }

  test('a message split anywhere still decodes', () => {
    const { messages, sink } = collect()
    const frame = encodeMessage({ jsonrpc: '2.0', method: 'x', params: { a: 1 } })
    for (const byte of frame) sink(Buffer.from([byte]))
    expect(messages).toEqual([{ jsonrpc: '2.0', method: 'x', params: { a: 1 } }])
  })

  test('several messages in one chunk all decode', () => {
    const { messages, sink } = collect()
    sink(Buffer.concat([encodeMessage({ id: 1 }), encodeMessage({ id: 2 })]))
    expect(messages.map(m => m.id)).toEqual([1, 2])
  })

  test('Content-Length counts bytes, not characters', () => {
    const { messages, sink } = collect()
    sink(encodeMessage({ method: 'x', params: { text: 'héllo — ★' } }))
    expect((messages[0]!.params as { text: string }).text).toBe('héllo — ★')
  })

  test('header name is case-insensitive', () => {
    const { messages, sink } = collect()
    const body = Buffer.from('{"id":7}', 'utf8')
    sink(Buffer.concat([Buffer.from(`content-length: ${body.length}\r\n\r\n`), body]))
    expect(messages[0]!.id).toBe(7)
  })
})

describe('protocol mapping', () => {
  const at = (line: number, col: number): Diagnostic => ({
    range: { start: { line, character: col }, end: { line, character: col } },
    message: 'm',
  })

  test('severity defaults to error and maps the four levels', () => {
    expect(severityOf(at(0, 0))).toBe('error')
    expect(severityOf({ ...at(0, 0), severity: 2 })).toBe('warning')
    expect(severityOf({ ...at(0, 0), severity: 3 })).toBe('info')
    expect(severityOf({ ...at(0, 0), severity: 4 })).toBe('hint')
  })

  test('the span styles are registered for every severity', () => {
    for (const severity of ['error', 'warning', 'info', 'hint']) {
      expect(styleIdForGroup(`druk.problem.${severity}`)).not.toBeNull()
    }
    expect(styleIdForGroup('druk.problem.unnecessary')).not.toBeNull()
    expect(styleIdForGroup(DEPRECATED_GROUP)).not.toBeNull()
  })

  test('a severity tint over a token is its own style, not the bare tint', () => {
    const keyword = styleIdForGroup('keyword')
    const tint = styleIdForGroup('druk.problem.error')
    expect(keyword).not.toBeNull()
    const combined = styleIdOver('druk.problem.error', keyword)
    expect(combined).not.toBeNull()
    expect(combined).not.toBe(tint)
    expect(combined).not.toBe(keyword)
    expect(styleIdOver('druk.problem.error', keyword)).toBe(combined)
    expect(styleIdOver('druk.problem.error', null)).toBe(tint)
  })

  test('the Unnecessary tag is recognised, and other tags are not', () => {
    expect(isUnnecessary(at(0, 0))).toBe(false)
    expect(isUnnecessary({ ...at(0, 0), tags: [] })).toBe(false)
    expect(isUnnecessary({ ...at(0, 0), tags: [2] })).toBe(false)
    expect(isUnnecessary({ ...at(0, 0), tags: [1] })).toBe(true)
    expect(isUnnecessary({ ...at(0, 0), tags: [2, 1] })).toBe(true)
  })

  test('the Deprecated tag is recognised, and other tags are not', () => {
    expect(isDeprecated(at(0, 0))).toBe(false)
    expect(isDeprecated({ ...at(0, 0), tags: [1] })).toBe(false)
    expect(isDeprecated({ ...at(0, 0), tags: [2] })).toBe(true)
    expect(isDeprecated({ ...at(0, 0), tags: [1, 2] })).toBe(true)
  })

  loadExtensions(process.env.XDG_CONFIG_HOME!, [], MARKET_DIR)

  test('overrides replace a server command, and an empty one disables it', () => {
    expect(resolveServer('typescript', {})?.command[0]).toBe('typescript-language-server')
    expect(resolveServer('typescript', { typescript: ['deno', 'lsp'] })?.command).toEqual([
      'deno',
      'lsp',
    ])
    expect(resolveServer('typescript', { typescript: ['deno', 'lsp'] })?.install).toBeUndefined()
    expect(resolveServers('typescript', { typescript: [] }).map(server => server.id)).toEqual([
      'eslint',
      'oxlint',
    ])
    expect(resolveServers('brainfuck', {})).toEqual([])
    expect(resolveServer(undefined, {})).toBeNull()
  })

  test('a language may have several servers, the language server first', () => {
    expect(resolveServers('typescript', {}).map(server => server.id)).toEqual([
      'typescript',
      'eslint',
      'oxlint',
    ])
    const eslint = resolveServers('typescript', {}).find(server => server.id === 'eslint')
    expect((eslint?.settings as { validate?: string } | undefined)?.validate).toBe('on')
    const oxlint = resolveServers('typescript', {}).find(server => server.id === 'oxlint')
    expect((oxlint?.settings as { run?: string } | undefined)?.run).toBe('onType')
  })

  test('typescript is pinned to 5, the last line that ships a tsserver.js', () => {
    const install = resolveServer('typescript', {})?.install
    expect(install).toEqual({
      kind: 'npm',
      packages: ['typescript-language-server', 'typescript@5'],
    })
  })

  test('elixir is served by expert, the official Elixir LSP', () => {
    const resolved = resolveServer('elixir', {})
    expect(resolved?.command).toEqual(['expert', '--stdio'])
    const supported = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64']
    expect(resolved?.install?.kind).toBe(
      supported.includes(`${process.platform}-${process.arch}`) ? 'download' : 'manual',
    )
    expect(resolveServer('elixir', { elixir: ['next-ls'] })?.install).toBeUndefined()
  })

  test('install hints read as the command that installs the server', () => {
    expect(installHint({ kind: 'npm', packages: ['pyright'] })).toBe('npm i -g pyright')
    expect(installHint({ kind: 'manual', command: 'gem install solargraph' })).toBe(
      'gem install solargraph',
    )
  })
})

describe('installed servers', () => {
  test('a command is rewritten only when druk installed that binary', () => {
    const root = tempDir('druk-lsp-root-')
    const command = ['pyright-langserver', '--stdio']
    expect(installedCommand(command, root)).toBeNull()

    const bin = join(root, 'node_modules', '.bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'pyright-langserver'), '')
    expect(installedCommand(command, root)).toEqual([join(bin, 'pyright-langserver'), '--stdio'])
    const downloaded = join(root, 'bin', 'expert')
    mkdirSync(join(root, 'bin'), { recursive: true })
    writeFileSync(downloaded, '')
    expect(installedCommand(['expert', '--stdio'], root)).toEqual([downloaded, '--stdio'])
  })

  test('a release binary downloads into bin/ and reports HTTP errors', async () => {
    const root = tempDir('druk-lsp-root-')
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.url.endsWith('/missing')) return new Response('not here', { status: 404 })
        return new Response('#!/bin/sh\necho hi\n')
      },
    })
    try {
      const base = `http://127.0.0.1:${server.port}`
      expect(await downloadServer(`${base}/expert`, 'expert', root)).toBeNull()
      const target = join(root, 'bin', 'expert')
      expect(existsSync(target)).toBe(true)
      expect(installedCommand(['expert', '--stdio'], root)).toEqual([target, '--stdio'])
      expect(await downloadServer(`${base}/missing`, 'expert', root)).toBe('HTTP 404')
    } finally {
      server.stop()
    }
  }, 20_000)

  test('a downloaded server is removed by deleting its binary', async () => {
    const root = tempDir('druk-lsp-root-')
    const target = join(root, 'bin', 'expert')
    mkdirSync(join(root, 'bin'), { recursive: true })
    writeFileSync(target, '')
    expect(installedCommand(['expert'], root)).not.toBeNull()

    expect(
      await removeServer({ kind: 'download', url: 'http://x/expert' }, 'expert', root),
    ).toBeNull()
    expect(existsSync(target)).toBe(false)
    expect(
      await removeServer({ kind: 'download', url: 'http://x/expert' }, 'expert', root),
    ).toBeNull()
  })

  test('a server druk never installed is refused rather than half-removed', async () => {
    const root = tempDir('druk-lsp-root-')
    expect(await removeServer({ kind: 'manual', command: 'brew install zls' }, 'zls', root)).toBe(
      'druk did not install it',
    )
  })

  test('an install creates the manager working directory', async () => {
    const root = join(tempDir('druk-lsp-root-'), 'lsp')
    const path = process.env.PATH
    process.env.PATH = ''
    try {
      expect(await installServer(['druk-no-such-package'], root, 'bun')).toBe(
        'bun is not installed, or not on PATH',
      )
      expect(existsSync(root)).toBe(true)
    } finally {
      process.env.PATH = path
    }
  }, 20_000)

  test('no node leaves no manager to offer, whatever else is on PATH', () => {
    const root = tempDir('druk-lsp-root-')
    const path = process.env.PATH
    process.env.PATH = ''
    try {
      expect(availablePackageManagers(root)).toEqual([])
    } finally {
      process.env.PATH = path
    }
  })

  test('a prefix keeps the manager that filled it, so the removal matches the install', () => {
    const root = tempDir('druk-lsp-root-')
    writeFileSync(join(root, '.manager'), 'bun')
    expect(availablePackageManagers(root)).toEqual(['bun'])
  })

  test('installing a second server keeps the first', async () => {
    const root = tempDir('druk-lsp-root-')
    const fake = (name: string) => {
      const dir = join(tempDir('druk-fake-pkg-'), name)
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name, version: '1.0.0', bin: { [name]: 'cli.js' } }),
      )
      writeFileSync(join(dir, 'cli.js'), '#!/usr/bin/env node\n')
      return dir
    }

    expect(await installServer([fake('druk-fake-a')], root)).toBeNull()
    expect(installedCommand(['druk-fake-a'], root)).not.toBeNull()
    expect(await installServer([fake('druk-fake-b')], root)).toBeNull()
    expect(installedCommand(['druk-fake-a'], root)).not.toBeNull()
    expect(installedCommand(['druk-fake-b'], root)).not.toBeNull()
  }, 60_000)

  test('a prefix filled before the manifest existed is described, not pruned', async () => {
    const root = tempDir('druk-lsp-root-')
    const pkg = join(root, 'node_modules', 'typescript-language-server')
    mkdirSync(pkg, { recursive: true })
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({ name: 'typescript-language-server', version: '4.3.3' }),
    )
    mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true })

    const path = process.env.PATH
    process.env.PATH = ''
    try {
      await installServer(['druk-no-such-package'], root)
    } finally {
      process.env.PATH = path
    }
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(manifest.dependencies).toEqual({ 'typescript-language-server': '4.3.3' })
  }, 20_000)

  test('an install with no npm to run it fails instead of hanging', async () => {
    const root = tempDir('druk-lsp-root-')
    const path = process.env.PATH
    process.env.PATH = ''
    try {
      expect(await installServer(['druk-no-such-package'], root)).toBe(
        'npm is not installed, or not on PATH',
      )
    } finally {
      process.env.PATH = path
    }
  }, 20_000)
})

describe('the project’s own server', () => {
  const project = (files: Record<string, string>) => {
    const dir = tempDir('druk-project-')
    for (const [name, content] of Object.entries(files)) {
      const path = join(dir, name)
      mkdirSync(join(path, '..'), { recursive: true })
      writeFileSync(path, content)
    }
    return dir
  }
  const TLS = ['typescript-language-server', '--stdio']

  test('a project with nothing installed leaves the choice to the caller', () => {
    expect(projectCommand('typescript', TLS, project({}))).toBeNull()
    expect(typescriptMajor(project({}))).toBeNull()
  })

  test('a server in the project’s node_modules wins over anything global', () => {
    const dir = project({
      'node_modules/.bin/typescript-language-server': '',
      'node_modules/typescript/package.json': '{"version":"5.9.2"}',
    })
    expect(typescriptMajor(dir)).toBe(5)
    expect(projectCommand('typescript', TLS, dir)).toEqual([
      join(dir, 'node_modules', '.bin', 'typescript-language-server'),
      '--stdio',
    ])
  })

  test('TypeScript 7 is served by the compiler itself, not by tsserver', () => {
    const dir = project({
      'node_modules/.bin/tsc': '',
      'node_modules/.bin/typescript-language-server': '',
      'node_modules/typescript/package.json': '{"version":"7.0.2"}',
    })
    expect(typescriptMajor(dir)).toBe(7)
    expect(projectCommand('typescript', TLS, dir)).toEqual([
      join(dir, 'node_modules', '.bin', 'tsc'),
      '--lsp',
      '--stdio',
    ])
  })

  test('TypeScript 5’s tsc is never used as a server: it has no --lsp', () => {
    const dir = project({
      'node_modules/.bin/tsc': '',
      'node_modules/typescript/package.json': '{"version":"5.9.2"}',
    })
    expect(projectCommand('typescript', TLS, dir)).toBeNull()
  })

  test('the project is the nearest node_modules above the file, not the open folder', () => {
    const dir = project({
      'packages/app/node_modules/.bin/tsc': '',
      'packages/app/node_modules/typescript/package.json': '{"version":"7.0.2"}',
      'packages/app/src/index.ts': '',
    })
    const from = join(dir, 'packages', 'app', 'src')
    expect(projectCommand('typescript', TLS, dir, from)).toEqual([
      join(dir, 'packages', 'app', 'node_modules', '.bin', 'tsc'),
      '--lsp',
      '--stdio',
    ])
    const sub = join(dir, 'packages', 'app', 'src')
    mkdirSync(sub, { recursive: true })
    expect(projectCommand('typescript', TLS, sub)?.[0]).toBe(
      join(dir, 'packages', 'app', 'node_modules', '.bin', 'tsc'),
    )
    const other = project({ 'node_modules/.bin/typescript-language-server': '' })
    expect(projectCommand('typescript', TLS, other, dir)?.[0]).toBe(
      join(other, 'node_modules', '.bin', 'typescript-language-server'),
    )
  })

  test('the native preview compiler is a TypeScript 7 too', () => {
    const dir = project({
      'node_modules/.bin/tsgo': '',
      'node_modules/typescript/package.json': '{"version":"5.9.2"}',
      'node_modules/@typescript/native-preview/package.json': '{"version":"7.0.0-dev"}',
    })
    expect(projectCommand('typescript', TLS, dir)).toEqual([
      join(dir, 'node_modules', '.bin', 'tsgo'),
      '--lsp',
      '--stdio',
    ])
  })
})

describe('problemFrom', () => {
  const problem = (line: number, col: number): Problem => ({
    path: '/p',
    line,
    col,
    endLine: line,
    endCol: col,
    severity: 'error',
    unnecessary: false,
    deprecated: false,
    message: 'm',
  })
  const list = [problem(1, 4), problem(5, 0), problem(5, 9)]

  test('finds the next problem after the cursor, wrapping at the end', () => {
    expect(problemFrom(list, 0, 0, 1)).toEqual(problem(1, 4))
    expect(problemFrom(list, 1, 4, 1)).toEqual(problem(5, 0))
    expect(problemFrom(list, 5, 9, 1)).toEqual(problem(1, 4))
  })

  test('finds the previous problem, wrapping at the start', () => {
    expect(problemFrom(list, 5, 9, -1)).toEqual(problem(5, 0))
    expect(problemFrom(list, 1, 4, -1)).toEqual(problem(5, 9))
    expect(problemFrom([], 0, 0, -1)).toBeNull()
  })

  test('collects one line, worst first', () => {
    const warn = { ...problem(5, 2), severity: 'warning' as const }
    expect(problemsOn([problem(1, 4), warn, problem(5, 9)], 5)).toEqual([problem(5, 9), warn])
    expect(problemsOn(list, 2)).toEqual([])
  })
})

describe('headline', () => {
  test('drops the advice a server appends to the sentence', () => {
    expect(headline('Expected a function expression. help: Enforce the consistent use')).toEqual({
      text: 'Expected a function expression.',
      more: true,
    })
    expect(headline('Dependency cycle detected Help: Refactor to remove the cycle')).toEqual({
      text: 'Dependency cycle detected',
      more: true,
    })
  })

  test('keeps a message that is only what broke, and flattens it', () => {
    expect(headline('Type  X\tis not\nassignable')).toEqual({
      text: 'Type X is not',
      more: true,
    })
    expect(headline('Cannot find name a')).toEqual({ text: 'Cannot find name a', more: false })
  })

  test('leaves a colon that is not advice alone', () => {
    expect(headline("Property 'help' is missing: add it")).toEqual({
      text: "Property 'help' is missing: add it",
      more: false,
    })
  })
})

describe('client against a live server', () => {
  test('handshake, didOpen diagnostics, didChange clearing them, dispose', async () => {
    const dir = tempDir('druk-lsp-')
    const path = join(dir, 'a.ts')
    const deliveries = collector<Diagnostic[]>()
    const client = spawnLspClient({
      id: 'test',
      command: [process.execPath, FAKE],
      rootDir: dir,
      onDiagnostics: (_uri, diagnostics) => deliveries.push(diagnostics),
      onFail: reason => {
        throw new Error(`fake server failed: ${reason}`)
      },
    })

    client.openDocument(path, 'typescript', 'const oops = 1\n')
    await deliveries.atLeast(1)
    expect(deliveries.items[0]).toHaveLength(1)
    expect(deliveries.items[0]![0]!.range.start).toEqual({ line: 0, character: 6 })
    expect(client.ready()).toBe(true)

    client.changeDocument(path, 'const fine = 1\n')
    await deliveries.atLeast(2)
    expect(deliveries.items[1]).toHaveLength(0)

    client.dispose()
  }, 20_000)

  test('a command that is not on PATH reports failure instead of wedging', async () => {
    const { promise: failed, resolve: onFail } = Promise.withResolvers<{
      reason: string
      missing: boolean
    }>()
    const client = spawnLspClient({
      id: 'test',
      command: ['druk-no-such-language-server'],
      rootDir: tmpdir(),
      onDiagnostics: () => {},
      onFail: (reason, missing) => onFail({ reason, missing }),
    })
    expect(await failed).toEqual({ reason: 'is not installed, or not on PATH', missing: true })
    expect(client.ready()).toBe(false)
    expect(client.dead()).toBe(true)
    client.dispose()
  }, 10_000)

  test('a starting client is not dead — its documents must not be forgotten', () => {
    const client = spawnLspClient({
      id: 'test',
      command: [process.execPath, FAKE],
      rootDir: tmpdir(),
      onDiagnostics: () => {},
      onFail: () => {},
    })
    expect(client.ready()).toBe(false)
    expect(client.dead()).toBe(false)
    client.dispose()
  })
})
