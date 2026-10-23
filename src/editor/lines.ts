// Rows are 0-based and ranges inclusive, matching the editor's logical cursor.

import { commentTokens } from '../languages'
import type { CommentStyle } from '../languages'
import { outdentWidth } from './typing'

const indentOf = (line: string) => line.length - line.trimStart().length

const isBlockCommented = (
  line: string,
  open: string,
  close: string
): boolean => {
  const trimmed = line.trim()
  return (
    trimmed.length >= open.length + close.length &&
    trimmed.startsWith(open) &&
    trimmed.indexOf(close, open.length) === trimmed.length - close.length
  )
}

// A delimiter inside the text would end the wrapper early, so it carries a backslash
// after its first character(s), and the wrapper's opening is marked with one more.
// Existing backslashes are escaped too so literal escapes survive the next toggle.
interface Escaper {
  escaping: RegExp
  unescaping: RegExp
}

const C_ESCAPER: Escaper = {
  escaping: /\/\\*(?=\*)|\*\\*(?=\/)/gu,
  unescaping: /\/\\+(?=\*)|\*\\+(?=\/)/gu,
}

// `-->` ends an HTML comment, and so does `--!>`, which the parser takes as a
// mistake it forgives; `<!--` inside one is harmless, so only the closers need it.
const HTML_ESCAPER: Escaper = {
  escaping: /--\\*(?=!?>)/gu,
  unescaping: /--\\+(?=!?>)/gu,
}

const escaperFor = (open: string, close: string): Escaper | undefined => {
  if (open.endsWith('/*') && close.startsWith('*/')) {
    return C_ESCAPER
  }
  if (open.endsWith('<!--') && close === '-->') {
    return HTML_ESCAPER
  }
  return undefined
}

const escapeBlockDelimiters = (
  text: string,
  escaping: boolean,
  escaper: Escaper
): string =>
  text.replace(escaping ? escaper.escaping : escaper.unescaping, (delimiter) =>
    escaping ? `${delimiter}\\` : delimiter.slice(0, -1)
  )

export function toggleComment(
  text: string,
  from: number,
  to: number,
  style: CommentStyle
): string {
  const lines = text.split('\n')
  const picked = () => lines.slice(from, to + 1)
  const active = picked().filter((line) => line.trim().length > 0)
  if (active.length === 0) {
    return text
  }

  if (typeof style !== 'string') {
    const [open, close] = style
    const escaper = escaperFor(open, close)
    const commented = active.every((line) =>
      isBlockCommented(line, open, close)
    )
    if (commented) {
      for (let row = from; row <= to; row += 1) {
        const line = lines[row]!
        if (!isBlockCommented(line, open, close)) {
          continue
        }
        const at = indentOf(line)
        const end = line.trimEnd().length
        let inner = line.slice(at + open.length, end - close.length)
        // Only marked wrappers use our escapes; hand-written comments keep theirs.
        const escaped = escaper !== undefined && inner.startsWith('\\ ')
        if (escaped) {
          inner = inner.slice(1)
        }
        if (inner.startsWith(' ')) {
          inner = inner.slice(1)
        }
        if (inner.endsWith(' ')) {
          inner = inner.slice(0, -1)
        }
        if (escaped) {
          inner = escapeBlockDelimiters(inner, false, escaper)
        }
        lines[row] = `${line.slice(0, at)}${inner}${line.slice(end)}`
      }
    } else {
      const indent = Math.min(...active.map(indentOf))
      for (let row = from; row <= to; row += 1) {
        const line = lines[row]!
        if (line.trim().length === 0) {
          continue
        }
        const end = line.trimEnd().length
        const inner = line.slice(indent, end)
        const escaped = escaper
          ? escapeBlockDelimiters(inner, true, escaper)
          : inner
        const marker = escaped === inner ? '' : '\\'
        lines[row] =
          `${line.slice(0, indent)}${open}${marker} ${escaped} ${close}${line.slice(end)}`
      }
    }
    return lines.join('\n')
  }

  const prefix = style
  const commented = active.every((line) => line.trimStart().startsWith(prefix))
  if (commented) {
    for (let row = from; row <= to; row += 1) {
      const line = lines[row]!
      const at = indentOf(line)
      if (!line.slice(at).startsWith(prefix)) {
        continue
      }
      const after = line.slice(at + prefix.length)
      lines[row] =
        line.slice(0, at) + (after.startsWith(' ') ? after.slice(1) : after)
    }
  } else {
    const indent = Math.min(...active.map(indentOf))
    for (let row = from; row <= to; row += 1) {
      if (lines[row]!.trim().length === 0) {
        continue
      }
      lines[row] =
        `${lines[row]!.slice(0, indent)}${prefix} ${lines[row]!.slice(indent)}`
    }
  }
  return lines.join('\n')
}

