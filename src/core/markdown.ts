import { extname } from 'node:path'

const MARKDOWN_EXTS = new Set(['.md', '.markdown', '.mdown', '.mkd'])

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXTS.has(extname(path).toLowerCase())
}
