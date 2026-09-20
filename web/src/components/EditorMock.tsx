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

const width = (spans: Span[]) => spans.reduce((n, [, t]) => n + [...t].length, 0)

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