const JSX_FILETYPES = new Set(['typescriptreact', 'javascriptreact', 'tsrx'])

const JSX_COMMENT: readonly [string, string] = ['{/*', '*/}']
const HTML_COMMENT: readonly [string, string] = ['<!--', '-->']
const CSS_COMMENT: readonly [string, string] = ['/*', '*/']

const JSX_PREFIX_KEYWORDS = new Set([
  'return',
  'yield',
  'throw',
  'case',
  'delete',
  'void',
  'typeof',
  'await',
  'in',
  'of',
  'else',
  'do',
])

const existingComment = (
  active: string[],
  styles: CommentStyle[]
): CommentStyle | undefined =>
  styles.find((style) =>
    typeof style === 'string'
      ? active.every((line) => line.trimStart().startsWith(style))
      : active.every((line) => isBlockCommented(line, style[0], style[1]))
  )

const canStartJsxOrRegex = (line: string, index: number): boolean => {
  const before = line.slice(0, index).trimEnd()
  if (before.length === 0 || before.endsWith('=>')) {
    return true
  }
  const last = before.at(-1)!
  if (last === ')' || last === ']' || last === '<' || last === '>') {
    return false
  }
  if (/[\w$]/u.test(last)) {
    const word = /[\w$]+$/u.exec(before)?.[0] ?? ''
    return JSX_PREFIX_KEYWORDS.has(word)
  }
  return true
}

const skipRegex = (line: string, start: number): number => {
  let inClass = false
  for (let i = start + 1; i < line.length; i += 1) {
    const ch = line[i]!
    if (ch === '\\') {
      i += 1
      continue
    }
    if (ch === '[') {
      inClass = true
    } else if (ch === ']') {
      inClass = false
    } else if (ch === '/' && !inClass) {
      let end = i + 1
      while (end < line.length && /[a-z]/iu.test(line[end]!)) {
        end += 1
      }
      return end
    }
  }
  return start + 1
}

const matchJsxOpenTag = (
  line: string,
  start: number,
  inJs: boolean
): number => {
  const match = /^<([A-Za-z_$][\w$.:-]*)/u.exec(line.slice(start))
  if (!match) {
    return 0
  }
  const tagName = match[1]!
  if (inJs && tagName === 'const') {
    return 0
  }
  let end = start + match[0].length
  if (line[end] === '<') {
    let depth = 0
    let cursor = end
    while (cursor < line.length) {
      if (line[cursor] === '<') {
        depth += 1
      } else if (line[cursor] === '>') {
        depth -= 1
        if (depth === 0) {
          end = cursor + 1
          break
        }
      }
      cursor += 1
    }
    if (depth !== 0) {
      return 0
    }
  }
  const rest = line.slice(end)
  if (rest.startsWith('/>')) {
    return end - start
  }
  if (rest.startsWith('>')) {
    if (inJs && /^>\s*\([^)]*\)\s*(?::|=>)/u.test(rest)) {
      return 0
    }
    return end - start
  }
  if (rest.length === 0) {
    return end - start
  }
  if (rest[0] === ' ' || rest[0] === '\t') {
    const afterSpace = rest.trimStart()
    if (
      inJs &&
      (afterSpace.startsWith('=') ||
        /^extends(?![\w$-]|\s*=)/u.test(afterSpace))
    ) {
      return 0
    }
    return end - start
  }
  return 0
}

