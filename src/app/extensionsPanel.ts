import { createMemo, createSignal } from 'solid-js'

import type { MarketEntry } from '../core/market'
import { isNewer } from '../core/update'
import { contributionSummary, extensions } from '../extensions'
import type { Extension } from '../extensions'
import type { ExtensionRow } from '../ui/ExtensionsPanel'
import type { Lsp } from './lsp'
import type { Market } from './market'
import type { PromptState } from './prompts'
import type { Settings } from './settings'
import type { Status } from './status'

export type { ExtensionRow } from '../ui/ExtensionsPanel'

const SECTIONS = { installed: 'INSTALLED', available: 'AVAILABLE' } as const

const MAX_RESULTS = 50

export function createExtensionsPanel(deps: {
  settings: Settings
  market: Market
  status: Status
  lsp: Lsp
  prompts: PromptState
}) {
  const { settings, market, status, lsp, prompts } = deps

  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({})
  const [cursor, setCursor] = createSignal(0)
  const [query, setQuery] = createSignal<string | null>(null)

  const matches = (haystack: string) => {
    const q = query()?.trim().toLowerCase()
    if (!q) return true
    return haystack.toLowerCase().includes(q)
  }

  const installedList = createMemo(() =>
    extensions()
      .map((extension: Extension) => {
        const latest = market.catalog().find(entry => entry.id === extension.id)
        return {
          categories: extension.categories,
          keywords: [
            ...extension.themes.map(theme => theme.id),
            ...extension.icons.map(icons => icons.id),
            ...extension.languages.map(language => language.id),
            ...extension.servers.flatMap(server => [server.id, ...server.filetypes]),
            ...extension.categories,
          ].join(' '),
          kind: 'installed' as const,
          id: extension.id,
          label: extension.name,
          version: extension.version,
          update:
            latest && !extension.builtin && isNewer(latest.version, extension.version)
              ? latest.version
              : null,
          disabled: extension.disabled,
          builtin: extension.builtin,
          about: contributionSummary(extension),
        }
      })
      .filter(row => matches(`${row.label} ${row.id} ${row.about} ${row.keywords}`)),
  )

  const availableList = createMemo(() => {
    const held = new Set(extensions().map(extension => extension.id))
    return market
      .catalog()
      .filter((entry: MarketEntry) => !held.has(entry.id))
      .map(entry => ({
        kind: 'available' as const,
        id: entry.id,
        label: entry.name,
        version: entry.version,
        about: entry.description,
        categories: entry.categories,
        keywords: [
          ...entry.provides.themes,
          ...entry.provides.icons,
          ...entry.provides.filetypes,
          ...entry.categories,
        ].join(' '),
      }))
      .filter(row => matches(`${row.label} ${row.id} ${row.about} ${row.keywords}`))
  })

  const rows = createMemo<ExtensionRow[]>(() => {
    const out: ExtensionRow[] = []
    const installed = installedList()
    if (installed.length > 0 || !query()) {
      const shut = !query() && collapsed().installed === true
      out.push({
        kind: 'section',
        id: 'installed',
        label: SECTIONS.installed,
        count: installed.length,
        collapsed: shut,
      })
      if (!shut) out.push(...installed)
    }
    const available = availableList()
    if (available.length === 0) return out
    const shutMarket = !query() && collapsed().available === true
    out.push({
      kind: 'section',
      id: 'available',
      label: SECTIONS.available,
      count: available.length,
      collapsed: shutMarket,
    })
    if (shutMarket) return out
    out.push(...available.slice(0, MAX_RESULTS))
    if (available.length > MAX_RESULTS) {
      out.push({
        kind: 'note',
        id: 'more',
        label: query()
          ? `+${available.length - MAX_RESULTS} more matches`
          : `+${available.length - MAX_RESULTS} more — search to narrow`,
      })
    }
    return out
  })

  const at = () => Math.max(0, Math.min(cursor(), rows().length - 1))
  const row = () => rows()[at()]

  const move = (delta: number) => setCursor(Math.max(0, Math.min(at() + delta, rows().length - 1)))
  const moveTo = (index: number) => setCursor(Math.max(0, Math.min(index, rows().length - 1)))

  const toggleSection = (id: string) =>
    setCollapsed(current => ({ ...current, [id]: !current[id] }))

  const fold = (shut: boolean) => {
    const current = row()
    if (current?.kind !== 'section' || current.collapsed === shut) return
    toggleSection(current.id)
  }

  const activate = (index = at()) => {
    moveTo(index)
    const current = rows()[Math.max(0, Math.min(index, rows().length - 1))]
    if (!current) return
    if (current.kind === 'note') return
    if (current.kind === 'section') return toggleSection(current.id)
    if (current.kind === 'available') return market.install(current.id)
    settings.toggleExtension(current.id)
  }

  const remove = () => {
    const current = row()
    if (current?.kind !== 'installed') return
    if (current.builtin) {
      return void status.say(`"${current.id}" ships with druk — turn it off instead`, 'warn')
    }
    const extension = extensions().find(entry => entry.id === current.id)
    prompts.setPrompt({
      kind: 'uninstallExtension',
      id: current.id,
      name: current.label,
      servers: (extension?.servers ?? [])
        .map(server => ({ id: server.id, removable: lsp.removable(server.id) }))
        .filter(entry => entry.removable !== null)
        .map(entry => ({ id: entry.id, name: entry.removable!.name })),
    })
  }

  const reload = (): void => {
    const load = settings.reloadExtensions()
    const problem = load.problems[0]
    if (problem) return void status.say(`Extension: ${problem.reason}`, 'warn')
    status.say(
      `${load.extensions.length} extension${load.extensions.length === 1 ? '' : 's'} reloaded`,
    )
  }

  const openSearch = () => setQuery(current => current ?? '')

  const closeSearch = () => {
    const held = row()
    setQuery(null)
    const at =
      held && held.kind !== 'section' ? rows().findIndex(entry => entry.id === held.id) : -1
    setCursor(Math.max(0, at))
  }
  const search = (value: string) => {
    setQuery(value)
    const first = rows().findIndex(
      entry => entry.kind === 'installed' || entry.kind === 'available',
    )
    setCursor(Math.max(0, first))
  }

  return {
    rows,
    cursor: at,
    move,
    moveTo,
    activate,
    fold,
    remove,
    reload,
    query,
    openSearch,
    closeSearch,
    search,
    installedCount: () => extensions().length,
    checkNow: () => void market.checkNow(),
    updateAll: () => void market.updateAll(),
  }
}

export type ExtensionsPanel = ReturnType<typeof createExtensionsPanel>
