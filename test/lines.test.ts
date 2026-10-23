import { describe, expect, test } from 'bun:test'

import {
  commentFor,
  duplicateLines,
  moveLines,
  removeLines,
  toggleComment,
  trimTrailing,
} from '../src/editor/lines'
import { loadMarketExtensions } from './helpers'

loadMarketExtensions()

describe('toggleComment', () => {
  test('comments a line and uncomments it back', () => {
    const once = toggleComment('const a = 1\n', 0, 0, '//')
    expect(once).toBe('// const a = 1\n')
    expect(toggleComment(once, 0, 0, '//')).toBe('const a = 1\n')
  })

  test('a block comments at its shallowest indent', () => {
    const text = '  if (x) {\n    y()\n  }\n'
    expect(toggleComment(text, 0, 2, '//')).toBe(
      '  // if (x) {\n  //   y()\n  // }\n'
    )
  })

  test('a mixed block gets commented, not toggled line by line', () => {
    const text = '// done\ntodo\n'
    expect(toggleComment(text, 0, 1, '//')).toBe('// // done\n// todo\n')
  })

  test('blank lines are skipped, and an all-blank range is untouched', () => {
    expect(toggleComment('a\n\nb\n', 0, 2, '#')).toBe('# a\n\n# b\n')
    expect(toggleComment('\n\n', 0, 1, '#')).toBe('\n\n')
  })

  test('uncommenting eats one space after the prefix, not the indent', () => {
    expect(toggleComment('  # x\n', 0, 0, '#')).toBe('  x\n')
    expect(toggleComment('  #x\n', 0, 0, '#')).toBe('  x\n')
  })

  test('wraps and unwraps a line or block with a [open, close] pair', () => {
    const once = toggleComment('    <span>hi</span>\n', 0, 0, ['{/*', '*/}'])
    expect(once).toBe('    {/* <span>hi</span> */}\n')
    expect(toggleComment(once, 0, 0, ['{/*', '*/}'])).toBe(
      '    <span>hi</span>\n'
    )

    const block = '  <div>\n    <span>hi</span>\n  </div>\n'
    const wrapped = toggleComment(block, 0, 2, ['{/*', '*/}'])
    expect(wrapped).toBe(
      '  {/* <div> */}\n  {/*   <span>hi</span> */}\n  {/* </div> */}\n'
    )
    expect(toggleComment(wrapped, 0, 2, ['{/*', '*/}'])).toBe(block)
  })

  test('unwraps tight block comments and does not mistake two inline comments for one', () => {
    expect(
      toggleComment('  {/*<span>hi</span>*/}\n', 0, 0, ['{/*', '*/}'])
    ).toBe('  <span>hi</span>\n')
    const twoInline = '  {/* a */} <span>hi</span> {/* b */}\n'
    const wrapped = toggleComment(twoInline, 0, 0, ['{/*', '*/}'])
    expect(wrapped).toBe(
      `${String.raw`  {/*\ {/\* a *\/} <span>hi</span> {/\* b *\/} */}`}\n`
    )
    expect(toggleComment(wrapped, 0, 0, ['{/*', '*/}'])).toBe(twoInline)
  })

  test('protects embedded CSS comment delimiters and restores existing escapes', () => {
    const text = String.raw`.card { /* note */ content: "/*/ /\* *\/"; }`
    const wrapped = toggleComment(text, 0, 0, ['/*', '*/'])
    expect(wrapped.slice(3, -2)).not.toContain('/*')
    expect(wrapped.slice(3, -2)).not.toContain('*/')
    expect(toggleComment(wrapped, 0, 0, ['/*', '*/'])).toBe(text)
  })

  test('preserves literal escapes when unwrapping hand-written comments', () => {
    const inner = String.raw`const pattern = /\* /`
    expect(toggleComment(`/* ${inner} */`, 0, 0, ['/*', '*/'])).toBe(inner)
    expect(toggleComment(`{/* ${inner} */}`, 0, 0, ['{/*', '*/}'])).toBe(inner)
    const text = String.raw`\ child text`
    const wrapped = toggleComment(text, 0, 0, ['{/*', '*/}'])
    expect(toggleComment(wrapped, 0, 0, ['{/*', '*/}'])).toBe(text)
  })

  const HTML: [string, string] = ['<!--', '-->']
  // What a browser would read as the end of the comment: `-->` or the forgiven `--!>`.
  const closers = (line: string) => [...line.matchAll(/--!?>/gu)].length

  test.each([
    ['a comment already on the line', '<p>a</p> <!-- n -->'],
    ['two comments around the markup', '<!-- a --> <p>b</p> <!-- c -->'],
    ['a stray closer', 'a --> b'],
    ['the closer a parser forgives', '<p>a</p> --!> x'],
    ['three hyphens before the bracket', 'a --->'],
    ['a literal escape already in the text', 'x --\\> y'],
  ])(
    'wraps %s in <!-- --> without ending it early, and unwraps it back',
    (_, line) => {
      const text = `  ${line}\n`
      const wrapped = toggleComment(text, 0, 0, HTML)
      // Exactly one closer, and it is the wrapper's own at the very end.
      expect(closers(wrapped.trim())).toBe(1)
      expect(wrapped.trimEnd().endsWith('-->')).toBe(true)
      expect(toggleComment(wrapped, 0, 0, HTML)).toBe(text)
    }
  )

  test('wraps a range holding a commented line, and a whole multi-line comment', () => {
    const range = '<p>a</p>\n<!-- b -->\n<p>c</p>\n'
    const wrapped = toggleComment(range, 0, 2, HTML)
    for (const line of wrapped.trim().split('\n')) {
      expect(closers(line)).toBe(1)
    }
    expect(toggleComment(wrapped, 0, 2, HTML)).toBe(range)

    const multi = '<!--\n<p>a</p>\n-->\n'
    const folded = toggleComment(multi, 0, 2, HTML)
    for (const line of folded.trim().split('\n')) {
      expect(closers(line)).toBe(1)
    }
    expect(toggleComment(folded, 0, 2, HTML)).toBe(multi)
  })

  test('leaves a hand-written <!-- --> comment as it was written', () => {
    expect(toggleComment('<!--x--\\>y-->\n', 0, 0, HTML)).toBe('x--\\>y\n')
    expect(toggleComment('<!-- a -- b -->\n', 0, 0, HTML)).toBe('a -- b\n')
  })

  test('keeps a CRLF ending when it wraps a line holding a comment', () => {
    const text = '<p>a</p> <!-- n -->\r\n'
    const wrapped = toggleComment(text, 0, 0, HTML)
    expect(wrapped.endsWith('-->\r\n')).toBe(true)
    expect(toggleComment(wrapped, 0, 0, HTML)).toBe(text)
  })
})

