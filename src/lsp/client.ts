import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type { LocationMethod } from './locations'
import type {
  CallHierarchyItem,
  CompletionItem,
  Diagnostic,
  DiagnosticReport,
  PublishDiagnosticsParams,
  RpcMessage,
} from './protocol'
import type { ServerLogLine } from './status'
import { createDecoder, encodeMessage } from './transport'

const INITIALIZE_TIMEOUT_MS = 30_000
const REQUEST_TIMEOUT_MS = 30_000

// One shared exit hook: a hook per client trips Node's ten-listener warning on `process`.
const liveChildren = new Set<ChildProcess>()
let exitHookInstalled = false

function trackChild(child: ChildProcess) {
  liveChildren.add(child)
  child.once('exit', () => liveChildren.delete(child))
  if (exitHookInstalled) {
    return
  }
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
  const shell = /\.(?:cmd|bat)$/iu.test(executable!)
  const child = spawn(shell ? `"${executable}"` : executable!, args, {
    cwd: options.rootDir,
    shell,
    // stderr must be drained whether or not `onLog` listens, or a chatty server blocks.
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  trackChild(child)

  const log = (kind: ServerLogLine['kind'], text: string) =>
    options.onLog?.({ kind, text })
  log('event', `spawned ${options.command.join(' ')}`)

  let stderrTail = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    const lines = (stderrTail + chunk.toString()).split('\n')
    stderrTail = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim().length > 0) {
        log('stderr', line)
      }
    }
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
    if (child.stdin?.writable) {
      child.stdin.write(encodeMessage(message))
    }
  }

  const request = async (method: string, params?: unknown) => {
    const { promise, reject, resolve } = Promise.withResolvers<unknown>()
    const id = nextId
    nextId += 1
    pending.set(id, { reject, resolve })
    // Without a deadline a server that never answers leaves the feature waiting for ever.
    const timer = setTimeout(() => {
      if (pending.delete(id)) {
        reject(new Error(`${method} timed out`))
      }
    }, REQUEST_TIMEOUT_MS)
    timer.unref?.()
    send({ id, jsonrpc: '2.0', method, params })
    try {
      return await promise
    } finally {
      clearTimeout(timer)
    }
  }

  const notify = (method: string, params: unknown) => {
    const message: RpcMessage = { jsonrpc: '2.0', method, params }
    if (state === 'starting') {
      queued.push(message)
    } else if (state === 'ready') {
      send(message)
    }
  }

  const pullDiagnostics = (path: string) => {
    if (state === 'starting') {
      pendingPulls.add(path)
      return
    }
    if (state !== 'ready' || !pullProvider) {
      return
    }
    const uri = pathToFileURL(path).href
    void (async () => {
      try {
        const result = await request('textDocument/diagnostic', {
          textDocument: { uri },
        })
        // `unchanged` means the last report still holds — not an empty list.
        const report = result as DiagnosticReport | null
        if (report?.kind === 'full') {
          options.onDiagnostics(uri, report.items ?? [])
        }
      } catch {
        // A server that cannot answer a pull leaves the last report standing.
      }
    })()
  }

  const answerTsserverRequest = async (entry: unknown): Promise<unknown> => {
    if (!Array.isArray(entry)) {
      return null
    }
    const [id, method, payload] = entry as [number, string, unknown]
    let body: unknown = null
    try {
      body = (await options.onTsserverRequest?.(method, payload)) ?? null
    } catch {
      body = null
    }
    return [id, body]
  }

  // Vue sends one `[id, command, args]` and waits for one `[id, body]`; every request must be
  // answered, null if need be, or the feature it was serving never completes.
  const answerTsserverRequests = async (params: unknown) => {
    if (!Array.isArray(params)) {
      return
    }
    if (typeof params[0] === 'number') {
      const answer = await answerTsserverRequest(params)
      if (answer) {
        notify('tsserver/response', answer)
      }
      return
    }
    const replies = await Promise.all(params.map(answerTsserverRequest))
    const answers = replies.filter((answer) => answer !== null)
    if (answers.length > 0) {
      notify('tsserver/response', answers)
    }
  }

  const die = (reason: string | null, missing = false) => {
    if (state === 'dead') {
      return
    }
    state = 'dead'
    log('event', reason === null || disposed ? 'stopped' : reason)
    for (const waiter of pending.values()) {
      waiter.reject(new Error(reason ?? 'disposed'))
    }
    pending.clear()
    queued.length = 0
    if (reason !== null && !disposed) {
      options.onFail(reason, missing)
    }
  }

  const onMessage = (message: RpcMessage) => {
    if (
      message.method !== undefined &&
      message.id !== null &&
      message.id !== undefined
    ) {
      // A server → client request left unanswered stalls some servers.
      if (message.method === 'workspace/configuration') {
        const items =
          (message.params as { items?: unknown[] } | undefined)?.items ?? []
        send({
          id: message.id,
          jsonrpc: '2.0',
          result: items.map(() => options.settings ?? null),
        })
      } else if (message.method === 'workspace/diagnostic/refresh') {
        send({ id: message.id, jsonrpc: '2.0', result: null })
        options.onRefreshDiagnostics?.()
      } else if (
        message.method === 'client/registerCapability' ||
        message.method === 'client/unregisterCapability' ||
        message.method === 'window/workDoneProgress/create'
      ) {
        send({ id: message.id, jsonrpc: '2.0', result: null })
      } else {
        send({
          error: {
            code: -32_601,
            message: `method not found: ${message.method}`,
          },
          id: message.id,
          jsonrpc: '2.0',
        })
      }
    } else if (message.method === 'textDocument/publishDiagnostics') {
      const params = message.params as PublishDiagnosticsParams
      // A report for text already edited past would put back the marks of a version nobody is reading.
      if (
        params.version !== undefined &&
        params.version < (versions.get(params.uri) ?? 0)
      ) {
        return
      }
      options.onDiagnostics(params.uri, params.diagnostics ?? [])
    } else if (message.method === 'tsserver/request') {
      void answerTsserverRequests(message.params)
    } else if (
      message.method === 'window/logMessage' ||
      message.method === 'window/showMessage'
    ) {
      const params = message.params as
        | { type?: number; message?: string }
        | undefined
      log(
        'server',
        `${MESSAGE_LEVEL[params?.type ?? 4] ?? 'log'}: ${params?.message ?? ''}`
      )
    } else if (message.id !== null && message.id !== undefined) {
      // A server may echo the id as a string; the waiter is keyed by the number that was sent.
      const id = Number(message.id)
      const waiter = pending.get(id)
      if (!waiter) {
        return
      }
      pending.delete(id)
      if (message.error) {
        waiter.reject(new Error(message.error.message))
      } else {
        waiter.resolve(message.result)
      }
    }
  }

  child.stdout?.on('data', createDecoder(onMessage))
  child.on('error', (error) =>
    'code' in error && error.code === 'ENOENT'
      ? die('is not installed, or not on PATH', true)
      : die(error.message)
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
    if (state !== 'starting') {
      return
    }
    die('did not answer initialize')
    killNow()
  }, INITIALIZE_TIMEOUT_MS)
  initTimeout.unref?.()

  const rootUri = pathToFileURL(options.rootDir).href
  const initialize = async () => {
    try {
      const result = await request('initialize', {
        capabilities: {
          textDocument: {
            callHierarchy: {},
            completion: {
              completionItem: {
                deprecatedSupport: true,
                documentationFormat: ['markdown', 'plaintext'],
                insertReplaceSupport: true,
                labelDetailsSupport: true,
                // Servers withhold these from the list until asked per chosen item.
                resolveSupport: {
                  properties: [
                    'documentation',
                    'detail',
                    'additionalTextEdits',
                  ],
                },
                // Servers send `${1:}` syntax regardless; completion.ts strips it on insert.
                snippetSupport: false,
                tagSupport: { valueSet: [1] },
              },
            },
            definition: { linkSupport: true },
            // Both models: typescript-go only answers pulls.
            diagnostic: {
              dynamicRegistration: false,
              relatedDocumentSupport: false,
            },
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            implementation: { linkSupport: true },
            publishDiagnostics: {},
            references: {},
            synchronization: { didSave: true },
            typeDefinition: { linkSupport: true },
          },
          // Without `configuration` a server never asks, and eslint then lints nothing.
          workspace: {
            configuration: true,
            diagnostics: { refreshSupport: true },
            didChangeConfiguration: { dynamicRegistration: true },
            symbol: {},
            workspaceFolders: true,
          },
        },
        initializationOptions: options.initializationOptions,
        processId: process.pid,
        rootUri,
        workspaceFolders: [{ name: 'workspace', uri: rootUri }],
      })
      if (state !== 'starting') {
        return
      }
      const capabilities = (
        result as {
          capabilities?: {
            completionProvider?: { resolveProvider?: boolean }
            diagnosticProvider?: unknown
            executeCommandProvider?: { commands?: string[] }
          }
        } | null
      )?.capabilities
      resolveProvider =
        capabilities?.completionProvider?.resolveProvider === true
      pullProvider =
        capabilities?.diagnosticProvider !== null &&
        capabilities?.diagnosticProvider !== undefined
      commands = new Set(capabilities?.executeCommandProvider?.commands)
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
      log(
        'event',
        `initialized — diagnostics ${pullProvider ? 'pulled' : 'published'}`
      )
      for (const message of queued) {
        send(message)
      }
      queued.length = 0
      // After the didOpens above, or the server is asked about documents it has not seen.
      for (const path of pendingPulls) {
        pullDiagnostics(path)
      }
      pendingPulls.clear()
    } catch (error: unknown) {
      // An error *response* to initialize leaves the client `starting` forever otherwise.
      die(error instanceof Error ? error.message : 'initialize failed')
    } finally {
      clearTimeout(initTimeout)
    }
  }
  initialize()

  return {
    // The item carries the answering server's own `data`: it goes back to that server alone.
    calls(
      direction: 'incoming' | 'outgoing',
      item: CallHierarchyItem
    ): Promise<unknown> {
      if (state !== 'ready') {
        return Promise.resolve(null)
      }
      return request(`callHierarchy/${direction}Calls`, { item }).catch(
        () => null
      )
    },

    changeDocument(path: string, text: string) {
      const uri = pathToFileURL(path).href
      const version = (versions.get(uri) ?? 1) + 1
      versions.set(uri, version)
      notify('textDocument/didChange', {
        contentChanges: [{ text }],
        textDocument: { uri, version },
      })
    },

    closeDocument(path: string) {
      const uri = pathToFileURL(path).href
      versions.delete(uri)
      log('event', `closed ${relative(options.rootDir, path)}`)
      notify('textDocument/didClose', { textDocument: { uri } })
    },

    complete(
      path: string,
      position: { line: number; character: number }
    ): Promise<unknown> {
      if (state !== 'ready') {
        return Promise.resolve(null)
      }
      return request('textDocument/completion', {
        position,
        textDocument: { uri: pathToFileURL(path).href },
      }).catch(() => null)
    },

    // Not `!ready()`: a starting client is un-ready too, and its sync is about to be honoured.
    dead: () => state === 'dead',

    // Never blocks: App teardown and tests must not wait on a server.
    dispose() {
      if (disposed) {
        return
      }
      disposed = true
      if (state === 'ready') {
        void (async () => {
          try {
            await request('shutdown')
          } catch {
            // A server already gone has nothing to shut down.
          }
        })()
        send({ jsonrpc: '2.0', method: 'exit' })
      }
      die(null)
      if (child.exitCode === null) {
        const backstop = setTimeout(killNow, 500)
        backstop.unref?.()
        child.once('exit', () => clearTimeout(backstop))
      }
    },

    documentSymbols(path: string): Promise<unknown> {
      if (state !== 'ready') {
        return Promise.resolve(null)
      }
      return request('textDocument/documentSymbol', {
        textDocument: { uri: pathToFileURL(path).href },
      }).catch(() => null)
    },

    documents(): string[] {
      return [...versions.keys()].map((uri) =>
        relative(options.rootDir, fileURLToPath(uri))
      )
    },

    executeCommand(command: string, params: unknown[]): Promise<unknown> {
      if (state !== 'ready') {
        return Promise.resolve(null)
      }
      return request('workspace/executeCommand', {
        arguments: params,
        command,
      }).catch(() => null)
    },

    hover(
      path: string,
      position: { line: number; character: number }
    ): Promise<unknown> {
      if (state !== 'ready') {
        return Promise.resolve(null)
      }
      return request('textDocument/hover', {
        position,
        textDocument: { uri: pathToFileURL(path).href },
      }).catch(() => null)
    },

    id: options.id,

    locate(
      method: LocationMethod,
      path: string,
      position: { line: number; character: number }
    ): Promise<unknown> {
      if (state !== 'ready') {
        return Promise.resolve(null)
      }
      return request(`textDocument/${method}`, {
        context:
          method === 'references' ? { includeDeclaration: false } : undefined,
        position,
        textDocument: { uri: pathToFileURL(path).href },
      }).catch(() => null)
    },

    openDocument(path: string, languageId: string, text: string) {
      const uri = pathToFileURL(path).href
      versions.set(uri, 1)
      log('event', `opened ${relative(options.rootDir, path)}`)
      notify('textDocument/didOpen', {
        textDocument: { languageId, text, uri, version: 1 },
      })
    },

    prepareCallHierarchy(
      path: string,
      position: { line: number; character: number }
    ): Promise<unknown> {
      if (state !== 'ready') {
        return Promise.resolve(null)
      }
      return request('textDocument/prepareCallHierarchy', {
        position,
        textDocument: { uri: pathToFileURL(path).href },
      }).catch(() => null)
    },

    pullDiagnostics,

    ready: () => state === 'ready',

    resolveCompletion(item: CompletionItem): Promise<CompletionItem | null> {
      if (state !== 'ready' || !resolveProvider) {
        return Promise.resolve(null)
      }
      return request('completionItem/resolve', item).then(
        (result) => result as CompletionItem | null,
        () => null
      )
    },

    saveDocument(path: string) {
      notify('textDocument/didSave', {
        textDocument: { uri: pathToFileURL(path).href },
      })
    },

    supportsCommand(command: string): boolean {
      return commands.has(command)
    },

    workspaceSymbols(query: string): Promise<unknown> {
      if (state !== 'ready') {
        return Promise.resolve(null)
      }
      return request('workspace/symbol', { query }).catch(() => null)
    },
  }
}

export type LspClient = ReturnType<typeof spawnLspClient>
