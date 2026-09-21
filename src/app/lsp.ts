import { dirname } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { createEffect, createSignal, onCleanup } from 'solid-js'
import { createStore } from 'solid-js/store'

import { extensions } from '../extensions'
import { filetypeForPath } from '../languages/highlight'
import { spawnLspClient } from '../lsp/client'
import type { LspClient } from '../lsp/client'
import { normalizeCompletion } from '../lsp/completion'
import type { CompletionReply } from '../lsp/completion'
import {
  availablePackageManagers,
  downloadServer,
  installServer,
  installedCommand,
  removeServer,
  SERVER_ROOT,
} from '../lsp/install'
import type { PackageManager } from '../lsp/install'
import { normalizeLocations } from '../lsp/locations'
import type { LocationMethod, Target } from '../lsp/locations'
import {
  projectCommand,
  VUE_TYPESCRIPT_PLUGIN,
  vuePluginLocation,
} from '../lsp/project'
import {
  isDeprecated,
  isUnnecessary,
  SEVERITY_RANK,
  severityOf,
} from '../lsp/protocol'
import type { CompletionItem, Diagnostic, Problem } from '../lsp/protocol'
import {
  installHint,
  resolveServers,
  servers as serverSpecs,
} from '../lsp/servers'
import type { FetchableInstall, ResolvedServer } from '../lsp/servers'
import type { ServerLogLine, ServerView } from '../lsp/status'
import type { PromptState } from './prompts'
import type { Settings } from './settings'
import type { Status } from './status'
import type { Workspace } from './workspace'

export type { Problem } from '../lsp/protocol'

const CHANGE_DEBOUNCE_MS = 150

// The wait is for the *writing* to stop: a server spawned into a half-written tree is stale.
const DEPENDENCY_QUIET_MS = 2000

const MAX_SERVER_LOG = 300

const VUE_TYPESCRIPT = 'vue-typescript'

// How Vue's `tsserver/request` reaches a real project (`answerTsserverRequests` in lsp/client.ts).
const TSSERVER_REQUEST = 'typescript.tsserverRequest'

// Vue asks as the first `.vue` opens, while the tsserver beside it is still reading the project.
const RELAY_WAIT_MS = 20_000

// A linter claiming the filetype does not count — eslint claims `.vue` and `.svelte`.
function languageServed(filetype: string | undefined): boolean {
  if (!filetype) {
    return false
  }
  return extensions().some(
    (extension) =>
      !extension.disabled &&
      extension.categories.includes('language') &&
      extension.servers.some((server) => server.filetypes.includes(filetype))
  )
}

// Only servers holding the same documents may field a relayed request: a `.ts` tsserver has not.
function siblingIds(from: string): Set<string> {
  const filetypes = new Set(
    serverSpecs().find((spec) => spec.id === from)?.filetypes
  )
  return new Set(
    serverSpecs()
      .filter(
        (spec) =>
          spec.id !== from && spec.filetypes.some((type) => filetypes.has(type))
      )
      .map((spec) => spec.id)
  )
}

