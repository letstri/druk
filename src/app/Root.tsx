import { basename } from 'node:path'

import { useRenderer } from '@opentui/solid'
import { createSignal, Show } from 'solid-js'

import { loadProjectConfig, readDisabledExtensions, resolveConfig } from '../core/config'
import type { Config } from '../core/config'
import { loadExtensions } from '../extensions'
import { setTheme } from '../themes'
import { App } from './App'

// Each component reading the terminal or keyboard adds a `resize` and a `keypress` listener (#100).
const LISTENER_CAP = 64

interface Opened {
  rootDir: string
  openFile: string | null
  openLine: number | null
  openCol: number | null
  config: Config
  project: Partial<Config>
  notice: string | null
  first: boolean
}

// Controllers are built from `rootDir` once: the keyed `Show` is what runs their `onCleanup`.
export function Root(props: {
  rootDir: string
  openFile?: string | null
  openLine?: number | null
  openCol?: number | null
  initialConfig: Config
  initialProject?: Partial<Config>
  checkUpdates?: boolean
  reloadConfig?: () => Config
}) {
  const renderer = useRenderer()
  renderer.setMaxListeners(LISTENER_CAP)
  renderer.keyInput.setMaxListeners(LISTENER_CAP)

  const [opened, setOpened] = createSignal<Opened>({
    rootDir: props.rootDir,
    openFile: props.openFile ?? null,
    openLine: props.openLine ?? null,
    openCol: props.openCol ?? null,
    config: props.initialConfig,
    project: props.initialProject ?? loadProjectConfig(props.rootDir),
    notice: null,
    first: true,
  })

  const openWorkspace = (dir: string) => {
    const config = props.reloadConfig?.() ?? opened().config
    loadExtensions(dir, readDisabledExtensions(dir))
    const project = loadProjectConfig(dir)
    setTheme(resolveConfig(config, project).theme)
    setOpened({
      rootDir: dir,
      openFile: null,
      openLine: null,
      openCol: null,
      config,
      project,
      notice: `Opened ${basename(dir)}`,
      first: false,
    })
  }

  return (
    <Show when={opened()} keyed>
      {(at: Opened) => (
        <App
          rootDir={at.rootDir}
          openFile={at.openFile}
          openLine={at.openLine}
          openCol={at.openCol}
          initialConfig={at.config}
          initialProject={at.project}
          checkUpdates={at.first && props.checkUpdates}
          notice={at.notice}
          onOpenWorkspace={openWorkspace}
        />
      )}
    </Show>
  )
}
