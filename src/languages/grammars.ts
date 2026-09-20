// Static `with { type: 'file' }` imports only: Bun embeds nothing a computed specifier hides.
import bashWasm from 'tree-sitter-wasms/out/tree-sitter-bash.wasm' with { type: 'file' }
import cWasm from 'tree-sitter-wasms/out/tree-sitter-c.wasm' with { type: 'file' }
import csharpWasm from 'tree-sitter-wasms/out/tree-sitter-c_sharp.wasm' with { type: 'file' }
import cppWasm from 'tree-sitter-wasms/out/tree-sitter-cpp.wasm' with { type: 'file' }
import cssWasm from 'tree-sitter-wasms/out/tree-sitter-css.wasm' with { type: 'file' }
import dartWasm from 'tree-sitter-wasms/out/tree-sitter-dart.wasm' with { type: 'file' }
import elixirWasm from 'tree-sitter-wasms/out/tree-sitter-elixir.wasm' with { type: 'file' }
import goWasm from 'tree-sitter-wasms/out/tree-sitter-go.wasm' with { type: 'file' }
import htmlWasm from 'tree-sitter-wasms/out/tree-sitter-html.wasm' with { type: 'file' }
import javaWasm from 'tree-sitter-wasms/out/tree-sitter-java.wasm' with { type: 'file' }
import jsonWasm from 'tree-sitter-wasms/out/tree-sitter-json.wasm' with { type: 'file' }
import kotlinWasm from 'tree-sitter-wasms/out/tree-sitter-kotlin.wasm' with { type: 'file' }
import luaWasm from 'tree-sitter-wasms/out/tree-sitter-lua.wasm' with { type: 'file' }
import phpWasm from 'tree-sitter-wasms/out/tree-sitter-php.wasm' with { type: 'file' }
import pythonWasm from 'tree-sitter-wasms/out/tree-sitter-python.wasm' with { type: 'file' }
import rubyWasm from 'tree-sitter-wasms/out/tree-sitter-ruby.wasm' with { type: 'file' }
import rustWasm from 'tree-sitter-wasms/out/tree-sitter-rust.wasm' with { type: 'file' }
import scalaWasm from 'tree-sitter-wasms/out/tree-sitter-scala.wasm' with { type: 'file' }
import solidityWasm from 'tree-sitter-wasms/out/tree-sitter-solidity.wasm' with { type: 'file' }
import swiftWasm from 'tree-sitter-wasms/out/tree-sitter-swift.wasm' with { type: 'file' }
import tomlWasm from 'tree-sitter-wasms/out/tree-sitter-toml.wasm' with { type: 'file' }
import tsxWasm from 'tree-sitter-wasms/out/tree-sitter-tsx.wasm' with { type: 'file' }
import vueWasm from 'tree-sitter-wasms/out/tree-sitter-vue.wasm' with { type: 'file' }

import bashQuery from './queries/bash.scm' with { type: 'file' }
import cQuery from './queries/c.scm' with { type: 'file' }
import csharpQuery from './queries/c_sharp.scm' with { type: 'file' }
import cppQuery from './queries/cpp.scm' with { type: 'file' }
import cssQuery from './queries/css.scm' with { type: 'file' }
import dartQuery from './queries/dart.scm' with { type: 'file' }
import elixirQuery from './queries/elixir.scm' with { type: 'file' }
import goQuery from './queries/go.scm' with { type: 'file' }
import htmlQuery from './queries/html.scm' with { type: 'file' }
import javaQuery from './queries/java.scm' with { type: 'file' }
import jsonQuery from './queries/json.scm' with { type: 'file' }
import kotlinQuery from './queries/kotlin.scm' with { type: 'file' }
import luaQuery from './queries/lua.scm' with { type: 'file' }
import phpQuery from './queries/php.scm' with { type: 'file' }
import pythonQuery from './queries/python.scm' with { type: 'file' }
import rubyQuery from './queries/ruby.scm' with { type: 'file' }
import rustQuery from './queries/rust.scm' with { type: 'file' }
import scalaQuery from './queries/scala.scm' with { type: 'file' }
import solidityQuery from './queries/solidity.scm' with { type: 'file' }
import swiftQuery from './queries/swift.scm' with { type: 'file' }
import tomlQuery from './queries/toml.scm' with { type: 'file' }
import tsxQuery from './queries/tsx.scm' with { type: 'file' }
import vueQuery from './queries/vue.scm' with { type: 'file' }

// Both absolute paths.
interface Grammar {
  wasm: string
  query: string
}

export const GRAMMARS = {
  bash: { wasm: bashWasm, query: bashQuery },
  c: { wasm: cWasm, query: cQuery },
  cpp: { wasm: cppWasm, query: cppQuery },
  csharp: { wasm: csharpWasm, query: csharpQuery },
  css: { wasm: cssWasm, query: cssQuery },
  dart: { wasm: dartWasm, query: dartQuery },
  elixir: { wasm: elixirWasm, query: elixirQuery },
  go: { wasm: goWasm, query: goQuery },
  html: { wasm: htmlWasm, query: htmlQuery },
  java: { wasm: javaWasm, query: javaQuery },
  json: { wasm: jsonWasm, query: jsonQuery },
  kotlin: { wasm: kotlinWasm, query: kotlinQuery },
  lua: { wasm: luaWasm, query: luaQuery },
  php: { wasm: phpWasm, query: phpQuery },
  python: { wasm: pythonWasm, query: pythonQuery },
  ruby: { wasm: rubyWasm, query: rubyQuery },
  rust: { wasm: rustWasm, query: rustQuery },
  scala: { wasm: scalaWasm, query: scalaQuery },
  solidity: { wasm: solidityWasm, query: solidityQuery },
  swift: { wasm: swiftWasm, query: swiftQuery },
  toml: { wasm: tomlWasm, query: tomlQuery },
  tsx: { wasm: tsxWasm, query: tsxQuery },
  vue: { wasm: vueWasm, query: vueQuery },
} satisfies Record<string, Grammar>
