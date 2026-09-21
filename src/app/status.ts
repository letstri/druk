import { createSignal } from 'solid-js'

import { progressFromBusy, reportProgress } from '../core/progress'
import type { Tone } from '../ui/StatusBar'

export const READY = ''

export interface Busy {
  label: string
  done?: number
  total?: number
}

export function createStatus() {
  const [status, setStatus] = createSignal<{ msg: string; tone: Tone }>({
    msg: READY,
    tone: 'info',
  })
  const [busy, setBusySignal] = createSignal<Busy | null>(null)

  const say = (msg: string, tone: Tone = 'info') => setStatus({ msg, tone })

  const setBusy = (next: Busy | null) => {
    setBusySignal(next)
    reportProgress(progressFromBusy(next))
  }

  // One slot: a second background rewrite would clobber the first's counter.
  const whileFree = (run: () => void) => {
    const running = busy()
    if (running) {
      return say(`${running.label} already — let it finish`, 'warn')
    }
    run()
  }

  // The no-op release is the point: releasing a slot never taken idles the bar mid-op.
  const claimBusy = (next: Busy): (() => void) => {
    if (busy()) {
      return () => null
    }
    setBusy(next)
    return () => setBusy(null)
  }

  return { busy, claimBusy, say, setBusy, status, whileFree }
}

export type Status = ReturnType<typeof createStatus>
