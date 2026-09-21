import { createDecoder, encodeMessage } from '../../src/lsp/transport'

const send = (message: object) => process.stdout.write(encodeMessage(message))

const CONFIG_REQUEST_ID = 9001

let viaRequest = false
let viaPush = false

const validated = (settings: unknown): boolean =>
  typeof settings === 'object' &&
  settings !== null &&
  (settings as { validate?: unknown }).validate === 'on'

process.stdin.on(
  'data',
  createDecoder((message) => {
    if (message.method === 'initialize') {
      send({
        id: message.id,
        jsonrpc: '2.0',
        result: {
          capabilities: {
            diagnosticProvider: {
              interFileDependencies: false,
              workspaceDiagnostics: false,
            },
            textDocumentSync: 1,
          },
        },
      })
    } else if (message.method === 'initialized') {
      send({
        id: CONFIG_REQUEST_ID,
        jsonrpc: '2.0',
        method: 'workspace/configuration',
        params: { items: [{ section: 'config-lsp' }] },
      })
    } else if (message.method === 'workspace/didChangeConfiguration') {
      viaPush = validated(
        (message.params as { settings?: unknown } | undefined)?.settings
      )
    } else if (message.method === 'textDocument/diagnostic') {
      const items = [
        ...(viaRequest ? ['configured by request'] : []),
        ...(viaPush ? ['configured by push'] : []),
      ].map((text, at) => ({
        message: text,
        range: {
          end: { character: 1, line: at },
          start: { character: 0, line: at },
        },
        severity: 2,
        source: 'config-lsp',
      }))
      send({ id: message.id, jsonrpc: '2.0', result: { items, kind: 'full' } })
    } else if (message.id === CONFIG_REQUEST_ID) {
      const result = message.result as unknown[] | undefined
      viaRequest = validated(result?.[0])
      send({
        id: CONFIG_REQUEST_ID + 1,
        jsonrpc: '2.0',
        method: 'workspace/diagnostic/refresh',
      })
    } else if (message.method === 'shutdown') {
      send({ id: message.id, jsonrpc: '2.0', result: null })
    } else if (message.method === 'exit') {
      process.exit(0)
    }
  })
)
