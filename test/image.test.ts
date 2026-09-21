import { describe, expect, test } from 'bun:test'

import { isImagePath } from '../src/core/image'

describe('isImagePath', () => {
  test('matches the decodable extensions, case-insensitively', () => {
    expect(isImagePath('/a/logo.png')).toBe(true)
    expect(isImagePath('/a/photo.JPG')).toBe(true)
    expect(isImagePath('/a/photo.jpeg')).toBe(true)
    expect(isImagePath('/a/anim.gif')).toBe(false)
    expect(isImagePath('/a/main.ts')).toBe(false)
    expect(isImagePath('/a/png')).toBe(false)
  })
})
