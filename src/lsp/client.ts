import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type {
  CompletionItem,
  Diagnostic,
  DiagnosticReport,
  PublishDiagnosticsParams,
  RpcMessage,
} from './protocol'
import type { ServerLogLine } from './status'
import { createDecoder, encodeMessage } from './transport'

const INITIALIZE_TIMEOUT_MS = 30_000

// One shared exit hook: a hook per client trips Node's ten-listener warning on `process`.
const liveChildren = new Set<ChildProcess>()
let exitHookInstalled = false

function trackChild(child: ChildProcess) {
  liveChildren.add(child)
  child.once('exit', () => liveChildren.delete(child))
  if (exitHookInstalled) return
  exitHookInstalled = true
  process.on('exit', () => {
    for (const live of liveChildren) {
      try {
        live.kill('SIGKILL')
      } catch {
        // already gone
      }
    }
  })
}

interface LspClientOptions {
  id: string
  command: string[]
  rootDir: string
  onDiagnostics: (uri: string, diagnostics: Diagnostic[]) => void
  // At most once, never for `dispose()`; `missing` = the command is not installed.
  onFail: (reason: string, missing: boolean) => void
  onLog?: (entry: Omit<ServerLogLine, 'time'>) => void
  initializationOptions?: unknown
  // Both ways: eslint reads only workspace/configuration, others only didChangeConfiguration.
  settings?: unknown
  onRefreshDiagnostics?: () => void
  onTsserverRequest?: (command: string, args: unknown) => Promise<unknown>
}

const MESSAGE_LEVEL: Record<number, string> = {
  1: 'error',
  2: 'warning',
  3: 'info',
  4: 'log',
  5: 'debug',
}

