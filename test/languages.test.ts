import { describe, expect, test } from 'bun:test'

import { MARKET_DIR } from '../scripts/extensions'
import { loadExtensions } from '../src/extensions'
import { languageFor, languageLabel, languages } from '../src/languages'
import {
  computeHighlights,
  filetypeForPath,
  getSyntaxStyle,
  segmentsIn,
  STALE,
} from '../src/languages/highlight'
import type { Highlighted, Segment } from '../src/languages/highlight'
import { allSegments, parseHighlights, WHOLE } from './syntax'

loadExtensions(process.env.XDG_CONFIG_HOME!, [], MARKET_DIR)

const SAMPLES: Record<string, string> = {
  bash: '# c\nfor f in *.ts; do echo "$f"; done\n',
  c: '// c\nint main(void) { return 0; }\n',
  cpp: '// c\nint main() { int x = 1; return x; }\n',
  csharp: '// c\nclass A { void M() { int x = 1; } }\n',
  css: '.a { color: #fff; }\n/* c */\n',
  dart: '// c\nvoid main() { var x = 1; }\n',
  dotenv: '# c\nexport PORT=3000\nURL="https://x.dev"\n',
  elixir: '# c\ndefmodule A do\n  def go(x), do: x\nend\n',
  go: 'package main\n// c\nfunc main() { return }\n',
  hcl: '# c\njob "web" {\n  type = "service"\n}\n',
  ini: '; c\n[section]\nkey = value\n',
  java: '// c\nclass A { void m() { int x = 1; } }\n',
  kotlin: '// c\nfun main() { val x = 1 }\n',
  liquid: '<!-- c -->\n<div class="a">{{ product.title | upcase }}</div>\n',
  lua: '-- c\nlocal function f(x) return x end\n',
  php: '<?php\n// c\nfunction f($x) { return $x; }\n',
  python: 'import os\ndef f(x):\n    # c\n    return x + 1\n',
  ruby: '# c\nclass A\n  def go(x)\n    x\n  end\nend\n',
  rust: 'fn main() {\n    let x: i32 = 1; // c\n}\n',
  sass: '/* c */\n.a\n  top: 1px\n',
  scala: '// c\nobject A { def go(x: Int): Int = x }\n',
  scss: '/* c */\n$brand: #f00;\n.a { color: $brand; &:hover { top: 1px } }\n',
  sql: '-- c\nSELECT id FROM users WHERE age > 18;\n',
  svelte: '<!-- c -->\n<script>let x = 1</script>\n<div class="a">{x}</div>\n',
  swift: '// c\nfunc go(x: Int) -> Int { return x }\n',
  terraform: '# c\nresource "aws_instance" "web" {\n  ami = var.ami_id\n}\n',
  toml: '# c\n[pkg]\nname = "x"\n',
  tsrx: '// c\nexport function A() @{\n\t@if (ok) {\n\t\t<p>{x as string}</p>\n\t}\n}\n',
  typescriptreact: '// c\nconst A = () => <div className="a">{1}</div>\n',
  vue: '<template>\n  <!-- c -->\n  <div class="a">x</div>\n</template>\n',
  yaml: '# c\na:\n  b: true\n',
}

