import { render } from '@opentui/solid'

import { Root } from './app/Root'
import { releaseAssetRoot } from './core/assets'
import type { Target } from './core/cli'
import {
  loadConfig,
  loadProjectConfig,
  readDisabledExtensions,
  resolveConfig,
} from './core/config'
import { divertWarnings } from './core/warnings'
import { loadExtensions } from './extensions'
import { highlightClient } from './languages/highlight'
import { setTheme } from './themes'

export async function main(target: Target): Promise<void> {
  // The staged root existed only for @opentui/core's own import; later lookups use the bundle.
  releaseAssetRoot()

  // Before the renderer takes the screen: from here on stderr is the editor.
  divertWarnings()

  const { rootDir, openFile } = target

  // Before the config: a validator drops a theme whose extension has not registered it yet.
  loadExtensions(rootDir, readDisabledExtensions(rootDir))

  // Before the first render, or it paints in the user's theme and then repaints.
  const config = loadConfig()
  const project = loadProjectConfig(rootDir)
  setTheme(resolveConfig(config, project).theme)

  // Kicked off in parallel: the worker spawn and wasm compile are the first highlight's long pole.
  void highlightClient()

  await render(
    () => (
      <Root
        rootDir={rootDir}
        openFile={openFile}
        openLine={target.line}
        openCol={target.col}
        initialConfig={config}
        initialProject={project}
        reloadConfig={loadConfig}
      />
    ),
    {
      // Without it the terminal never hands drags over, and paints its own selection.
      enableMouseMovement: true,
      // App handles Ctrl+C: OpenTUI's own exit would bypass the unsaved-buffer prompt.
      exitOnCtrlC: false,
      targetFps: 30,
      // events + allKeysAsEscapes make a held Ctrl visible to the peek; reportText carries IME.
      useKittyKeyboard: {
        allKeysAsEscapes: true,
        alternateKeys: true,
        disambiguate: true,
        events: true,
        reportText: true,
      },
      useMouse: true,
    }
  )
}
