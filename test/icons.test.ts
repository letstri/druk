import { expect, test } from 'bun:test'

import {
  ICON_FALLBACK_ENV,
  NO_ICONS,
  registerIconTheme,
  usableIconTheme,
} from '../src/icons'

const patched = {
  extensions: {},
  file: { glyph: '' },
  folder: { glyph: '' },
  folderOpen: { glyph: '' },
  folders: {},
  foldersOpen: {},
  id: 'nerd',
  name: 'Nerd',
  names: {},
  patchedFont: true,
}
registerIconTheme(patched)

const env = (vars: Record<string, string>) => vars as NodeJS.ProcessEnv

test('a patched set falls back to shapes on a console font', () => {
  expect(
    usableIconTheme('nerd', env({ LANG: 'en_US.UTF-8', TERM: 'linux' }))
  ).toBe('unicode')
  expect(
    usableIconTheme(
      'nerd',
      env({ LANG: 'en_US.UTF-8', TERM: 'xterm-256color' })
    )
  ).toBe('nerd')
})

test('shapes survive a console font, having no private-use glyphs', () => {
  expect(
    usableIconTheme('unicode', env({ LANG: 'en_US.UTF-8', TERM: 'linux' }))
  ).toBe('unicode')
})

test('a non-UTF-8 locale drops icons altogether', () => {
  expect(
    usableIconTheme(
      'unicode',
      env({ LANG: 'en_US.ISO-8859-1', TERM: 'xterm-256color' })
    )
  ).toBe(NO_ICONS)
  expect(usableIconTheme('nerd', env({ LC_ALL: 'C' }))).toBe(NO_ICONS)
})

test('an unset locale is left alone', () => {
  expect(usableIconTheme('nerd', env({ TERM: 'xterm-256color' }))).toBe('nerd')
})

test('the env override forces the answer both ways', () => {
  expect(
    usableIconTheme('nerd', env({ TERM: 'linux', [ICON_FALLBACK_ENV]: 'off' }))
  ).toBe('nerd')
  expect(
    usableIconTheme(
      'nerd',
      env({ TERM: 'xterm-256color', [ICON_FALLBACK_ENV]: 'on' })
    )
  ).toBe('unicode')
})
