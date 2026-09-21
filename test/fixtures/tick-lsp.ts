import { createDecoder, encodeMessage } from '../../src/lsp/transport'

const send = (message: object) => process.stdout.write(encodeMessage(message))

const publish = (uri: string, text: string) => {
  const lines = text.split('\n')
  const diagnostics = []
  for (let line = 0; line < lines.length; line += 1) {
    const col = lines[line]!.indexOf('oops')
    if (col === -1) {
      continue
    }
    diagnostics.push({
      message: 'found oops',
      range: {
        end: { character: col + 4, line },
        start: { character: col, line },
      },
      severity: 1,
      source: 'tick',
    })
  }
  send({
    jsonrpc: '2.0',
    method: 'textDocument/publishDiagnostics',
    params: { diagnostics, uri },
  })
}

const documents = new Map<string, string>()

process.stdin.on(
  'data',
  createDecoder((message) => {
    if (message.method === 'initialize') {
      send({
        id: message.id,
        jsonrpc: '2.0',
        result: { capabilities: { textDocumentSync: 1 } },
      })
    } else if (message.method === 'shutdown') {
      send({ id: message.id, jsonrpc: '2.0', result: null })
    } else if (message.method === 'exit') {
      process.exit(0)
    } else if (message.method === 'textDocument/didOpen') {
      const params = message.params as {
        textDocument: { uri: string; text: string }
      }
      documents.set(params.textDocument.uri, params.textDocument.text)
      publish(params.textDocument.uri, params.textDocument.text)
    }
  })
)

let on = true
setInterval(() => {
  on = !on
  for (const [uri, text] of documents) {
    publish(uri, on ? text : '')
  }
}, 150)

process.stdin.on('end', () => process.exit(0))
