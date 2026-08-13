import { describe, expect, test } from 'bun:test'

import { filetypeForPath, segmentsIn, styleIdForGroup } from '../src/languages/highlight'
import { loadMarketExtensions } from './helpers'
import { parseHighlights, WHOLE } from './syntax'

// Vue and php are market plugins; the languages they inject — typescript, css,
// html — are preinstalled.
loadMarketExtensions()

/** Text painted with `group`'s style, anywhere in the document. */
function painter(source: string, filetype: string) {
  const lines = source.split('\n')
  return async (group: string): Promise<string[]> => {
    const styleId = styleIdForGroup(group)
    if (styleId == null) throw new Error(`no style for ${group}`)
    const parsed = await parseHighlights(source, filetype)
    return segmentsIn(parsed, 0, WHOLE)
      .filter(segment => segment.styleId === styleId)
      .map(segment => lines[segment.line]!.slice(segment.start, segment.end))
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
    expect(await painted('property')).toContain('class')
  })

  // The whole point: the vue grammar reads a block body as one raw_text token,
  // so before injections everything between the script tags rendered plain.
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

  // `(interpolation) @embedded` covers the braces and everything between them,
  // so the injected capture has to be the one that wins the expression.
  test('paints the expression inside an interpolation', async () => {
    expect(await painted('variable.member')).toContain('value')
  })

  // A directive's value is an expression the whole of the template's logic is
  // written in, and the outer `@string` covers it — so the injection has to win
  // it the way the interpolation's does.
  test('paints directive values as the expressions they are', async () => {
    expect(await painted('keyword.operator')).toContain('in')
    expect(await painted('number')).toContain('0')
    expect(await painted('operator')).toContain('>')
    expect(await painted('variable.member')).toContain('length')
    expect(await painted('function')).toContain('shout')
    // An object literal inside the value, whose own parts are painted apart.
    expect(await painted('variable.member')).toContain('width')
    expect(await painted('operator')).toContain('+')
  })

  // The plain attribute beside them is a literal, and reads as one.
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

  // Everything outside `<?php … ?>` is one `text` token to the php grammar.
  test('paints the html around it', async () => {
    expect(await painted('tag')).toContain('p')
    expect(await painted('attribute')).toContain('class')
  })
})
