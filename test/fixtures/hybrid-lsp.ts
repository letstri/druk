import { createDecoder, encodeMessage } from '../../src/lsp/transport'

const send = (message: object) => process.stdout.write(encodeMessage(message))

let relayed: Promise<unknown> | null = null
let land: (body: unknown) => void = () => {}

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
            completionProvider: { triggerCharacters: ['.'] },
          },
        },
      })
    } else if (message.method === 'textDocument/didOpen') {
      relayed = new Promise(resolve => {
        land = resolve
      })
      send({
        jsonrpc: '2.0',
        method: 'tsserver/request',
        params: [[1, '_vue:projectInfo', { needFileNameList: false }]],
      })
    } else if (message.method === 'tsserver/response') {
      const [[, body]] = message.params as [[number, unknown]]
      land(body)
    } else if (message.method === 'textDocument/completion') {
      const id = message.id
      void relayed?.then(body =>
        send({
          jsonrpc: '2.0',
          id,
          result: {
            isIncomplete: false,
            items: [{ label: `hybrid:${JSON.stringify(body)}`, kind: 6 }],
          },
        }),
      )
    } else if (message.method === 'shutdown') {
      send({ jsonrpc: '2.0', id: message.id, result: null })
    } else if (message.method === 'exit') {
      process.exit(0)
    }
  }),
)
process.stdin.on('end', () => process.exit(0))
