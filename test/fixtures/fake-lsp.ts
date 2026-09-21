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
  for (let line = 0; line < lines.length; line += 1) {
    const long = lines[line]!.indexOf('huh')
    if (long !== -1) {
      diagnostics.push({
        code: 2307,
        message: NOT_FOUND,
        range: {
          end: { character: long + 3, line },
          start: { character: long, line },
        },
        severity: 1,
        source: 'fake',
      })
    }
    const col = lines[line]!.indexOf('oops')
    if (col !== -1) {
      diagnostics.push({
        code: 'no-oops',
        message: 'found oops',
        range: {
          end: { character: col + 4, line },
          start: { character: col, line },
        },
        severity: 1,
        source: 'fake',
      })
    }
    const stale = lines[line]!.indexOf('stale')
    if (stale !== -1) {
      diagnostics.push({
        message: "'stale' is deprecated",
        range: {
          end: { character: stale + 5, line },
          start: { character: stale, line },
        },
        severity: 4,
        source: 'fake',
        tags: [2],
      })
    }
    const sprawl = lines[line]!.indexOf('sprawl')
    if (sprawl !== -1 && line + 2 < lines.length) {
      diagnostics.push({
        message: 'this whole block is deprecated',
        range: {
          end: { character: 1, line: line + 2 },
          start: { character: sprawl, line },
        },
        severity: 4,
        source: 'fake',
        tags: [2],
      })
    }
    const wall = lines[line]!.indexOf('wall')
    if (wall !== -1) {
      diagnostics.push({
        code: 2345,
        message: WALL,
        range: {
          end: { character: wall + 4, line },
          start: { character: wall, line },
        },
        severity: 1,
        source: 'fake',
      })
    }
    const tip = lines[line]!.indexOf('tip')
    if (tip !== -1) {
      diagnostics.push({
        code: 'terse',
        message: 'short gripe help: with advice the row drops',
        range: {
          end: { character: tip + 3, line },
          start: { character: tip, line },
        },
        severity: 1,
        source: 'fake',
      })
    }
    const nag = lines[line]!.indexOf('nag')
    if (nag === -1) {
      continue
    }
    diagnostics.push({
      code: 'wordy',
      message: NAG,
      range: {
        end: { character: nag + 3, line },
        start: { character: nag, line },
      },
      severity: 2,
      source: 'fake',
    })
  }
  send({
    jsonrpc: '2.0',
    method: 'textDocument/publishDiagnostics',
    params: { diagnostics, uri },
  })
}

const COMPLETIONS: CompletionItem[] = [
  {
    detail: '() => void',
    insertText: 'drukAlpha()',
    kind: 3,
    label: 'drukAlpha',
    labelDetails: { description: 'druk/alpha', detail: '(alpha)' },
  },
  { detail: 'number', kind: 6, label: 'drukBeta' },
  {
    additionalTextEdits: [
      {
        newText: 'import { drukImported } from "druk"\n',
        range: {
          end: { character: 0, line: 0 },
          start: { character: 0, line: 0 },
        },
      },
    ],
    detail: 'auto-import',
    kind: 7,
    label: 'drukImported',
  },
  { detail: 'resolve-import', kind: 7, label: 'drukLazy' },
]

const LONG: CompletionItem[] = [
  {
    detail: `(${'argument: SomeVeryLongTypeName, '.repeat(8)}) => void`,
    documentation: `A description with no break in it: ${'unbreakableword'.repeat(20)}`,
    kind: 3,
    label: `long${'Name'.repeat(30)}`,
    labelDetails: {
      description: `some/deeply/nested/module/path/${'segment/'.repeat(12)}index`,
      detail: `(${'argument: SomeVeryLongTypeName, '.repeat(8)})`,
    },
  },
]

const MEMBERS: CompletionItem[] = [
  { detail: '(n: string) => void', kind: 2, label: 'memTable', sortText: '11' },
  { detail: 'number', kind: 5, label: 'memOther', sortText: '11' },
]

const span = (line: number) => ({
  end: { character: 4, line },
  start: { character: 0, line },
})

const hierarchyItem = (name: string, uri: string, line: number) => ({
  kind: 12,
  name,
  range: span(line),
  selectionRange: span(line),
  uri,
})

const documents = new Map<string, string>()

let rootUri = ''