describe('languages', () => {
  test('every registered language declares a grammar or patterns', () => {
    for (const lang of languages()) {
      const usable = lang.bundled || (lang.wasm && lang.query) || lang.patterns
      expect(`${lang.id}:${usable ? 'ok' : 'unusable'}`).toBe(`${lang.id}:ok`)
    }
  })

  test('a label, where there is one, is shorter than the id it replaces', () => {
    for (const lang of languages().filter((language) => language.label)) {
      expect(lang.label!.length).toBeLessThan(lang.id.length)
    }
  })

  test('labels stand in for the id on screen, and only where set', () => {
    expect(languageLabel('typescriptreact')).toBe('tsx')
    expect(languageLabel('javascriptreact')).toBe('jsx')
    expect(languageLabel('typescript')).toBe('ts')
    expect(languageLabel('javascript')).toBe('js')
    expect(languageLabel('markdown')).toBe('md')
    expect(languageLabel('python')).toBe('python')
    expect(languageLabel('css')).toBe('css')
    expect(languageLabel('plain')).toBe('plain')
  })

  test('ids are unique', () => {
    const ids = languages().map((language) => language.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  for (const [filetype, source] of Object.entries(SAMPLES)) {
    test(`${filetype} highlights`, async () => {
      expect(languageFor(filetype)).toBeDefined()
      const segs = await allSegments(source, filetype)
      const comment = getSyntaxStyle().getStyleId('comment')
      expect(segs.some((s) => s.styleId === comment)).toBe(true)
    }, 15_000)
  }
})

function styleLookup(source: string) {
  const lines = source.split('\n')
  return (segs: Segment[], needle: string, occurrence = 0) => {
    let index = -1
    for (let i = 0; i <= occurrence; i += 1) {
      index = source.indexOf(needle, index + 1)
    }
    let acc = 0
    for (let line = 0; line < lines.length; line += 1) {
      const lineLen = lines[line]!.length
      if (index < acc + lineLen) {
        const col = index - acc
        return segs.find(
          (s) => s.line === line && col >= s.start && col < s.end
        )?.styleId
      }
      acc += lineLen + 1
    }
  }
}

const isStyle = (found: number | undefined, group: string) =>
  found === getSyntaxStyle().getStyleId(group)

describe('liquid doc comments', () => {
  const SOURCE = [
    '{% doc %}',
    '  Renders a reusable AJAX add-to-cart form and button.',
    '',
    '  @param {product} product - Shopify product object for the form.',
    '  @param {variant} [current_variant] - Variant used for the initial button availability state.',
    '',
    '  @example',
    "  {% render 'add-to-cart-form', product: product %}",
    '{% enddoc %}',
    '',
  ].join('\n')

  const styleAt = styleLookup(SOURCE)

  test('delimiters and prose default to comment, @param/@example stand out as tags, {type} as a type, and both the required and optional [name] form as a parameter', async () => {
    const segs = await allSegments(SOURCE, 'liquid')
    expect(isStyle(styleAt(segs, '{% doc %}'), 'comment')).toBe(true)
    expect(isStyle(styleAt(segs, 'Renders a reusable'), 'comment')).toBe(true)
    expect(isStyle(styleAt(segs, '@param'), 'keyword.tag')).toBe(true)
    expect(isStyle(styleAt(segs, '@example'), 'keyword.tag')).toBe(true)
    expect(isStyle(styleAt(segs, '{product}'), 'type.builtin')).toBe(true)
    expect(isStyle(styleAt(segs, '{variant}'), 'type.builtin')).toBe(true)
    expect(isStyle(styleAt(segs, 'product', 1), 'variable.parameter')).toBe(
      true
    )
    expect(
      isStyle(styleAt(segs, 'current_variant'), 'variable.parameter')
    ).toBe(true)
  })

  test('the dotted groups above have no theme entry of their own, so the assertions above are exercising the fallback, not a coincidence', () => {
    const ss = getSyntaxStyle()
    expect(ss.getStyleId('keyword.tag')).toBe(ss.getStyleId('keyword'))
    expect(ss.getStyleId('type.builtin')).toBe(ss.getStyleId('type'))
    expect(ss.getStyleId('variable.parameter')).toBe(ss.getStyleId('variable'))
  })
})

describe('liquid assign targets', () => {
  const SOURCE = [
    '{%- liquid',
    '  assign variant = current_variant | default: product.first_available_variant',
    "  assign resolved_form_class = 'js-add-to-cart'",
    '  if form_class != blank',
    '    assign resolved_form_class = resolved_form_class | append: form_class',
    '  endif',
    '-%}',
    '{% capture inline_label %}Add to cart{% endcapture %}',
    '<div class="{{ resolved_form_class }}">{{ variant }}</div>',
    '',
  ].join('\n')

  const styleAt = styleLookup(SOURCE)

  test('an assign target is styled as a variable whether its value is a bare reference, a filter chain, or a string literal', async () => {
    const segs = await allSegments(SOURCE, 'liquid')
    expect(
      isStyle(styleAt(segs, 'variant = current_variant'), 'variable')
    ).toBe(true)
    expect(
      isStyle(
        styleAt(segs, "resolved_form_class = 'js-add-to-cart'"),
        'variable'
      )
    ).toBe(true)
    expect(
      isStyle(
        styleAt(segs, 'resolved_form_class = resolved_form_class'),
        'variable'
      )
    ).toBe(true)
    expect(isStyle(styleAt(segs, 'inline_label'), 'variable')).toBe(true)
  })

  test('a reference to that name elsewhere is not mistaken for another declaration', async () => {
    const segs = await allSegments(SOURCE, 'liquid')
    const ss = getSyntaxStyle()

    expect(styleAt(segs, 'form_class != blank')).not.toBe(
      ss.getStyleId('variable')
    )
    expect(styleAt(segs, 'resolved_form_class', 2)).not.toBe(
      ss.getStyleId('variable')
    )
    expect(styleAt(segs, 'resolved_form_class', 3)).not.toBe(
      ss.getStyleId('variable')
    )
  })

  test('real HTML attributes and filters are unaffected', async () => {
    const segs = await allSegments(SOURCE, 'liquid')
    expect(isStyle(styleAt(segs, 'class="'), 'attribute')).toBe(true)
    expect(isStyle(styleAt(segs, 'default:'), 'function')).toBe(true)
    expect(isStyle(styleAt(segs, 'append:'), 'function')).toBe(true)
  })
})

describe('liquid around the markup a theme file is mostly made of', () => {
  const SOURCE = [
    '<!-- section: cart -->',
    '<div class="cart" data-count="3" id="cart-2">',
    "  <p>It's the customer's cart. Don't panic.</p>",
    '  <span>Buy one or capture it later.</span>',
    '</div>',
    '<script>',
    '  const ok = alpha || beta',
    '</script>',
    '',
  ].join('\n')

  const styleAt = styleLookup(SOURCE)

  test('an HTML comment keeps its own delimiters instead of losing them to the bracket pattern', async () => {
    const segs = await allSegments(SOURCE, 'liquid')
    expect(isStyle(styleAt(segs, '<!--'), 'comment')).toBe(true)
    expect(isStyle(styleAt(segs, '-->'), 'comment')).toBe(true)
  })

  test('an attribute value stays one string, digits and all', async () => {
    const segs = await allSegments(SOURCE, 'liquid')
    expect(isStyle(styleAt(segs, '"3"'), 'string')).toBe(true)
    expect(isStyle(styleAt(segs, '3'), 'string')).toBe(true)
    expect(isStyle(styleAt(segs, '2'), 'string')).toBe(true)
  })

  test('apostrophes in prose do not pair into a string', async () => {
    const segs = await allSegments(SOURCE, 'liquid')
    expect(isStyle(styleAt(segs, "'s the customer"), 'string')).toBe(false)
    expect(isStyle(styleAt(segs, 'the customer'), 'string')).toBe(false)
  })

  test('prose that happens to say "capture" does not declare a variable', async () => {
    const segs = await allSegments(SOURCE, 'liquid')
    expect(isStyle(styleAt(segs, 'it later'), 'variable')).toBe(false)
  })

  test('a JavaScript or in an embedded script is not read as a filter pipe', async () => {
    const segs = await allSegments(SOURCE, 'liquid')
    expect(isStyle(styleAt(segs, '|| beta'), 'operator')).toBe(false)
    expect(isStyle(styleAt(segs, 'beta'), 'function')).toBe(false)
  })
})

describe('abandoning a highlight that arrived too late', () => {
  const SOURCE = 'const alpha = 1 // note\n'

  test('says STALE instead of preparing work nobody will use', async () => {
    expect(await computeHighlights(SOURCE, 'typescript', 2, () => true)).toBe(
      STALE
    )
  })

  test('still segments normally while the text is current', async () => {
    const parsed = await computeHighlights(SOURCE, 'typescript', 2, () => false)
    expect(parsed).not.toBe(STALE)
    const comment = getSyntaxStyle().getStyleId('comment')
    expect(
      segmentsIn(parsed as Highlighted, 0, WHOLE).some(
        (s) => s.styleId === comment
      )
    ).toBe(true)
  })

  test('a caller that asks nothing can never be handed STALE', async () => {
    expect(await computeHighlights(SOURCE, 'typescript', 2)).not.toBe(STALE)
  })
})

describe('reusing a parse across tab switches', () => {
  test('the same text comes back as the same parse, not a new one', async () => {
    const source = 'const beta = 2 // note\n'
    const first = await computeHighlights(source, 'typescript', 2)
    const again = await computeHighlights(source, 'typescript', 2)
    expect(first).not.toBe(STALE)
    expect(again).toBe(first)
  })

  test('a different tab size is not the same parse', async () => {
    const source = 'if (a) {\n    b()\n}\n'
    const two = await computeHighlights(source, 'typescript', 2)
    const four = await computeHighlights(source, 'typescript', 4)
    expect(four).not.toBe(two)
  })
})

const key = (s: {
  line: number
  start: number
  end: number
  styleId: number
}) => `${s.line}:${s.start}-${s.end}:${s.styleId}`

describe('segmenting a window instead of the document', () => {
  const source = `${Array.from(
    { length: 300 },
    (_, i) => `export const value${i} = ${i} // note ${i}`
  ).join('\n')}\n`

  test('a window matches what a full segmentation produces for those lines', async () => {
    const parsed = await parseHighlights(source, 'typescript')
    const whole = segmentsIn(parsed, 0, WHOLE)

    for (const [from, to] of [
      [0, 40],
      [100, 160],
      [260, 299],
    ] as const) {
      const windowed = segmentsIn(parsed, from, to).map(key).toSorted()
      const expected = whole
        .filter((s) => s.line >= from && s.line <= to)
        .map(key)
        .toSorted()
      expect(`${from}-${to}: ${windowed.join('|')}`).toBe(
        `${from}-${to}: ${expected.join('|')}`
      )
    }
  }, 20_000)

  test('stitching every window back together reproduces the whole file', async () => {
    const parsed = await parseHighlights(source, 'typescript')
    const whole = segmentsIn(parsed, 0, WHOLE).map(key).toSorted()

    const stitched: string[] = []
    for (let from = 0; from <= 300; from += 37) {
      stitched.push(...segmentsIn(parsed, from, from + 36).map(key))
    }
    expect(stitched.toSorted()).toEqual(whole)
  }, 20_000)
})

// Terraform interpolation below, not a template literal.
/* oxlint-disable no-template-curly-in-string */
describe('terraform', () => {
  const SOURCE = [
    'terraform {',
    '  required_version = ">= 1.0"',
    '}',
    '',
    '# a commented-out attribute',
    '# ami = "abc"',
    '',
    'variable "prefix" {',
    '  type    = string',
    '  default = null',
    '}',
    '',
    'resource "aws_instance" "web" {',
    '  instance_type = "t3.micro"',
    '  count         = var.enabled ? 1 : 0',
    '  colour        = "#ffffff"',
    '  docs          = "https://x.dev/path.html#anchor"',
    '  name          = "${var.prefix}-web" // trailing',
    '  tags          = merge(local.common, {})',
    '}',
    '',
  ].join('\n')

  const styleAt = styleLookup(SOURCE)
  const segsFor = () => allSegments(SOURCE, 'terraform')

  test('block heads, keys, types, values and calls each take their own colour', async () => {
    const segs = await segsFor()
    expect(isStyle(styleAt(segs, 'resource'), 'keyword')).toBe(true)
    expect(isStyle(styleAt(segs, 'variable'), 'keyword')).toBe(true)
    expect(isStyle(styleAt(segs, 'instance_type'), 'property')).toBe(true)
    expect(isStyle(styleAt(segs, 'string'), 'type')).toBe(true)
    expect(isStyle(styleAt(segs, 'null'), 'boolean')).toBe(true)
    expect(isStyle(styleAt(segs, '"t3.micro"'), 'string')).toBe(true)
    expect(isStyle(styleAt(segs, 'merge('), 'function')).toBe(true)
  })

  test('a reference inside an interpolation survives the string around it', async () => {
    const segs = await segsFor()
    expect(isStyle(styleAt(segs, 'var.prefix'), 'variable')).toBe(true)
    expect(isStyle(styleAt(segs, '${'), 'punctuation.special')).toBe(true)
    expect(isStyle(styleAt(segs, 'local.common'), 'variable')).toBe(true)
    expect(isStyle(styleAt(segs, 'var.enabled'), 'variable')).toBe(true)
  })

  test('a # that is not a comment is left alone', async () => {
    const segs = await segsFor()
    expect(isStyle(styleAt(segs, '"#ffffff"'), 'string')).toBe(true)
    expect(isStyle(styleAt(segs, '#anchor'), 'string')).toBe(true)
  })

  test('comments win the line, including one that comments out code', async () => {
    const segs = await segsFor()
    expect(isStyle(styleAt(segs, 'ami ='), 'comment')).toBe(true)
    expect(isStyle(styleAt(segs, '"abc"'), 'comment')).toBe(true)
    expect(isStyle(styleAt(segs, '// trailing'), 'comment')).toBe(true)
  })

  test('the extensions route to a filetype at all', () => {
    expect(filetypeForPath('main.tf')).toBe('terraform')
    expect(filetypeForPath('infra/prod.tfvars')).toBe('terraform')
    expect(filetypeForPath('terraform.tfvars')).toBe('terraform')
    expect(filetypeForPath('packer.hcl')).toBe('hcl')
    expect(filetypeForPath('shelf.ts')).toBe('typescript')
  })

  test('hcl paints the same, under its own name', async () => {
    const segs = await allSegments(
      '# c\njob "web" {\n  type = "service"\n}\n',
      'hcl'
    )
    const styles = styleLookup('# c\njob "web" {\n  type = "service"\n}\n')
    expect(isStyle(styles(segs, '"service"'), 'string')).toBe(true)
    expect(languageFor('hcl')).toBeDefined()
    expect(languageLabel('terraform')).toBe('tf')
  })
})
