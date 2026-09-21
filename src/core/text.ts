export const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? '' : 's'}`

/** `2 themes, 1 language`, or `nothing` when every count is zero. */
export const countList = (
  counts: readonly (readonly [number, string])[]
): string =>
  counts
    .filter(([count]) => count > 0)
    .map(([count, noun]) => plural(count, noun))
    .join(', ') || 'nothing'
