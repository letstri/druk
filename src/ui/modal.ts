export const PAD = 2

export function modalWidth(terminal: number, share: number, min: number, max: number): number {
  const wanted = Math.max(min, Math.min(max, Math.round(terminal * share)))
  return Math.max(20, Math.min(wanted, terminal - 2))
}

export function listRows(terminal: number, chrome: number, max: number): number {
  return Math.max(3, Math.min(max, terminal - chrome))
}
