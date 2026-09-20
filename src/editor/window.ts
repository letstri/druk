// `scrollY` counts visual rows, not logical lines: read as one it lands past a wrapped file's end.
export interface Window {
  from: number
  to: number
}

export function lineAt(lineSources: readonly number[], row: number): number {
  if (lineSources.length === 0) return row
  return lineSources[Math.max(0, Math.min(lineSources.length - 1, row))] ?? row
}

export function logicalWindow(
  scrollY: number,
  height: number,
  lineSources: readonly number[],
  overscan: number,
): Window {
  return {
    from: Math.max(0, lineAt(lineSources, scrollY) - overscan),
    to: lineAt(lineSources, scrollY + height) + overscan,
  }
}
