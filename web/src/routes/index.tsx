import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

export const Route = createFileRoute('/')({
  component: Home,
})

const GITHUB = 'https://github.com/letstri/druk'

function copyText(text: string): Promise<void> {
  const legacy = () => {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(legacy)
  }
  legacy()
  return Promise.resolve()
}

function Cmd({ text, note }: { text: string; note?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="cmd"
      onClick={async () => {
        await copyText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1400)
      }}
      aria-label={`Copy: ${text}`}
    >
      <span className="line">
        <span className="ps1">$ </span>
        {text}
      </span>
      {copied ? (
        <span className="copied"> # copied</span>
      ) : note ? (
        <span className="comment"> # {note}</span>
      ) : null}
    </button>
  )
}

// The mock is druk's own UI drawn as text: history arrows and tab strip, the
// sidebar with its Files/Git/Review/Ext view strip and explorer header, the
// tree with git letters, the editor, and a status bar with the footer hints.
//
// Every string here is a JS literal rather than JSX text, and has to stay one:
// the formatter collapses runs of spaces inside JSX text, and this all renders
// in a <pre>, where that is a visible change — code indentation and the gaps
// that line the columns up both come out of these strings.
type Span = [cls: string, text: string]

interface MockRow {
  side: Span[]
  num?: string
  git?: 'add' | 'mod'
  fold?: string
  code: Span[]
  cursor?: boolean
  caret?: boolean
}

// Columns the sidebar occupies. A row's spans are padded out to it, so the
// gutter starts at the same column on every line.
const SB = 24

const width = (spans: Span[]) => spans.reduce((n, [, t]) => n + [...t].length, 0)

/** Pads a sidebar row to SB columns, keeping `mark` (a git letter, a ◆) at the right edge. */
function side(text: string, mark?: Span): Span[] {
  if (!mark) return [['', text.padEnd(SB)]]
  return [['', text.padEnd(SB - 2)], mark, ['', ' ']]
}

const ROWS: MockRow[] = [
  {
    side: [
      ['sb-active', ' Files '],
      ['d', ' Git  Review  Ext'],
    ],
    code: [['d', ' src/app/workspace.ts']],
  },
  {
    side: [
      ['', ' druk        '],
      ['d', '▴ explorer '],
    ],
    num: ' 14',
    fold: '▾',
    code: [
      ['k', 'export function '],
      ['f', 'createWorkspace'],
      ['', '(deps: '],
      ['t', 'Deps'],
      ['', ') {'],
    ],
  },
  {
    side: side(' ▾ src'),
    num: ' 15',
    code: [
      ['k', '  const'],
      ['', ' [tabs, setTabs] = '],
      ['f', 'createSignal'],
      ['', '<'],
      ['t', 'Tab'],
      ['', '[]>([])'],
    ],
  },
  {
    side: side('   ▾ app'),
    num: ' 16',
    code: [
      ['k', '  const'],
      ['', ' dirty = '],
      ['f', 'createMemo'],
      ['', '(() => '],
      ['f', 'tabs'],
      ['', '().'],
      ['f', 'filter'],
      ['', '(t => t.unsaved))'],
    ],
  },
  { side: side('     commands.ts'), num: ' 17', code: [] },
  {
    side: side('     git.ts'),
    num: ' 18',
    fold: '▸',
    git: 'mod',
    code: [
      ['k', '  function'],
      ['f', ' openFile'],
      ['', '(path: '],
      ['t', 'string'],
      ['', ') { '],
      ['d', '⋯ 24 lines'],
      ['wide d', '  Ctrl+Opt+E'],
    ],
  },
  { side: side('     workspace.ts', ['g-mod', 'M']), num: ' 43', code: [] },
  {
    side: side('   ▾ ui'),
    num: ' 44',
    git: 'add',
    code: [['d', '  // a fold hands the buffer a different text; the']],
  },
  {
    side: side('     EditorPane.tsx', ['g-add', 'U']),
    num: ' 45',
    git: 'add',
    code: [['d', "  // gutter keeps the file's own numbering across the gap"]],
  },
  {
    side: side('   ▸ core'),
    num: ' 46',
    git: 'mod',
    cursor: true,
    caret: true,
    code: [
      ['k', '  const'],
      ['', ' folded = () => '],
      ['f', 'spacedView'],
      ['', '('],
      ['f', 'source'],
      ['', '(), '],
      ['f', 'folds'],
      ['', '())'],
    ],
  },
  {
    side: side('   ▸ lsp'),
    num: ' 47',
    code: [
      ['f', '  autosave'],
      ['', '(folded)  '],
      ['w', "▲ 'autosave' is deprecated"],
      ['wide w', '  Ctrl+Opt+I'],
    ],
  },
  {
    side: side(' ▸ extensions'),
    num: ' 48',
    code: [
      ['k', '  return'],
      ['', ' { tabs, dirty, openFile }'],
    ],
  },
  {
    side: side('   review.json', ['d', '◆']),
    num: ' 49',
    code: [['', '}']],
  },
]

