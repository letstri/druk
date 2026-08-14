/**
 * A server that enforces the protocol's open discipline the way real servers
 * do: a didOpen for a document it already holds is refused — the text it
 * carried is dropped, as typescript-language-server drops it ("Can't open
 * already open document"). Completion answers one item made of the word at the
 * asked position *as this server sees it* plus how many didOpens arrived, so a
 * client that lost sync is visible in the frame: the word is stale and the
 * count says the document was opened twice.
 */
import { createDecoder, encodeMessage } from '../../src/lsp/transport'

const send = (message: object) => process.stdout.write(encodeMessage(message))

const documents = new Map<string, string>()
const opens = new Map<string, number>()

process.stdin.on(
  'data',
  createDecoder(message => {
    if (message.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          capabilities: {
            textDocumentSync: 1,
            completionProvider: {},
          },
        },
      })
    } else if (message.method === 'textDocument/didOpen') {
      const params = message.params as { textDocument: { uri: string; text: string } }
      const uri = params.textDocument.uri
      opens.set(uri, (opens.get(uri) ?? 0) + 1)
      if (!documents.has(uri)) documents.set(uri, params.textDocument.text)
    } else if (message.method === 'textDocument/didChange') {
      const params = message.params as {
        textDocument: { uri: string }
        contentChanges: { text: string }[]
      }
      documents.set(params.textDocument.uri, params.contentChanges[0]!.text)
    } else if (message.method === 'textDocument/completion') {
      const { textDocument, position } = message.params as {
        textDocument: { uri: string }
        position: { line: number; character: number }
      }
      const line = (documents.get(textDocument.uri) ?? '').split('\n')[position.line] ?? ''
      const head = line.slice(0, position.character)
      const word = head.slice(head.search(/[A-Za-z0-9_$]*$/))
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          isIncomplete: false,
          items: [{ label: `${word}Sync${opens.get(textDocument.uri) ?? 0}`, kind: 6 }],
        },
      })
    } else if (message.method === 'shutdown') {
      send({ jsonrpc: '2.0', id: message.id, result: null })
    } else if (message.method === 'exit') {
      process.exit(0)
    }
  }),
)
process.stdin.on('end', () => process.exit(0))
