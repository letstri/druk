import { expect, test } from 'bun:test'

import { getSyntaxStyle } from '../src/languages/highlight'
import { fixture, launch, press } from './helpers'
import { allSegments } from './syntax'

const YAML = 'settings:\n  autoInstallPeers: true\n  count: 42\n# note\n'

test('yaml keys, values and comments get distinct styles', async () => {
  const segs = await allSegments(YAML, 'yaml')
  const ss = getSyntaxStyle()
  const lines = YAML.split('\n')
  const styleOf = (needle: string) => {
    for (const [line, text] of lines.entries()) {
      const col = text.indexOf(needle)
      if (col < 0) continue
      return segs.find(s => s.line === line && s.start <= col && col < s.end)?.styleId
    }
    return undefined
  }

  expect(styleOf('settings')).toBe(ss.getStyleId('property')!)
  expect(styleOf('true')).toBe(ss.getStyleId('boolean')!)
  expect(styleOf('42')).toBe(ss.getStyleId('number')!)
  expect(styleOf('# note')).toBe(ss.getStyleId('comment')!)
})

test('a .yaml file opens and reports its filetype', async () => {
  const t = await launch(fixture({ 'config.yaml': YAML }))
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  const frame = t.captureCharFrame()
  expect(frame).toContain('autoInstallPeers')
  expect(frame.split('\n').at(-2)).toContain('yaml')
})