process.stdin.on(
  'data',
  createDecoder((message) => {
    if (message.method === 'initialize') {
      rootUri = (message.params as { rootUri?: string }).rootUri ?? ''
      send({
        id: message.id,
        jsonrpc: '2.0',
        result: {
          capabilities: {
            callHierarchyProvider: true,
            completionProvider: {
              resolveProvider: true,
              triggerCharacters: ['.'],
            },
            definitionProvider: true,
            documentSymbolProvider: true,
            implementationProvider: true,
            referencesProvider: true,
            textDocumentSync: 1,
            typeDefinitionProvider: true,
            workspaceSymbolProvider: true,
          },
        },
      })
    } else if (message.method === 'textDocument/prepareCallHierarchy') {
      send({
        id: message.id,
        jsonrpc: '2.0',
        result: [hierarchyItem('beta', `${rootUri}/a.ts`, 0)],
      })
    } else if (message.method === 'callHierarchy/incomingCalls') {
      const { item } = message.params as { item: { name: string } }
      send({
        id: message.id,
        jsonrpc: '2.0',
        result:
          item.name === 'beta'
            ? [
                {
                  from: hierarchyItem('caller', `${rootUri}/use.ts`, 1),
                  fromRanges: [span(1)],
                },
              ]
            : [],
      })
    } else if (message.method === 'callHierarchy/outgoingCalls') {
      send({
        id: message.id,
        jsonrpc: '2.0',
        result: [
          {
            fromRanges: [span(0)],
            to: hierarchyItem('callee', `${rootUri}/def.ts`, 1),
          },
        ],
      })
    } else if (message.method === 'textDocument/definition') {
      send({
        id: message.id,
        jsonrpc: '2.0',
        result: [
          {
            targetRange: {
              end: { character: 0, line: 2 },
              start: { character: 0, line: 0 },
            },
            targetSelectionRange: {
              end: { character: 12, line: 1 },
              start: { character: 6, line: 1 },
            },
            targetUri: `${rootUri}/def.ts`,
          },
        ],
      })
    } else if (
      message.method === 'textDocument/implementation' ||
      message.method === 'textDocument/typeDefinition'
    ) {
      send({
        id: message.id,
        jsonrpc: '2.0',
        result: {
          range: {
            end: { character: 12, line: 1 },
            start: { character: 6, line: 1 },
          },
          uri: `${rootUri}/def.ts`,
        },
      })
    } else if (message.method === 'textDocument/references') {
      const at = (line: number, uri: string) => ({
        range: {
          end: { character: 4, line },
          start: { character: 0, line },
        },
        uri,
      })
      send({
        id: message.id,
        jsonrpc: '2.0',
        result: [at(0, `${rootUri}/a.ts`), at(1, `${rootUri}/use.ts`)],
      })
    } else if (message.method === 'textDocument/documentSymbol') {
      send({
        id: message.id,
        jsonrpc: '2.0',
        result: [
          {
            children: [
              {
                kind: 6,
                name: 'ring',
                range: {
                  end: { character: 3, line: 1 },
                  start: { character: 2, line: 1 },
                },
                selectionRange: {
                  end: { character: 6, line: 1 },
                  start: { character: 2, line: 1 },
                },
              },
            ],
            kind: 5,
            name: 'Bell',
            range: {
              end: { character: 1, line: 2 },
              start: { character: 0, line: 0 },
            },
            selectionRange: {
              end: { character: 10, line: 0 },
              start: { character: 6, line: 0 },
            },
          },
        ],
      })
    } else if (message.method === 'workspace/symbol') {
      const { query } = message.params as { query: string }
      send({
        id: message.id,
        jsonrpc: '2.0',
        result: [
          {
            containerName: 'def',
            kind: 12,
            location: {
              range: {
                end: { character: 12, line: 1 },
                start: { character: 6, line: 1 },
              },
              uri: `${rootUri}/def.ts`,
            },
            name: query,
          },
        ],
      })
    } else if (message.method === 'textDocument/completion') {
      const { textDocument, position } = message.params as {
        textDocument: { uri: string }
        position: { line: number; character: number }
      }
      const line =
        (documents.get(textDocument.uri) ?? '').split('\n')[position.line] ?? ''
      const wordAt = line
        .slice(0, position.character)
        .search(/[A-Za-z0-9_$]*$/u)
      const reply = (items: CompletionItem[]) =>
        send({
          id: message.id,
          jsonrpc: '2.0',
          result: { isIncomplete: false, items },
        })
      if (line[wordAt - 1] === '.') {
        reply(MEMBERS)
      } else if (line.slice(wordAt, position.character).startsWith('long')) {
        reply(LONG)
      } else {
        setTimeout(() => reply(COMPLETIONS), 400)
      }
    } else if (message.method === 'completionItem/resolve') {
      const item = message.params as CompletionItem
      const result =
        item.label === 'drukAlpha'
          ? {
              ...item,
              documentation: {
                kind: 'markdown',
                value:
                  'Alpha **greets** the caller.\n\n```ts\ndrukAlpha()\n```',
              },
            }
          : item.label === 'drukLazy'
            ? {
                ...item,
                additionalTextEdits: [
                  {
                    newText: 'import { drukLazy } from "druk"\n',
                    range: {
                      end: { character: 0, line: 0 },
                      start: { character: 0, line: 0 },
                    },
                  },
                ],
              }
            : item
      send({ id: message.id, jsonrpc: '2.0', result })
    } else if (message.method === 'shutdown') {
      send({ id: message.id, jsonrpc: '2.0', result: null })
    } else if (message.method === 'exit') {
      process.exit(0)
    } else if (message.method === 'textDocument/didOpen') {
      const params = message.params as {
        textDocument: { uri: string; text: string }
      }
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
  })
)
process.stdin.on('end', () => process.exit(0))