function Spans({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map(([cls, text], i) => (
        <span key={i} className={cls || undefined}>
          {text}
        </span>
      ))}
    </>
  )
}

function Row({ row }: { row: MockRow }) {
  const gutter = row.git === 'add' ? 'g-add' : row.git === 'mod' ? 'g-mod' : 'gh'
  return (
    <div className={row.cursor ? 'cursor-line' : undefined}>
      <span className="side d">
        <Spans spans={row.side} />
        {' '.repeat(Math.max(0, SB - width(row.side)))}
      </span>
      <span className="side gh">│</span>
      <span className="n">{row.num ?? '   '}</span>
      <span className={gutter}>{row.git ? '▎' : ' '}</span>
      <span className="d">{`${row.fold ?? ' '} `}</span>
      <Spans spans={row.code} />
      {row.caret ? <span className="caret" /> : null}
    </div>
  )
}

function EditorMock() {
  return (
    <div className="editor" aria-label="druk editing its own source">
      <pre>
        <div className="tabs">
          <span className="wide">{'  ← →  ‹7  '}</span>
          <span className="tab-active">{' ● workspace.ts × '}</span>
          {'  '}
          <span className="w">{'▲ editor.ts'}</span>
          <span className="wide">{'    git.ts    panes.ts'}</span>
        </div>
        <div>
          {ROWS.map((row, i) => (
            <Row key={i} row={row} />
          ))}
        </div>
        <div className="status">
          <span>
            {' ⎇ main ↑1  ~3   '}
            <span className="e">● 1</span>
            {'  '}
            <span className="w">▲ 2</span>
            {'   '}
            <span className="wide d">{'F1 commands  Ctrl+K keys  Space preview  Ctrl+P open'}</span>
          </span>
          <span className="d">
            {'Ln 46, Col 41  '}
            <span className="c">typescript</span>
            {'  '}
          </span>
        </div>
      </pre>
    </div>
  )
}

function Feat({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="feat">
      <span className="feat-name">{name}</span> — {children}
    </div>
  )
}

function Home() {
  return (
    <main className="term">
      <div className="session">
        <h1 className="comment">
          # <span className="title">druk</span> — a code editor that lives in your terminal.
        </h1>
        <p className="comment"># one self-contained binary. no Node, no Electron, no window.</p>
        <p className="prompt" style={{ marginTop: '1.5rem' }}>
          <span className="ps1">~</span>/<span className="cwd">code</span>{' '}
          <span className="ps1">$</span> druk .
        </p>
      </div>

      <EditorMock />

      <section className="section">
        <p className="prompt">
          <span className="ps1">$</span> <span className="comment"># what's inside</span>
        </p>
        <div className="out">
          <Feat name="tree-sitter syntax">
            eight languages built in, thirty more one install away
          </Feat>
          <Feat name="language servers">
            your own — diagnostics, completion, go to definition, auto-import
          </Feat>
          <Feat name="git">
            stage, commit, sync, stash; diffs inline or side-by-side; merge conflicts resolved right
            in the buffer
          </Feat>
          <Feat name="review notes">
            left on lines, shared with an agent through review.json, replies read as threads
          </Feat>
          <Feat name="search">
            project-wide find and replace; a fuzzy picker that reads file.ts:42 straight from a
            stack trace
          </Feat>
          <Feat name="views">
            markdown rendered in place — mermaid diagrams included — images, PDFs
          </Feat>
          <Feat name="folding">from indentation, so it works even where no grammar does</Feat>
          <Feat name="vim mode">
            plus custom keybindings and themes that follow the OS appearance
          </Feat>
          <Feat name="extensions">JSON manifests, not code — installing one runs nothing</Feat>
        </div>
      </section>

      <section className="section">
        <p className="prompt">
          <span className="ps1">$</span>{' '}
          <span className="comment"># install — click a line to copy it</span>
        </p>
        <div className="out">
          <Cmd text="curl -fsSL https://druk.letstri.dev/install | bash" />
          <Cmd text="brew install letstri/tap/druk" />
          <Cmd text="npm install -g druk" />
          <Cmd text="bunx druk" note="try it without installing anything" />
          <Cmd text="druk update" note="upgrades this copy, however it was installed" />
        </div>
      </section>

      <section className="section">
        <p className="prompt">
          <span className="ps1">$</span> open <a href={GITHUB}>github.com/letstri/druk</a>{' '}
          <span className="comment"># source, issues, extension market</span>
          <span className="caret" style={{ marginLeft: '0.5rem' }} />
        </p>
      </section>
    </main>
  )
}
