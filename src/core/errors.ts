export const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)
