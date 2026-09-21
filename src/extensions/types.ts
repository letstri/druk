import type { IconTheme } from '../icons'
import type { Language } from '../languages'
import type { ServerSpec } from '../lsp/servers'
import type { Theme } from '../themes'

export type ExtensionCategory = 'language' | 'lsp' | 'theme' | 'icons'

export const CATEGORIES: ExtensionCategory[] = [
  'language',
  'lsp',
  'theme',
  'icons',
]

export interface Extension {
  id: string
  name: string
  version: string
  description: string
  source: string
  disabled: boolean
  builtin: boolean
  themes: { id: string; theme: Theme }[]
  icons: IconTheme[]
  languages: Language[]
  servers: ServerSpec[]
  categories: ExtensionCategory[]
  // Relative to the manifest's folder.
  assets: string[]
}

export interface ExtensionProblem {
  source: string
  reason: string
}

export interface ExtensionLoad {
  extensions: Extension[]
  problems: ExtensionProblem[]
}