type JsxFrame =
  | { kind: 'js' }
  | { kind: 'jsx-tag' }
  | { kind: 'jsx-child' }
  | { kind: 'str'; quote: "'" | '"' | '`' }
  | { kind: 'comment' }

function jsxCommentStyle(
  lines: string[],
  firstActive: number,
  lastActive: number,
  startRow = 0
): CommentStyle {
  const stack: JsxFrame[] = [{ kind: 'js' }]
  let startKind: JsxFrame['kind'] = 'js'
  let minDepth = 0
  let minKind: JsxFrame['kind'] = 'js'
  let validLineBreaks = true

  const recordDepth = () => {
    const depth = stack.length - 1
    if (depth < minDepth) {
      minDepth = depth
      minKind = stack[depth]!.kind
    }
  }

  for (let row = startRow; row <= lastActive; row += 1) {
    const line = lines[row] ?? ''
    if (row === firstActive) {
      startKind = stack.at(-1)!.kind
      minDepth = stack.length - 1
      minKind = startKind
    }

    let i = 0
    while (i < line.length) {
      const top = stack.at(-1)!
      const ch = line[i]!

      if (top.kind === 'comment') {
        if (line.startsWith('*/', i)) {
          stack.pop()
          if (row >= firstActive) {
            recordDepth()
          }
          i += 2
        } else {
          i += 1
        }
        continue
      }

      if (top.kind === 'str') {
        if (ch === '\\') {
          i += 2
        } else if (top.quote === '`' && line.startsWith('${', i)) {
          stack.push({ kind: 'js' })
          i += 2
        } else if (ch === top.quote) {
          stack.pop()
          if (row >= firstActive) {
            recordDepth()
          }
          i += 1
        } else {
          i += 1
        }
        continue
      }

      if (top.kind === 'js' || top.kind === 'jsx-tag') {
        if (line.startsWith('//', i)) {
          break
        }
        if (line.startsWith('/*', i)) {
          stack.push({ kind: 'comment' })
          i += 2
          continue
        }
        if (ch === "'" || ch === '"' || ch === '`') {
          stack.push({ kind: 'str', quote: ch })
          i += 1
          continue
        }
        if (top.kind === 'js' && ch === '/' && canStartJsxOrRegex(line, i)) {
          i = skipRegex(line, i)
          continue
        }
        if (ch === '{') {
          stack.push({ kind: 'js' })
          i += 1
          continue
        }
        if (ch === '}') {
          if (stack.length > 1 && top.kind === 'js') {
            stack.pop()
            if (row >= firstActive) {
              recordDepth()
            }
          }
          i += 1
          continue
        }
        if (top.kind === 'jsx-tag') {
          if (line.startsWith('/>', i)) {
            stack.pop()
            if (row >= firstActive) {
              recordDepth()
            }
            i += 2
          } else if (ch === '>') {
            stack[stack.length - 1] = { kind: 'jsx-child' }
            i += 1
          } else {
            i += 1
          }
          continue
        }
        if (line.startsWith('<>', i) && canStartJsxOrRegex(line, i)) {
          stack.push({ kind: 'jsx-child' })
          i += 2
          continue
        }
        if (ch === '<' && canStartJsxOrRegex(line, i)) {
          const tagLen = matchJsxOpenTag(line, i, true)
          if (tagLen > 0) {
            stack.push({ kind: 'jsx-tag' })
            i += tagLen
            continue
          }
        }
        i += 1
        continue
      }

      // `jsx-child`: text between `<Tag>` and `</Tag>` (or `<>` and `</>`).
      if (ch === '{') {
        stack.push({ kind: 'js' })
        i += 1
      } else if (line.startsWith('</', i)) {
        const closeAt = line.indexOf('>', i + 2)
        if (stack.length > 1) {
          stack.pop()
          if (row >= firstActive) {
            recordDepth()
          }
        }
        i = closeAt === -1 ? line.length : closeAt + 1
      } else if (line.startsWith('<>', i)) {
        stack.push({ kind: 'jsx-child' })
        i += 2
      } else if (ch === '<') {
        const tagLen = matchJsxOpenTag(line, i, false)
        if (tagLen > 0) {
          stack.push({ kind: 'jsx-tag' })
          i += tagLen
        } else {
          i += 1
        }
      } else {
        i += 1
      }
    }

    if (row >= firstActive && row < lastActive) {
      const topKind = stack.at(-1)!.kind
      if (topKind !== 'jsx-child' && topKind !== 'jsx-tag') {
        validLineBreaks = false
      }
    }
  }

  const endKind = stack.at(-1)!.kind
  // `{/* */}` around a tag the range only half-covers breaks the parse; `//` never does.
  return startKind === 'jsx-child' &&
    endKind === 'jsx-child' &&
    minKind === 'jsx-child' &&
    validLineBreaks
    ? JSX_COMMENT
    : '//'
}

