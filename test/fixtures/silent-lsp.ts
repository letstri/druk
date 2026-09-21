import { createDecoder, encodeMessage } from '../../src/lsp/transport'

const send = (message: object) => process.stdout.write(encodeMessage(message))

process.stdin.on(
  'data',
  createDecoder((message) => {
    if (message.method === 'initialize') {
      send({
        id: message.id,
        jsonrpc: '2.0',
        result: {
          capabilities: {
            completionProvider: {
              resolveProvider: true,
              triggerCharacters: ['.'],
            },
            textDocumentSync: 1,
          },
        },
      })
    } else if (message.method === 'textDocument/completion') {
      send({
        id: message.id,
        jsonrpc: '2.0',
        result: { isIncomplete: false, items: [] },
      })
    } else if (message.method === 'completionItem/resolve') {
      send({ id: message.id, jsonrpc: '2.0', result: message.params })
    } else if (message.method === 'shutdown') {
      send({ id: message.id, jsonrpc: '2.0', result: null })
    } else if (message.method === 'exit') {
      process.exit(0)
    }
  })
)
process.stdin.on('end', () => process.exit(0))
