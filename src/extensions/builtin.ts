/**
 * The extensions that ship inside the binary.
 *
 * Same manifests as the market's — these are `extensions/<id>/extension.json` in this
 * repository, imported as JSON so `bun build --compile` inlines them. Nothing
 * else distinguishes a preinstalled extension: it is listed, it can be disabled,
 * and installing the market's copy of the same id replaces it, which is how a
 * built-in extension gets an update.
 *
 * What is here is a judgement about a first run: the languages most projects
 * open, so a fresh druk highlights code with no network and no installs. Every
 * other language is an extension away, and costs one small JSON to fetch — the
 * grammars themselves are embedded either way (`src/languages/grammars.ts`),
 * since a wasm cannot be downloaded into a running tree-sitter worker.
 *
 * The static imports are the point. A computed path resolves to nothing inside
 * the compiled binary, so this list is deliberately spelled out rather than
 * globbed from the folder.
 */
import cssManifest from '../../extensions/css/extension.json'
import dotenvManifest from '../../extensions/dotenv/extension.json'
import htmlManifest from '../../extensions/html/extension.json'
import jsonManifest from '../../extensions/json/extension.json'
import markdownManifest from '../../extensions/markdown/extension.json'
import tomlManifest from '../../extensions/toml/extension.json'
import typescriptManifest from '../../extensions/typescript/extension.json'
import yamlManifest from '../../extensions/yaml/extension.json'
import { parseManifest } from './manifest'
import type { Extension } from './types'

const MANIFESTS: unknown[] = [
  typescriptManifest,
  jsonManifest,
  markdownManifest,
  htmlManifest,
  cssManifest,
  yamlManifest,
  tomlManifest,
  dotenvManifest,
]

/** Where a built-in says it came from, since there is no file to point at. */
const BUILTIN_SOURCE = 'built in'

let parsed: Extension[] | null = null

/**
 * The embedded extensions, parsed once.
 *
 * A problem here is druk's own bug, not a user's, so it is dropped rather than
 * reported: `test/extensions-repo.test.ts` parses every manifest in the repository
 * and fails the build, which is where a broken one is caught.
 */
export function builtinExtensions(): Extension[] {
  parsed ??= MANIFESTS.map(raw => parseManifest(raw, BUILTIN_SOURCE).extension)
    .filter(extension => extension !== null)
    .map(extension => ({ ...extension, builtin: true }))
  return parsed
}
