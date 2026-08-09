import { fileURLToPath } from 'node:url'

import { createEffect, createSignal, onCleanup } from 'solid-js'
import { createStore } from 'solid-js/store'

import { filetypeForPath } from '../languages/highlight'
import { spawnLspClient } from '../lsp/client'
import type { LspClient } from '../lsp/client'
import { normalizeCompletion } from '../lsp/completion'
import type { CompletionReply } from '../lsp/completion'
import { normalizeDefinition } from '../lsp/definition'
import type { Target } from '../lsp/definition'
import {
  availablePackageManagers,
  downloadServer,
  installServer,
  installedCommand,
  removeServer,
  SERVER_ROOT,
} from '../lsp/install'
import type { PackageManager } from '../lsp/install'
import { projectCommand } from '../lsp/project'
import { isUnnecessary, severityOf } from '../lsp/protocol'
import type { CompletionItem, Diagnostic, ProblemSeverity } from '../lsp/protocol'
import { installHint, resolveServers, servers as serverSpecs } from '../lsp/servers'
import type { FetchableInstall, ResolvedServer } from '../lsp/servers'
import type { ServerLogLine, ServerView } from '../lsp/status'
import type { PromptState } from './prompts'
import type { Settings } from './settings'
import type { Status } from './status'
import type { Workspace } from './workspace'

export interface Problem {
  path: string
  /** 0-based, like every position the editor bridge speaks. */
  line: number
  col: number
  /** Range end, for the underline; equal to the start when the server sent none. */
  endLine: number
  endCol: number
  severity: ProblemSeverity
  /** LSP's Unnecessary tag: unused code, dimmed instead of underlined. */
  unnecessary: boolean
  message: string
  source?: string
}

/**
 * Keystrokes a didChange waits for more of. Higher than the highlighter's 16ms:
 * a server re-checks the project on every sync, which is milliseconds of CPU
 * where the highlighter's is microseconds.
 */
const CHANGE_DEBOUNCE_MS = 150

/**
 * How long the dependency directories must sit still before the servers are
 * restarted. An install writes for as long as it takes, and a server spawned
 * into a half-written `node_modules` is the stale-diagnostics problem again —
 * so the wait is for the writing to stop, not for the first event.
 */
const DEPENDENCY_QUIET_MS = 2_000

/**
 * Lines a server's log keeps. Enough to hold a whole startup plus a while of
 * chatter; the page renders every line it has, so the cap is also what keeps a
 * chatty server from growing the render without bound.
 */
const MAX_SERVER_LOG = 300

