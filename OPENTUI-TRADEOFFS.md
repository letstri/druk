# Custom implementations that could be replaced — and what it costs

Every place druk does for itself something OpenTUI either does differently or does
not do at all, with the native alternative that exists and the feature that is
lost by taking it.

Checked against **@opentui/core 0.4.5** (`node_modules/@opentui/core/*.d.ts` and
the shipped implementation), druk **1.29.1**, commit `303d9a5`. Re-verify against
the package on an OpenTUI bump: several entries below exist only because a setter,
an event or a style attribute is missing, and any of those may land upstream.

Nothing here is a recommendation to remove. The list is what a swap would buy and
what it would break, so the trade is made once, in the open, instead of being
rediscovered.

## A. A native path exists — replacing degrades a feature

### A1. Editor scroll past the end, and the scroll margin
- **Custom**: `ownScrolling` (`src/ui/EditorPane.tsx:190`), ~50 lines rewriting the
  textarea's protected `handleScroll` and `onResize`, plus one
  `EditorView.setScrollMargin(0)`.
- **Native**: `EditorView.setViewport` clamps to the last screenful; `handleScroll`
  stops with the last line at the bottom. There is no `scrollBeyondLastLine` option,
  and the renderable's `scrollMargin` is a constructor option with no setter — only
  `EditorView.setScrollMargin` reaches it after construction.
- **Degrades**: the `scrollPastEnd` setting goes (VS Code's default, and druk's).
  The end of a file is then only readable from the very bottom row of the terminal.
  The margin goes back to OpenTUI's 0.2 — a fifth of the pane — so the view scrolls
  four rows before the caret has reached an edge, where VS Code's
  `cursorSurroundingLines` is 0.

### A1b. Scrolling away from the caret — *not* reachable

Not a trade-off: the Zig view pins the viewport to the cursor as it draws. A
`setViewport(…, moveCursor: false)` lands (`getViewport` reports the new offset) and
is undone before the frame reaches the screen, so a wheel notch either drags the
caret along or does nothing at all. OpenTUI's own `handleScroll` passes
`moveCursor: true` for that reason and druk follows it. VS Code's behaviour — the
caret staying put while the view moves away, and the view snapping back to it on the
next keystroke — needs an upstream way to detach the two. Re-check on a bump.

### A2. Programmatic scrolling of the editor
- **Custom**: `scrollByRows` / `scrollToRow` / `scrollTo` (`src/ui/EditorPane.tsx:1416`),
  calling the protected `handleScroll` with a synthetic event.
- **Native**: `EditorView.setViewport(x, y, w, h, moveCursor)` is public.
- **Degrades**: `setViewport` bypasses the caret-follow and scroll-margin handling
  `handleScroll` performs, and bypasses A1's hook. Goto-line, go-to-definition,
  problem and conflict navigation and the diff reveal would all land the viewport
  without the caret, or with the margin left where the previous scroll set it.

### A3. Editor scrollbar and its drag
- **Custom**: `scrollMetrics` / `scrollbar()` / `dragTo` (`src/ui/EditorPane.tsx:610`,
  `:1674`) — thumb size, travel and drag mapping, plus the git and problem tracks
  drawn beside it as `<Index>` columns.
- **Native**: `ScrollBarRenderable` exists with `scrollSize` / `scrollPosition` /
  `viewportSize` and its own drag handling — but it is not an intrinsic JSX element
  in `@opentui/solid` (only `box`, `text`, `span`, `input`, `select`, `ascii_font`,
  `tab_select`, `scrollbox`, `code`, `textarea`, `markdown`), so it has to be
  mounted imperatively, and a textarea scrolls internally rather than inside a
  scrollbox.
- **Degrades**: the thumb would count visual rows while the git and problem marks
  count lines, so on a wrapped file the thumb and the marks would point at different
  places — the one thing `scrollMetrics` exists to reconcile. Past-end scrolling
  (A1) has no representation in the native bar either.