const tagAttr = (attrs: string, name: string): string | undefined =>
  new RegExp(`\\b${name}\\s*=\\s*["']?([\\w+/.-]+)["']?`, 'iu')
    .exec(attrs)?.[1]
    ?.toLowerCase()

// A <script> is JavaScript unless lang/type says otherwise; a type outside the
// JS set — application/json, importmap, a template — is data, not code.
const SCRIPT_TYPES_JS = new Set([
  'module',
  'text/javascript',
  'application/javascript',
  'text/ecmascript',
  'application/ecmascript',
  'text/jscript',
])
const SCRIPT_TAGS_JSX = new Set(['jsx', 'tsx', 'babel'])
const SCRIPT_TYPES_JSX = new Set(['text/babel', 'text/jsx', 'text/tsx'])
const SCRIPT_LANGS_JS = new Set([
  'js',
  'ts',
  'mjs',
  'cjs',
  'javascript',
  'typescript',
])
const STYLE_LANGS_LINE = new Set(['scss', 'sass', 'less', 'stylus'])

type RegionMode =
  | 'markup'
  | 'script'
  | 'jsx'
  | 'style'
  | 'lineStyle'
  | 'data'
  | 'liquid'

const scriptMode = (attrs: string): RegionMode => {
  const lang = tagAttr(attrs, 'lang')
  if (lang) {
    if (SCRIPT_TAGS_JSX.has(lang)) {
      return 'jsx'
    }
    return SCRIPT_LANGS_JS.has(lang) ? 'script' : 'data'
  }
  const type = tagAttr(attrs, 'type')
  if (!type || SCRIPT_TYPES_JS.has(type)) {
    return 'script'
  }
  return SCRIPT_TYPES_JSX.has(type) ? 'jsx' : 'data'
}

const styleMode = (attrs: string): RegionMode =>
  STYLE_LANGS_LINE.has(tagAttr(attrs, 'lang') ?? '') ? 'lineStyle' : 'style'

const SCRIPT_CLOSE = /<\/script\s*>/iu
const STYLE_CLOSE = /<\/style\s*>/iu

// A markup-side region the html tags do not cover — liquid's {% … %} blocks.
interface ExtraRegion {
  close: RegExp
  mode: RegionMode
  open: RegExp
}

interface RegionScan {
  // Rows carrying a boundary: the `>` completing an open tag, a close tag, an {% %} tag.
  boundaryRows: Set<number>
  // The region each row starts in.
  modeAtStart: RegionMode[]
  // The first row of the region each row starts in.
  regionStart: number[]
}