/** Language servers: one per language, diagnostics per open file. */
export function createLsp(deps: {
  rootDir: string
  settings: Settings
  status: Status
  prompts: PromptState
}) {
  const { rootDir, settings, status, prompts } = deps

  const [problems, setProblems] = createStore<Record<string, Problem[]>>({})
  /**
   * What each server said about each file, before they are merged into the list
   * above. Kept apart because a file may be served by several — eslint and
   * tsserver both answer for a `.ts` — and each publish replaces only its own
   * sender's marks. Merging in place would let whichever spoke last wipe the
   * other's.
   */
  const bySource = new Map<string, Map<string, Problem[]>>()

  /**
   * Set by `wireLspEffects`: ask one server for every open document's
   * diagnostics again. A pull server that watches a config file says so with
   * `workspace/diagnostic/refresh` rather than publishing anything, so without
   * this an eslint config saved mid-session would never take effect.
   */
  let refreshPulls: ((serverId: string) => void) | null = null
  const onDiagnosticsRefresh = (refresh: (serverId: string) => void) => {
    refreshPulls = refresh
  }
  /** By server id. `null` marks one that failed, so nothing respawns it. */
  const clients = new Map<string, LspClient | null>()
  /**
   * Bumped when a server becomes spawnable again. `wireLspEffects` reads it, so
   * an install can re-open documents that were skipped while the server was
   * missing — nothing else in that effect changes when a server comes back.
   */
  const [generation, setGeneration] = createSignal(0)
  /**
   * Bumped by `restart`. `wireLspEffects` watches it to forget which documents
   * are open, which is what makes the fresh servers receive them all again.
   */
  const [restarts, setRestarts] = createSignal(0)
  /** Server ids already offered this session, so a decline is not re-asked. */
  const offered = new Set<string>()

  /**
   * Set by App: no installed extension serves this filetype, so the market may have
   * one. A setter rather than a dependency because the market controller is
   * built after this one — it reads the settings this one already holds.
   */
  let onNoServer: ((filetype: string) => void) | null = null
  const onMissingServer = (handle: (filetype: string) => void) => {
    onNoServer = handle
  }

  /** What the status page shows: state, command, log and open documents per server. */
  const [servers, setServers] = createStore<Record<string, ServerView>>({})

  const timeStamp = () => new Date().toTimeString().slice(0, 8)

  const appendLog = (id: string, entry: Omit<ServerLogLine, 'time'>) => {
    setServers(id, 'logs', logs => {
      const next = [...logs, { time: timeStamp(), ...entry }]
      return next.length > MAX_SERVER_LOG ? next.slice(next.length - MAX_SERVER_LOG) : next
    })
  }

  const byPosition = (a: Problem, b: Problem) => a.line - b.line || a.col - b.col

  /** One file's marks from every server that has spoken about it, in order. */
  const merge = (path: string) => {
    const senders = bySource.get(path)
    const all = senders ? [...senders.values()].flat() : []
    setProblems(path, all.toSorted(byPosition))
  }

  /** A publish from `serverId`. Replaces that server's marks for the file, only. */
  const onDiagnosticsFrom = (serverId: string) => (uri: string, diagnostics: Diagnostic[]) => {
    let path: string
    try {
      path = fileURLToPath(uri)
    } catch {
      return // a scheme druk never opened; nothing to attach it to
    }
    const senders = bySource.get(path) ?? new Map<string, Problem[]>()
    senders.set(
      serverId,
      diagnostics.map(diagnostic => ({
        path,
        line: diagnostic.range.start.line,
        col: diagnostic.range.start.character,
        endLine: diagnostic.range.end.line,
        endCol: diagnostic.range.end.character,
        severity: severityOf(diagnostic),
        unnecessary: isUnnecessary(diagnostic),
        message: diagnostic.message,
        source: diagnostic.source,
      })),
    )
    bySource.set(path, senders)
    merge(path)
  }

  const clearProblems = (path: string) => {
    bySource.delete(path)
    if (problems[path]?.length) setProblems(path, [])
  }

  /**
   * What to do about a server that is not installed: offer to fetch it when druk
   * can, otherwise print the line that installs it by hand. Asked once per server
   * per session — `offered` outlives the failure mark, so a decline is final
   * until the next launch.
   */
  const reportMissing = (resolved: ResolvedServer) => {
    const name = resolved.command[0]!
    const spec = resolved.install
    if (!spec) return status.say(`LSP: ${name} is not installed, or not on PATH`, 'warn')
    // An npm server is a node script whatever fetches it, so an empty manager
    // list is `availablePackageManagers` saying the install could not be run —
    // node is missing, or the prefix is pinned to a manager that has gone.
    if (
      (spec.kind === 'npm' || spec.kind === 'download') &&
      settings.config.lspAutoInstall &&
      !offered.has(resolved.id)
    ) {
      const managers = spec.kind === 'npm' ? availablePackageManagers() : []
      if (spec.kind === 'npm' && managers.length === 0) {
        return status.say(`LSP: ${name} not installed — ${installHint(spec)}`, 'warn')
      }
      offered.add(resolved.id)
      return prompts.setPrompt({
        kind: 'installServer',
        id: resolved.id,
        name,
        install: spec,
        managers,
      })
    }
    status.say(`LSP: ${name} not installed — ${installHint(spec)}`, 'warn')
  }

  /**
   * `initialize` options for one server. Only typescript has any: it drives a
   * separate `tsserver`, and which TypeScript that is deserves to be settable.
   * Left empty the server decides — it prefers the open project's own copy,
   * which is what a project pinning a compiler version wants, and only falls
   * back to the one druk installed.
   */
  const initializationOptionsFor = (id: string): unknown => {
    if (id !== 'typescript') return undefined
    const tsdk = settings.config.typescriptTsdk.trim()
    return tsdk ? { tsserver: { path: tsdk } } : undefined
  }

  /** One server for `path`'s language, spawned on first use. Null if it failed. */
  const spawnFor = (resolved: ResolvedServer): LspClient | null => {
    const known = clients.get(resolved.id)
    if (known !== undefined) return known
    // The project's own server first — for TypeScript it is the only one that
    // can serve a 7.x project at all. Then a copy druk installed; PATH is
    // consulted only when there is neither, so a user's own install wins from
    // the moment they make one.
    const project = projectCommand(resolved.id, resolved.command, rootDir)
    const fetched = project ? null : installedCommand(resolved.command)
    const command = project ?? fetched ?? resolved.command
    // The log survives a restart — the run before is the context for this one —
    // but state and error start over with the new process.
    setServers(resolved.id, {
      id: resolved.id,
      command,
      state: 'starting',
      error: null,
      logs: servers[resolved.id]?.logs ?? [],
      docs: [],
    })
    /** Assigned right below; the spawn's own synchronous log lines miss it, which
     * only costs them the docs/state sync no one needs that early. */
    let spawned: LspClient | null = null
    const client = spawnLspClient({
      id: resolved.id,
      command,
      rootDir,
      initializationOptions: initializationOptionsFor(resolved.id),
      settings: resolved.settings,
      onDiagnostics: onDiagnosticsFrom(resolved.id),
      onRefreshDiagnostics: () => refreshPulls?.(resolved.id),
      onLog: entry => {
        appendLog(resolved.id, entry)
        if (!spawned) return
        setServers(resolved.id, 'docs', spawned.documents())
        // 'failed' is onFail's to set — it knows the reason; a deliberate
        // dispose never gets there and reads as 'stopped'.
        if (servers[resolved.id]?.state !== 'failed') {
          setServers(
            resolved.id,
            'state',
            spawned.dead() ? 'stopped' : spawned.ready() ? 'ready' : 'starting',
          )
        }
      },
      onFail: (reason, missing) => {
        clients.set(resolved.id, null)
        setServers(resolved.id, { state: 'failed', error: reason })
        if (missing) return reportMissing(resolved)
        status.say(
          // A copy druk fetched can be broken in ways the user cannot see and did
          // not cause — a dependency that moved on, most of all. Naming the
          // directory is what makes that repairable without reading the source.
          // The project's own copy gets no such advice: deleting druk's would
          // not touch it.
          fetched
            ? `LSP: ${command[0]} ${reason} — delete ${SERVER_ROOT} to reinstall it`
            : `LSP: ${command[0]} ${reason}`,
          'warn',
        )
      },
    })
    spawned = client
    clients.set(resolved.id, client)
    return client
  }

  /**
   * Every running server for `path`'s language, in extension load order. More
   * than one is normal — a linter and a language server both serve TypeScript —
   * and all of them are synced, so all of them report.
   */
  const clientsFor = (path: string): LspClient[] => {
    if (!settings.config.lsp) return []
    const filetype = filetypeForPath(path)
    const resolved = resolveServers(filetype, settings.config.lspServers)
    if (resolved.length === 0) {
      // No extension names a server for this language. druk ships none itself, so
      // this is the normal state for a language whose extension is not installed —
      // the market decides whether that is worth an offer.
      if (filetype) onNoServer?.(filetype)
      return []
    }
    return resolved.map(spawnFor).filter(client => client !== null)
  }

  /**
   * The client that answers a feature request. Every server sees the document,
   * but only one can answer a completion or a definition — and which one is not
   * knowable from load order, since a linter serves the same filetype and
   * answers neither. So the callers ask each in turn and keep the first real
   * answer; this is only the list to walk.
   */
  const readyClients = (path: string): LspClient[] =>
    clientsFor(path).filter(client => client.ready())

  /**
   * Fetch a server the user agreed to install, then let it spawn: the failure
   * mark goes, and the generation bump re-opens the documents that were skipped
   * while it was missing.
   */
  const install = async (
    id: string,
    name: string,
    spec: FetchableInstall,
    manager?: PackageManager,
  ) => {
    const tool = spec.kind === 'download' ? 'download' : (manager ?? 'npm')
    status.say(`Installing ${name} with ${tool}…`)
    const error =
      spec.kind === 'download'
        ? await downloadServer(spec.url, name)
        : await installServer(spec.packages, SERVER_ROOT, manager)
    if (error) return status.say(`Could not install ${name}: ${error}`, 'error')
    // npm can exit 0 having produced no binary — a package whose bin moved, or
    // one installed for another platform. Saying "installed" then would send
    // the user round the same prompt on every launch with nothing to show why.
    if (!installedCommand([name])) {
      return status.say(`Installed ${name}, but no ${name} appeared in ${SERVER_ROOT}`, 'error')
    }
    clients.delete(id)
    setGeneration(generation() + 1)
    status.say(`Installed ${name}`)
  }

  /**
   * druk's own copy of `id`, and what removing it would take. Null when there is
   * nothing of druk's to remove — the server is on PATH, or in the project, or
   * was never installed at all.
   */
  const removable = (id: string): { name: string; packages: string[] } | null => {
    const spec = serverSpecs().find(server => server.id === id)
    if (!spec?.install || spec.install.kind === 'manual') return null
    const name = spec.command[0]
    if (!name || !installedCommand(spec.command)) return null
    return { name, packages: spec.install.kind === 'npm' ? spec.install.packages : [name] }
  }

  /**
   * Delete druk's copy of a server. The client goes first: on Windows a running
   * process holds its own executable open, and everywhere else a server left
   * running against deleted files is a crash report nobody can read.
   */
  const uninstall = async (id: string): Promise<void> => {
    const spec = serverSpecs().find(server => server.id === id)
    if (!spec?.install) return void status.say(`${id}: druk did not install it`, 'warn')
    const name = spec.command[0] ?? id
    clients.get(id)?.dispose()
    clients.delete(id)
    setServers(id, { state: 'stopped', error: null, docs: [] })
    status.say(`Removing ${name}…`)
    const error = await removeServer(spec.install, name)
    if (error) return void status.say(`Could not remove ${name}: ${error}`, 'error')
    // The documents it held are open in the other servers still; this only makes
    // the next matching file try to spawn it again — and be offered the install.
    setGeneration(generation() + 1)
    offered.delete(id)
    status.say(`Removed ${name} from ${SERVER_ROOT}`)
  }

  /**
   * Kill every server and forget the failure marks, so the next `clientFor`
   * starts fresh. Serves both App teardown and the settings toggle: turning LSP
   * back on respawns servers as files re-sync.
   */
  const dispose = () => {
    for (const client of clients.values()) client?.dispose()
    clients.clear()
    for (const path of Object.keys(problems)) clearProblems(path)
  }

  /**
   * Kill the servers and let the open documents spawn them again. The only cure
   * for a server whose view of the project is stale: druk registers no watched
   * files, so nothing else tells one that `node_modules` — or a config it read
   * at startup — has changed under it.
   */
  const restart = () => {
    const running = clients.size > 0
    dispose()
    setRestarts(restarts() + 1)
    return running
  }

  let depsTimer: ReturnType<typeof setTimeout> | null = null

  /** The watcher saw a dependency directory written. */
  const dependenciesChanged = () => {
    if (!settings.config.lsp) return
    if (depsTimer) clearTimeout(depsTimer)
    depsTimer = setTimeout(() => {
      depsTimer = null
      // Nothing spawned yet: the next `clientFor` reads the new tree anyway, and
      // saying so about servers the user never started would be noise.
      if (restart()) status.say('Dependencies changed — restarted language servers')
    }, DEPENDENCY_QUIET_MS)
  }

  onCleanup(() => clearTimeout(depsTimer ?? undefined))

  /** Set by `wireLspEffects`: push the debounced didChange for `path` out now. */
  let flushEdits: ((path: string) => void) | null = null
  const onFlushNeeded = (flush: (path: string) => void) => {
    flushEdits = flush
  }

  /**
   * Completion at a buffer position. The pending didChange goes first — the
   * request is aimed at what is on screen, and a server answering against text
   * 150ms stale would misplace every edit it returns.
   */
  const complete = async (
    path: string,
    line: number,
    col: number,
  ): Promise<CompletionReply | null> => {
    if (!settings.config.lsp || !settings.config.lspCompletion) return null
    const ready = readyClients(path)
    if (ready.length === 0) return null
    flushEdits?.(path)
    for (const client of ready) {
      const reply = normalizeCompletion(await client.complete(path, { line, character: col }))
      if (reply && reply.items.length > 0) return reply
    }
    return null
  }

  /**
   * Where the symbol at a buffer position is defined. The pending didChange
   * goes out first, for the reason completion flushes it: a server answering
   * against text 150ms stale would name a line that has since moved.
   */
  const definition = async (path: string, line: number, col: number): Promise<Target | null> => {
    if (!settings.config.lsp) return null
    const ready = readyClients(path)
    if (ready.length === 0) return null
    flushEdits?.(path)
    for (const client of ready) {
      const target = normalizeDefinition(await client.definition(path, { line, character: col }))
      if (target) return target
    }
    return null
  }

  /**
   * Ask `path`'s server to fill in a chosen item's withheld fields — the
   * auto-import edits most servers leave off the list. Null means "insert the
   * item as it came".
   */
  const resolveCompletion = (
    path: string,
    item: CompletionItem,
  ): Promise<CompletionItem | null> => {
    if (!settings.config.lsp || !settings.config.lspCompletion) return Promise.resolve(null)
    // The first ready server, not each in turn: the item came from whichever
    // answered `complete`, and only that one holds the handle it resolves.
    const client = readyClients(path)[0]
    if (!client) return Promise.resolve(null)
    return client.resolveCompletion(item)
  }

  return {
    problems,
    servers,
    clearProblems,
    clientsFor,
    complete,
    definition,
    resolveCompletion,
    onFlushNeeded,
    onDiagnosticsRefresh,
    onMissingServer,
    install,
    removable,
    uninstall,
    generation,
    restart,
    restarts,
    dependenciesChanged,
    dispose,
  }
}

