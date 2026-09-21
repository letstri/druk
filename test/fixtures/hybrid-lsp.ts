import { createDecoder, encodeMessage } from '../../src/lsp/transport'

const send = (message: object) => process.stdout.write(encodeMessage(message))

let relayed: Promise<unknown> | null = null
let land: (body: unknown) => void = () => null

process.stdin.on(
  'data',
  createDecoder((message) => {
    if (message.method === 'initialize') {
      send({
        id: message.id,
        jsonrpc: '2.0',
        result: {
          capabilities: {
            completionProvider: { triggerCharacters: ['.'] },
            textDocumentSync: 1,
          },
        },
      })
    } else if (message.method === 'textDocument/didOpen') {
      const pending = Promise.withResolvers<unknown>()
      relayed = pending.promise
      land = pending.resolve
      send({
        jsonrpc: '2.0',
        method: 'tsserver/request',
        params: [1, '_vue:projectInfo', { needFileNameList: false }],
      })
    } else if (message.method === 'tsserver/response') {
      const [, body] = message.params as [number, unknown]
      land(body)
    } else if (message.method === 'textDocument/completion') {
      const { id } = message
      void (async () => {
        const body = await relayed
        send({
          id,
          jsonrpc: '2.0',
          result: {
            isIncomplete: false,
            items: [{ kind: 6, label: `hybrid:${JSON.stringify(body)}` }],
          },
        })
      })()
    } else if (message.method === 'shutdown') {
      send({ id: message.id, jsonrpc: '2.0', result: null })
    } else if (message.method === 'exit') {
      process.exit(0)
    }
  })
)
process.stdin.on('end', () => process.exit(0))
