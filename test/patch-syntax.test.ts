import { describe, expect, test } from 'bun:test'

import { DIFF_GROUPS, filetypeForPath } from '../src/languages/highlight'
import { painted } from './syntax'

const PATCH = `diff --git a/dist/dom/dom.js b/dist/dom/dom.js
index ca03177..40da2e1 100644
--- a/dist/dom/dom.js
+++ b/dist/dom/dom.js
@@ -130,6 +130,14 @@ function setProp(el, name, next, prev, isSvg) {
     return;
   }
+  if (!isSvg && name in el) {
+    el[name] = next;
   }
-  renderChildChain(parent, domParent, anchor, false);
\\ No newline at end of file
`

describe('recognising patches', () => {
  test('by extension, wherever the file sits', () => {
    expect(filetypeForPath('patches/@tanstack__redact@0.1.1.patch')).toBe(
      'diff'
    )
    expect(filetypeForPath('fix.diff')).toBe('diff')
    expect(filetypeForPath('merge.rej')).toBe('diff')
  })
})

describe('painting a patch', () => {
  test('the two sides take the colours a diff is read in', async () => {
    const group = await painted(PATCH, 'diff')

    expect(group(DIFF_GROUPS.added)).toContain('+  if (!isSvg && name in el) {')
    expect(group(DIFF_GROUPS.added)).toContain('+    el[name] = next;')
    expect(group(DIFF_GROUPS.removed)).toContain(
      '-  renderChildChain(parent, domParent, anchor, false);'
    )
  })

  test('the hunk header is neither side', async () => {
    const group = await painted(PATCH, 'diff')

    expect(group(DIFF_GROUPS.hunk)).toContain(
      '@@ -130,6 +130,14 @@ function setProp(el, name, next, prev, isSvg) {'
    )
  })

  test('the file headers stay headers, signs and all', async () => {
    const group = await painted(PATCH, 'diff')

    expect(group(DIFF_GROUPS.meta)).toContain('--- a/dist/dom/dom.js')
    expect(group(DIFF_GROUPS.meta)).toContain('+++ b/dist/dom/dom.js')
    expect(group(DIFF_GROUPS.meta)).toContain(
      'diff --git a/dist/dom/dom.js b/dist/dom/dom.js'
    )
    expect(group(DIFF_GROUPS.meta)).toContain('index ca03177..40da2e1 100644')
    expect(group(DIFF_GROUPS.meta)).toContain('\\ No newline at end of file')
    expect(group(DIFF_GROUPS.removed)).not.toContain('--- a/dist/dom/dom.js')
    expect(group(DIFF_GROUPS.added)).not.toContain('+++ b/dist/dom/dom.js')
  })

  test('context lines are left alone', async () => {
    const group = await painted(PATCH, 'diff')

    for (const marked of [
      DIFF_GROUPS.added,
      DIFF_GROUPS.removed,
      DIFF_GROUPS.meta,
    ]) {
      expect(group(marked)).not.toContain('return;')
    }
  })
})
