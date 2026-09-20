export type ServerInstall =
  | { kind: 'npm'; packages: string[] }
  | { kind: 'manual'; command: string }
  | { kind: 'download'; url: string }

export type FetchableInstall = Exclude<ServerInstall, { kind: 'manual' }>

export interface ServerSpec {
  id: string
  command: string[]
  filetypes: string[]
  install?: ServerInstall
  // The server's own settings shape, not druk's.
  settings?: unknown
}

let fromExtensions: ServerSpec[] = []

export function registerServer(spec: ServerSpec): void {
  fromExtensions = [...fromExtensions.filter(server => server.id !== spec.id), spec]
}

export function clearExtensionServers(): void {
  fromExtensions = []
}

// In load order; a later extension claiming an id replaces the earlier spec.
export function servers(): ServerSpec[] {
  return fromExtensions
}

export function installHint(install: ServerInstall): string {
  if (install.kind === 'npm') return `npm i -g ${install.packages.join(' ')}`
  if (install.kind === 'download') return `Download it from ${install.url}`
  return install.command
}

// `install` is dropped for an overridden command — it describes the default's package.
export interface ResolvedServer {
  id: string
  command: string[]
  install?: ServerInstall
  settings?: unknown
}

const resolveOne = (
  spec: ServerSpec,
  overrides: Record<string, string[]>,
): ResolvedServer | null => {
  const override = overrides[spec.id]
  const command = override ?? spec.command
  if (command.length === 0) return null
  return {
    id: spec.id,
    command,
    install: override ? undefined : spec.install,
    settings: spec.settings,
  }
}

export function resolveServers(
  filetype: string | undefined,
  overrides: Record<string, string[]>,
): ResolvedServer[] {
  if (!filetype) return []
  return servers()
    .filter(server => server.filetypes.includes(filetype))
    .map(spec => resolveOne(spec, overrides))
    .filter(resolved => resolved !== null)
}

export function resolveServer(
  filetype: string | undefined,
  overrides: Record<string, string[]>,
): ResolvedServer | null {
  return resolveServers(filetype, overrides)[0] ?? null
}
