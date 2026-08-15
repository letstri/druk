/**
 * A language server that republishes the same diagnostic on a timer, the way a
 * real one does while a project is being rebuilt around it. Run with
 * `bun test/fixtures/tick-lsp.ts`.
 */
import { createDecoder, encodeMessage } from '../../src/lsp/transport'

const send = (message: object) => process.stdout.write(encodeMessage(message))

const publish = (uri: string, text: string) => {
  const lines = text.split('\n')
  const diagnostics = []
  for (let line = 0; line < lines.length; line++) {
    const col = lines[line]!.indexOf('oops')
    if (col < 0) continue
    diagnostics.push({
      range: { start: { line, character: col }, end: { line, character: col + 4 } },
      severity: 1,
      message: 'found oops',
      source: 'tick',
    })
  }
  send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, diagnostics } })
}

const documents = new Map<string, string>()

process.stdin.on(
  'data',
  createDecoder(message => {
    if (message.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: { capabilities: { textDocumentSync: 1 } },
      })
    } else if (message.method === 'shutdown') {
      send({ jsonrpc: '2.0', id: message.id, result: null })
    } else if (message.method === 'exit') {
      process.exit(0)
    } else if (message.method === 'textDocument/didOpen') {
      const params = message.params as { textDocument: { uri: string; text: string } }
      documents.set(params.textDocument.uri, params.textDocument.text)
      publish(params.textDocument.uri, params.textDocument.text)
    }
  }),
)

let on = true
setInterval(() => {
  on = !on
  for (const [uri, text] of documents) publish(uri, on ? text : '')
}, 150)

process.stdin.on('end', () => process.exit(0))
