(comment) @comment
(tag_name) @tag
; The argument and modifier are @attribute like the name: `:title` is a
; directive_name of one character and a directive_argument holding the word, so
; any split paints the `:` and the `title` in two colours — and `:title` beside
; a plain `class` read as two kinds of thing where VS Code reads one.
[(attribute_name) (directive_name) (directive_argument) (directive_modifier)] @attribute
[(quoted_attribute_value) (attribute_value)] @string
(interpolation) @embedded
["<" ">" "</" "/>"] @punctuation.bracket
"=" @operator

; The vue grammar stops at the block boundary: everything between <script> and
; </script> is one raw_text token. These hand those spans to another grammar —
; see `resolveInjections` in ../highlight.ts.
(script_element (raw_text) @injection.typescript)
(style_element (raw_text) @injection.css)
(interpolation (raw_text) @injection.typescript)
; A directive's value is an expression, not a string: `v-if="a > b"`,
; `:class="{ on: isOn }"`, `@click="go()"`. A plain attribute's value stays the
; string it is. The @string above still covers the whole of it, which is what
; the quotes keep, and what a value the typescript grammar makes nothing of
; falls back to.
(directive_attribute (quoted_attribute_value (attribute_value) @injection.typescript))
