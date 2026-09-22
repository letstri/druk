import { plainMarkup } from './completion'
import type { MarkupContent } from './protocol'

// MarkedString: a bare string, or code in a named language. Deprecated by the spec, still sent.
type MarkedString = string | { language: string; value: string }

function textOf(part: unknown): string {
  if (typeof part === 'string') {
    return plainMarkup(part)
  }
  if (part && typeof part === 'object' && 'value' in part) {
    const content = part as MarkupContent | { language: string; value: string }
    return plainMarkup('kind' in content ? content : content.value)
  }
  return ''
}

// One string out of the protocol's three shapes: MarkupContent, a MarkedString, or a list of them.
export function hoverText(result: unknown): string {
  const contents = (result as { contents?: unknown } | null)?.contents
  if (contents === undefined || contents === null) {
    return ''
  }
  const parts: MarkedString[] = Array.isArray(contents)
    ? (contents as MarkedString[])
    : [contents as MarkedString]
  return parts
    .map((part) => textOf(part))
    .filter((text) => text.length > 0)
    .join('\n\n')
}

// TypeScript's deprecation diagnostic is `'x' is deprecated.` and nothing more: the reason
// lives in the JSDoc tag, which only hover carries.
export function deprecationNote(text: string): string {
  const lines = text.split('\n')
  const at = lines.findIndex((line) => /^@?deprecated\b/iu.test(line.trim()))
  if (at === -1) {
    return ''
  }
  const paragraph: string[] = []
  for (const line of lines.slice(at)) {
    if (!line.trim()) {
      break
    }
    paragraph.push(line.trim())
  }
  return paragraph
    .join(' ')
    .replace(/^@?deprecated\b\s*[—–\-:]*\s*/iu, '')
    .trim()
}
