import { createEffect, createSignal, on, onCleanup } from 'solid-js'

import { symbolChain } from '../lsp/symbols'

// An edit moves every symbol below it, so the request waits for the typing to stop.
const SETTLE_MS = 400

export function createBreadcrumbs(deps: {
  symbols: (path: string, query: string | null) => Promise<unknown>
  path: () => string | null
  content: () => string
  line: () => number
  enabled: () => boolean
}) {
  const [result, setResult] = createSignal<unknown>(null)
  let token = 0

  createEffect(
    on([deps.path, deps.content, deps.enabled], ([path]) => {
      token += 1
      const mine = token
      setResult(null)
      if (!(path && deps.enabled())) {
        return
      }
      const timer = setTimeout(() => {
        void (async () => {
          const found = await deps.symbols(path, null)
          if (mine === token) {
            setResult(found)
          }
        })()
      }, SETTLE_MS)
      onCleanup(() => clearTimeout(timer))
    })
  )

  return () => (deps.enabled() ? symbolChain(result(), deps.line()) : [])
}