### A4. Minimum scrollbar thumb size in the sidebar
- **Custom**: `enlargeThumb` (`src/ui/list.ts:23`), patching `slider.getVirtualThumbSize`.
- **Native**: none — `SliderOptions` has no minimum-size option; the floor is one
  virtual cell, half a row.
- **Degrades**: on a few hundred entries the thumb becomes a half-block: not visible
  at a glance and not worth aiming at with the mouse.

### A5. Sidebar list windowing
- **Custom**: `createScrollList` with `OVERSCAN = 40` (`src/ui/list.ts`), building only
  a window of rows as renderables.
- **Native**: `ScrollBoxOptions.viewportCulling` skips *drawing* off-screen children.
- **Degrades**: culling still *builds* every child, and the Zig core stops handing out
  renderables a few thousand in. A directory of 8000 files renders as a blank tree.

### A6. Revealing a row the keyboard moved to
- **Custom**: `reveal` (`src/ui/list.ts:65`) — a `setTimeout(0)` then a manual
  `scrollTop` adjustment, read back afterwards.
- **Native**: `ScrollBoxRenderable.scrollChildIntoView(childId)`.
- **Degrades**: it needs a live child, and A5's window means the target row often is
  not built yet. It also scrolls immediately, and the scrollbox clamps against a
  content height layout has not recomputed — the reveal is silently clamped to 0 and
  the cursor stays off screen. Both are the exact failures the deferred version fixes.

### A7. Word and line selection by multi-click
- **Custom**: `selectOnMultiClick` (`src/ui/EditorPane.tsx:329`) and the same counting
  in `src/ui/FileTree.tsx:104`.
- **Native**: `MouseEvent` carries `type`, `button`, `x`, `y`, `modifiers`, `scroll` —
  no click count and no `dblclick` type.
- **Degrades**: double-click word select and triple-click line select go; in the tree,
  double-click to open goes.
- **Costs**: `setSelection` writes a view selection the renderer does not own, and
  OpenTUI clears only its own on a plain caret move (`updateSelectionForMovement` →
  `_ctx.clearSelection`), so `movesCaret` in `EditorPane.tsx` clears it by hand — else
  a word selected on one line is deleted by the next keystroke typed on another.

### A8. Selection confined to the editor and the diff panes
- **Custom**: `allowSelectionIn` (`src/ui/selection.ts`), ~20 lines patching the
  renderer's public `startSelection` once per renderer; the editor's buffer and each
  diff pane register, and a descendant of one counts, since the hit test answers with
  the code renderable inside a diff rather than with the pane itself.
- **Native**: `selectable` is a public property on `Renderable` and an option on
  `TextBufferOptions` — the supported way is `selectable={false}` per renderable.
- **Degrades**: nothing functionally, but the 12 lines become a prop on every chrome
  text in ~40 components, and a new component that forgets it is a silent regression
  (dragging across a tree row or a tab selects that text). This is the one entry
  where the native path is *more* code rather than less.

### A9. Fitting text to a column budget
- **Custom**: `cut` and `wrapText` (`src/ui/text.ts`, 24 lines).
- **Native**: `wrapMode="none"` clips a row; `wrapMode="word"` wraps it.
- **Degrades**: clipping loses the ellipsis, so a cut path or branch name no longer
  says it was cut. `wrapText`'s callers are modals that need the *row count* before
  laying out — a wrapping `<text>` reports nothing, so the modal cannot size itself
  and a long message pushes its buttons off the bottom.

### A10. Strikethrough for deprecated symbols
- **Custom**: `struckThroughId` (`src/languages/highlight.ts:160`) — a direct
  `resolveRenderLib().syntaxStyleRegister(...)` FFI call with `TextAttributes.STRIKETHROUGH`.
- **Native**: `SyntaxStyle.registerStyle` takes `fg`, `bg`, `bold`, `italic`,
  `underline`, `dim` — strikethrough is not expressible.