describe('commentFor', () => {
  test('uses {/* */} inside JSX children and // in surrounding TypeScript and tag attributes', () => {
    const tsx = [
      'export function App() {',
      '  const count = 1',
      '  return (',
      '    <Show',
      '      when={count > 0}',
      '      fallback={<p>none</p>}',
      '    >',
      '      <Header />',
      '      <span>{count}</span>',
      '      {count}',
      '      {items.map((item) => {',
      '        const label = item.name',
      '        return (',
      '          <li key={item.id}>',
      '            <em>{label}</em>',
      '          </li>',
      '        )',
      '      })}',
      '    </Show>',
      '  )',
      '}',
    ].join('\n')

    expect(commentFor(tsx, 1, 1, 'typescriptreact')).toBe('//')
    expect(commentFor(tsx, 2, 2, 'typescriptreact')).toBe('//')
    expect(commentFor(tsx, 4, 4, 'typescriptreact')).toBe('//')
    expect(commentFor(tsx, 5, 5, 'typescriptreact')).toBe('//')
    expect(commentFor(tsx, 7, 7, 'typescriptreact')).toEqual(['{/*', '*/}'])
    expect(commentFor(tsx, 8, 8, 'typescriptreact')).toEqual(['{/*', '*/}'])
    expect(commentFor(tsx, 9, 9, 'typescriptreact')).toEqual(['{/*', '*/}'])
    expect(commentFor(tsx, 7, 9, 'typescriptreact')).toEqual(['{/*', '*/}'])
    expect(commentFor(tsx, 11, 11, 'typescriptreact')).toBe('//')
    expect(commentFor(tsx, 14, 14, 'typescriptreact')).toEqual(['{/*', '*/}'])

    const commented = toggleComment(
      tsx,
      7,
      7,
      commentFor(tsx, 7, 7, 'typescriptreact')!
    )
    expect(commented.split('\n')[7]).toBe('      {/* <Header /> */}')
    expect(commentFor(commented, 7, 7, 'typescriptreact')).toEqual([
      '{/*',
      '*/}',
    ])
    expect(
      toggleComment(
        commented,
        7,
        7,
        commentFor(commented, 7, 7, 'typescriptreact')!
      )
    ).toBe(tsx)
  })

  test('does not mistake TypeScript generics or comparisons for JSX tags', () => {
    const tsx = [
      'const id = <T>(x: T) => x',
      'const ext = <T extends Foo>(x: T) => x',
      'const def = <T = string>(x: T) => x',
      'const cmp = a < b && c > d',
      'const next = count + 1',
    ].join('\n')
    expect(commentFor(tsx, 4, 4, 'typescriptreact')).toBe('//')
  })

  test.each([
    '<span>{/* note */}hi</span>',
    '<span>{"*/"}</span>',
    '<span>/*/</span>',
    String.raw`<span data-value="/\* *\/">hi</span>`,
  ])('round-trips JSX children with embedded delimiters: %s', (child) => {
    const text = `const view = (\n  <div>\n    ${child}\n    <b>next</b>\n  </div>\n)`
    const wrapped = toggleComment(
      text,
      2,
      3,
      commentFor(text, 2, 3, 'typescriptreact')!
    )
    expect(wrapped).not.toBe(text)
    expect(() =>
      new Bun.Transpiler({ loader: 'tsx' }).transformSync(wrapped)
    ).not.toThrow()
    expect(
      toggleComment(
        wrapped,
        2,
        3,
        commentFor(wrapped, 2, 3, 'typescriptreact')!
      )
    ).toBe(text)
  })

  test('handles fragments and tsrx components', () => {
    const frag = 'const v = (\n  <>\n    <p>hi</p>\n  </>\n)\n'
    expect(commentFor(frag, 2, 2, 'javascriptreact')).toEqual(['{/*', '*/}'])

    const tsrx =
      'export function App() @{\n  const n = 1\n  <main>\n    <p>hi</p>\n  </main>\n}\n'
    expect(commentFor(tsrx, 1, 1, 'tsrx')).toBe('//')
    expect(commentFor(tsrx, 3, 3, 'tsrx')).toEqual(['{/*', '*/}'])
  })

  test('switches comment style across template, script, and style blocks in vue, svelte, and html', () => {
    const vue = [
      '<template>',
      '  <div class="card">hi</div>',
      '</template>',
      '<script setup lang="ts">',
      'const count = 1',
      '</script>',
      '<style scoped>',
      '.card { color: red; }',
      '</style>',
    ].join('\n')

    expect(commentFor(vue, 1, 1, 'vue')).toEqual(['<!--', '-->'])
    expect(commentFor(vue, 4, 4, 'vue')).toBe('//')
    expect(commentFor(vue, 7, 7, 'vue')).toEqual(['/*', '*/'])
    expect(commentFor(vue, 1, 1, 'svelte')).toEqual(['<!--', '-->'])
    expect(commentFor(vue, 4, 4, 'svelte')).toBe('//')
    expect(commentFor(vue, 7, 7, 'svelte')).toEqual(['/*', '*/'])
    expect(commentFor(vue, 1, 1, 'html')).toEqual(['<!--', '-->'])
    expect(commentFor(vue, 4, 4, 'html')).toBe('//')
    expect(commentFor(vue, 7, 7, 'html')).toEqual(['/*', '*/'])

    const vueTsx = [
      '<script lang="tsx">',
      'export const View = () => (',
      '  <div>',
      '    <span>hi</span>',
      '  </div>',
      ')',
      '</script>',
      '<style lang="scss">',
      '.box { color: blue; }',
      '</style>',
    ].join('\n')
    expect(commentFor(vueTsx, 1, 1, 'vue')).toBe('//')
    expect(commentFor(vueTsx, 3, 3, 'vue')).toEqual(['{/*', '*/}'])
    expect(commentFor(vueTsx, 8, 8, 'vue')).toBe('//')
  })

  test('switches between PHP code and HTML markup in php files, and handles liquid regions', () => {
    const php = [
      '<?php',
      '$title = "Home";',
      '?>',
      '<div class="hero">',
      '  <h1><?= $title ?></h1>',
      '</div>',
    ].join('\n')
    expect(commentFor(php, 1, 1, 'php')).toBe('//')
    expect(commentFor(php, 4, 4, 'php')).toEqual(['<!--', '-->'])

    const liquid = [
      '<div>{{ title }}</div>',
      '{% liquid',
      '  assign x = 1',
      '%}',
      '{% stylesheet %}',
      '#hero { color: red; }',
      '{% endstylesheet %}',
      '{% javascript %}',
      'const y = 2',
      '{% endjavascript %}',
    ].join('\n')
    expect(commentFor(liquid, 0, 0, 'liquid')).toEqual(['<!--', '-->'])
    expect(commentFor(liquid, 2, 2, 'liquid')).toBe('#')
    expect(commentFor(liquid, 5, 5, 'liquid')).toEqual(['/*', '*/'])
    expect(commentFor(liquid, 8, 8, 'liquid')).toBe('//')
  })

  test('reads lang and type on script and style tags, even across lines', () => {
    const html = [
      '<script',
      '  type="application/json">',
      '  { "a": 1 }',
      '</script>',
      '<script',
      '  lang="ts">',
      '  const x = 1',
      '</script>',
      '<style',
      '  lang="scss">',
      '  .a { color: red; }',
      '</style>',
    ].join('\n')

    expect(commentFor(html, 2, 2, 'html')).toEqual(['<!--', '-->'])
    expect(commentFor(html, 6, 6, 'html')).toBe('//')
    expect(commentFor(html, 10, 10, 'html')).toBe('//')

    const vueMulti =
      '<script\n  lang="tsx"\n>\nconst v = (\n  <div>\n    <p>hi</p>\n  </div>\n)\n</script>\n'
    expect(commentFor(vueMulti, 3, 3, 'vue')).toBe('//')
    expect(commentFor(vueMulti, 5, 5, 'vue')).toEqual(['{/*', '*/}'])
  })

  test('a script tag inside an html comment or one holding data opens no region', () => {
    const html = [
      '<!-- <script> -->',
      'const x = 1',
      '<script type="application/json">',
      '{ "a": 1 }',
      '</script>',
      '<script type="text/template">',
      '<div>{{x}}</div>',
      '</script>',
    ].join('\n')
    expect(commentFor(html, 1, 1, 'html')).toEqual(['<!--', '-->'])
    expect(commentFor(html, 3, 3, 'html')).toEqual(['<!--', '-->'])
    expect(commentFor(html, 6, 6, 'html')).toEqual(['<!--', '-->'])
  })

  test.each([
    '<div data-example="<script>">',
    '<div\n  data-example="<script>"\n>',
    '<div data-example="quoted > <style>">',
    '<script-editor>',
    '<style-editor>',
  ])('only real embedded tags open regions after %s', (opening) => {
    const text = `${opening}\n<p>hi</p>`
    const row = text.split('\n').length - 1
    for (const filetype of ['html', 'vue', 'svelte', 'liquid', 'php']) {
      const style = commentFor(text, row, row, filetype)!
      expect(style).toEqual(['<!--', '-->'])
      const wrapped = toggleComment(text, row, row, style)
      expect(wrapped.split('\n')[row]).toBe('<!-- <p>hi</p> -->')
      expect(
        toggleComment(
          wrapped,
          row,
          row,
          commentFor(wrapped, row, row, filetype)!
        )
      ).toBe(text)
    }
  })

  test('ignores quoted angle brackets while completing embedded tags', () => {
    const text = [
      '<script data-example=">"',
      '  type="application/json">',
      '{ "a": 1 }',
      '</script>',
      '<script data-example="',
      '  >',
      '" lang="tsx">',
      'const view = (',
      '  <div>',
      '    <p>hi</p>',
      '  </div>',
      ')',
      '</script>',
    ].join('\n')
    expect(commentFor(text, 2, 2, 'html')).toEqual(['<!--', '-->'])
    expect(commentFor(text, 9, 9, 'html')).toEqual(['{/*', '*/}'])
  })

  test.each([
    '<script>\nconst x = 1\n</script><style>',
    '<script>\nconst x = 1\n</script><script></script><style>',
    '<script></script><style>',
    '<style>\n.a {}\n</style><style>',
    '{% javascript %}\nconst x = 1\n{% endjavascript %}<style>',
  ])('continues scanning after region closures: %s', (before) => {
    const text = `${before}\n#hero { color: red; }\n</style>`
    const row = text.split('\n').length - 2
    const filetypes = before.startsWith('{%')
      ? ['liquid']
      : ['html', 'vue', 'svelte', 'liquid', 'php']
    for (const filetype of filetypes) {
      const style = commentFor(text, row, row, filetype)!
      expect(style).toEqual(['/*', '*/'])
      const wrapped = toggleComment(text, row, row, style)
      expect(wrapped.split('\n')[row]).toBe('/* #hero { color: red; } */')
      expect(
        toggleComment(
          wrapped,
          row,
          row,
          commentFor(wrapped, row, row, filetype)!
        )
      ).toBe(text)
    }
  })

  test('recognizes existing PHP comments only in their region', () => {
    const php = [
      '<?php',
      '# note',
      '/* note */',
      '?>',
      '<style>',
      '#hero { color: red; }',
      '</style>',
      '#plain text',
      '//plain text',
      '<script>',
      '/* note */',
      '</script>',
    ].join('\n')
    expect(commentFor(php, 1, 1, 'php')).toBe('#')
    expect(commentFor(php, 2, 2, 'php')).toEqual(['/*', '*/'])
    expect(commentFor(php, 10, 10, 'php')).toEqual(['/*', '*/'])
    for (const row of [5, 7, 8]) {
      const style = commentFor(php, row, row, 'php')!
      expect(style).toEqual(row === 5 ? ['/*', '*/'] : ['<!--', '-->'])
      const wrapped = toggleComment(php, row, row, style)
      expect(wrapped.split('\n')[row]).toBe(
        row === 5
          ? '/* #hero { color: red; } */'
          : `<!-- ${php.split('\n')[row]} -->`
      )
      expect(
        toggleComment(wrapped, row, row, commentFor(wrapped, row, row, 'php')!)
      ).toBe(php)
    }
  })

  test('php leaving php mode mid-selection uses /* */, which a ?> cannot cut short', () => {
    const php = ['<?php', '$a = 1;', '?>', '<div>x</div>'].join('\n')
    expect(commentFor(php, 1, 1, 'php')).toBe('//')
    expect(commentFor(php, 1, 3, 'php')).toEqual(['/*', '*/'])
  })

  test('treats PHP 8 attributes as code, not hash comments', () => {
    const php = [
      '<?php',
      "#[Route('/home')]",
      'function home() {}',
      '# real comment',
      '# [bracketed comment]',
    ].join('\n')
    expect(commentFor(php, 1, 1, 'php')).toBe('//')
    const commentedAttr = toggleComment(php, 1, 1, '//')
    expect(commentedAttr.split('\n')[1]).toBe("// #[Route('/home')]")
    expect(
      toggleComment(
        commentedAttr,
        1,
        1,
        commentFor(commentedAttr, 1, 1, 'php')!
      )
    ).toBe(php)

    expect(commentFor(php, 3, 3, 'php')).toBe('#')
    expect(commentFor(php, 4, 4, 'php')).toBe('#')
  })

  test('liquid schema blocks are data, and liquid tags inside html comments open nothing', () => {
    const liquid = [
      '{% schema %}',
      '{ "name": "x" }',
      '{% endschema %}',
      '<!-- {% javascript %} -->',
      '<p>text</p>',
    ].join('\n')
    expect(commentFor(liquid, 1, 1, 'liquid')).toEqual(['<!--', '-->'])
    expect(commentFor(liquid, 4, 4, 'liquid')).toEqual(['<!--', '-->'])
  })

  test('provides block or line comments for css, markdown, and hcl/terraform', () => {
    expect(commentFor('.a { color: red; }\n', 0, 0, 'css')).toEqual([
      '/*',
      '*/',
    ])
    expect(commentFor('# Heading\n', 0, 0, 'markdown')).toEqual(['<!--', '-->'])
    expect(
      commentFor('resource "aws_s3_bucket" "b" {}\n', 0, 0, 'terraform')
    ).toBe('#')
    expect(commentFor('locals {}\n', 0, 0, 'hcl')).toBe('#')
  })
})