export function createLsp(deps: {
  rootDir: string
  settings: Settings
  status: Status
  prompts: PromptState
}) {
  const { rootDir, settings, status, prompts } = deps

  const [problems, setProblems] = createStore<Record<string, Problem[]>>({})
  // Per sender: merging in place would let whichever server published last wipe the other's marks.
  const bySource = new Map<string, Map<string, Problem[]>>()

  // A pull server answers `workspace/diagnostic/refresh` by publishing nothing: re-ask each document.
  let refreshPulls: ((serverId: string) => void) | null = null
  const onDiagnosticsRefresh = (refresh: (serverId: string) => void) => {
    refreshPulls = refresh
  }
  // By server id. `null` marks one that failed, so nothing respawns it.
  const clients = new Map<string, LspClient | null>()
  // Bumped when a server becomes spawnable again: `wireLspEffects` re-opens the skipped documents.
  const [generation, setGeneration] = createSignal(0)
  // Bumped by `restart`: `wireLspEffects` forgets which documents are open and sends them all again.
  const [restarts, setRestarts] = createSignal(0)
  const offered = new Set<string>()

  // A setter rather than a dependency: the market controller is built after this one.
  let onNoServer:
    | ((path: string, filetype: string | undefined) => void)
    | null = null
  const onMissingServer = (
    handle: (path: string, filetype: string | undefined) => void
  ) => {
    onNoServer = handle
  }

  const [servers, setServers] = createStore<Record<string, ServerView>>({})

  const timeStamp = () => new Date().toTimeString().slice(0, 8)

  const appendLog = (id: string, entry: Omit<ServerLogLine, 'time'>) => {
    setServers(id, 'logs', (logs) => {
      const next = [...logs, { time: timeStamp(), ...entry }]
      return next.length > MAX_SERVER_LOG
        ? next.slice(next.length - MAX_SERVER_LOG)
        : next
    })
  }

  const byPosition = (a: Problem, b: Problem) =>
    a.line - b.line || a.col - b.col

  const merge = (path: string) => {
    const senders = bySource.get(path)
    const all = senders ? [...senders.values()].flat() : []
    setProblems(path, all.toSorted(byPosition))
  }

  const onDiagnosticsFrom =
    (serverId: string) => (uri: string, diagnostics: Diagnostic[]) => {
      let path: string
      try {
        path = fileURLToPath(uri)
      } catch {
        // a scheme druk never opened; nothing to attach it to
        return
      }
      const senders = bySource.get(path) ?? new Map<string, Problem[]>()
      senders.set(
        serverId,
        diagnostics.map((diagnostic) => ({
          code:
            diagnostic.code === undefined ? undefined : String(diagnostic.code),
          col: diagnostic.range.start.character,
          deprecated: isDeprecated(diagnostic),
          endCol: diagnostic.range.end.character,
          endLine: diagnostic.range.end.line,
          line: diagnostic.range.start.line,
          message: diagnostic.message,
          path,
          severity: severityOf(diagnostic),
          source: diagnostic.source,
          unnecessary: isUnnecessary(diagnostic),
        }))
      )
      bySource.set(path, senders)
      merge(path)
    }

  // A dead server's marks are about text nobody can re-check: they would sit there until the tab closed.
  const forgetMarksFrom = (serverId: string) => {
    for (const [path, senders] of bySource) {
      if (senders.delete(serverId)) {
        merge(path)
      }
    }
  }

  const clearProblems = (path: string) => {
    bySource.delete(path)
    if (problems[path]?.length) {
      setProblems(path, [])
    }
  }

  const reportMissing = (resolved: ResolvedServer) => {
    const name = resolved.command[0]!
    const spec = resolved.install
    if (!spec) {
      return status.say(
        `LSP: ${name} is not installed, or not on PATH — Restart language servers once it is`,
        'warn'
      )
    }
    if (
      (spec.kind === 'npm' || spec.kind === 'download') &&
      settings.config.lspAutoInstall &&
      !offered.has(resolved.id)
    ) {
      const managers = spec.kind === 'npm' ? availablePackageManagers() : []
      if (spec.kind === 'npm' && managers.length === 0) {
        return status.say(
          `LSP: ${name} not installed — ${installHint(spec)}`,
          'warn'
        )
      }
      offered.add(resolved.id)
      return prompts.setPrompt({
        id: resolved.id,
        install: spec,
        kind: 'installServer',
        managers,
        name,
      })
    }
    status.say(`LSP: ${name} not installed — ${installHint(spec)}`, 'warn')
  }

  const initializationOptionsFor = (id: string): unknown => {
    if (id === VUE_TYPESCRIPT) {
      const location = vuePluginLocation(rootDir, SERVER_ROOT)
      if (location) {
        return {
          plugins: [
            { languages: ['vue'], location, name: VUE_TYPESCRIPT_PLUGIN },
          ],
        }
      }
      // Without the plugin its tsserver reads a `.vue` as no language at all and is silent.
      status.say(
        `LSP: ${VUE_TYPESCRIPT_PLUGIN} not installed — no TypeScript in .vue`,
        'warn'
      )
      return undefined
    }
    if (id !== 'typescript') {
      return undefined
    }
    const tsdk = settings.config.typescriptTsdk.trim()
    return tsdk ? { tsserver: { path: tsdk } } : undefined
  }

  // The wait is load-bearing: Vue asks first thing, and a sibling mid-handshake advertises no commands.
  const relayTsserverRequest = async (
    from: string,
    command: string,
    args: unknown
  ) => {
    const siblings = siblingIds(from)
    const deadline = Date.now() + RELAY_WAIT_MS
    for (;;) {
      const others = [...clients.values()].filter(
        (client): client is LspClient =>
          client !== null && siblings.has(client.id)
      )
      const target = others.find((client) =>
        client.supportsCommand(TSSERVER_REQUEST)
      )
      if (target) {
        const reply = (await target.executeCommand(TSSERVER_REQUEST, [
          command,
          args,
        ])) as {
          body?: unknown
        } | null
        return reply?.body ?? null
      }
      if (!others.some((client) => !client.ready() && !client.dead())) {
        return null
      }
      if (Date.now() >= deadline) {
        return null
      }
      await sleep(50)
    }
  }

  const spawnFor = (
    resolved: ResolvedServer,
    path: string
  ): LspClient | null => {
    const known = clients.get(resolved.id)
    if (known !== undefined) {
      return known
    }
    // Project copy first (only it serves a TS 7.x project), then druk's, then PATH; one server per id.
    const project = projectCommand(
      resolved.id,
      resolved.command,
      rootDir,
      dirname(path)
    )
    const fetched = project ? null : installedCommand(resolved.command)
    const command = project ?? fetched ?? resolved.command
    setServers(resolved.id, {
      command,
      docs: [],
      error: null,
      id: resolved.id,
      logs: servers[resolved.id]?.logs ?? [],
      state: 'starting',
    })
    // Assigned below, so the spawn's own synchronous log lines miss it.
    let spawned: LspClient | null = null
    const client = spawnLspClient({
      command,
      id: resolved.id,
      initializationOptions: initializationOptionsFor(resolved.id),
      onDiagnostics: onDiagnosticsFrom(resolved.id),
      onFail: (reason, missing) => {
        clients.set(resolved.id, null)
        forgetMarksFrom(resolved.id)
        setServers(resolved.id, { error: reason, state: 'failed' })
        if (missing) {
          return reportMissing(resolved)
        }
        status.say(
          fetched
            ? `LSP: ${command[0]} ${reason} — delete ${SERVER_ROOT} to reinstall it`
            : `LSP: ${command[0]} ${reason} — Restart language servers to try again`,
          'warn'
        )
      },
      onLog: (entry) => {
        appendLog(resolved.id, entry)
        if (!spawned) {
          return
        }
        setServers(resolved.id, 'docs', spawned.documents())
        // 'failed' is onFail's to set: it knows the reason.
        if (servers[resolved.id]?.state !== 'failed') {
          setServers(
            resolved.id,
            'state',
            spawned.dead() ? 'stopped' : spawned.ready() ? 'ready' : 'starting'
          )
        }
      },
      onRefreshDiagnostics: () => refreshPulls?.(resolved.id),
      onTsserverRequest: (name, params) =>
        relayTsserverRequest(resolved.id, name, params),
      rootDir,
      settings: resolved.settings,
    })
    spawned = client
    clients.set(resolved.id, client)
    return client
  }

  const clientsFor = (path: string): LspClient[] => {
    if (!settings.config.lsp) {
      return []
    }
    const filetype = filetypeForPath(path)
    // A server turned off is an answer, not a gap: offering its extension re-asks what was declined.
    const turnedOff =
      filetype !== undefined &&
      serverSpecs().some(
        (spec) =>
          spec.filetypes.includes(filetype) &&
          settings.config.lspServers[spec.id]?.length === 0
      )
    if (!turnedOff && !languageServed(filetype)) {
      onNoServer?.(path, filetype)
    }
    return resolveServers(filetype, settings.config.lspServers)
      .map((server) => spawnFor(server, path))
      .filter((client) => client !== null)
  }

  const readyClients = (path: string): LspClient[] =>
    clientsFor(path).filter((client) => client.ready())

  const install = async (
    id: string,
    name: string,
    spec: FetchableInstall,
    manager?: PackageManager
  ) => {
    const tool = spec.kind === 'download' ? 'download' : (manager ?? 'npm')
    const release = status.claimBusy({
      label: `Installing ${name} with ${tool}`,
    })
    try {
      const error =
        spec.kind === 'download'
          ? await downloadServer(spec.url, name)
          : await installServer(spec.packages, SERVER_ROOT, manager)
      if (error) {
        return status.say(`Could not install ${name}: ${error}`, 'error')
      }
      // npm can exit 0 having produced no binary: a bin that moved, or a foreign platform.
      if (!installedCommand([name])) {
        return status.say(
          `Installed ${name}, but no ${name} appeared in ${SERVER_ROOT}`,
          'error'
        )
      }
      clients.delete(id)
      setGeneration(generation() + 1)
      status.say(`Installed ${name}`)
    } finally {
      release()
    }
  }

  const removable = (
    id: string
  ): { name: string; packages: string[] } | null => {
    const spec = serverSpecs().find((server) => server.id === id)
    if (!spec?.install || spec.install.kind === 'manual') {
      return null
    }
    const [name] = spec.command
    if (!name || !installedCommand(spec.command)) {
      return null
    }
    return {
      name,
      packages: spec.install.kind === 'npm' ? spec.install.packages : [name],
    }
  }

  // The client goes first: on Windows a running process holds its own executable open.
  const uninstall = async (id: string): Promise<void> => {
    const spec = serverSpecs().find((server) => server.id === id)
    if (!spec?.install) {
      status.say(`${id}: druk did not install it`, 'warn')
      return
    }
    const name = spec.command[0] ?? id
    clients.get(id)?.dispose()
    clients.delete(id)
    setServers(id, { docs: [], error: null, state: 'stopped' })
    const release = status.claimBusy({ label: `Removing ${name}` })
    try {
      const error = await removeServer(spec.install, name)
      if (error) {
        status.say(`Could not remove ${name}: ${error}`, 'error')
        return
      }
      setGeneration(generation() + 1)
      offered.delete(id)
      status.say(`Removed ${name} from ${SERVER_ROOT}`)
    } finally {
      release()
    }
  }

  const dispose = () => {
    for (const client of clients.values()) {
      client?.dispose()
    }
    clients.clear()
    for (const path of Object.keys(problems)) {
      clearProblems(path)
    }
  }

  // druk registers no watched files, so nothing else tells a server its `node_modules` moved.
  const restart = () => {
    const running = clients.size > 0
    dispose()
    setRestarts(restarts() + 1)
    return running
  }

  let depsTimer: ReturnType<typeof setTimeout> | null = null

  const dependenciesChanged = () => {
    if (!settings.config.lsp) {
      return
    }
    if (depsTimer) {
      clearTimeout(depsTimer)
    }
    depsTimer = setTimeout(() => {
      depsTimer = null
      if (restart()) {
        status.say('Dependencies changed — restarted language servers')
      }
    }, DEPENDENCY_QUIET_MS)
  }

  onCleanup(() => clearTimeout(depsTimer ?? undefined))

  let flushEdits: ((path: string) => void) | null = null
  const onFlushNeeded = (flush: (path: string) => void) => {
    flushEdits = flush
  }

  // Which server answered last: `resolveCompletion` cannot simply ask the first.
  const answeredCompletion = new Map<string, string>()
  const answeredHierarchy = new Map<string, string>()
  // A slower earlier request must not name the answering server after a newer one has.
  const completionGen = new Map<string, number>()

  // The pending didChange goes first: an answer against text 150ms stale misplaces every edit.
  const complete = async (
    path: string,
    line: number,
    col: number
  ): Promise<CompletionReply | null> => {
    if (!settings.config.lsp || !settings.config.lspCompletion) {
      return null
    }
    const ready = readyClients(path)
    if (ready.length === 0) {
      return null
    }
    flushEdits?.(path)
    const gen = (completionGen.get(path) ?? 0) + 1
    completionGen.set(path, gen)
    for (const client of ready) {
      const reply = normalizeCompletion(
        await client.complete(path, { character: col, line })
      )
      if (reply && reply.items.length > 0) {
        if (completionGen.get(path) === gen) {
          answeredCompletion.set(path, client.id)
        }
        return reply
      }
    }
    return null
  }

  const readyClientsEventually = async (
    path: string,
    timeoutMs: number
  ): Promise<LspClient[]> => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const ready = readyClients(path)
      if (ready.length > 0) {
        return ready
      }
      if (clientsFor(path).every((client) => client.dead())) {
        return []
      }
      if (Date.now() >= deadline) {
        return []
      }
      await sleep(50)
    }
  }

  const locations = async (
    path: string,
    line: number,
    col: number,
    method: LocationMethod
  ): Promise<Target[]> => {
    if (!settings.config.lsp) {
      return []
    }
    const ready = await readyClientsEventually(path, 10_000)
    if (ready.length === 0) {
      return []
    }
    flushEdits?.(path)
    for (const client of ready) {
      const targets = normalizeLocations(
        await client.locate(method, path, { character: col, line })
      )
      if (targets.length > 0) {
        return targets
      }
    }
    return []
  }

  const definition = async (
    path: string,
    line: number,
    col: number
  ): Promise<Target | null> => {
    const found = await locations(path, line, col, 'definition')
    return found[0] ?? null
  }

  // Path-less requests still go to the servers serving the open file.
  const symbols = async (
    path: string,
    query: string | null
  ): Promise<unknown> => {
    if (!settings.config.lsp) {
      return null
    }
    const ready = await readyClientsEventually(path, 10_000)
    flushEdits?.(path)
    for (const client of ready) {
      const result =
        query === null
          ? await client.documentSymbols(path)
          : await client.workspaceSymbols(query)
      if (Array.isArray(result) && result.length > 0) {
        return result
      }
    }
    return null
  }

  // null means "insert it as it came".
  const resolveCompletion = (
    path: string,
    item: CompletionItem
  ): Promise<CompletionItem | null> => {
    if (!settings.config.lsp || !settings.config.lspCompletion) {
      return Promise.resolve(null)
    }
    // The server that answered `complete`: only it holds the handle the item resolves through.
    const ready = readyClients(path)
    const source = answeredCompletion.get(path)
    const client =
      ready.find((candidate) => candidate.id === source) ?? ready[0]
    if (!client) {
      return Promise.resolve(null)
    }
    return client.resolveCompletion(item)
  }

  return {
    clearProblems,
    clientsFor,
    complete,
    definition,
    dependenciesChanged,
    dispose,
    generation,
    install,
    locations,
    onDiagnosticsRefresh,
    onFlushNeeded,
    onMissingServer,
    problems,
    removable,
    resolveCompletion,
    restart,
    restarts,
    servers,
    symbols,
    uninstall,
  }
}

