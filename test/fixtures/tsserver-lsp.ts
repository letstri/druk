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
            executeCommandProvider: {
              commands: ['typescript.tsserverRequest'],
            },
            textDocumentSync: 1,
          },
        },
      })
    } else if (message.method === 'workspace/executeCommand') {
      const params = message.params as {
        command: string
        arguments?: unknown[]
      }
      const [command] = params.arguments ?? []
      send({
        id: message.id,
        jsonrpc: '2.0',
        result: { body: { ran: command } },
      })
    } else if (message.method === 'shutdown') {
      send({ id: message.id, jsonrpc: '2.0', result: null })
    } else if (message.method === 'exit') {
      process.exit(0)
    }
  })
)
process.stdin.on('end', () => process.exit(0))