function scanMarkupRegions(
  lines: string[],
  lastRow: number,
  extraRegions: ExtraRegion[] = []
): RegionScan {
  const modeAtStart: RegionMode[] = []
  const boundaryRows = new Set<number>()

  let mode: RegionMode = 'markup'
  let regionClose: RegExp | null = null
  let inComment = false
  let pendingTag: {
    tag: string
    attrs: string
    quote: "'" | '"' | null
  } | null = null

  const finishTag = (tag: string, attrs: string, row: number) => {
    if (
      (tag !== 'script' && tag !== 'style') ||
      attrs.trimEnd().endsWith('/')
    ) {
      return
    }
    boundaryRows.add(row)
    mode = tag === 'script' ? scriptMode(attrs) : styleMode(attrs)
    regionClose = tag === 'script' ? SCRIPT_CLOSE : STYLE_CLOSE
  }

  for (let row = 0; row <= lastRow; row += 1) {
    const line = lines[row] ?? ''
    modeAtStart[row] = mode

    let i = 0
    while (i < line.length) {
      if (regionClose) {
        const close = regionClose.exec(line.slice(i))
        if (!close) {
          break
        }
        boundaryRows.add(row)
        mode = 'markup'
        regionClose = null
        i += close.index + close[0].length
        continue
      }
      if (inComment) {
        const end = line.indexOf('-->', i)
        if (end === -1) {
          break
        }
        inComment = false
        i = end + 3
        continue
      }
      if (pendingTag) {
        const ch = line[i]!
        if (pendingTag.quote) {
          if (ch === pendingTag.quote) {
            pendingTag.quote = null
          }
        } else if (ch === "'" || ch === '"') {
          pendingTag.quote = ch
        } else if (ch === '>') {
          const { tag, attrs } = pendingTag
          pendingTag = null
          finishTag(tag, attrs, row)
          i += 1
          continue
        }
        pendingTag.attrs += ch
        i += 1
        continue
      }

      const commentAt = line.indexOf('<!--', i)
      const tagMatch = /<(\/?[A-Za-z][\w:.-]*)(?=[\s/>]|$)/u.exec(line.slice(i))
      const tagAt = tagMatch ? i + tagMatch.index : -1
      let extra: ExtraRegion | null = null
      let extraMatch: RegExpExecArray | null = null
      let extraAt = -1
      for (const region of extraRegions) {
        const match = region.open.exec(line.slice(i))
        if (match && (extraAt === -1 || i + match.index < extraAt)) {
          extra = region
          extraMatch = match
          extraAt = i + match.index
        }
      }
      const candidates = [commentAt, tagAt, extraAt].filter((n) => n !== -1)
      if (candidates.length === 0) {
        break
      }
      const at = Math.min(...candidates)

      if (at === commentAt) {
        const end = line.indexOf('-->', at + 4)
        if (end === -1) {
          inComment = true
          break
        }
        i = end + 3
        continue
      }
      if (at === extraAt) {
        const { close, mode: next } = extra!
        boundaryRows.add(row)
        mode = next
        regionClose = close
        i = at + extraMatch![0].length
        continue
      }
      pendingTag = { attrs: '', quote: null, tag: tagMatch![1]!.toLowerCase() }
      i = at + tagMatch![0].length
    }
    if (pendingTag) {
      pendingTag.attrs += '\n'
    }
  }

  const regionStart: number[] = []
  let start = 0
  for (let row = 0; row <= lastRow; row += 1) {
    regionStart[row] = start
    if (boundaryRows.has(row)) {
      start = row + 1
    }
  }

  return { boundaryRows, modeAtStart, regionStart }
}

const crossedBoundary = (
  boundaryRows: Set<number>,
  from: number,
  to: number
): boolean => {
  for (const row of boundaryRows) {
    if (row >= from && row <= to) {
      return true
    }
  }
  return false
}

function htmlRegionCommentStyle(
  lines: string[],
  firstActive: number,
  lastActive: number
): CommentStyle {
  const { modeAtStart, boundaryRows, regionStart } = scanMarkupRegions(
    lines,
    lastActive
  )
  const startMode = modeAtStart[firstActive] ?? 'markup'
  if (crossedBoundary(boundaryRows, firstActive, lastActive)) {
    return HTML_COMMENT
  }
  if (startMode === 'script' || startMode === 'lineStyle') {
    return '//'
  }
  if (startMode === 'jsx') {
    return jsxCommentStyle(
      lines,
      firstActive,
      lastActive,
      regionStart[firstActive]!
    )
  }
  if (startMode === 'style') {
    return CSS_COMMENT
  }
  return HTML_COMMENT
}