export type Lsp = ReturnType<typeof createLsp>

/**
 * Keep every server's view of the open documents current. One effect over the
 * open tabs and their buffer contents; everything it sends is captured inside
 * the tracked run — only the didChange *send* is deferred, so a tab switch
 * during the debounce can never re-aim an edit at the wrong document.
 */
export function wireLspEffects(deps: { lsp: Lsp; settings: Settings; workspace: Workspace }) {
  const { lsp, settings, workspace } = deps

  interface Synced {
    /** Every server the document is open in — a linter and a language server both. */
    clients: LspClient[]
    /** Text and dirty flag as last reported, to tell edits and saves apart. */
    text: string
    dirty: boolean
  }
  const synced = new Map<string, Synced>()
  const pendingEdits = new Map<string, { entry: Synced; text: string }>()
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let lastRestart = lsp.restarts()

  const flushEdit = (path: string) => {
    const edit = pendingEdits.get(path)
    if (!edit) return
    pendingEdits.delete(path)
    for (const client of edit.entry.clients) {
      client.changeDocument(path, edit.text)
      // Pull servers report nothing on their own: every sync is followed by the
      // question, or the marks would stay on the text they were computed for.
      client.pullDiagnostics(path)
    }
    edit.entry.text = edit.text
  }

  lsp.onFlushNeeded(flushEdit)

  // A server that says its answers went stale gets them asked again, for every
  // document it holds — it is the only signal a pull server gives when a file it
  // watches, rather than one druk synced, is what changed.
  lsp.onDiagnosticsRefresh(serverId => {
    for (const [path, entry] of synced) {
      for (const client of entry.clients) {
        if (client.id === serverId) client.pullDiagnostics(path)
      }
    }
  })

  const flushAll = () => {
    flushTimer = null
    // flushEdit removes only the entry being visited, which Map iteration allows.
    for (const path of pendingEdits.keys()) flushEdit(path)
  }

  createEffect(() => {
    if (!settings.config.lsp) {
      // The toggle is a teardown, not a pause: servers die, marks clear, and the
      // sync state empties so turning it back on re-opens every document.
      pendingEdits.clear()
      synced.clear()
      lsp.dispose()
      return
    }

    // Tracked for its side effect on `clientFor`: a server just installed can
    // now spawn, and the documents it should have opened are already open.
    lsp.generation()

    const restarts = lsp.restarts()
    if (restarts !== lastRestart) {
      lastRestart = restarts
      // `restart` has already killed the servers; forgetting what they knew is
      // what makes the loop below open every document into the fresh ones.
      pendingEdits.clear()
      synced.clear()
    }

    const open = workspace.tabs()
    const openSet = new Set(open)

    for (const [path, entry] of synced) {
      if (openSet.has(path)) continue
      pendingEdits.delete(path)
      for (const client of entry.clients) client.closeDocument(path)
      synced.delete(path)
      // Not every server publishes an empty set on didClose; without this a
      // reopened file would show diagnostics from a buffer long gone.
      lsp.clearProblems(path)
    }

    for (const path of open) {
      const buffer = workspace.buffers[path]
      if (!buffer) continue
      // Read here, in the tracked run — these are the captured values.
      const text = buffer.content
      const dirty = buffer.dirty
      let known = synced.get(path)

      // Any of the entry's servers gone — one failed to spawn, or crashed — and
      // the whole entry is forgotten. Forgetting it is what lets the document
      // reach a replacement: the very file whose opening triggered the install
      // offer is synced to the *dead* client, so without this the generation
      // bump after an install re-opens every document except the one that asked
      // for the server.
      if (known?.clients.some(client => client.dead())) {
        pendingEdits.delete(path)
        synced.delete(path)
        known = undefined
      }

      if (!known) {
        const clients = lsp.clientsFor(path)
        if (clients.length === 0) continue
        const filetype = filetypeForPath(path) ?? 'plaintext'
        for (const client of clients) {
          client.openDocument(path, filetype, text)
          client.pullDiagnostics(path)
        }
        synced.set(path, { clients, text, dirty })
        continue
      }

      if (text !== known.text) {
        pendingEdits.set(path, { entry: known, text })
        if (!flushTimer) flushTimer = setTimeout(flushAll, CHANGE_DEBOUNCE_MS)
      } else {
        // `known.text` is what the server was last *sent*, so an edit that puts
        // the buffer back to it — a backspace over the character just typed — is
        // not "nothing to do": the edit queued for that backspace describes a
        // text the editor no longer has, and flushing it would hand the server a
        // document one keystroke behind the position druk is about to ask about.
        // That is a completion answered for the wrong column.
        pendingEdits.delete(path)
      }
      if (known.dirty && !dirty) {
        // dirty fell: this run is a save. The pending edit goes first so the
        // didSave refers to the text that was actually written.
        flushEdit(path)
        for (const client of known.clients) {
          client.saveDocument(path)
          // A formatter may have rewritten the file, and a save is when a pull
          // server's project-wide errors are worth asking about again.
          client.pullDiagnostics(path)
        }
      }
      known.dirty = dirty
    }
  })

  onCleanup(() => clearTimeout(flushTimer ?? undefined))
}

/**
 * The problem at or after (`direction` 1) / before (−1) the cursor, wrapping
 * around the file. `list` is sorted by position, as `createLsp` stores it.
 */
export function problemFrom(
  list: Problem[],
  line: number,
  col: number,
  direction: 1 | -1,
): Problem | null {
  if (list.length === 0) return null
  const after = (problem: Problem) => problem.line - line || problem.col - col
  if (direction === 1) return list.find(problem => after(problem) > 0) ?? list[0]!
  return list.findLast(problem => after(problem) < 0) ?? list.at(-1)!
}
