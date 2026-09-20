// TypeScript has no notion of `with { type: 'file' }`, which resolves to a path string.
declare module '*.wasm' {
  const path: string
  export default path
}

declare module '*.scm' {
  const path: string
  export default path
}
