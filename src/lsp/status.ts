// In `lsp/` rather than `app/`: `ui/LspStatusView` reads these and `ui/` may not import `app/`.

export type ServerState = 'starting' | 'ready' | 'stopped' | 'failed'

export interface ServerLogLine {
  // HH:MM:SS
  time: string
  kind: 'stderr' | 'server' | 'event'
  text: string
}

export interface ServerView {
  id: string
  command: string[]
  state: ServerState
  error: string | null
  logs: ServerLogLine[]
  docs: string[]
}
