import type { Diagnostic } from '../../src/lsp/protocol'
import { createDecoder, encodeMessage } from '../../src/lsp/transport'

const send = (message: object) => process.stdout.write(encodeMessage(message))

const documents = new Map<string, string>()

const diagnosticsFor = (uri: string): Diagnostic[] => {
  const lines = (documents.get(uri) ?? '').split('\n')
  const found: Diagnostic[] = []
  for (let line = 0; line < lines.length; line += 1) {
    for (
      let col = lines[line]!.indexOf('oops');
      col >= 0;
      col = lines[line]!.indexOf('oops', col + 4)
    ) {
      found.push({
        message: 'pulled oops',
        range: {
          end: { character: col + 4, line },
          start: { character: col, line },
        },
        severity: 1,
        source: 'pull',
      })
    }
  }
  return found
}

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
              interFileDependencies: true,
              workspaceDiagnostics: false,
            },
            textDocumentSync: 1,
          },
        },
      })
    } else if (message.method === 'textDocument/diagnostic') {
      const params = message.params as { textDocument: { uri: string } }
      send({
        id: message.id,
        jsonrpc: '2.0',
        result: {
          items: diagnosticsFor(params.textDocument.uri),
          kind: 'full',
        },
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
    } else if (message.method === 'textDocument/didChange') {
      const params = message.params as {
        textDocument: { uri: string }
        contentChanges: { text: string }[]
      }
      documents.set(params.textDocument.uri, params.contentChanges[0]!.text)
    }
  })
)
process.stdin.on('end', () => process.exit(0))
