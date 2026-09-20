import { basename, extname } from 'node:path'

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
import type { Extension } from '../extensions/types'
import { iconThemeLabel } from '../icons'
import { isThemeName, themeLabel } from '../themes'
import type { PromptState } from './prompts'
import type { Settings } from './settings'
import type { Status } from './status'

// `ChoiceModal` has no scroll of its own.
const MAX_ACTIVATION_CHOICES = 8

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
  onServersReload?: () => void
  fetcher?: Fetcher
}) {
  const { rootDir, settings, status, prompts, onServersReload, fetcher } = deps

  const [catalog, setCatalog] = createSignal<MarketEntry[]>(readCachedCatalog()?.extensions ?? [])
  const declined = new Set<string>()
  const asked = new Set<string>()
  const fetched = new Map<string, Fetched & { ok: true }>()

  const registry = () => settings.config.extensionRegistry

  const entry = (id: string): MarketEntry | undefined =>
    catalog().find(extension => extension.id === id)

  const installedVersions = () =>
    extensions()
      .filter(extension => !extension.builtin)
      .map(extension => ({ id: extension.id, version: extension.version }))

  const updates = createMemo(() => updatesFor(installedVersions(), catalog(), isNewer))

  const refresh = async (force = false): Promise<MarketEntry[]> => {
    const cached = readCachedCatalog()
    if (!force && !isStale(cached, Date.now())) {
      if (cached) setCatalog(cached.extensions)
      return catalog()
    }
    const fresh = await fetchCatalog(registry(), fetcher)
    if (!fresh) return catalog()
    writeCachedCatalog(fresh, Date.now())
    setCatalog(fresh)
    return fresh
  }

  let loading: Promise<MarketEntry[]> | null = null
  const ready = (): Promise<MarketEntry[]> => (loading ??= refresh())

  let opened = false
  const openPanel = (): Promise<MarketEntry[]> => {
    if (opened) return ready()
    opened = true
    return (loading = refresh(true))
  }

  const offer = async (id: string, why: string, quiet = false): Promise<void> => {
    const found = entry(id)
    if (!found) return void (quiet || status.say(`No extension "${id}" in the market`, 'warn'))
    const result = await fetchExtension(id, { registry: registry(), fetcher })
    if (!result.ok) return void (quiet || status.say(`Extension ${id}: ${result.error}`, 'error'))
    if (quiet && prompts.prompt()) return
    fetched.set(id, result)
    prompts.setPrompt({
      kind: 'installExtension',
      id,
      name: found.name,
      summary: summarize(found),
      why,
      runs: result.extension.servers.map(server => server.command.join(' ')),
    })
  }

  const applyUpdates = async (
    pending: { entry: MarketEntry; current: string }[],
    quiet = false,
  ): Promise<void> => {
    const updated: MarketEntry[] = []
    let servers = false
    for (const { entry: found } of pending) {
      const result = await fetchExtension(found.id, { registry: registry(), fetcher })
      if (!result.ok) {
        if (!quiet) status.say(`Extension ${found.id}: ${result.error}`, 'error')
        continue
      }
      const error = await writeExtension(found.id, result, EXTENSIONS_DIR, {
        registry: registry(),
        fetcher,
      })
      if (error) {
        if (!quiet) status.say(`Could not update ${found.id}: ${error}`, 'error')
        continue
      }
      servers ||= result.extension.servers.length > 0
      updated.push(found)
    }
    if (updated.length === 0) return
    settings.reloadExtensions()
    status.say(
      updated.length === 1
        ? `Updated ${updated[0]!.name} to ${updated[0]!.version}`
        : `Updated ${updated.length} extensions`,
    )
    // After the status line: the restart re-syncs open documents and would overwrite it.
    if (servers) onServersReload?.()
  }

  const appearancesOf = (installed: Extension) => [
    ...installed.themes
      .filter(({ id }) => id !== settings.config.theme)
      .map(({ id }) => ({ id: `theme:${id}`, label: `${themeLabel(id)} theme` })),
    ...installed.icons
      .filter(icons => icons.id !== settings.config.iconTheme)
      .map(icons => ({ id: `icons:${icons.id}`, label: `${iconThemeLabel(icons.id)} file icons` })),
  ]

  const offerActivation = (installed: Extension): void => {
    if (installed.disabled) return
    const choices = appearancesOf(installed)
    if (choices.length === 0) return
    // The write was asynchronous: a save conflict may have opened a prompt meanwhile.
    if (prompts.prompt()) return
    prompts.setPrompt({
      kind: 'activateExtension',
      name: installed.name,
      choices: choices.slice(0, MAX_ACTIVATION_CHOICES),
      more: Math.max(0, choices.length - MAX_ACTIVATION_CHOICES),
    })
  }

  const activate = (choice: string): void => {
    const [kind, ...rest] = choice.split(':')
    const id = rest.join(':')
    if (kind === 'icons') return settings.applyIconTheme(id)
    if (kind === 'theme' && isThemeName(id)) settings.applyTheme(id)
  }

  const accept = (id: string): void => {
    const result = fetched.get(id)
    fetched.delete(id)
    if (!result) return
    const release = status.claimBusy({ label: `Installing ${result.extension.name}` })
    void (async () => {
      try {
        const error = await writeExtension(id, result, EXTENSIONS_DIR, {
          registry: registry(),
          fetcher,
        })
        if (error) return void status.say(`Could not install ${id}: ${error}`, 'error')
        const load = settings.reloadExtensions()
        const installed = load.extensions.find(extension => extension.id === id)
        status.say(`Installed ${installed?.name ?? id} ${installed?.version ?? ''}`.trim())
        // After the status line: the restart re-syncs open documents and would overwrite it.
        if (result.extension.servers.length > 0) onServersReload?.()
        if (installed) offerActivation(installed)
      } finally {
        release()
      }
    })()
  }

  const decline = (id: string): void => {
    fetched.delete(id)
    declined.add(id)
  }

  const install = (id: string): void => {
    declined.delete(id)
    void offer(id, 'Install it?')
  }

  const remove = (id: string): void => {
    const installed = extensions().find(extension => extension.id === id)
    if (installed?.builtin) {
      return void status.say(`"${id}" ships with druk — disable it instead`, 'warn')
    }
    const error = removeFromDisk(id, EXTENSIONS_DIR)
    if (error) return void status.say(`Could not remove ${id}: ${error}`, 'error')
    settings.reloadExtensions()
    status.say(`Removed extension "${id}"`)
  }

  const checkNow = async (): Promise<void> => {
    const before = catalog().length
    const fresh = await refresh(true)
    if (fresh.length === 0) {
      return void status.say('Could not reach the extension market', 'warn')
    }
    const pending = updates()
    if (pending.length > 0) return applyUpdates(pending)
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
    await applyUpdates(pending)
  }

  const suggestForFiletype = (path: string, filetype: string | undefined): void => {
    if (!settings.config.extensionUpdates || !settings.config.lsp) return
    const name = basename(path).toLowerCase()
    const key = filetype ?? (extname(name) || name)
    // Marked before the await: `clientsFor` asks on every sync of every open document.
    if (asked.has(key)) return
    asked.add(key)
    void (async () => {
      await ready()
      if (catalog().length === 0) return void asked.delete(key)
      const claims = (extension: MarketEntry) =>
        extension.provides.extensions.find(ext => name.endsWith(ext.toLowerCase()))
      const serving = catalog().filter(extension =>
        filetype ? extension.provides.filetypes.includes(filetype) : claims(extension),
      )
      // A linter claims the filetype too: prefer a language extension to the alphabetical first.
      const found =
        serving.find(extension => extension.categories.includes('language')) ?? serving[0]
      if (!found || declined.has(found.id)) return
      if (extensions().some(extension => extension.id === found.id)) return
      declined.add(found.id)
      const label = filetype ?? claims(found)
      await offer(found.id, `No language server for ${label}. Install ${found.name}?`, true)
    })()
  }

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
      return
    }
  }

  const check = async (): Promise<void> => {
    if (!settings.config.extensionUpdates) return
    await ready()
    const pending = updates()
    if (pending.length > 0) await applyUpdates(pending, true)
    suggestMissingNames()
  }

  return {
    catalog,
    openPanel,
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
    activate,
    suggestForFiletype,
  }
}

export type Market = ReturnType<typeof createMarket>
