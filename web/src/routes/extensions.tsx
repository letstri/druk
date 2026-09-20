import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import catalog from '../../../extensions/index.json'

export const Route = createFileRoute('/extensions')({
  component: Extensions,
  head: () => ({
    meta: [
      { title: 'druk extensions — languages, servers, themes, icons' },
      {
        name: 'description',
        content:
          "Every extension in druk's market: languages and their servers, themes, icon sets. A manifest is JSON, not code — installing one runs nothing.",
      },
      { property: 'og:title', content: 'druk extensions' },
      {
        property: 'og:description',
        content:
          'Languages, language servers, themes and icon sets for druk. JSON manifests, not code.',
      },
      { property: 'og:url', content: 'https://druk.sh/extensions' },
      { name: 'twitter:title', content: 'druk extensions' },
      {
        name: 'twitter:description',
        content:
          'Languages, language servers, themes and icon sets for druk. JSON manifests, not code.',
      },
    ],
    links: [{ rel: 'canonical', href: 'https://druk.sh/extensions' }],
  }),
})

const REPO = 'https://github.com/letstri/druk/tree/main/extensions'

type Category = 'language' | 'lsp' | 'theme' | 'icons'

interface Extension {
  id: string
  name: string
  version: string
  description: string
  provides: { themes: string[]; icons: string[]; filetypes: string[] }
  categories: string[]
}

// Mirrors src/extensions/builtin.ts; the catalog does not mark preinstalled manifests.
const BUILTIN = new Set([
  'typescript',
  'json',
  'markdown',
  'html',
  'css',
  'yaml',
  'toml',
  'dotenv',
  'diff',
])

const EXTENSIONS = catalog.extensions as Extension[]

const GROUPS: { key: Category; label: string; note: string }[] = [
  {
    key: 'language',
    label: 'languages',
    note: 'grammar, highlight query, comment token — and, where one exists, the server that serves it',
  },
  {
    key: 'lsp',
    label: 'linters',
    note: 'a server that reports beside whichever one serves the file',
  },
  {
    key: 'theme',
    label: 'themes',
    note: 'a palette family; several flavors ship as one extension',
  },
  {
    key: 'icons',
    label: 'icon themes',
    note: 'file icons for the tree, the tabs and the git panel',
  },
]

function groupOf(extension: Extension): Category {
  if (extension.categories.includes('language')) return 'language'
  if (extension.categories.includes('theme')) return 'theme'
  if (extension.categories.includes('icons')) return 'icons'
  return 'lsp'
}

function haystack(extension: Extension): string {
  const { themes, icons, filetypes } = extension.provides
  return [
    extension.id,
    extension.name,
    extension.description,
    ...extension.categories,
    ...themes,
    ...icons,
    ...filetypes,
  ]
    .join(' ')
    .toLowerCase()
}

function Row({ extension }: { extension: Extension }) {
  const { themes, icons, filetypes } = extension.provides
  // A lone filetype named after the extension repeats the row's name.
  const registers = [...filetypes, ...themes, ...icons].filter(
    (name, _, all) => all.length > 1 || name !== extension.id,
  )
  return (
    <div className="ext">
      <div className="ext-head">
        <a className="ext-name" href={`${REPO}/${extension.id}`}>
          {extension.name}
        </a>
        <span className="ext-ver">{extension.version}</span>
        {BUILTIN.has(extension.id) ? <span className="ext-tag built">built in</span> : null}
        {extension.categories.includes('lsp') ? <span className="ext-tag">lsp</span> : null}
      </div>
      <div className="ext-desc">{extension.description}</div>
      {registers.length > 0 ? <div className="ext-regs">{registers.join('  ')}</div> : null}
    </div>
  )
}

function Extensions() {
  const [query, setQuery] = useState('')
  const [only, setOnly] = useState<Category | 'all'>('all')

  const indexed = useMemo(
    () =>
      EXTENSIONS.map(extension => ({
        extension,
        text: haystack(extension),
        group: groupOf(extension),
      })),
    [],
  )

  const needle = query.trim().toLowerCase()
  const hits = indexed.filter(
    row => (only === 'all' || row.group === only) && (needle === '' || row.text.includes(needle)),
  )

  const counts = (key: Category) => indexed.filter(row => row.group === key).length

  return (
    <main className="term">
      <div className="session">
        <h1 className="comment">
          # <span className="title">druk</span> extensions — {EXTENSIONS.length} in the market.
        </h1>
        <p className="comment">
          # a manifest is JSON, not code: installing one runs nothing. grammars are already in the
          binary, so a language extension is one small file.
        </p>
        <p className="prompt" style={{ marginTop: '1.5rem' }}>
          <span className="ps1">$</span> druk . <span className="comment"># then Ctrl+Opt+X</span>
        </p>
        <p className="comment">
          # or drop the manifest in ~/.config/druk/extensions/&lt;id&gt;.json
        </p>
      </div>

      <section className="section">
        <div className="filter">
          <label className="filter-line" htmlFor="ext-filter">
            <span className="ps1">/</span>
            <input
              id="ext-filter"
              className="filter-input"
              type="search"
              aria-label="Filter extensions"
              value={query}
              placeholder="filter by name, language, theme…"
              autoComplete="off"
              spellCheck={false}
              onChange={event => setQuery(event.target.value)}
            />
          </label>
          <div className="chips">
            <button
              type="button"
              className={only === 'all' ? 'chip on' : 'chip'}
              aria-pressed={only === 'all'}
              onClick={() => setOnly('all')}
            >
              all {EXTENSIONS.length}
            </button>
            {GROUPS.map(group => (
              <button
                key={group.key}
                type="button"
                className={only === group.key ? 'chip on' : 'chip'}
                aria-pressed={only === group.key}
                onClick={() => setOnly(group.key)}
              >
                {group.label} {counts(group.key)}
              </button>
            ))}
          </div>
        </div>

        {hits.length === 0 ? (
          <p className="comment out">
            # nothing matches {JSON.stringify(query)} — the panel's search is the same one, and it
            reads ids and filetypes too.
          </p>
        ) : null}

        {GROUPS.map(group => {
          const rows = hits.filter(row => row.group === group.key)
          if (rows.length === 0) return null
          return (
            <div key={group.key} className="group">
              <p className="prompt">
                <span className="ps1">▾</span> <span className="group-name">{group.label}</span>{' '}
                <span className="comment"># {group.note}</span>
              </p>
              <div className="out">
                {rows.map(row => (
                  <Row key={row.extension.id} extension={row.extension} />
                ))}
              </div>
            </div>
          )
        })}
      </section>

      <section className="section">
        <p className="prompt">
          <span className="ps1">$</span> <span className="comment"># adding one</span>
        </p>
        <div className="out">
          <p className="comment">
            # a folder under extensions/ holding extension.json, then bun run extensions. served raw
            from main, so a merged pull request is installable without a druk release.
          </p>
          <p className="prompt" style={{ marginTop: '0.75rem' }}>
            <span className="ps1">$</span> open{' '}
            <a href="https://github.com/letstri/druk/blob/main/extensions/README.md">
              extensions/README.md
            </a>
          </p>
          <p className="prompt">
            <span className="ps1">$</span> cd <Link to="/">..</Link>{' '}
            <span className="comment"># back to the editor</span>
            <span className="caret" style={{ marginLeft: '0.5rem' }} />
          </p>
        </div>
      </section>
    </main>
  )
}