function phpCommentStyle(
  lines: string[],
  firstActive: number,
  lastActive: number,
  active: string[]
): CommentStyle {
  let inPhp = false
  let inBlockComment = false
  let quote: "'" | '"' | null = null
  let startInPhp = false
  let stayedInPhp = true

  for (let row = 0; row <= lastActive; row += 1) {
    const line = lines[row] ?? ''
    if (row === firstActive) {
      startInPhp = inPhp
    }

    let i = 0
    while (i < line.length) {
      if (!inPhp) {
        const open = /<\?(?:php\b|=|(?![A-Za-z]))/iu.exec(line.slice(i))
        if (!open) {
          break
        }
        if (row >= firstActive) {
          stayedInPhp = false
        }
        inPhp = true
        i += open.index + open[0].length
        continue
      }

      if (inBlockComment) {
        const close = line.indexOf('*/', i)
        if (close === -1) {
          break
        }
        inBlockComment = false
        i = close + 2
        continue
      }

      if (quote) {
        if (line[i] === '\\') {
          i += 2
        } else if (line[i] === quote) {
          quote = null
          i += 1
        } else {
          i += 1
        }
        continue
      }

      if (line.startsWith('?>', i)) {
        inPhp = false
        if (row >= firstActive) {
          stayedInPhp = false
        }
        i += 2
        continue
      }
      if (
        line.startsWith('//', i) ||
        (line[i] === '#' && line[i + 1] !== '[')
      ) {
        const close = line.indexOf('?>', i)
        if (close === -1) {
          break
        }
        i = close
        continue
      }
      if (line.startsWith('/*', i)) {
        inBlockComment = true
        i += 2
        continue
      }
      const ch = line[i]!
      if (ch === "'" || ch === '"') {
        quote = ch
      }
      i += 1
    }
  }

  if (startInPhp) {
    // `?>` inside `/* */` stays commented; inside `//` it still ends PHP, and `<!-- -->` is not PHP at all.
    // `#[` starts a PHP 8 attribute, not a `#` comment.
    const hashComments = active.every(
      (line) => !line.trimStart().startsWith('#[')
    )
    return (
      existingComment(
        active,
        hashComments ? ['//', '#', CSS_COMMENT] : ['//', CSS_COMMENT]
      ) ?? (stayedInPhp ? '//' : CSS_COMMENT)
    )
  }
  const style = htmlRegionCommentStyle(lines, firstActive, lastActive)
  return (
    existingComment(active, style === '//' ? ['//', CSS_COMMENT] : [style]) ??
    style
  )
}

const LIQUID_REGIONS: ExtraRegion[] = [
  { close: /-?%\}/u, mode: 'liquid', open: /\{%-?\s*liquid\b/u },
  {
    close: /\{%-?\s*endjavascript\s*-?%\}/u,
    mode: 'script',
    open: /\{%-?\s*javascript\s*-?%\}/u,
  },
  {
    close: /\{%-?\s*end(?:stylesheet|style)\s*-?%\}/u,
    mode: 'style',
    open: /\{%-?\s*(?:stylesheet|style)\s*-?%\}/u,
  },
  {
    close: /\{%-?\s*endschema\s*-?%\}/u,
    mode: 'data',
    open: /\{%-?\s*schema\s*-?%\}/u,
  },
]

