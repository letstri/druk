/**
 * A minimal language server for tests: speaks the stdio protocol, answers the
 * handshake, publishes one error diagnostic wherever a document says "oops",
 * answers completion with a fixed list (one item carrying an auto-import
 * style additionalTextEdit, so the whole insertion path is exercised), and
 * sends every definition query to `def.ts` in the project root.
 * Run with `bun test/fixtures/fake-lsp.ts` — the tests point `lspServers` at it.
 */
import type { CompletionItem, Diagnostic } from '../../src/lsp/protocol'
import { createDecoder, encodeMessage } from '../../src/lsp/transport'

const send = (message: object) => process.stdout.write(encodeMessage(message))

// Chatter on stderr, the way real servers do — the status page's log shows it.
process.stderr.write('fake-lsp standing by\n')

/**
 * A message no list row can hold, so the problems modal's detail block has
 * something to spell out. As wordy as a real linter's help text, which is what
 * makes a one-row list unreadable in the first place.
 */
const NAG = `this is a very wordy diagnostic help: real servers append the rule they
  applied and the fix they suggest to the sentence, which is why one row of a
  list is never enough to read one`

/**
 * One long sentence with no advice in it: `headline` has nothing to drop, so
 * this is the message only the terminal's width can shorten — the other half of
 * what earns the inline note its "there is more" hint.
 */
const NOT_FOUND = `Cannot find module '@fake/core' or its corresponding type declarations`

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
    // The signature/origin pair a modern server draws beside the label; its
    // documentation is withheld until resolve, as tsserver's is.
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
  // No additionalTextEdits here: they arrive only via completionItem/resolve,
  // the way typescript-language-server serves auto-imports.
  { label: 'drukLazy', kind: 7, detail: 'resolve-import' },
]

/**
 * Answered for a prefix of "long": every user-facing string at a hostile length,
 * so `test/long-names.test.tsx` can draw the menu at one.
 */
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

/**
 * Members answered when the position sits after a `.` — distinguishable from
 * the global list above, so a test can tell which scope the server was asked
 * about. sortText mimics tsserver's "own member" rank.
 */
const MEMBERS: CompletionItem[] = [
  { label: 'memTable', kind: 2, detail: '(n: string) => void', sortText: '11' },
  { label: 'memOther', kind: 5, detail: 'number', sortText: '11' },
]

/** Last synced text per uri, to see what character sits before a position. */
const documents = new Map<string, string>()

/** Where the definition answers point — the project root, from the handshake. */
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
      // A LocationLink rather than a Location: it is the shape linkSupport asks
      // for, and the one whose selection range the client has to prefer.
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
      // Globals answer slowly, the way a big project's server does — so a test
      // can type past the request and prove the stale reply gets dropped.
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
