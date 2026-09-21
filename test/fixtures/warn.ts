import { EventEmitter } from 'node:events'
import { setTimeout as sleep } from 'node:timers/promises'

import { divertWarnings } from '../../src/core/warnings'

divertWarnings(process.argv[2])
// EventEmitter, not EventTarget: the max-listeners warning is what this fixture provokes.
// oxlint-disable-next-line unicorn/prefer-event-target
const emitter = new EventEmitter()
for (let n = 0; n <= emitter.getMaxListeners(); n += 1) {
  emitter.on('x', () => null)
}
await sleep(20)
