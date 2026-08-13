/**
 * Tooltips: the key that does what a chrome button does, and nothing else.
 *
 * A terminal has no hover layer, so druk's convention has always been to draw a
 * button's affordance on the row the cursor is on. That leaves the mouse user
 * knowing what the buttons do and never learning the keys — which is what this
 * is for. A tooltip is therefore a chord and no words: every one of these
 * buttons is on screen with its own name or glyph beside it, and a box adding
 * `Files` under a button labelled `Files` is a box saying nothing. Two ways in,
 * showing the same thing:
 *
 * - Hovering one button gives that button's chord.
 * - Holding Ctrl (or Cmd) for half a second lights every button's chord at once.
 *
 * It follows that a command with no chord in force has no tooltip at all, and
 * that binding one is what brings it back.
 *
 * The peek half needs the terminal to report a modifier key as an event of its
 * own, which only the kitty keyboard protocol does — `src/main.tsx` asks for it.
 * Where the terminal has no protocol nothing arrives and nothing happens, which
 * is the right failure: hover still works.
 *
 * Registration is module state rather than a context, the way `keys.ts` holds
 * the key overrides: `TooltipLayer` draws every registered target wherever it
 * is in the tree, and a context would have to be threaded through components
 * that have no other reason to know about it.
 */
import type { KeyEvent } from '@opentui/core'
import { onBlur, useKeyboard } from '@opentui/solid'
import { createSignal, onCleanup } from 'solid-js'

import { chordFor } from './keys'
import type { TooltipAnchor, TooltipObstacle } from './tooltipLayout'

/** The box a target lives in, as much of a renderable as this needs. */
interface TargetBox {
  x: number
  y: number
  width: number
  height: number
}

interface Target {
  id: number
  /** Bindable command id whose chord this control advertises. */
  command: () => string
  box: () => TargetBox | null
}

const targets = new Map<number, Target>()
let nextId = 1

/**
 * Bumped as targets come and go. The layer reads the boxes imperatively off the
 * renderables — they are laid out by then, and nothing about a renderable is a
 * signal — so without this a tooltip'd button that mounts while the peek is up
 * would not appear until something else changed.
 */
const [version, bump] = createSignal(0)
const [hovered, setHovered] = createSignal<number | null>(null)
const [held, setHeld] = createSignal(false)

/**
 * The `tooltips` setting, pushed in by `App`. It lives here rather than staying
 * a prop on the layer because the peek is more than the boxes: the buttons light
 * up with it, and a component asking "am I lit?" must get `false` from the same
 * switch that stops the boxes being drawn.
 */
const [enabled, setEnabled] = createSignal(true)

export { setEnabled as setTooltipsEnabled }

/** The peek as the rest of the editor sees it — off entirely while turned off. */
const peeking = () => enabled() && held()

/**
 * Register one control, by the id of the command it runs. Drop-in for
 * `useHover` — same `hovered`/`enter`/`leave` — plus a `ref` for the box the
 * tooltip is placed against.
 *
 * `undefined` registers nothing and gives back the plain hover state, so a
 * component that draws both buttons and plain text (the status bar's groups) can
 * call this for all of them rather than branching around the shapes.
 */
export function useTooltip(command: string | (() => string) | undefined) {
  const id = nextId++
  let box: TargetBox | null = null
  const commandId = typeof command === 'function' ? command : () => command ?? ''
  const chord = () => chordFor(commandId())

  // Registered even with no command: a control that draws no tooltip is still a
  // control, and the placement has to know its cells are spoken for.
  targets.set(id, { id, command: commandId, box: () => box })
  bump(at => at + 1)

  onCleanup(() => {
    targets.delete(id)
    // Not `setHovered(null)`: the pointer has usually already arrived somewhere
    // else by the time a row is torn down, and clearing unconditionally would
    // erase the new state.
    setHovered(cur => (cur === id ? null : cur))
    bump(at => at + 1)
  })

  return {
    hovered: () => hovered() === id,
    /**
     * Whether to paint this control as live: under the pointer, or lit by a
     * peek. Lighting the buttons is what ties a peek's chords to the things they
     * run — the boxes sit on the rows above or below, and a column of chords
     * beside a strip of unmarked buttons says nothing about which is which.
     */
    lit: () => hovered() === id || (peeking() && chord() !== ''),
    enter: () => setHovered(id),
    leave: () => setHovered(cur => (cur === id ? null : cur)),
    ref: (node: TargetBox) => {
      box = node
    },
  }
}

/**
 * What to draw now: nothing unless the pointer is on a target or the peek is up,
 * and nothing for a control whose command has no key — a chord is all a tooltip
 * ever says, so with no chord there is nothing to say. A command left unbound
 * therefore costs its button a tooltip, which is the right way round: binding
 * one gives it back.
 */
export function tooltipAnchors(): TooltipAnchor[] {
  version()
  if (!enabled()) return []
  const at = hovered()
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

/**
 * Every registered control's cells, tooltip or not — what the placement must not
 * draw over. `Files` is in here despite having no chord of its own: it is still
 * a button, and a chip parked on it would read as its key.
 */
export function tooltipObstacles(): TooltipObstacle[] {
  version()
  if (!enabled()) return []
  const boxes: TooltipObstacle[] = []
  for (const target of targets.values()) {
    const box = target.box()
    if (box) boxes.push({ x: box.x, y: box.y, width: box.width, height: box.height })
  }
  return boxes
}

/** How long Ctrl has to be held down before the keys light up. */
const HOLD_MS = 500

/**
 * The peek cannot outlive this, however the hold ended. A terminal that drops
 * the release — the window loses focus mid-hold on some of them — would
 * otherwise leave the keys on screen for the rest of the session.
 */
const MAX_MS = 10_000

/**
 * Modifiers worth holding. Ctrl is the one every chord here starts with; Cmd is
 * what a macOS user reaches for out of habit, and it costs nothing to answer.
 * Alt is deliberately absent: it is half of Ctrl+Opt, so holding it while
 * reaching for one of those chords would flash the keys mid-shortcut.
 */
const PEEK_KEYS = new Set([
  'leftctrl',
  'rightctrl',
  'leftsuper',
  'rightsuper',
  'leftmeta',
  'rightmeta',
])

/**
 * Watch for the hold. Mounted once, by `App`.
 *
 * `useKeyboard(..., { release: true })` puts presses and releases through one
 * handler; releases reach no other listener in the editor, so turning the
 * protocol's event reporting on costs the existing key handling nothing.
 *
 * The one place that subscribes to OpenTUI directly rather than through
 * `useKeys`: that wrapper exists to rename a Ctrl chord to the US key the
 * character sits on, which a modifier's own name has no need of, and it cannot
 * ask for release events at all.
 */
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
      // Any real key ends it: Ctrl held on the way to Ctrl+S is not a request to
      // read the keys, and the peek must be gone before the chord runs.
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
