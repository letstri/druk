import { describe, expect, test } from 'bun:test'

import {
  filetypeForPath,
  segmentsIn,
  styleIdForGroup,
} from '../src/languages/highlight'
import { loadMarketExtensions } from './helpers'
import { parseHighlights, WHOLE } from './syntax'

loadMarketExtensions()

function painter(source: string, filetype: string) {
  const lines = source.split('\n')
  return async (group: string): Promise<string[]> => {
    const styleId = styleIdForGroup(group)
    if (styleId === null || styleId === undefined) {
      throw new Error(`no style for ${group}`)
    }
    const parsed = await parseHighlights(source, filetype)
    return segmentsIn(parsed, 0, WHOLE)
      .filter((segment) => segment.styleId === styleId)
      .map((segment) => lines[segment.line]!.slice(segment.start, segment.end))
  }
}

const VUE = `<template>
  <div :class="tone">{{ greeting.value }}</div>
  <li v-for="(item, i) in items" :key="item.id" @click.stop="shout()">
    <b v-if="items.length > 0" :style="{ width: size + 'px' }">x</b>
  </li>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const greeting = ref('hello')

function shout(): string {
  return greeting.value.toUpperCase()
}
</script>

<style scoped>
.tone {
  color: red;
}
</style>
`

describe('vue highlighting', () => {
  const painted = painter(VUE, 'vue')

  test('recognises .vue files', () => {
    expect(filetypeForPath('App.vue')).toBe('vue')
  })

  test('paints the template', async () => {
    expect(await painted('tag')).toContain('div')
    expect(await painted('attribute')).toContain(':class')
    expect(await painted('attribute')).toContain('v-for')
    expect(await painted('attribute')).toContain('stop')
  })

  // OpenTUI's bundled typescript query gates captures behind `#lua-match?` its worker never runs.
  test('paints a template expression identifier as a variable', async () => {
    const variables = await painted('variable')
    expect(variables).toContain('tone')
    expect(variables).toContain('items')
    expect(await painted('constant')).not.toContain('tone')
  })

  test('paints typescript inside <script>', async () => {
    const keywords = await painted('keyword')
    expect(keywords).toContain('import')
    expect(keywords).toContain('return')
    expect(await painted('function')).toContain('shout')
    expect(await painted('function.method')).toContain('toUpperCase')
    expect(await painted('string')).toContain("'hello'")
  })

  test('paints css inside <style>', async () => {
    expect(await painted('property')).toContain('color')
  })

  test('paints the expression inside an interpolation', async () => {
    expect(await painted('property')).toContain('value')
  })

  test('paints directive values as the expressions they are', async () => {
    expect(await painted('keyword')).toContain('in')
    expect(await painted('number')).toContain('0')
    expect(await painted('operator')).toContain('>')
    expect(await painted('property')).toContain('length')
    expect(await painted('function')).toContain('shout')
    expect(await painted('property')).toContain('width')
    expect(await painted('operator')).toContain('+')
  })

  test('leaves a plain attribute value a string', async () => {
    expect(await painted('string')).toContain('"ts"')
  })
})

const HTML = `<div>
  <script>
    function go() { return 1 }
  </script>
  <style>
    .a { color: red; }
  </style>
</div>
`

describe('html highlighting', () => {
  const painted = painter(HTML, 'html')

  test('paints the markup', async () => {
    expect(await painted('tag')).toContain('div')
  })

  test('paints javascript inside <script>', async () => {
    expect(await painted('keyword')).toContain('function')
    expect(await painted('function')).toContain('go')
  })

  test('paints css inside <style>', async () => {
    expect(await painted('property')).toContain('color')
  })
})

const PHP = `<p class="lede">hello</p>
<?php
function greet(string $name): string {
  return "hi $name";
}
?>
<p>bye</p>
`

describe('php highlighting', () => {
  const painted = painter(PHP, 'php')

  test('paints the php itself', async () => {
    expect(await painted('keyword')).toContain('function')
    expect(await painted('type')).toContain('string')
  })

  test('paints the html around it', async () => {
    expect(await painted('tag')).toContain('p')
    expect(await painted('attribute')).toContain('class')
  })
})
