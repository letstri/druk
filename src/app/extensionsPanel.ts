import { createMemo, createSignal } from 'solid-js'

import type { MarketEntry } from '../core/market'
import { plural } from '../core/text'
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

const SECTIONS = { available: 'AVAILABLE', installed: 'INSTALLED' } as const

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
    if (!q) {
      return true
    }
    return haystack.toLowerCase().includes(q)
  }

  const installedList = createMemo(() =>
    extensions()
      .map((extension: Extension) => {
        const latest = market
          .catalog()
          .find((entry) => entry.id === extension.id)
        return {
          about: contributionSummary(extension),
          builtin: extension.builtin,
          categories: extension.categories,
          disabled: extension.disabled,
          id: extension.id,
          keywords: [
            ...extension.themes.map((theme) => theme.id),
            ...extension.icons.map((icons) => icons.id),
            ...extension.languages.map((language) => language.id),
            ...extension.servers.flatMap((server) => [
              server.id,
              ...server.filetypes,
            ]),
            ...extension.categories,
          ].join(' '),
          kind: 'installed' as const,
          label: extension.name,
          update:
            latest &&
            !extension.builtin &&
            isNewer(latest.version, extension.version)
              ? latest.version
              : null,
          version: extension.version,
        }
      })
      .filter((row) =>
        matches(`${row.label} ${row.id} ${row.about} ${row.keywords}`)
      )
  )

  const availableList = createMemo(() => {
    const held = new Set(extensions().map((extension) => extension.id))
    return market
      .catalog()
      .filter((entry: MarketEntry) => !held.has(entry.id))
      .map((entry) => ({
        about: entry.description,
        categories: entry.categories,
        id: entry.id,
        keywords: [
          ...entry.provides.themes,
          ...entry.provides.icons,
          ...entry.provides.filetypes,
          ...entry.categories,
        ].join(' '),
        kind: 'available' as const,
        label: entry.name,
        version: entry.version,
      }))
      .filter((row) =>
        matches(`${row.label} ${row.id} ${row.about} ${row.keywords}`)
      )
  })

  const rows = createMemo<ExtensionRow[]>(() => {
    const out: ExtensionRow[] = []
    const installed = installedList()
    if (installed.length > 0 || !query()) {
      const shut = !query() && collapsed().installed === true
      out.push({
        collapsed: shut,
        count: installed.length,
        id: 'installed',
        kind: 'section',
        label: SECTIONS.installed,
      })
      if (!shut) {
        out.push(...installed)
      }
    }
    const available = availableList()
    if (available.length === 0) {
      return out
    }
    const shutMarket = !query() && collapsed().available === true
    out.push({
      collapsed: shutMarket,
      count: available.length,
      id: 'available',
      kind: 'section',
      label: SECTIONS.available,
    })
    if (shutMarket) {
      return out
    }
    out.push(...available.slice(0, MAX_RESULTS))
    if (available.length > MAX_RESULTS) {
      out.push({
        id: 'more',
        kind: 'note',
        label: query()
          ? `+${available.length - MAX_RESULTS} more matches`
          : `+${available.length - MAX_RESULTS} more — search to narrow`,
      })
    }
    return out
  })

  const at = () => Math.max(0, Math.min(cursor(), rows().length - 1))
  const row = () => rows()[at()]

  const move = (delta: number) =>
    setCursor(Math.max(0, Math.min(at() + delta, rows().length - 1)))
  const moveTo = (index: number) =>
    setCursor(Math.max(0, Math.min(index, rows().length - 1)))

  const toggleSection = (id: string) =>
    setCollapsed((current) => ({ ...current, [id]: !current[id] }))

  const fold = (shut: boolean) => {
    const current = row()
    if (current?.kind !== 'section' || current.collapsed === shut) {
      return
    }
    toggleSection(current.id)
  }

  const activate = (index = at()) => {
    moveTo(index)
    const current = rows()[Math.max(0, Math.min(index, rows().length - 1))]
    if (!current) {
      return
    }
    if (current.kind === 'note') {
      return
    }
    if (current.kind === 'section') {
      return toggleSection(current.id)
    }
    if (current.kind === 'available') {
      return market.install(current.id)
    }
    settings.toggleExtension(current.id)
  }

  const remove = () => {
    const current = row()
    if (current?.kind !== 'installed') {
      return
    }
    if (current.builtin) {
      status.say(
        `"${current.id}" ships with druk — turn it off instead`,
        'warn'
      )
      return
    }
    const extension = extensions().find((entry) => entry.id === current.id)
    prompts.setPrompt({
      id: current.id,
      kind: 'uninstallExtension',
      name: current.label,
      servers: (extension?.servers ?? [])
        .map((server) => ({
          id: server.id,
          removable: lsp.removable(server.id),
        }))
        .filter((entry) => entry.removable !== null)
        .map((entry) => ({ id: entry.id, name: entry.removable!.name })),
    })
  }

  const reload = (): void => {
    const load = settings.reloadExtensions()
    const [problem] = load.problems
    if (problem) {
      status.say(`Extension: ${problem.reason}`, 'warn')
      return
    }
    status.say(`${plural(load.extensions.length, 'extension')} reloaded`)
  }

  const openSearch = () => setQuery((current) => current ?? '')

  const closeSearch = () => {
    const held = row()
    setQuery(null)
    const landing =
      held && held.kind !== 'section'
        ? rows().findIndex((entry) => entry.id === held.id)
        : -1
    setCursor(Math.max(0, landing))
  }
  const search = (value: string) => {
    setQuery(value)
    const first = rows().findIndex(
      (entry) => entry.kind === 'installed' || entry.kind === 'available'
    )
    setCursor(Math.max(0, first))
  }

  return {
    activate,
    checkNow: () => {
      market.checkNow()
    },
    closeSearch,
    cursor: at,
    fold,
    installedCount: () => extensions().length,
    move,
    moveTo,
    openSearch,
    query,
    reload,
    remove,
    rows,
    search,
    updateAll: () => {
      market.updateAll()
    },
  }
}

export type ExtensionsPanel = ReturnType<typeof createExtensionsPanel>
