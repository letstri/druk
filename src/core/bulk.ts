import fs from 'node:fs'
import { basename, dirname, join } from 'node:path'
// A timer, not setImmediate or Bun.sleep(0): both resolve ahead of the renderer's frame.
import { setTimeout as yieldToLoop } from 'node:timers/promises'

export interface BulkProgress {
  done: number
  total: number
}

export interface BulkResult {
  done: number
  failed: string[]
  moved: { from: string; to: string }[]
}

async function unitsOf(path: string): Promise<string[]> {
  try {
    const stat = await fs.promises.stat(path)
    if (!stat.isDirectory()) {
      return [path]
    }
    const names = await fs.promises.readdir(path)
    return names.map((name) => join(path, name))
  } catch {
    return [path]
  }
}

export async function removeAll(
  targets: string[],
  onProgress: (progress: BulkProgress) => void
): Promise<BulkResult> {
  const failed: string[] = []
  let done = 0
  let total = 0

  for (const target of targets) {
    const units = await unitsOf(target)
    // Cumulative: `done` never resets, so a per-target total reads "Deleting 15/4".
    total += units.length
    for (const unit of units) {
      try {
        await fs.promises.rm(unit, { force: true, recursive: true })
      } catch {
        failed.push(basename(unit))
      }
      done += 1
      onProgress({ done, total })
      await yieldToLoop()
    }
    if (units[0] !== target) {
      try {
        await fs.promises.rm(target, { force: true, recursive: true })
      } catch {
        failed.push(basename(target))
      }
    }
  }
  return { done, failed, moved: [] }
}

const copyInto = (from: string, to: string) =>
  fs.promises.cp(from, to, {
    errorOnExist: true,
    force: false,
    recursive: true,
  })

async function transferAll(
  targets: string[],
  dir: string,
  name: (dir: string, base: string) => string,
  onProgress: (progress: BulkProgress) => void,
  transfer: (from: string, to: string) => Promise<void>
): Promise<BulkResult> {
  const failed: string[] = []
  const moved: BulkResult['moved'] = []
  let done = 0

  for (const [index, target] of targets.entries()) {
    const to = name(dir, basename(target))
    try {
      await fs.promises.mkdir(dirname(to), { recursive: true })
      await transfer(target, to)
      moved.push({ from: target, to })
      done += 1
    } catch {
      failed.push(basename(target))
    }
    onProgress({ done, total: targets.length })
    if (index % 4 === 3) {
      await yieldToLoop()
    }
  }
  return { done, failed, moved }
}

export const copyAll = (
  targets: string[],
  dir: string,
  name: (dir: string, base: string) => string,
  onProgress: (progress: BulkProgress) => void
): Promise<BulkResult> => transferAll(targets, dir, name, onProgress, copyInto)

export const moveAll = (
  targets: string[],
  dir: string,
  name: (dir: string, base: string) => string,
  onProgress: (progress: BulkProgress) => void
): Promise<BulkResult> =>
  transferAll(targets, dir, name, onProgress, async (from, to) => {
    try {
      await fs.promises.rename(from, to)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
        throw error
      }
      await copyInto(from, to)
      await fs.promises.rm(from, { force: true, recursive: true })
    }
  })
