; Ordering matters: tree-sitter reports two captures of one node in query order, and
; equal-specificity captures are painted in that order, so the last one wins. The broad
; `(identifier) @variable` therefore has to come first — every pattern below it is a
; refinement of it.
(identifier) @variable
(shorthand_property_identifier) @variable.member
(shorthand_property_identifier_pattern) @variable.member
[(this) (super)] @variable.builtin
(required_parameter pattern: (identifier) @variable.parameter)
(optional_parameter pattern: (identifier) @variable.parameter)
(arrow_function parameter: (identifier) @variable.parameter)

["as" "async" "await" "break" "case" "catch" "class" "const" "continue" "debugger" "declare" "default" "delete" "do" "else" "enum" "export" "extends" "finally" "for" "from" "function" "get" "global" "if" "implements" "import" "in" "infer" "instanceof" "interface" "is" "keyof" "let" "module" "namespace" "new" "object" "of" "override" "private" "protected" "public" "readonly" "require" "return" "satisfies" "set" "static" "switch" "target" "throw" "try" "type" "typeof" "using" "var" "void" "while" "with" "yield"] @keyword
(comment) @comment
[(string) (template_string)] @string
; The expressions inside `${…}` are code, not string: without this a tagged template or
; a styled-component body paints as one flat run of string colour.
(template_substitution) @embedded
(escape_sequence) @escape
(regex) @string.regexp
(number) @number
[(true) (false)] @boolean
[(null) (undefined)] @constant.builtin
[(type_identifier) (predefined_type)] @type
(extends_clause value: (identifier) @type)
(rest_pattern (identifier) @variable)
(non_null_expression "!" @operator)
(optional_chain) @operator
(property_identifier) @property

; Callables. A name is far more useful painted as a function than as a variable, and
; almost every line of a component file is one of these.
(call_expression function: (identifier) @function)
(call_expression function: (member_expression property: (property_identifier) @function))
(new_expression constructor: (identifier) @constructor)
(function_declaration name: (identifier) @function)
(function_expression name: (identifier) @function)
(generator_function_declaration name: (identifier) @function)
(method_definition name: (property_identifier) @function)
(method_signature name: (property_identifier) @function)
(pair key: (property_identifier) @function value: [(function_expression) (arrow_function)])
(variable_declarator name: (identifier) @function value: [(function_expression) (arrow_function)])
(assignment_expression left: (member_expression property: (property_identifier) @function) right: [(function_expression) (arrow_function)])

; `import * as React` / `namespace Foo` — the module name is not a plain variable.
(namespace_import (identifier) @namespace)
(internal_module name: (identifier) @namespace)
(decorator "@" @attribute (identifier) @attribute)

["+" "-" "*" "/" "%" "**" "=" "+=" "-=" "*=" "/=" "%=" "**=" "==" "===" "!=" "!==" "<" "<=" ">" ">=" "&&" "||" "??" "!" "?" "&&=" "||=" "??=" "&" "|" "^" "~" "<<" ">>" ">>>" "++" "--" "=>" "..." "?." "&=" "|=" "^=" "<<=" ">>=" ">>>="] @operator
["{" "}" "(" ")" "[" "]"] @punctuation.bracket
["," ";" ":" "."] @punctuation.delimiter

; JSX. Without these every tag and attribute renders as plain text, which is most
; of what a component file looks like.
(jsx_opening_element name: (identifier) @tag)
(jsx_closing_element name: (identifier) @tag)
(jsx_self_closing_element name: (identifier) @tag)
(jsx_opening_element name: (member_expression) @tag)
(jsx_closing_element name: (member_expression) @tag)
(jsx_self_closing_element name: (member_expression) @tag)
; A dotted tag (`<Slider.Root>`) is one `member_expression`, and the broad
; `(identifier)` and `(property_identifier)` rules above capture its halves as well.
; Captures are painted innermost-last rather than by query order, so @tag over the
; whole span loses every character back to @variable and @property: each half has to
; be named itself. The three-deep form (`<A.B.C>`) is the same rule one level down.
(jsx_opening_element name: (member_expression object: (identifier) @tag property: (property_identifier) @tag))
(jsx_closing_element name: (member_expression object: (identifier) @tag property: (property_identifier) @tag))
(jsx_self_closing_element name: (member_expression object: (identifier) @tag property: (property_identifier) @tag))
(jsx_opening_element name: (member_expression object: (member_expression object: (identifier) @tag property: (property_identifier) @tag) property: (property_identifier) @tag))
(jsx_closing_element name: (member_expression object: (member_expression object: (identifier) @tag property: (property_identifier) @tag) property: (property_identifier) @tag))
(jsx_self_closing_element name: (member_expression object: (member_expression object: (identifier) @tag property: (property_identifier) @tag) property: (property_identifier) @tag))
(jsx_attribute (property_identifier) @attribute)
(jsx_namespace_name (identifier) @attribute)
; The angle brackets belong to the tag, not to the comparison operators they share a
; token with — two dots so they outrank `@operator` on the same characters.
(jsx_opening_element ["<" ">"] @tag.delimiter)
(jsx_closing_element ["</" ">"] @tag.delimiter)
(jsx_self_closing_element ["<" "/>"] @tag.delimiter)
(jsx_text) @embedded
