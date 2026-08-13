import { createSignal } from 'solid-js'

import { progressFromBusy, reportProgress } from '../core/progress'
import type { Tone } from '../ui/StatusBar'

/** Idle: the footer shows contextual key hints instead of a message. */
export const READY = ''

/** A long operation in flight — counted when the work can say how far it is. */
export interface Busy {
  label: string
  done?: number
  total?: number
}

/** The status bar's message and the one progress slot long operations share. */
export function createStatus() {
  const [status, setStatus] = createSignal<{ msg: string; tone: Tone }>({
    msg: READY,
    tone: 'info',
  })
  /** A long operation in flight, so the bar can spin instead of freezing. */
  const [busy, setBusySignal] = createSignal<Busy | null>(null)

  const say = (msg: string, tone: Tone = 'info') => setStatus({ msg, tone })

  const setBusy = (next: Busy | null) => {
    setBusySignal(next)
    reportProgress(progressFromBusy(next))
  }

  /**
   * One at a time. The operations run in the background, so a second delete
   * started while the first is going would share the one progress slot and clear
   * it early — and both would be rewriting the same tree underneath each other.
   */
  const whileFree = (run: () => void) => {
    const running = busy()
    if (running) return say(`${running.label} already — let it finish`, 'warn')
    run()
  }

  /**
   * Take the slot for a background operation and hand back its release. An
   * operation that finds it taken still runs, silently — an install is not one
   * of the tree rewrites `whileFree` serialises, and going without the counter
   * is what it did before there was a slot at all. Releasing one you never took
   * is the thing this exists to stop: it idles the bar while a bulk delete is
   * still rewriting the tree, and leaves `whileFree` open for a second one.
   */
  const claimBusy = (next: Busy): (() => void) => {
    if (busy()) return () => {}
    setBusy(next)
    return () => setBusy(null)
  }

  return { status, say, busy, setBusy, claimBusy, whileFree }
}

export type Status = ReturnType<typeof createStatus>
