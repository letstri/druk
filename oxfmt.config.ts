import { defineConfig } from 'oxfmt'
import ultracite from 'ultracite/oxfmt'

import { ignorePatterns } from './oxc.ignore.ts'

export default defineConfig({
  ...ultracite,
  ignorePatterns: [...(ultracite.ignorePatterns || []), ...ignorePatterns],
  semi: false,
  singleQuote: true,
})
