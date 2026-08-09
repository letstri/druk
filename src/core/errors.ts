/** A thrown value's message: not everything thrown is an Error. */
export const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)
