export const ignorePatterns = [
  '.agents/**',
  '.claude/**',
  '.github/**',
  'extensions/index.json',
  // Prose wrapped by hand; oxfmt's proseWrap would unwrap every paragraph.
  '**/*.md',
]
