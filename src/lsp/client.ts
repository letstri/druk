/**
 * One language server: the process, the handshake, and document sync.
 *
 * Lifecycle is `starting → ready → dead`. Notifications sent while the server is
 * still initializing are queued — the protocol forbids anything before the
 * `initialized` notification, and rust-analyzer takes seconds to answer
 * `initialize` — and flushed in order once the handshake lands.
 */
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

/**
 * A server that spawns but never answers `initialize` would otherwise sit in
 * `starting` forever, silently queueing every notification. Generous: on a cold
 * cache rust-analyzer legitimately takes a while.
 */
const INITIALIZE_TIMEOUT_MS = 30_000

/**
 * Every live server process, killed from one shared `process.on('exit')` hook.
 * One listener however many servers run — a hook per client would trip Node's
 * ten-listener warning on `process`, printed to stderr over the TUI's frame.
 * `exit` handlers are the one thing that still runs on `process.exit()`, and
 * kill() is signal-only, so it is safe there.
 */
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

export interface LspClientOptions {
  /** The server's id, as its manifest declares it. Carried for the caller's sake. */
  id: string
  command: string[]
  rootDir: string
  onDiagnostics: (uri: string, diagnostics: Diagnostic[]) => void
  /**
   * The server is gone and will not be respawned: the command was not on PATH,
   * the handshake failed or timed out, or the process died. Called at most once,
   * and never for a `dispose()` the editor asked for. `missing` marks the one
   * failure that is the user's to fix by installing something.
   */
  onFail: (reason: string, missing: boolean) => void
  /**
   * A line for the status page's log: a stderr line, a window/logMessage, or a
   * lifecycle event. Fires whether or not anyone is looking — the page opens
   * after the interesting part, which is exactly when the log is wanted.
   */
  onLog?: (entry: Omit<ServerLogLine, 'time'>) => void
  /** Server-specific `initialize` options, when the caller has any to send. */
  initializationOptions?: unknown
  /**
   * The server's own configuration object, from its extension manifest.
   *
   * Answered to every `workspace/configuration` item and pushed once as a
   * `didChangeConfiguration` after the handshake. Undefined means "no opinion",
   * which is answered as `null` — the reply a server reads as "use your
   * defaults". Both halves matter: eslint asks per document and does nothing
   * with a null answer, and other servers only ever read the push.
   */
  settings?: unknown
  /**
   * The server asked for every open document's diagnostics to be re-pulled
   * (`workspace/diagnostic/refresh`) — it has learnt something the last answers
   * did not account for, a config file it watches most of all.
   */
  onRefreshDiagnostics?: () => void
}

/** window/logMessage's MessageType, spelled out. Anything unknown reads as "log". */
const MESSAGE_LEVEL: Record<number, string> = {
  1: 'error',
  2: 'warning',
  3: 'info',
  4: 'log',
  5: 'debug',
}

