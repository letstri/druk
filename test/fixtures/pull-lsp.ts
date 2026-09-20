import type { Diagnostic } from '../../src/lsp/protocol'
import { createDecoder, encodeMessage } from '../../src/lsp/transport'

const send = (message: object) => process.stdout.write(encodeMessage(message))

const documents = new Map<string, string>()

const diagnosticsFor = (uri: string): Diagnostic[] => {
  const lines = (documents.get(uri) ?? '').split('\n')
  const found: Diagnostic[] = []
  for (let line = 0; line < lines.length; line++) {
    for (
      let col = lines[line]!.indexOf('oops');
      col >= 0;
      col = lines[line]!.indexOf('oops', col + 4)
    ) {
      found.push({
        range: { start: { line, character: col }, end: { line, character: col + 4 } },
        severity: 1,
        message: 'pulled oops',
        source: 'pull',
      })
    }
  }
  return found
}

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
            diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: false },
          },
        },
      })
    } else if (message.method === 'textDocument/diagnostic') {
      const params = message.params as { textDocument: { uri: string } }
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: { kind: 'full', items: diagnosticsFor(params.textDocument.uri) },
      })
    } else if (message.method === 'shutdown') {
      send({ jsonrpc: '2.0', id: message.id, result: null })
    } else if (message.method === 'exit') {
      process.exit(0)
    } else if (message.method === 'textDocument/didOpen') {
      const params = message.params as { textDocument: { uri: string; text: string } }
      documents.set(params.textDocument.uri, params.textDocument.text)
    } else if (message.method === 'textDocument/didChange') {
      const params = message.params as {
        textDocument: { uri: string }
        contentChanges: { text: string }[]
      }
      documents.set(params.textDocument.uri, params.contentChanges[0]!.text)
    }
  }),
)
process.stdin.on('end', () => process.exit(0))
