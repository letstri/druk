import { createDecoder, encodeMessage } from '../../src/lsp/transport'

const send = (message: object) => process.stdout.write(encodeMessage(message))

const documents = new Map<string, string>()
const opens = new Map<string, number>()

process.stdin.on(
  'data',
  createDecoder((message) => {
    if (message.method === 'initialize') {
      send({
        id: message.id,
        jsonrpc: '2.0',
        result: {
          capabilities: {
            completionProvider: {},
            textDocumentSync: 1,
          },
        },
      })
    } else if (message.method === 'textDocument/didOpen') {
      const params = message.params as {
        textDocument: { uri: string; text: string }
      }
      const { uri } = params.textDocument
      opens.set(uri, (opens.get(uri) ?? 0) + 1)
      if (!documents.has(uri)) {
        documents.set(uri, params.textDocument.text)
      }
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
      const line =
        (documents.get(textDocument.uri) ?? '').split('\n')[position.line] ?? ''
      const head = line.slice(0, position.character)
      const word = head.slice(head.search(/[A-Za-z0-9_$]*$/u))
      send({
        id: message.id,
        jsonrpc: '2.0',
        result: {
          isIncomplete: false,
          items: [
            {
              kind: 6,
              label: `${word}Sync${opens.get(textDocument.uri) ?? 0}`,
            },
          ],
        },
      })
    } else if (message.method === 'shutdown') {
      send({ id: message.id, jsonrpc: '2.0', result: null })
    } else if (message.method === 'exit') {
      process.exit(0)
    }
  })
)
process.stdin.on('end', () => process.exit(0))
