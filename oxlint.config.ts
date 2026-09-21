import { defineConfig } from 'oxlint'
import core from 'ultracite/oxlint/core'

import { ignorePatterns } from './oxc.ignore.ts'

export default defineConfig({
  extends: [core],
  ignorePatterns: [...(core.ignorePatterns || []), ...ignorePatterns],
  rules: {
    complexity: 'off',

    // Hoisted declarations: the keymap, the command tree and the controllers lean on them.
    'func-style': 'off',

    // A sequential loop over git commands or file writes is the point, not a miss.
    'no-await-in-loop': 'off',

    // A ternary inside JSX has no `if` to become; a helper per branch reads worse.
    'no-nested-ternary': 'off',

    'no-use-before-define': 'off',
    'prefer-named-capture-group': 'off',
    'typescript/no-non-null-assertion': 'off',

    // Test helpers are scoped to their `describe`; hoisting them collides the names.
    'unicorn/consistent-function-scoping': 'off',

    // Files are named for what they export: PascalCase components, camelCase modules.
    'unicorn/filename-case': 'off',

    'unicorn/import-style': 'off',
  },
})
