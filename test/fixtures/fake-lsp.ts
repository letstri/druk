import type { CompletionItem, Diagnostic } from '../../src/lsp/protocol'
import { createDecoder, encodeMessage } from '../../src/lsp/transport'

const send = (message: object) => process.stdout.write(encodeMessage(message))

process.stderr.write('fake-lsp standing by\n')

const NAG = `this is a very wordy diagnostic help: real servers append the rule they
  applied and the fix they suggest to the sentence, which is why one row of a
  list is never enough to read one`

const NOT_FOUND = `Cannot find module '@fake/core' or its corresponding type declarations`

const WALL = `Argument of type '{ alpha: number; beta: string; gamma: boolean; delta: number[]; epsilon: Record<string, unknown> }' is not assignable to parameter of type 'Options'. Object literal may only specify known properties, and 'epsilon' does not exist in type 'Options'. Consider changing the shape of the object, widening the parameter, or declaring the property on the interface the call site expects, which is the fix a real server spends three paragraphs suggesting to anybody who will read that far.`

const publish = (uri: string, text: string) => {
  const diagnostics: Diagnostic[] = []
  const lines = text.split('\n')
  for (let line = 0; line < lines.length; line++) {
    const long = lines[line]!.indexOf('huh')
    if (long >= 0) {
      diagnostics.push({
        range: { start: { line, character: long }, end: { line, character: long + 3 } },
        severity: 1,
        message: NOT_FOUND,
        source: 'fake',
        code: 2307,
      })
    }
    const col = lines[line]!.indexOf('oops')
    if (col >= 0) {
      diagnostics.push({
        range: { start: { line, character: col }, end: { line, character: col + 4 } },
        severity: 1,
        message: 'found oops',
        source: 'fake',
        code: 'no-oops',
      })
    }
    const stale = lines[line]!.indexOf('stale')
    if (stale >= 0) {
      diagnostics.push({
        range: { start: { line, character: stale }, end: { line, character: stale + 5 } },
        severity: 4,
        tags: [2],
        message: "'stale' is deprecated",
        source: 'fake',
      })
    }
    const sprawl = lines[line]!.indexOf('sprawl')
    if (sprawl >= 0 && line + 2 < lines.length) {
      diagnostics.push({
        range: { start: { line, character: sprawl }, end: { line: line + 2, character: 1 } },
        severity: 4,
        tags: [2],
        message: 'this whole block is deprecated',
        source: 'fake',
      })
    }
    const wall = lines[line]!.indexOf('wall')
    if (wall >= 0) {
      diagnostics.push({
        range: { start: { line, character: wall }, end: { line, character: wall + 4 } },
        severity: 1,
        message: WALL,
        source: 'fake',
        code: 2345,
      })
    }
    const tip = lines[line]!.indexOf('tip')
    if (tip >= 0) {
      diagnostics.push({
        range: { start: { line, character: tip }, end: { line, character: tip + 3 } },
        severity: 1,
        message: 'short gripe help: with advice the row drops',
        source: 'fake',
        code: 'terse',
      })
    }
    const nag = lines[line]!.indexOf('nag')
    if (nag < 0) continue
    diagnostics.push({
      range: { start: { line, character: nag }, end: { line, character: nag + 3 } },
      severity: 2,
      message: NAG,
      source: 'fake',
      code: 'wordy',
    })
  }
  send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, diagnostics } })
}

const COMPLETIONS: CompletionItem[] = [
  {
    label: 'drukAlpha',
    kind: 3,
    detail: '() => void',
    insertText: 'drukAlpha()',
    labelDetails: { detail: '(alpha)', description: 'druk/alpha' },
  },
  { label: 'drukBeta', kind: 6, detail: 'number' },
  {
    label: 'drukImported',
    kind: 7,
    detail: 'auto-import',
    additionalTextEdits: [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        newText: 'import { drukImported } from "druk"\n',
      },
    ],
  },
  { label: 'drukLazy', kind: 7, detail: 'resolve-import' },
]

const LONG: CompletionItem[] = [
  {
    label: `long${'Name'.repeat(30)}`,
    kind: 3,
    detail: `(${'argument: SomeVeryLongTypeName, '.repeat(8)}) => void`,
    labelDetails: {
      detail: `(${'argument: SomeVeryLongTypeName, '.repeat(8)})`,
      description: `some/deeply/nested/module/path/${'segment/'.repeat(12)}index`,
    },
    documentation: `A description with no break in it: ${'unbreakableword'.repeat(20)}`,
  },
]

const MEMBERS: CompletionItem[] = [
  { label: 'memTable', kind: 2, detail: '(n: string) => void', sortText: '11' },
  { label: 'memOther', kind: 5, detail: 'number', sortText: '11' },
]

const documents = new Map<string, string>()

let rootUri = ''

process.stdin.on(
  'data',
  createDecoder(message => {
    if (message.method === 'initialize') {
      rootUri = (message.params as { rootUri?: string }).rootUri ?? ''
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          capabilities: {
            textDocumentSync: 1,
            completionProvider: { triggerCharacters: ['.'], resolveProvider: true },
            definitionProvider: true,
          },
        },
      })
    } else if (message.method === 'textDocument/definition') {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: [
          {
            targetUri: `${rootUri}/def.ts`,
            targetRange: { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } },
            targetSelectionRange: {
              start: { line: 1, character: 6 },
              end: { line: 1, character: 12 },
            },
          },
        ],
      })
    } else if (message.method === 'textDocument/completion') {
      const { textDocument, position } = message.params as {
        textDocument: { uri: string }
        position: { line: number; character: number }
      }
      const line = (documents.get(textDocument.uri) ?? '').split('\n')[position.line] ?? ''
      const wordAt = line.slice(0, position.character).search(/[A-Za-z0-9_$]*$/)
      const reply = (items: CompletionItem[]) =>
        send({ jsonrpc: '2.0', id: message.id, result: { isIncomplete: false, items } })
      if (line[wordAt - 1] === '.') reply(MEMBERS)
      else if (line.slice(wordAt, position.character).startsWith('long')) reply(LONG)
      else setTimeout(() => reply(COMPLETIONS), 400)
    } else if (message.method === 'completionItem/resolve') {
      const item = message.params as CompletionItem
      const result =
        item.label === 'drukAlpha'
          ? {
              ...item,
              documentation: {
                kind: 'markdown',
                value: 'Alpha **greets** the caller.\n\n```ts\ndrukAlpha()\n```',
              },
            }
          : item.label === 'drukLazy'
            ? {
                ...item,
                additionalTextEdits: [
                  {
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                    newText: 'import { drukLazy } from "druk"\n',
                  },
                ],
              }
            : item
      send({ jsonrpc: '2.0', id: message.id, result })
    } else if (message.method === 'shutdown') {
      send({ jsonrpc: '2.0', id: message.id, result: null })
    } else if (message.method === 'exit') {
      process.exit(0)
    } else if (message.method === 'textDocument/didOpen') {
      const params = message.params as { textDocument: { uri: string; text: string } }
      documents.set(params.textDocument.uri, params.textDocument.text)
      publish(params.textDocument.uri, params.textDocument.text)
    } else if (message.method === 'textDocument/didChange') {
      const params = message.params as {
        textDocument: { uri: string }
        contentChanges: { text: string }[]
      }
      documents.set(params.textDocument.uri, params.contentChanges[0]!.text)
      publish(params.textDocument.uri, params.contentChanges[0]!.text)
    }
  }),
)
process.stdin.on('end', () => process.exit(0))
