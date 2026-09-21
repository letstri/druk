// Spelled out rather than globbed: a computed path resolves to nothing in the compiled binary.
import cssManifest from '../../extensions/css/extension.json'
import diffManifest from '../../extensions/diff/extension.json'
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
  diffManifest,
]

const BUILTIN_SOURCE = 'built in'

let parsed: Extension[] | null = null

// A problem here is druk's own bug (test/extensions-repo.test.ts), so it is dropped, not reported.
export function builtinExtensions(): Extension[] {
  parsed ??= MANIFESTS.map(
    (raw) => parseManifest(raw, BUILTIN_SOURCE).extension
  )
    .filter((extension) => extension !== null)
    .map((extension) => ({ ...extension, builtin: true }))
  return parsed
}
