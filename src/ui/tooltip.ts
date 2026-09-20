import type { KeyEvent } from '@opentui/core'
import { onBlur, useKeyboard } from '@opentui/solid'
import { createSignal, onCleanup } from 'solid-js'

import { chordFor } from './keys'
import type { TooltipAnchor, TooltipObstacle } from './tooltipLayout'

interface TargetBox {
  x: number
  y: number
  width: number
  height: number
}

interface Target {
  id: number
  command: () => string
  box: () => TargetBox | null
}

const targets = new Map<number, Target>()
let nextId = 1

// Renderable boxes are not signals: without this a button mounting mid-peek never appears.
const [version, bump] = createSignal(0)
const [hovered, setHovered] = createSignal<number | null>(null)
const [held, setHeld] = createSignal(false)

const DWELL_MS = 400

const [dwelled, setDwelled] = createSignal<number | null>(null)
let dwell: ReturnType<typeof setTimeout> | null = null

const clearDwell = () => {
  if (dwell) clearTimeout(dwell)
  dwell = null
}

const resting = () => {
  const at = hovered()
  return at !== null && at === dwelled() ? at : null
}

function enter(id: number) {
  if (hovered() === id) return
  clearDwell()
  setHovered(id)
  // A pointer that never really left this button (see `leave`) keeps the chord it earned.
  if (dwelled() === id) return
  setDwelled(null)
  dwell = setTimeout(() => {
    dwell = null
    setDwelled(id)
  }, DWELL_MS)
}

// The next control's `over` can arrive before this one's `out`; which would erase the new state.
function leave(id: number) {
  if (hovered() !== id) return
  clearDwell()
  setHovered(null)
  queueMicrotask(() => {
    if (hovered() === null) setDwelled(null)
  })
}

const [enabled, setEnabled] = createSignal(true)

export { setEnabled as setTooltipsEnabled }

const peeking = () => enabled() && held()

export function useTooltip(command: string | (() => string) | undefined) {
  const id = nextId++
  let box: TargetBox | null = null
  const commandId = typeof command === 'function' ? command : () => command ?? ''
  const chord = () => chordFor(commandId())

  // Registered even with no command: the placement has to know its cells are spoken for.
  targets.set(id, { id, command: commandId, box: () => box })
  bump(at => at + 1)

  onCleanup(() => {
    targets.delete(id)
    leave(id)
    bump(at => at + 1)
  })

  return {
    hovered: () => hovered() === id,
    lit: () => hovered() === id || (peeking() && chord() !== ''),
    enter: () => enter(id),
    leave: () => leave(id),
    ref: (node: TargetBox) => {
      box = node
    },
  }
}

export function tooltipAnchors(): TooltipAnchor[] {
  version()
  if (!enabled()) return []
  const at = resting()
  const peek = peeking()
  const anchors: TooltipAnchor[] = []

  for (const target of targets.values()) {
    if (!peek && target.id !== at) continue
    const chord = chordFor(target.command())
    if (!chord) continue
    const box = target.box()
    if (!box) continue
    anchors.push({
      id: target.id,
      text: ` ${chord} `,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    })
  }

  return anchors
}

// Peek only: a hover chip sits against its own button, so it needs no obstacles.
export function tooltipObstacles(): TooltipObstacle[] {
  version()
  if (!enabled() || !peeking()) return []
  const boxes: TooltipObstacle[] = []
  for (const target of targets.values()) {
    const box = target.box()
    if (box) boxes.push({ x: box.x, y: box.y, width: box.width, height: box.height })
  }
  return boxes
}

const HOLD_MS = 500

// A terminal that drops the release — focus lost mid-hold — would leave the keys on screen.
const MAX_MS = 10_000

// No Alt: it is half of Ctrl+Opt, so holding it would flash the keys mid-chord.
const PEEK_KEYS = new Set([
  'leftctrl',
  'rightctrl',
  'leftsuper',
  'rightsuper',
  'leftmeta',
  'rightmeta',
])

// useKeys cannot ask for release events; a modifier needs no layout translation.
export function useTooltipPeek(): void {
  let hold: ReturnType<typeof setTimeout> | null = null
  let expiry: ReturnType<typeof setTimeout> | null = null

  const stop = () => {
    if (hold) clearTimeout(hold)
    if (expiry) clearTimeout(expiry)
    hold = null
    expiry = null
    setHeld(false)
  }

  useKeyboard(
    (key: KeyEvent) => {
      const modifier = PEEK_KEYS.has(key.name)
      if (key.eventType === 'release') {
        if (modifier) stop()
        return
      }
      // Any real key ends it: the peek must be gone before the chord it prefixed runs.
      if (!modifier) {
        stop()
        return
      }
      if (key.repeated || hold || held()) return
      hold = setTimeout(() => {
        hold = null
        setHeld(true)
        expiry = setTimeout(stop, MAX_MS)
      }, HOLD_MS)
    },
    { release: true },
  )

  // A terminal sends no release for a key the window lost focus while holding.
  onBlur(stop)
  onCleanup(stop)
}
