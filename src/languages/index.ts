/**
 * Language registry — what druk knows how to highlight, and how to name it.
 *
 * Nothing is listed here any more: a language is an extension contribution, the way
 * a theme or a language server is. The grammars themselves still ship inside the
 * binary (`./grammars.ts`, imported statically because that is the only form
 * `bun build --compile` can embed) — what an extension decides is whether a language
 * is *registered*, and with which query, patterns, label and comment prefix.
 *
 * So the table below starts empty and `loadExtensions` fills it. Every reader has
 * to go through a function for that reason: the modules that show languages are
 * evaluated before any extension has been read.
 */
import { createSignal } from 'solid-js'

export interface Language {
  /** Filetype id, e.g. "typescript". Must match OpenTUI's `pathToFiletype`. */
  id: string
  /**
   * What the status bar calls the file, when the id itself will not do. `id` has to
   * be OpenTUI's filetype name, and a couple of those are a mouthful — `.tsx` files
   * are `typescriptreact`. Left off, the id is shown as-is.
   */
  label?: string
  /**
   * Grammar shipped with OpenTUI — no wasm/query needed from us.
   * Bundled today: markdown, zig. Not typescript/javascript, deliberately:
   * OpenTUI's bundled queries gate identifier captures behind `#lua-match?`
   * predicates its worker never evaluates, so every identifier matched
   * `@type` and `@constant` too and painted as a constant. The typescript
   * extension points those filetypes at the vendored tsx grammar instead.
   */
  bundled?: boolean
  /** Path to the grammar wasm, when the grammar is vendored or an extension's own. */
  wasm?: string
  /** Path to the highlight query, beside the wasm. */
  query?: string
  /**
   * Regex highlighting. Alone, it is the whole answer for a format with no usable
   * grammar. Beside a grammar, it is an overlay for a dialect the grammar cannot
   * parse — see `outsideProse` in ./highlight.ts for what it may override.
   * Patterns paint in order, so later entries win the characters they overlap.
   */
  patterns?: { group: string; re: RegExp }[]
  /**
   * Extensions OpenTUI does not resolve itself (`.tf`, `.tsrx`), with the dot.
   * Without one of these the patterns never run and the file renders plain.
   */
  extensions?: string[]
  /** Whole file names — `bun.lock` is jsonc however its extension reads. */
  filenames?: string[]
  /** Name pattern for the files an extension cannot describe (`.env.local`). */
  filenamePattern?: RegExp
  /** Line-comment prefix, for the Ctrl+/ toggle. Absent: the toggle does nothing. */
  lineComment?: string
}

/** Registered by extensions, in load order. A later entry replaces an earlier id. */
const registry = new Map<string, Language>()

/**
 * Bumped on every change — and a signal, not a counter, because every lookup
 * below reads it.
 *
 * That is what makes installing a language extension show up without a restart: the
 * status bar's filetype and the editor's highlight window are computed in
 * reactive scopes, and a plain Map would leave both showing what they resolved
 * to before the extension existed. `highlight.ts` reads it untracked, to know when
 * the tree-sitter worker needs telling about a new grammar.
 */
const [generation, bump] = createSignal(0)

export function registerLanguage(language: Language): void {
  registry.set(language.id, language)
  bump(generation() + 1)
}

export function clearExtensionLanguages(): void {
  registry.clear()
  bump(generation() + 1)
}

/** How many times the registry has changed — `highlight.ts` re-registers on it. */
export const languageGeneration = (): number => generation()

export const languages = (): Language[] => {
  generation()
  return [...registry.values()]
}

export function languageFor(filetype: string | undefined): Language | undefined {
  generation()
  return filetype ? registry.get(filetype) : undefined
}

/** What to call `filetype` on screen. */
export function languageLabel(filetype: string): string {
  return languageFor(filetype)?.label ?? filetype
}

export function commentPrefix(filetype: string | undefined): string | undefined {
  return languageFor(filetype)?.lineComment
}

/** Languages with a grammar of their own, which tree-sitter has to be told about. */
export const vendoredLanguages = (): Language[] =>
  languages().filter(language => language.wasm && language.query)

/**
 * The filetype a file *name* declares, for the names and extensions OpenTUI
 * resolves none of. Ordered: a whole name beats a pattern beats an extension,
 * since `bun.lock` and `.env.local` are both "extensions" that mean nothing.
 */
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
