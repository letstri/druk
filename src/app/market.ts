/**
 * The extension market as the editor sees it: what is on offer, what is out of
 * date, and what the open file would want installed.
 *
 * Every path into an install goes through the same two steps — fetch and
 * validate the manifest (`core/market.ts`), then ask. The prompt is raised only
 * once the manifest is in hand, so what it names is the file that will actually
 * be written rather than a claim the catalog made about it.
 *
 * Nothing here is load-bearing: the catalog is fetched best-effort, and every
 * failure leaves the editor exactly as it was with at most a status line.
 */
import { createMemo, createSignal } from 'solid-js'

import { unregisteredNames } from '../core/config'
import {
  fetchCatalog,
  fetchExtension,
  isStale,
  readCachedCatalog,
  removeFromDisk,
  updatesFor,
  writeCachedCatalog,
  writeExtension,
} from '../core/market'
import type { Fetched, Fetcher, MarketEntry } from '../core/market'
import { isNewer } from '../core/update'
import { extensions, EXTENSIONS_DIR } from '../extensions'
import type { PromptState } from './prompts'
import type { Settings } from './settings'
import type { Status } from './status'

/** What an extension adds, in the words the prompt and the palette use. */
function summarize(entry: MarketEntry): string {
  const counts = [
    [entry.provides.themes.length, 'theme'],
    [entry.provides.icons.length, 'icon theme'],
    [entry.provides.filetypes.length, 'language'],
  ] as const
  const parts = counts
    .filter(([count]) => count > 0)
    .map(([count, noun]) => `${count} ${noun}${count === 1 ? '' : 's'}`)
  return parts.join(', ') || 'nothing'
}

