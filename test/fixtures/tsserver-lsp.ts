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
            executeCommandProvider: { commands: ['typescript.tsserverRequest'] },
          },
        },
      })
    } else if (message.method === 'workspace/executeCommand') {
      const params = message.params as { command: string; arguments?: unknown[] }
      const [command] = params.arguments ?? []
      send({ jsonrpc: '2.0', id: message.id, result: { body: { ran: command } } })
    } else if (message.method === 'shutdown') {
      send({ jsonrpc: '2.0', id: message.id, result: null })
    } else if (message.method === 'exit') {
      process.exit(0)
    }
  }),
)
process.stdin.on('end', () => process.exit(0))