describe('moveLines', () => {
  test('moves a line down and back up', () => {
    expect(moveLines('a\nb\nc\n', 0, 0, 1)).toBe('b\na\nc\n')
    expect(moveLines('a\nb\nc\n', 1, 1, -1)).toBe('b\na\nc\n')
  })

  test('moves a block as one unit', () => {
    expect(moveLines('a\nb\nc\nd\n', 0, 1, 1)).toBe('c\na\nb\nd\n')
  })

  test('refuses to move past either edge', () => {
    expect(moveLines('a\nb\n', 0, 0, -1)).toBeNull()
    expect(moveLines('a\nb\n', 1, 1, 1)).toBeNull()
  })
})

describe('duplicateLines', () => {
  test('copies the line below itself', () => {
    expect(duplicateLines('a\nb\n', 0, 0)).toBe('a\na\nb\n')
  })

  test('copies a block below the block', () => {
    expect(duplicateLines('a\nb\nc\n', 0, 1)).toBe('a\nb\na\nb\nc\n')
  })
})

describe('removeLines', () => {
  test('takes the line and its newline, so the next one keeps its indent', () => {
    expect(removeLines('  a,\n  b,\n  c,\n', 1, 1)).toBe('  a,\n  c,\n')
  })

  test('takes a block as one unit', () => {
    expect(removeLines('a\nb\nc\nd\n', 1, 2)).toBe('a\nd\n')
  })

  test('the last line goes without taking the file’s final newline elsewhere', () => {
    expect(removeLines('a\nb\n', 1, 1)).toBe('a\n')
    expect(removeLines('a\nb', 1, 1)).toBe('a')
  })

  test('deleting every line empties the file', () => {
    expect(removeLines('a\nb\n', 0, 1)).toBe('')
  })

  test('a range past the end is clamped, and an empty file is left alone', () => {
    expect(removeLines('a\nb\n', 1, 9)).toBe('a\n')
    expect(removeLines('', 0, 0)).toBe('')
  })
})

describe('trimTrailing', () => {
  test('strips trailing spaces and tabs from every line', () => {
    expect(trimTrailing('a  \nb\t\nc\n')).toBe('a\nb\nc\n')
  })

  test('adds the final newline when missing, and only then', () => {
    expect(trimTrailing('a')).toBe('a\n')
    expect(trimTrailing('a\n')).toBe('a\n')
  })

  test('leaves leading indentation alone', () => {
    expect(trimTrailing('  a \n')).toBe('  a\n')
  })
})
