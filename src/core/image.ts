import { extname } from 'node:path'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg'])

export function isImagePath(path: string): boolean {
  return IMAGE_EXTS.has(extname(path).toLowerCase())
}