export function spawnLspClient(options: LspClientOptions) {
  const [executable, ...args] = options.command
  // A `.cmd` shim (npm's on Windows) needs a shell (spawn fails EINVAL) and quoting for spaces.
  const shell = /\.(?:cmd|bat)$/i.test(executable!)
  const child = spawn(shell ? `"${executable}"` : executable!, args, {
    cwd: options.rootDir,
    shell,
    // stderr must be drained whether or not `onLog` listens, or a chatty server blocks.
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  trackChild(child)

  const log = (kind: ServerLogLine['kind'], text: string) => options.onLog?.({ kind, text })
  log('event', `spawned ${options.command.join(' ')}`)

  let stderrTail = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    const lines = (stderrTail + chunk.toString()).split('\n')
    stderrTail = lines.pop() ?? ''
    for (const line of lines) if (line.trim().length > 0) log('stderr', line)
  })

  let state: 'starting' | 'ready' | 'dead' = 'starting'
  let disposed = false
  let resolveProvider = false
  let pullProvider = false
  let commands = new Set<string>()
  const pendingPulls = new Set<string>()
  let nextId = 1
  const pending = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (error: Error) => void }
  >()
  const queued: RpcMessage[] = []
  const versions = new Map<string, number>()

  const send = (message: RpcMessage) => {
    if (child.stdin?.writable) child.stdin.write(encodeMessage(message))
  }

  const request = (method: string, params?: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      send({ jsonrpc: '2.0', id, method, params })
    })

  const notify = (method: string, params: unknown) => {
    const message: RpcMessage = { jsonrpc: '2.0', method, params }
    if (state === 'starting') queued.push(message)
    else if (state === 'ready') send(message)
  }

  const pullDiagnostics = (path: string) => {
    if (state === 'starting') return void pendingPulls.add(path)
    if (state !== 'ready' || !pullProvider) return
    const uri = pathToFileURL(path).href
    void request('textDocument/diagnostic', { textDocument: { uri } })
      .then(result => {
        // `unchanged` means the last report still holds — not an empty list.
        const report = result as DiagnosticReport | null
        if (report?.kind === 'full') options.onDiagnostics(uri, report.items ?? [])
      })
      .catch(() => {})
  }

  // Vue relay: every entry must be answered, null if need be, or the server hangs the feature.
  const answerTsserverRequests = async (params: unknown) => {
    if (!Array.isArray(params)) return
    const answers: [number, unknown][] = []
    for (const entry of params as unknown[]) {
      if (!Array.isArray(entry)) continue
      const [id, command, args] = entry as [number, string, unknown]
      let body: unknown = null
      try {
        body = (await options.onTsserverRequest?.(command, args)) ?? null
      } catch {
        body = null
      }
      answers.push([id, body])
    }
    if (answers.length > 0) notify('tsserver/response', answers)
  }

  const die = (reason: string | null, missing = false) => {
    if (state === 'dead') return
    state = 'dead'
    log('event', reason === null || disposed ? 'stopped' : reason)
    for (const waiter of pending.values()) waiter.reject(new Error(reason ?? 'disposed'))
    pending.clear()
    queued.length = 0
    if (reason !== null && !disposed) options.onFail(reason, missing)
  }

  const onMessage = (message: RpcMessage) => {
    if (message.method !== undefined && message.id != null) {
      // A server → client request left unanswered stalls some servers.
      if (message.method === 'workspace/configuration') {
        const items = (message.params as { items?: unknown[] } | undefined)?.items ?? []
        send({ jsonrpc: '2.0', id: message.id, result: items.map(() => options.settings ?? null) })
      } else if (message.method === 'workspace/diagnostic/refresh') {
        send({ jsonrpc: '2.0', id: message.id, result: null })
        options.onRefreshDiagnostics?.()
      } else if (
        message.method === 'client/registerCapability' ||
        message.method === 'client/unregisterCapability' ||
        message.method === 'window/workDoneProgress/create'
      ) {
        send({ jsonrpc: '2.0', id: message.id, result: null })
      } else {
        send({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: `method not found: ${message.method}` },
        })
      }
    } else if (message.method === 'textDocument/publishDiagnostics') {
      const params = message.params as PublishDiagnosticsParams
      options.onDiagnostics(params.uri, params.diagnostics ?? [])
    } else if (message.method === 'tsserver/request') {
      void answerTsserverRequests(message.params)
    } else if (message.method === 'window/logMessage' || message.method === 'window/showMessage') {
      const params = message.params as { type?: number; message?: string } | undefined
      log('server', `${MESSAGE_LEVEL[params?.type ?? 4] ?? 'log'}: ${params?.message ?? ''}`)
    } else if (message.id != null) {
      const waiter = pending.get(message.id as number)
      if (!waiter) return
      pending.delete(message.id as number)
      if (message.error) waiter.reject(new Error(message.error.message))
      else waiter.resolve(message.result)
    }
  }

  child.stdout?.on('data', createDecoder(onMessage))
  child.on('error', error =>
    'code' in error && error.code === 'ENOENT'
      ? die('is not installed, or not on PATH', true)
      : die(error.message),
  )
  child.on('exit', () => die('exited'))

  const killNow = () => {
    try {
      child.kill('SIGKILL')
    } catch {
      // already gone
    }
  }

  const initTimeout = setTimeout(() => {
    if (state !== 'starting') return
    die('did not answer initialize')
    killNow()
  }, INITIALIZE_TIMEOUT_MS)
  initTimeout.unref?.()

  const rootUri = pathToFileURL(options.rootDir).href
  void request('initialize', {
    processId: process.pid,
    rootUri,
    capabilities: {
      // Without `configuration` a server never asks, and eslint then lints nothing.
      workspace: {
        configuration: true,
        workspaceFolders: true,
        didChangeConfiguration: { dynamicRegistration: true },
        diagnostics: { refreshSupport: true },
      },
      textDocument: {
        synchronization: { didSave: true },
        publishDiagnostics: {},
        definition: { linkSupport: true },
        // Both models: typescript-go only answers pulls.
        diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
        completion: {
          completionItem: {
            // Servers send `${1:}` syntax regardless; completion.ts strips it on insert.
            snippetSupport: false,
            insertReplaceSupport: true,
            labelDetailsSupport: true,
            documentationFormat: ['markdown', 'plaintext'],
            deprecatedSupport: true,
            tagSupport: { valueSet: [1] },
            // Servers withhold these from the list until asked per chosen item.
            resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] },
          },
        },
      },
    },
    workspaceFolders: [{ uri: rootUri, name: 'workspace' }],
    initializationOptions: options.initializationOptions,
  })
    .then(result => {
      if (state !== 'starting') return
      const capabilities = (
        result as {
          capabilities?: {
            completionProvider?: { resolveProvider?: boolean }
            diagnosticProvider?: unknown
            executeCommandProvider?: { commands?: string[] }
          }
        } | null
      )?.capabilities
      resolveProvider = capabilities?.completionProvider?.resolveProvider === true
      pullProvider = capabilities?.diagnosticProvider != null
      commands = new Set(capabilities?.executeCommandProvider?.commands ?? [])
      send({ jsonrpc: '2.0', method: 'initialized', params: {} })
      // After `initialized` (the protocol) and before the queued didOpens (the settings).
      if (options.settings !== undefined) {
        send({
          jsonrpc: '2.0',
          method: 'workspace/didChangeConfiguration',
          params: { settings: options.settings },
        })
      }
      state = 'ready'
      log('event', `initialized — diagnostics ${pullProvider ? 'pulled' : 'published'}`)
      for (const message of queued) send(message)
      queued.length = 0
      // After the didOpens above, or the server is asked about documents it has not seen.
      for (const path of pendingPulls) pullDiagnostics(path)
      pendingPulls.clear()
    })
    .catch((error: unknown) => {
      // An error *response* to initialize leaves the client `starting` forever otherwise.
      die(error instanceof Error ? error.message : 'initialize failed')
    })
    .finally(() => clearTimeout(initTimeout))

  return {
    id: options.id,

    ready: () => state === 'ready',

    // Not `!ready()`: a starting client is un-ready too, and its sync is about to be honoured.
    dead: () => state === 'dead',

    pullDiagnostics,

    supportsCommand(command: string): boolean {
      return commands.has(command)
    },

    executeCommand(command: string, args: unknown[]): Promise<unknown> {
      if (state !== 'ready') return Promise.resolve(null)
      return request('workspace/executeCommand', { command, arguments: args }).catch(() => null)
    },

    documents(): string[] {
      return [...versions.keys()].map(uri => relative(options.rootDir, fileURLToPath(uri)))
    },

    openDocument(path: string, languageId: string, text: string) {
      const uri = pathToFileURL(path).href
      versions.set(uri, 1)
      log('event', `opened ${relative(options.rootDir, path)}`)
      notify('textDocument/didOpen', { textDocument: { uri, languageId, version: 1, text } })
    },

    changeDocument(path: string, text: string) {
      const uri = pathToFileURL(path).href
      const version = (versions.get(uri) ?? 1) + 1
      versions.set(uri, version)
      notify('textDocument/didChange', {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      })
    },

    complete(path: string, position: { line: number; character: number }): Promise<unknown> {
      if (state !== 'ready') return Promise.resolve(null)
      return request('textDocument/completion', {
        textDocument: { uri: pathToFileURL(path).href },
        position,
      }).catch(() => null)
    },

    definition(path: string, position: { line: number; character: number }): Promise<unknown> {
      if (state !== 'ready') return Promise.resolve(null)
      return request('textDocument/definition', {
        textDocument: { uri: pathToFileURL(path).href },
        position,
      }).catch(() => null)
    },

    resolveCompletion(item: CompletionItem): Promise<CompletionItem | null> {
      if (state !== 'ready' || !resolveProvider) return Promise.resolve(null)
      return request('completionItem/resolve', item).then(
        result => result as CompletionItem | null,
        () => null,
      )
    },

    saveDocument(path: string) {
      notify('textDocument/didSave', { textDocument: { uri: pathToFileURL(path).href } })
    },

    closeDocument(path: string) {
      const uri = pathToFileURL(path).href
      versions.delete(uri)
      log('event', `closed ${relative(options.rootDir, path)}`)
      notify('textDocument/didClose', { textDocument: { uri } })
    },

    // Never blocks: App teardown and tests must not wait on a server.
    dispose() {
      if (disposed) return
      disposed = true
      if (state === 'ready') {
        void request('shutdown').catch(() => {})
        send({ jsonrpc: '2.0', method: 'exit' })
      }
      die(null)
      if (child.exitCode === null) {
        const backstop = setTimeout(killNow, 500)
        backstop.unref?.()
        child.once('exit', () => clearTimeout(backstop))
      }
    },
  }
}

export type LspClient = ReturnType<typeof spawnLspClient>
