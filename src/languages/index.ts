import { createSignal } from 'solid-js'

export interface Language {
  // Must match OpenTUI's `pathToFiletype`.
  id: string
  label?: string
  // OpenTUI's own grammar — never ts/js: their queries gate captures behind `#lua-match?`.
  bundled?: boolean
  wasm?: string
  query?: string
  // Later entries win the characters they overlap.
  patterns?: { group: string; re: RegExp }[]
  // With the dot.
  extensions?: string[]
  filenames?: string[]
  filenamePattern?: RegExp
  lineComment?: string
}

const registry = new Map<string, Language>()

// A signal, not a counter: the bare `generation()` calls below are what make lookups reactive.
const [generation, bump] = createSignal(0)

export function registerLanguage(language: Language): void {
  registry.set(language.id, language)
  bump(generation() + 1)
}

export function clearExtensionLanguages(): void {
  registry.clear()
  bump(generation() + 1)
}

export const languageGeneration = (): number => generation()

export const languages = (): Language[] => {
  generation()
  return [...registry.values()]
}

export function languageFor(filetype: string | undefined): Language | undefined {
  generation()
  return filetype ? registry.get(filetype) : undefined
}

export function languageLabel(filetype: string): string {
  return languageFor(filetype)?.label ?? filetype
}

export function commentPrefix(filetype: string | undefined): string | undefined {
  return languageFor(filetype)?.lineComment
}

export const vendoredLanguages = (): Language[] =>
  languages().filter(language => language.wasm && language.query)

// Ordered: a whole name beats a pattern beats an extension (`bun.lock`, `.env.local`).
export function filetypeForName(name: string): string | undefined {
  generation()
  const lower = name.toLowerCase()
  for (const language of registry.values()) {
    if (language.filenames?.some(entry => entry.toLowerCase() === lower)) return language.id
  }
  for (const language of registry.values()) {
    if (language.filenamePattern?.test(name)) return language.id
  }
  for (const language of registry.values()) {
    if (language.extensions?.some(ext => lower.endsWith(ext.toLowerCase()))) return language.id
  }
  return undefined
}