export type Lsp = ReturnType<typeof createLsp>

// Only the didChange *send* is deferred: a tab switch mid-debounce must not re-aim the edit.
export function wireLspEffects(deps: {
  lsp: Lsp
  settings: Settings
  workspace: Workspace
}) {
  const { lsp, settings, workspace } = deps

  interface Synced {
    clients: LspClient[]
    // Text and dirty flag as last *sent*, which is what tells edits and saves apart.
    text: string
    dirty: boolean
  }
  const synced = new Map<string, Synced>()
  const pendingEdits = new Map<string, { entry: Synced; text: string }>()
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let lastRestart = lsp.restarts()

  const flushEdit = (path: string) => {
    const edit = pendingEdits.get(path)
    if (!edit) {
      return
    }
    pendingEdits.delete(path)
    for (const client of edit.entry.clients) {
      client.changeDocument(path, edit.text)
      client.pullDiagnostics(path)
    }
    edit.entry.text = edit.text
  }

  lsp.onFlushNeeded(flushEdit)

  lsp.onDiagnosticsRefresh((serverId) => {
    for (const [path, entry] of synced) {
      for (const client of entry.clients) {
        if (client.id === serverId) {
          client.pullDiagnostics(path)
        }
      }
    }
  })

  const flushAll = () => {
    flushTimer = null
    // flushEdit removes only the entry being visited, which Map iteration allows.
    for (const path of pendingEdits.keys()) {
      flushEdit(path)
    }
  }

  createEffect(() => {
    if (!settings.config.lsp) {
      // A teardown, not a pause: emptying the sync state re-opens every document when it comes back.
      pendingEdits.clear()
      synced.clear()
      lsp.dispose()
      return
    }

    // Tracked for its side effect: a server just installed can now spawn.
    lsp.generation()

    const restarts = lsp.restarts()
    if (restarts !== lastRestart) {
      lastRestart = restarts
      pendingEdits.clear()
      synced.clear()
    }

    const open = workspace.tabs()
    const openSet = new Set(open)

    for (const [path, entry] of synced) {
      if (openSet.has(path)) {
        continue
      }
      pendingEdits.delete(path)
      for (const client of entry.clients) {
        client.closeDocument(path)
      }
      synced.delete(path)
      // Not every server publishes an empty set on didClose.
      lsp.clearProblems(path)
    }

    for (const path of open) {
      const buffer = workspace.buffers[path]
      if (!buffer) {
        continue
      }
      // Read here, in the tracked run — these are the captured values.
      const text = buffer.content
      const { dirty } = buffer
      const known = synced.get(path)

      // The dead client is dropped, never the entry: re-opening an open document is refused.
      if (known?.clients.some((client) => client.dead())) {
        known.clients = known.clients.filter((client) => !client.dead())
      }

      if (!known) {
        const clients = lsp.clientsFor(path)
        if (clients.length === 0) {
          continue
        }
        const filetype = filetypeForPath(path) ?? 'plaintext'
        for (const client of clients) {
          client.openDocument(path, filetype, text)
          client.pullDiagnostics(path)
        }
        synced.set(path, { clients, dirty, text })
        continue
      }

      const fresh = lsp
        .clientsFor(path)
        .filter((client) => !known.clients.includes(client))
      if (fresh.length > 0) {
        const filetype = filetypeForPath(path) ?? 'plaintext'
        for (const client of fresh) {
          client.openDocument(path, filetype, known.text)
          client.pullDiagnostics(path)
        }
        known.clients.push(...fresh)
      }

      if (text === known.text) {
        // Back to the last text sent is not "nothing to do": the queued edit describes text that is gone.
        pendingEdits.delete(path)
      } else {
        pendingEdits.set(path, { entry: known, text })
        if (!flushTimer) {
          flushTimer = setTimeout(flushAll, CHANGE_DEBOUNCE_MS)
        }
      }
      if (known.dirty && !dirty) {
        // The pending edit goes first, so the didSave refers to the text that was written.
        flushEdit(path)
        for (const client of known.clients) {
          client.saveDocument(path)
          client.pullDiagnostics(path)
        }
      }
      known.dirty = dirty
    }
  })

  onCleanup(() => clearTimeout(flushTimer ?? undefined))
}

export function problemsOn(list: Problem[], line: number): Problem[] {
  return list
    .filter((problem) => problem.line === line)
    .toSorted(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.col - b.col
    )
}

// The problem after (`direction` 1) or before (−1) the cursor, wrapping around the file.
export function problemFrom(
  list: Problem[],
  line: number,
  col: number,
  direction: 1 | -1
): Problem | null {
  if (list.length === 0) {
    return null
  }
  const after = (problem: Problem) => problem.line - line || problem.col - col
  if (direction === 1) {
    return list.find((problem) => after(problem) > 0) ?? list[0]!
  }
  return list.findLast((problem) => after(problem) < 0) ?? list.at(-1)!
}
