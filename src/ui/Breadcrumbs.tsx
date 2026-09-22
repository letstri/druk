import { relative, sep } from 'node:path'

import { createMemo, Show } from 'solid-js'

import { ui } from '../themes'
import { cut } from './text'

const CRUMB = ' › '
const GAP = '   ·   '

interface BreadcrumbsProps {
  rootDir: string
  path: string
  symbols: string[]
  width: number
}

export function Breadcrumbs(props: BreadcrumbsProps) {
  const symbols = () => props.symbols.join(CRUMB)
  const parts = createMemo(() => {
    const rel = relative(props.rootDir, props.path)
    // The tab already carries the file's name, so the crumbs are its folders alone.
    const file = (rel.startsWith('..') ? props.path : rel)
      .split(sep)
      .slice(0, -1)
      .join(CRUMB)
    const room = Math.max(0, props.width - 2)
    const syms = cut(symbols(), Math.max(0, room - GAP.length - 8))
    return {
      file: cut(
        file,
        syms ? Math.max(8, room - GAP.length - syms.length) : room
      ),
      syms,
    }
  })

  return (
    <box
      height={1}
      flexShrink={0}
      flexDirection="row"
      backgroundColor={ui.bg}
      paddingLeft={1}
    >
      <text fg={ui.dim} bg={ui.bg} wrapMode="none" content={parts().file} />
      <Show when={parts().syms}>
        <text
          fg={ui.faint}
          bg={ui.bg}
          wrapMode="none"
          content={parts().file ? GAP : ''}
        />
        <text fg={ui.dim} bg={ui.bg} wrapMode="none" content={parts().syms} />
      </Show>
    </box>
  )
}