export function spawnLspClient(options: LspClientOptions) {
  const [executable, ...args] = options.command
  const child = spawn(executable!, args, {
    cwd: options.rootDir,
    // stderr must be drained: servers chat on it freely, and anything written to
    // an unread pipe would eventually block them mid-request. The listener below
    // consumes it whether or not `onLog` is listening.
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
  /** From the initialize reply: whether `completionItem/resolve` may be sent at all. */
  let resolveProvider = false
  /**
   * From the initialize reply: the server publishes nothing and answers
   * `textDocument/diagnostic` instead. TypeScript 7's server is the one druk
   * meets — a client that only listens would show an empty file forever.
   */
  let pullProvider = false
  /** Documents whose pull was asked for before the handshake finished. */
  const pendingPulls = new Set<string>()
  let nextId = 1
  const pending = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (error: Error) => void }
  >()
  /** Notifications owed to the server once `initialized` has been sent. */
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

  /**
   * Ask for a document's diagnostics, for the servers that answer instead of
   * publishing. A no-op for the rest, so callers may call it unconditionally.
   * A pull asked for during the handshake is remembered, not dropped.
   */
  const pullDiagnostics = (path: string) => {
    if (state === 'starting') return void pendingPulls.add(path)
    if (state !== 'ready' || !pullProvider) return
    const uri = pathToFileURL(path).href
    void request('textDocument/diagnostic', { textDocument: { uri } })
      .then(result => {
        // `unchanged` means the last report still holds; replacing it with an
        // empty list is how a file's problems would silently disappear.
        const report = result as DiagnosticReport | null
        if (report?.kind === 'full') options.onDiagnostics(uri, report.items ?? [])
      })
      .catch(() => {}) // a refused or cancelled pull leaves the last report standing
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
      // Server → client requests. druk implements none, but a request left
      // unanswered stalls some servers — so each gets the emptiest legal reply.
      if (message.method === 'workspace/configuration') {
        // The same object for every item: the requests are per document (eslint
        // asks with a `scopeUri`), and a manifest has one answer for the server,
        // not one per file.
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
    // Everything else ($/progress, telemetry) is server chatter.
  }

  child.stdout?.on('data', createDecoder(onMessage))
  child.on('error', error =>
    // Bun and Node word the ENOENT differently and both repeat the command name
    // the caller already has, so the raw message reads as a stutter in the status
    // bar. The flag is what lets the caller offer an install line instead.
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
      // Declared even though druk has no settings UI per server: without
      // `configuration` a server never asks, and one whose whole behaviour is
      // configured — eslint — silently does nothing. `refreshSupport` is the
      // other half: it is how such a server says its answers went stale.
      workspace: {
        configuration: true,
        workspaceFolders: true,
        didChangeConfiguration: { dynamicRegistration: true },
        diagnostics: { refreshSupport: true },
      },
      textDocument: {
        synchronization: { didSave: true },
        publishDiagnostics: {},
        // linkSupport lets a server answer with LocationLink, whose selection
        // range names the symbol rather than the whole declaration — a jump
        // that lands on the name instead of the doc comment above it.
        definition: { linkSupport: true },
        // Both models are declared: a server picks one, and typescript-go's
        // only answers pulls. Related documents are declined — druk asks per
        // open document, and the extra reports would have nowhere to go.
        diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
        completion: {
          completionItem: {
            // Snippets are declined — a terminal caret cannot tab through
            // placeholders — but servers send `${1:}` syntax regardless, so the
            // editor strips it on insert (see lsp/completion.ts).
            snippetSupport: false,
            insertReplaceSupport: true,
            // The signature/origin pair the menu draws beside a label, and the
            // documentation its detail panel shows.
            labelDetailsSupport: true,
            documentationFormat: ['markdown', 'plaintext'],
            deprecatedSupport: true,
            tagSupport: { valueSet: [1] },
            // Auto-import edits are costly to compute for every candidate, so
            // servers withhold them from the list and only attach them when the
            // client promises to ask again for the item it actually chose. Docs
            // and the full signature are withheld for the same reason, and the
            // menu asks for the selected item alone.
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
          }
        } | null
      )?.capabilities
      resolveProvider = capabilities?.completionProvider?.resolveProvider === true
      pullProvider = capabilities?.diagnosticProvider != null
      send({ jsonrpc: '2.0', method: 'initialized', params: {} })
      // After `initialized`, as the protocol requires, and before the queued
      // didOpens below — a server that reads only the push would otherwise
      // decide what to do with the first document before it had the settings.
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
      // After the didOpens above, or the server would answer about a document
      // it has not been told about.
      for (const path of pendingPulls) pullDiagnostics(path)
      pendingPulls.clear()
    })
    .catch((error: unknown) => {
      // A rejection from `die` (process error/exit, dispose) is already handled —
      // `die` no-ops when dead. An *error response* to initialize is not: without
      // this the client would sit in `starting` queueing notifications forever.
      die(error instanceof Error ? error.message : 'initialize failed')
    })
    .finally(() => clearTimeout(initTimeout))

  return {
    id: options.id,

    /** True once the handshake finished and false again when the server dies. */
    ready: () => state === 'ready',

    /**
     * True once the server is gone for good. Not `!ready()`: a client is also
     * un-ready while starting, and treating that as dead would tear down a
     * document sync the handshake is about to honour.
     */
    dead: () => state === 'dead',

    pullDiagnostics,

    /** Documents currently synced, as project-relative paths — the status page's list. */
    documents(): string[] {
      return [...versions.keys()].map(uri => relative(options.rootDir, fileURLToPath(uri)))
    },

    openDocument(path: string, languageId: string, text: string) {
      const uri = pathToFileURL(path).href
      versions.set(uri, 1)
      log('event', `opened ${relative(options.rootDir, path)}`)
      notify('textDocument/didOpen', { textDocument: { uri, languageId, version: 1, text } })
    },

    /** Full-document sync: simple and impossible to desynchronize. */
    changeDocument(path: string, text: string) {
      const uri = pathToFileURL(path).href
      const version = (versions.get(uri) ?? 1) + 1
      versions.set(uri, version)
      notify('textDocument/didChange', {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      })
    },

    /**
     * Completion at a position. Null while the server is still starting or once
     * it is dead — and on an error reply, which some servers use for "nothing
     * here" and none of which is worth surfacing over a keystroke.
     */
    complete(path: string, position: { line: number; character: number }): Promise<unknown> {
      if (state !== 'ready') return Promise.resolve(null)
      return request('textDocument/completion', {
        textDocument: { uri: pathToFileURL(path).href },
        position,
      }).catch(() => null)
    },

    /**
     * Where the symbol at `position` is defined. Null while the server is
     * starting or once it is dead, and on an error reply — servers answer one
     * for "nothing here", which is not worth a message over a keypress.
     */
    definition(path: string, position: { line: number; character: number }): Promise<unknown> {
      if (state !== 'ready') return Promise.resolve(null)
      return request('textDocument/definition', {
        textDocument: { uri: pathToFileURL(path).href },
        position,
      }).catch(() => null)
    },

    /**
     * Fill in what the server withheld from the completion list — auto-import
     * edits, mostly. Null when the server never offered resolve, and on an
     * error reply: the item is usable as it came, just without the extras.
     */
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

    /**
     * Polite but bounded: ask for shutdown, then make sure. Never blocks — the
     * caller is App teardown, and a test run must not wait on a server's mood.
     */
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
