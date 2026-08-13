/**
 * A server that handshakes, offers completion and resolve, and then answers
 * nothing to either — a linter, or Vue's server standing over a `<script>`
 * block it has no opinion about. It exists so a test can prove the *other*
 * server for a filetype is the one asked to resolve what it listed.
 */
import { createDecoder, encodeMessage } from '../../src/lsp/transport'

const send = (message: object) => process.stdout.write(encodeMessage(message))

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
            completionProvider: { triggerCharacters: ['.'], resolveProvider: true },
          },
        },
      })
    } else if (message.method === 'textDocument/completion') {
      send({ jsonrpc: '2.0', id: message.id, result: { isIncomplete: false, items: [] } })
    } else if (message.method === 'completionItem/resolve') {
      // The item back unchanged: whatever was withheld stays withheld, which is
      // exactly the failure a resolve aimed at the wrong server produces.
      send({ jsonrpc: '2.0', id: message.id, result: message.params })
    } else if (message.method === 'shutdown') {
      send({ jsonrpc: '2.0', id: message.id, result: null })
    } else if (message.method === 'exit') {
      process.exit(0)
    }
  }),
)
process.stdin.on('end', () => process.exit(0))