function liquidCommentStyle(
  lines: string[],
  firstActive: number,
  lastActive: number,
  active: string[]
): CommentStyle {
  const { modeAtStart, boundaryRows, regionStart } = scanMarkupRegions(
    lines,
    lastActive,
    LIQUID_REGIONS
  )
  const startMode = modeAtStart[firstActive] ?? 'markup'
  const stayedInRegion = !crossedBoundary(boundaryRows, firstActive, lastActive)

  if (stayedInRegion && startMode === 'liquid') {
    return '#'
  }
  const existing = existingComment(active, [
    HTML_COMMENT,
    '//',
    CSS_COMMENT,
    ['{% comment %}', '{% endcomment %}'],
    ['{% #', '%}'],
  ])
  if (existing) {
    return existing
  }
  if (stayedInRegion && startMode === 'script') {
    return '//'
  }
  if (stayedInRegion && startMode === 'jsx') {
    return jsxCommentStyle(
      lines,
      firstActive,
      lastActive,
      regionStart[firstActive]!
    )
  }
  if (stayedInRegion && startMode === 'lineStyle') {
    return '//'
  }
  if (stayedInRegion && startMode === 'style') {
    return CSS_COMMENT
  }
  return HTML_COMMENT
}

export function commentFor(
  text: string,
  from: number,
  to: number,
  filetype: string | undefined
): CommentStyle | undefined {
  if (!filetype) {
    return undefined
  }
  const fallback = commentTokens(filetype)
  const lines = text.split('\n')
  const start = Math.max(0, from)
  const end = Math.min(lines.length - 1, to)
  let firstActive = -1
  let lastActive = -1
  const active: string[] = []
  for (let row = start; row <= end; row += 1) {
    const line = lines[row]
    if (line !== undefined && line.trim().length > 0) {
      if (firstActive === -1) {
        firstActive = row
      }
      lastActive = row
      active.push(line)
    }
  }
  if (active.length === 0) {
    return fallback
  }

  if (JSX_FILETYPES.has(filetype)) {
    return (
      existingComment(active, [JSX_COMMENT, '//', CSS_COMMENT]) ??
      jsxCommentStyle(lines, firstActive, lastActive)
    )
  }
  if (filetype === 'vue' || filetype === 'svelte' || filetype === 'html') {
    return (
      existingComment(active, [HTML_COMMENT, '//', CSS_COMMENT, JSX_COMMENT]) ??
      htmlRegionCommentStyle(lines, firstActive, lastActive)
    )
  }
  if (filetype === 'php') {
    return phpCommentStyle(lines, firstActive, lastActive, active)
  }
  if (filetype === 'liquid') {
    return liquidCommentStyle(lines, firstActive, lastActive, active)
  }
  return fallback
}

export function moveLines(
  text: string,
  from: number,
  to: number,
  delta: -1 | 1
): string | null {
  const lines = text.split('\n')
  // The trailing empty string after a final newline is not a movable line.
  const last = lines.at(-1) === '' ? lines.length - 2 : lines.length - 1
  if (from + delta < 0 || to + delta > last) {
    return null
  }
  const block = lines.splice(from, to - from + 1)
  lines.splice(from + delta, 0, ...block)
  return lines.join('\n')
}

export function removeLines(text: string, from: number, to: number): string {
  const lines = text.split('\n')
  // The trailing empty string after a final newline is not a line: deleting it takes the newline.
  const last = lines.at(-1) === '' ? lines.length - 2 : lines.length - 1
  const start = Math.max(0, from)
  const end = Math.min(to, last)
  if (end < start) {
    return text
  }
  lines.splice(start, end - start + 1)
  return lines.join('\n')
}

export function duplicateLines(text: string, from: number, to: number): string {
  const lines = text.split('\n')
  lines.splice(to + 1, 0, ...lines.slice(from, to + 1))
  return lines.join('\n')
}

export function trimTrailing(text: string): string {
  const trimmed = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/u, ''))
    .join('\n')
  return trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`
}

export function indentLines(
  text: string,
  from: number,
  to: number,
  tabSize: number,
  outdent: boolean
): string {
  const lines = text.split('\n')
  for (let row = from; row <= to; row += 1) {
    const line = lines[row]
    if (line === undefined) {
      continue
    }
    if (outdent) {
      lines[row] = line.slice(outdentWidth(line, tabSize))
    } else if (line.trim().length > 0) {
      lines[row] = ' '.repeat(tabSize) + line
    }
  }
  return lines.join('\n')
}
