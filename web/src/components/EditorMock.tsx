// Every string stays a JS literal: the formatter collapses runs of spaces in JSX text.
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

// Sidebar width in columns; every sidebar row is padded to it or the gutter drifts.
const SB = 24

const width = (spans: Span[]) =>
  spans.reduce((n, [, t]) => n + [...t].length, 0)

function side(text: string, mark?: Span): Span[] {
  if (!mark) {
    return [['', text.padEnd(SB)]]
  }
  return [['', text.padEnd(SB - 2)], mark, ['', ' ']]
}

const ROWS: MockRow[] = [
  {
    code: [['d', ' src/app/workspace.ts']],
    side: [
      ['sb-active', ' Files '],
      ['d', ' Git  Review  Ext'],
    ],
  },
  {
    code: [
      ['k', 'export function '],
      ['f', 'createWorkspace'],
      ['', '(deps: '],
      ['t', 'Deps'],
      ['', ') {'],
    ],
    fold: '▾',
    num: ' 14',
    side: [
      ['', ' druk        '],
      ['d', '▴ explorer '],
    ],
  },
  {
    code: [
      ['k', '  const'],
      ['', ' [tabs, setTabs] = '],
      ['f', 'createSignal'],
      ['', '<'],
      ['t', 'Tab'],
      ['', '[]>([])'],
    ],
    num: ' 15',
    side: side(' ▾ src'),
  },
  {
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
    num: ' 16',
    side: side('   ▾ app'),
  },
  { code: [], num: ' 17', side: side('     commands.ts') },
  {
    code: [
      ['k', '  function'],
      ['f', ' openFile'],
      ['', '(path: '],
      ['t', 'string'],
      ['', ') { '],
      ['d', '⋯ 24 lines'],
      ['wide d', '  Ctrl+Opt+E'],
    ],
    fold: '▸',
    git: 'mod',
    num: ' 18',
    side: side('     git.ts'),
  },
  { code: [], num: ' 43', side: side('     workspace.ts', ['g-mod', 'M']) },
  {
    code: [['d', '  // a fold hands the buffer a different text; the']],
    git: 'add',
    num: ' 44',
    side: side('   ▾ ui'),
  },
  {
    code: [['d', "  // gutter keeps the file's own numbering across the gap"]],
    git: 'add',
    num: ' 45',
    side: side('     EditorPane.tsx', ['g-add', 'U']),
  },
  {
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
    cursor: true,
    git: 'mod',
    num: ' 46',
    side: side('   ▸ core'),
  },
  {
    code: [
      ['f', '  autosave'],
      ['', '(folded)  '],
      ['w', "▲ 'autosave' is deprecated"],
      ['wide w', '  Ctrl+Opt+I'],
    ],
    num: ' 47',
    side: side('   ▸ lsp'),
  },
  {
    code: [
      ['k', '  return'],
      ['', ' { tabs, dirty, openFile }'],
    ],
    num: ' 48',
    side: side(' ▸ extensions'),
  },
  {
    code: [['', '}']],
    num: ' 49',
    side: side('   review.json', ['d', '◆']),
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
  const gutter =
    row.git === 'add' ? 'g-add' : row.git === 'mod' ? 'g-mod' : 'gh'
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

export function EditorMock() {
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
            <span className="wide d">
              {'F1 commands  Ctrl+K keys  Space preview  Ctrl+P open'}
            </span>
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