- **Degrades**: an LSP-tagged deprecated symbol would have to reuse `dim` or `italic`,
  both of which already mean something else (Unnecessary fades toward the background;
  italic is a syntax style). The alternative is drawing nothing.

### A11. Combining a tint with the syntax under it
- **Custom**: `styleIdOver` (`src/languages/highlight.ts:185`) — registers one style per
  (capture, overlay) pair on first use.
- **Native**: `SyntaxStyle.mergeStyles(...names)` merges styles — but it takes style
  *names* and returns a `MergedStyle` (fg/bg/attributes), while the buffer's highlight
  API takes a style *id* and druk holds the base as an id from the highlight pass.
- **Degrades**: without the pre-combined id the native buffer replaces the cell's style
  rather than merging, so every background-only overlay — diagnostic tints, merge
  conflict sides, diff row fills — repaints the code it covers as flat unstyled text.

### A12. Highlight columns on tab-indented lines
- **Custom**: `inCells` (`src/editor/columns.ts`, 19 lines).
- **Native**: `addHighlightByCharRange` takes character columns.
- **Degrades**: it stores the character column verbatim and drifts the same way, so a
  tab-indented file's colours slide one cell left per tab — the whole point of the
  helper. Native is a rename, not a fix.

### A13. Deleting lines
- **Custom**: `removeLines` and friends (`src/editor/lines.ts`, 64 lines).
- **Native**: `EditBufferRenderable.deleteLine()`, and a `delete-line` textarea action.
- **Degrades**: native deletes the cursor's line only. A selection touching several
  lines — the case `Ctrl+Opt+D` exists for
  ([#75](https://github.com/letstri/druk/issues/75)) — is not covered, and neither are
  move-lines, duplicate-lines or comment toggle in the same file.

### A14. Selecting a picker's whole value on open
- **Custom**: `setSelection(0, value.length)` in `onMount` (`src/ui/TextInput.tsx:22`).
- **Native**: `InputRenderable` extends `TextareaRenderable`, so `selectAll()` is there.
- **Degrades**: `selectAll` moves the cursor to derive the range and comes back empty on
  a renderable this freshly built — the search would reopen with its remembered query
  unselected, so the first keystroke appends instead of replacing.

### A15. The pickers' keyboard and rows
- **Custom**: `useListKeys` (`src/ui/list.ts:34`) plus each picker's own row rendering.
- **Native**: `<select>` (`SelectRenderable`) with options, descriptions and its own keys.
- **Degrades**: a `SelectOption` is text — the file picker's icons, the columns branch
  and workspace rows line up, the lit match letters, the per-row hover tints and the
  right-aligned metadata all go. Wrap-around ↑↓ would have to be checked against the
  native handler's own.

### A16. Layout-driven resize work
- **Custom**: `afterResize` (`src/ui/EditorPane.tsx:228`), patching protected `onResize`.
- **Native**: `useTerminalDimensions()` reports the *terminal* size;
  `LayoutEvents.RESIZED` is emitted by the root renderable only.
- **Degrades**: a pane resizes without the terminal doing so — the sidebar toggling,
  the problems track column appearing, the sidebar being dragged. Those are exactly the
  cases that leave the gutter's cached paint mapping rows to the wrong lines.

### A17. Wheel events landing on an unhit region
- **Custom**: `ignoreScrollOutsideBounds` (`src/ui/EditorPane.tsx:214`).
- **Native**: make every region hit-testable, so the renderer's fallback never fires —
  on a missed hit test it sends the scroll to the focused renderable
  (`maybeRenderable ?? fallbackTarget`, `chunk-bun-tkm837n2.js:8924`).
- **Degrades**: nothing, when it holds — but it is an invariant no type enforces: one
  gap anywhere in the layout and wheeling the file tree scrolls the editor again.

### A18. Layout-aware keyboard
- **Custom**: `useKeys` (`src/ui/useKeys.ts`) over `core/keylayout.ts`, including
  recognising explicit associated text in `key.raw` before normalising Option events.
- **Native**: `reportText` requests layout text and the parser decodes it into
  `key.sequence`, but exposes no distinction from its key-code fallback. The native
  input rejects text with Alt still set and treats a Space key as a literal space,
  even when it committed a dead key's different text.
- **Degrades**: with a Ukrainian or Russian layout up, every shortcut in druk is dead
  (Ctrl+ф does not save), Caps Lock without associated text types lowercase, and
  Option symbols and dead-key compositions can be lost or replaced by a space.

### A19. Drawing an image into cells
- **Custom**: `toCells` (`src/core/image.ts`) and the `painted` loop in
  `src/ui/ImageView.tsx` — RGBA box-averaged to one `▀` per cell, two pixel rows deep.
- **Native**: `OptimizedBuffer.drawSuperSampleBuffer(x, y, pixels, len, 'rgba8unorm',
  alignedBytesPerRow)` draws RGBA straight into the frame, and picks *quadrant* glyphs,
  so it resolves twice the horizontal detail ours does. Its pixel layout is undocumented
  and not derivable from the FFI signature: the name says WebGPU readback (256-byte row
  alignment), and a tight `width * 4` pitch drew a staircase of wrapped rows at a
  position and width neither the data nor the arguments predict, both when `len` was
  bytes and when it was pixels.
- **Degrades**: nothing, once the layout contract is known — this is the one entry
  worth retrying on a bump, since the swap deletes ~70 lines *and* sharpens the image.
  Taken blind it draws garbage over the editor slot.
- **Note**: it is the fallback path only. A terminal that answers the kitty graphics
  query gets the image itself (`src/core/kittyImage.ts`), which OpenTUI detects
  (`capabilities.kitty_graphics`) but never uses.

## B. No native path at all — removal is deleting the feature

| Custom | Feature lost |
| --- | --- |
| `src/editor/folds.ts` (242 lines) | code folding, and the blank-row gap the review card is drawn in — the edit buffer has no hidden line |
| `src/editor/typing.ts` (79) | Tab and Shift+Tab, bracket/quote pairing, indent carried to the next line — `TextareaAction` has no indent action and Tab is unbound |
| `src/editor/window.ts` (32) | highlights on wrapped files — nothing maps a visual row back to its logical line |
| `src/ui/tooltip.ts` + `tooltipLayout.ts` + `hover.ts` (454) | every tooltip, the Ctrl-peek, and every hover tint — a terminal has no hover layer |
| `src/ui/completionLayout.ts` (200) | the completion popup's size, placement and detail panel |
| `src/core/fs.ts` encoding (`decodeText`) | CRLF and BOM files open clean — the Zig core drops the `\r` and the decoder eats the BOM, so without it every such file opens dirty and a save rewrites every line |
| `DiffView` hatch (`src/ui/DiffView.tsx:105`) | the padded side of a split diff reads as blank editor — a terminal has no fill patterns |
| `DiffView` `livePane` / `isDestroyed` guards | paging between changes throws `TextBufferView is destroyed`: the ref is never called back on removal |

## C. Already taken

`followScroll` (`src/ui/list.ts`) was two copies of a patch on the scrollbox's protected
`onMouseEvent`, the second in `ChangesView`. `ScrollBoxRenderable.scrollTop` *is*
`verticalScrollBar.scrollPosition`, whose setter drives the slider, which emits
`change` — so a wheel notch, a bar drag, a key and a programmatic scroll all reach one
native listener. Replaced by `el.verticalScrollBar.on('change', …)`, no degradation, and
`ChangesView` now imports the one helper.

## Two rewrites, not removals

Neither is on this list because neither is a straight swap, but both are real:

- `TextareaRenderable.extmarks` (an `ExtmarksController`) could carry the inline
  diagnostic text and the review marks that `EditorPane` places by hand today.
- `TextareaOptions.keyBindings` maps keys to a fixed `TextareaAction` set and could take
  some of what `src/app/keyboard.ts` dispatches — but only the actions in that set, which
  excludes every druk command.