export function createMarket(deps: {
  rootDir: string
  settings: Settings
  status: Status
  prompts: PromptState
  /** Re-run open documents when an installed extension contributes servers. */
  onServersReload?: () => void
  /** Injected by tests; production uses the global `fetch`. */
  fetcher?: Fetcher
}) {
  const { rootDir, settings, status, prompts, onServersReload, fetcher } = deps

  // Seeded from the cache so the palette has a market to show before — and
  // without — any network round trip.
  const [catalog, setCatalog] = createSignal<MarketEntry[]>(readCachedCatalog()?.extensions ?? [])
  /**
   * Ids already offered this session. A decline is a decision, and re-asking on
   * every file of that language would make the offer a nuisance rather than a
   * hint; the palette is how someone changes their mind.
   */
  const declined = new Set<string>()
  /** Filetypes whose missing server has already been looked into this session. */
  const asked = new Set<string>()
  /** Manifests fetched for an open prompt, waiting for the answer to be written. */
  const fetched = new Map<string, Fetched & { ok: true }>()

  const registry = () => settings.config.extensionRegistry

  const entry = (id: string): MarketEntry | undefined =>
    catalog().find(extension => extension.id === id)

  // Market copies only: a built-in is part of the binary and updates with druk
  // itself, so the market must never offer it one.
  const installedVersions = () =>
    extensions()
      .filter(extension => !extension.builtin)
      .map(extension => ({ id: extension.id, version: extension.version }))

  /** Installed extensions the market has a newer version of. */
  const updates = createMemo(() => updatesFor(installedVersions(), catalog(), isNewer))

  /**
   * Refresh the catalog. `force` skips the freshness check — the palette's
   * "Check for extension updates" means now, not "if the cache has expired".
   */
  const refresh = async (force = false): Promise<MarketEntry[]> => {
    const cached = readCachedCatalog()
    if (!force && !isStale(cached, Date.now())) {
      if (cached) setCatalog(cached.extensions)
      return catalog()
    }
    const fresh = await fetchCatalog(registry(), fetcher)
    if (!fresh) return catalog() // offline: whatever the cache had stays on offer
    writeCachedCatalog(fresh, Date.now())
    setCatalog(fresh)
    return fresh
  }

  /**
   * The first refresh, shared. The startup check and the first file whose
   * language has no server both want a catalog, and they happen within a frame
   * of each other — without this the file would either race the fetch and find
   * nothing, or start a second one.
   */
  let loading: Promise<MarketEntry[]> | null = null
  const ready = (): Promise<MarketEntry[]> => (loading ??= refresh())

  /**
   * Fetch `id`'s manifest and ask. Silent about an extension it cannot fetch when
   * the offer was druk's idea rather than the user's — an editor that reports a
   * failed background request on every launch is worse than one that says
   * nothing.
   */
  const offer = async (id: string, why: string, quiet = false): Promise<void> => {
    const found = entry(id)
    if (!found) return void (quiet || status.say(`No extension "${id}" in the market`, 'warn'))
    const installed = extensions().find(extension => extension.id === id)
    const result = await fetchExtension(id, { registry: registry(), fetcher })
    if (!result.ok) return void (quiet || status.say(`Extension ${id}: ${result.error}`, 'error'))
    // An offer druk raised itself must never replace a question the user is
    // already being asked — a save conflict, a delete — since the modal reads
    // as an answer to whatever is on screen and the other prompt would vanish.
    if (quiet && prompts.prompt()) return
    fetched.set(id, result)
    prompts.setPrompt({
      kind: 'installExtension',
      id,
      name: found.name,
      summary: summarize(found),
      why,
      // The one part of a manifest that is not inert: these are spawned when a
      // file of a matching type opens, so the answer is about them.
      runs: result.extension.servers.map(server => server.command.join(' ')),
      ...(installed ? { current: installed.version } : null),
    })
  }

  /**
   * Write the manifest the open prompt was about, and register it. Asynchronous
   * because an extension may carry assets — a grammar for a language druk ships
   * none for — and those are fetched now rather than at prompt time, so the
   * question is answered before the megabytes move.
   */
  const accept = (id: string): void => {
    const result = fetched.get(id)
    fetched.delete(id)
    if (!result) return
    if (result.extension.assets.length > 0) status.say(`Installing ${result.extension.name}…`)
    void (async () => {
      const error = await writeExtension(id, result, EXTENSIONS_DIR, {
        registry: registry(),
        fetcher,
      })
      if (error) return void status.say(`Could not install ${id}: ${error}`, 'error')
      const load = settings.reloadExtensions()
      const installed = load.extensions.find(extension => extension.id === id)
      status.say(`Installed ${installed?.name ?? id} ${installed?.version ?? ''}`.trim())
      // After the confirmation, not before: the restart re-syncs the open
      // documents, and what the new server has to say about them would
      // otherwise overwrite the line saying the install worked.
      if (result.extension.servers.length > 0) onServersReload?.()
    })()
  }

  /** The prompt was declined: remember it, so the same file does not re-ask. */
  const decline = (id: string): void => {
    fetched.delete(id)
    declined.add(id)
  }

  const install = (id: string): void => {
    declined.delete(id)
    void offer(id, 'Install it?')
  }

  const remove = (id: string): void => {
    // A built-in has no folder to delete: it is inside the binary, and the next
    // load would bring it straight back. Disabling is the operation that exists.
    const installed = extensions().find(extension => extension.id === id)
    if (installed?.builtin) {
      return void status.say(`"${id}" ships with druk — disable it instead`, 'warn')
    }
    const error = removeFromDisk(id, EXTENSIONS_DIR)
    if (error) return void status.say(`Could not remove ${id}: ${error}`, 'error')
    settings.reloadExtensions()
    status.say(`Removed extension "${id}"`)
  }

  /** The palette's "Check for extension updates": always a fetch, always an answer. */
  const checkNow = async (): Promise<void> => {
    const before = catalog().length
    const fresh = await refresh(true)
    if (fresh.length === 0) {
      return void status.say('Could not reach the extension market', 'warn')
    }
    const pending = updates()
    if (pending.length > 0) {
      return void status.say(
        `${pending.length} extension update${pending.length === 1 ? '' : 's'} available`,
      )
    }
    status.say(
      before === 0
        ? `Extension market: ${fresh.length} extension${fresh.length === 1 ? '' : 's'}`
        : 'Every extension is up to date',
    )
  }

  const updateAll = async (): Promise<void> => {
    await refresh(true)
    const pending = updates()
    if (pending.length === 0) return void status.say('Every extension is up to date')
    // One prompt at a time: each manifest is fetched and confirmed on its own,
    // and the palette command is how the next one is reached. A queue of modals
    // would be worse than a list.
    await offer(pending[0]!.entry.id, `Update ${pending[0]!.entry.name}?`)
  }

  /**
   * A file opened whose language no installed server serves. Offered once per
   * language per session, and never for one the user has already said no to.
   */
  const suggestForFiletype = (filetype: string): void => {
    if (!settings.config.extensionUpdates || !settings.config.lsp) return
    // Marked before the await, not after: `clientFor` asks on every sync of
    // every open document, so a check that waited for the fetch would queue a
    // dozen of them before the first one answered.
    if (asked.has(filetype)) return
    asked.add(filetype)
    void (async () => {
      await ready()
      const found = catalog().find(extension => extension.provides.filetypes.includes(filetype))
      if (!found || declined.has(found.id)) return
      if (extensions().some(extension => extension.id === found.id)) return
      declined.add(found.id) // asked is asked, whatever the answer turns out to be
      await offer(found.id, `No language server for ${filetype}. Install ${found.name}?`, true)
    })()
  }

  /**
   * A config naming a theme nothing registers. This is the upgrade path: druk
   * used to ship these palettes, so a config written before they moved into the
   * market names one druk no longer has — and the market knows whose it is.
   */
  const suggestMissingNames = (): void => {
    const { themes, icons } = unregisteredNames(rootDir)
    for (const name of [...themes, ...icons]) {
      const found = catalog().find(
        extension =>
          extension.provides.themes.includes(name) || extension.provides.icons.includes(name),
      )
      if (!found || declined.has(found.id)) continue
      declined.add(found.id)
      void offer(found.id, `Your settings ask for "${name}". Install ${found.name}?`, true)
      return // one offer on the way in; the rest are a palette away
    }
  }

  /** The startup pass: refresh, report updates, then offer what the config wants. */
  const check = async (): Promise<void> => {
    if (!settings.config.extensionUpdates) return
    await ready()
    const pending = updates()
    if (pending.length > 0) {
      status.say(
        pending.length === 1
          ? `${pending[0]!.entry.name} ${pending[0]!.entry.version} is out — palette → Extensions`
          : `${pending.length} extension updates available — palette → Extensions`,
      )
    }
    suggestMissingNames()
  }

  return {
    catalog,
    updates,
    refresh,
    ready,
    check,
    checkNow,
    install,
    accept,
    decline,
    remove,
    updateAll,
    suggestForFiletype,
  }
}

export type Market = ReturnType<typeof createMarket>
