# Architecture

druk is a Solid app rendered to the terminal by [OpenTUI](https://github.com/anomalyco/opentui).
OpenTUI supplies the hard parts — layout, the editable text buffer (undo/redo, selection,
grapheme handling), mouse hit-testing and the tree-sitter worker. This repo is the wiring
around it.

```
src/
  index.tsx          entry: argument handling, then a *dynamic* import of main.tsx
  main.tsx           load config → apply theme → render <App/>
  assets.d.ts        types for `with { type: 'file' }` imports (wasm, .scm)
build.ts             compiles a standalone binary per platform (Bun.build + Solid plugin)
extensions/             the market: one folder per extension, served raw from main  ← extensions
  index.json         generated catalog (`bun run extensions`) — what druk fetches
  <id>/extension.json   a language (grammar, patterns, server) or an appearance
                     (themes, icon themes) — one kind per extension, as data
bin/druk.js          npm launcher: runs the binary, fetching it first if it is missing
bin/binary.mjs       finds or downloads the platform binary from the GitHub release
bin/postinstall.mjs  fetches it at install time, so the first run does not have to
install              curl | bash installer, served at druk.letstri.dev/install
scripts/
  release.ts         stages the npm package + release archives from dist/
  formula.ts         Homebrew formula for the current version's archives
  app/
    App.tsx          composition root: creates the controllers, wires them, renders layout
    commands.ts      command tree  ← the feature index (F1 palette)
    actions.ts       binds the command tree's actions to the controllers
    keyboard.ts      the global keymap (chords + tree keys)
    Overlays.tsx     overlay state + the modal stack (search, pickers, palette, help…)
    context.ts       AppContext: every controller, typed, for the wiring that spans them
    workspace.ts     buffers + tabs: open/close/save, disk sync, session persistence
    navigation.ts    the visit history the back / forward arrows walk: one stop per
                     tab landed on, kept at the cursor position it was left at
    tree.ts          file-tree state: expansion, selection, marked ranges
    fileOps.ts       move/copy/delete batches and the x/c/p clipboard
    git.ts           git signals, the serialised mutation runner, refresh effects
    branches.ts      branch picker state + the switch/create/merge/rename/delete runs
    comparison.ts    branch-comparison state and its OID-keyed caches
    prompts.ts       prompt/confirm state machine (and quit, which may prompt)
    panes.ts         focus, sidebar visibility, which view it shows (files/git/extensions)
    editor.ts        one-shot signal channels into EditorPane (goto, undo, edits…)
    market.ts        the market as the editor sees it: updates, offers, installs
    extensionsPanel.ts the sidebar's extensions view: rows, cursor, fold state
    lsp.ts           language servers: spawn per language, sync buffers, diagnostics,
                     completion requests (flushing the didChange debounce first)
    settings.ts      the two config layers (user / project) resolved into one store,
                     the actions that patch and persist either, and the page's rows
    status.ts        status-bar message + the one busy/progress slot
    types.ts         shared app types (FileBuffer, Prompt, Conflict…)
  core/
    cli.ts           argv -> project directory + optional single file
    config.ts        settings in two layers: ~/.config/druk/config.json, with
                     <project>/.druk/settings.json overriding it key by key
    format.ts        format on save: extension -> user command ({} or an appended path)
    fs.ts            file listing, read/write, binary guard, directory watcher
    search.ts        in-file/project search, fuzzy matching, replace
    image.ts         PNG/JPEG decode + scaling onto half-block cells, for the viewer
    pdf.ts           embedded PDFium WASM, serialized document/page rendering, fit and pan geometry
    git.ts           queries, mutations, and async branch-comparison metadata/blob reads
    diff.ts          Myers line diff between two texts, emitted as a unified patch
    imports.ts       the path token under the cursor, and where it resolves —
                     relative, project-root, or through tsconfig/jsconfig aliases
    bulk.ts          delete/copy/move in the background, reporting progress
    process.ts       one async subprocess wrapper: timeout, bounded output, one settle
    clipboard.ts     pbcopy/wl-copy/xclip/xsel wrappers
    session.ts       per-project open tabs + expanded folders, keyed by path
    update.ts        startup npm version check (best-effort, opt-out)
    market.ts        the extension catalog: fetch, cache, validate-then-write
    upgrade.ts       `druk update`: which install is running, and how to upgrade it
    assets.ts        pins OpenTUI's asset lookup; stages the native library (side-effect import)
  languages/
    index.ts         language registry — filled by extensions, read through functions
    grammars.ts      wasm + query file imports, the form the binary can embed —
                     what a manifest's `"grammar": {"vendored": …}` names
    queries/*.scm    highlight queries for grammars we vendor
    highlight.ts     tree-sitter client → non-overlapping highlight segments
  lsp/
    protocol.ts      the slice of LSP druk speaks, hand-written (a dozen shapes)
    transport.ts     JSON-RPC stdio framing (Content-Length frames over Buffers)
    client.ts        one language server: spawn, handshake, document sync, dispose
    completion.ts    the pure half of autocomplete: normalize, fuzzy filter, snippet
                     strip, edit application
    definition.ts    the pure half of go-to-definition: any of the reply's three
                     shapes as one file position
    servers.ts       filetype → server command, all of it registered by extensions
    status.ts        the shapes the LSP status page renders (state, log, docs)
  extensions/
    index.ts         discovery: manifests → registered contributions  ← extensions
    builtin.ts       the manifests compiled into the binary (static JSON imports)
    manifest.ts      validating an extension.json into themes / icons / languages / servers
    types.ts         Extension and the problems a manifest can have
  icons/
    index.ts         file-icon themes: the tree's glyph column (unicode is the one built in)
  themes/
    index.ts         theme registry — the two built-ins, plus what extensions add
    types.ts         Theme / ThemeUi shape
    github-dark.ts   and github-light: the pair the defaults name, and the only
                     palettes in the binary — every other one is a market extension
  editor/
    vim.ts           modal editing state machine (normal / insert / visual)
    history.ts       undo/redo, coalesced per edit burst
    changes.ts       git changes per track row, for the column by the scrollbar
    problems.ts      LSP problems per track row, its own column beside that one
    window.ts        visual rows -> logical lines, for the highlight window
    columns.ts       character columns -> drawn cells, since a tab is two of them
    typing.ts        auto-closing pairs and indentation on Enter
  ui/                presentational components, no app state
    EditorPane, FileTree, GitPanel, ComparePanel, ComparisonView, CompareFilter,
    SidebarTabs, Tabs, StatusBar, CommandPalette, FilePicker,
    SearchPanel, DiffView, ImageView, PdfView, SettingsView, SettingEditor,
    SettingPicker, ExtensionsPanel, LspStatusView, UpdateBanner,
    Overlay, TextInput, PromptModal, ConfirmModal, ChoiceModal, HelpOverlay, Welcome
    modal.ts         modal geometry: width, list rows, text wrapping
    list.ts          list behaviour: windowing, panel scroll, picker keys, row colour
```

Dependency direction is one-way: `ui/` and feature folders never import from `app/`.
State lives in the `app/` controllers — factories (`createWorkspace`, `createTree`, …)
that `App.tsx` calls once, in dependency order, inside the component body, so their
signals and effects live under the app's render root. Components take props and call
callbacks. Cross-cutting wiring (the keymap, the palette actions, the modal stack)
takes the whole `AppContext` instead of a dependency list — it touches everything by
nature, and threading twenty props would say less.

## Extension points

### Add a language

A language is an extension: `extensions/<language>/extension.json`, with the server that
serves it in the same manifest, then `bun run extensions`. Nothing in `src/` lists
languages any more — the registry starts empty and `loadExtensions` fills it.

```json
{ "id": "python", "grammar": { "vendored": "python" }, "lineComment": "#" }
```

The grammar comes from one of three places:

- `{"vendored": "<key>"}` — one of the wasm/query pairs in
  [`src/languages/grammars.ts`](src/languages/grammars.ts), embedded in the binary.
  Adding a *new* vendored grammar is the one part that is still a source change:
  a query at `src/languages/queries/<id>.scm` and two static
  `with { type: 'file' }` imports, which is what `bun build --compile` can see.
  A path built at runtime resolves to nothing inside the shipped binary.
- `{"bundled": true}` — a grammar OpenTUI carries itself (javascript, typescript,
  markdown, zig): no wasm, no query.
- `{"wasm": "grammar.wasm", "query": "highlights.scm"}` — files in the extension's own
  folder, which the market fetches on install. This is how a language druk vendors
  no grammar for arrives, and the only case that puts a wasm in an extension.

A dialect close enough to an existing language reuses its grammar: `typescriptreact`
and `tsrx` both name `{"vendored": "tsx"}`.

With no usable grammar, `patterns` is the whole answer — `{group, re, flags}` with
the regex as a string, painted in order, later entries winning the characters they
overlap. yaml, sql, svelte, hcl, ini, dotenv and liquid are all patterns.

OpenTUI resolves most extensions, so a filetype it has never heard of claims its own
with `extensions`, `filenames` or `filenamePattern` — `.tf`, `bun.lock`,
`.env.local`. `filetypeForPath` asks the registry before OpenTUI for exactly this
reason: without the claim the patterns never run and the file renders plain.

The status bar shows the `id`, which is fine for almost all of them. Add a `label` only
where OpenTUI's filetype name is not what a person would call the file — `typescriptreact`
shows as `tsx`, `javascriptreact` as `jsx`.

Highlight queries are easy to get wrong in a way that fails *silently*: a query naming a
node the grammar does not have simply matches nothing, and one invalid pattern stops the
parser from loading at all. Compile a query against its grammar before trusting it, and
assert in `test/languages.test.ts` that a sample really produces highlights.

When no grammar works — tree-sitter-yaml, for one, needs an external scanner OpenTUI's
worker cannot link — declare `patterns` instead: a list of `{ group, re }` painted in
order, later entries winning the characters they overlap. Good enough for line-oriented
config formats, and it needs no wasm.

`patterns` beside a grammar means something else: an overlay for a dialect the grammar
cannot parse. `.tsrx` is tsx plus Octane's `@if`/`@for`/`@{` directives, which land in
tree-sitter `ERROR` regions — a query cannot reach inside one, so the tokens are regex-
matched instead. `outsideProse` then drops any match a comment or string capture already
covers, and *only* those: elsewhere the overlay has to win, because the grammar
mis-attributes these tokens rather than missing them (tsx reads `@catch` as a call and
captures `catch` as `function`). Ordering is load-bearing in the other direction too —
patterns without a grammar must never reach tree-sitter, which is what keeps a yaml file
from hanging the query engine.

### Add a theme

Copy an existing theme file and **use a published palette verbatim** — cite the source in
the file header, as the shipped themes do. Change the colors, and register it in `THEMES` in
[`src/themes/index.ts`](src/themes/index.ts). It appears in the command palette
automatically. `ui` covers the chrome; `syntax` maps tree-sitter capture groups to
styles, and sub-scopes fall back to their parent (`type.builtin` → `type`).

Where a published palette maps onto a capture group, follow the scheme's own highlighting
guide too — most upstreams ship one (catppuccin's style guide, everforest's `palette.md`,
solarized's vim colorscheme), and matching it is what makes the theme recognisable. Only
`currentLine` and `indentGuide` are usually absent from a palette; blend them off `bg`
yourself, within the bounds `test/unit.test.ts` and `test/indent.test.tsx` assert.

`setTheme()` **replaces** `syntaxTheme` rather than merging into it. Themes do not all
define the same capture groups, and a leftover group from the previous theme renders in
the wrong palette — near-invisible text when the switch flips light to dark. Sub-scopes
fall back to their parent anyway, so an omitted group costs nothing.

`ui` is a **Solid store**, not a plain object. Solid components never re-render, so a
mutated object would leave every color on screen stale after a theme switch — reading
`ui.bg` inside JSX is what subscribes that spot to the change. `syntaxTheme` can stay a
plain object because it is only read when the style table is rebuilt.

Indent guides ride the same pipeline: `computeHighlights` appends one `indent.guide`
capture per indent stop, so they inherit the newline-offset conversion and run-merging
that syntax highlights use.

### Add a language server

A `languageServers` entry in a market manifest: `id`, the `command` to spawn, the
`filetypes` it serves, an optional `install`, and an optional `settings`.

Two things about it are worth knowing before writing one.

**A filetype may have several servers, and all of them run.** `resolveServers`
([`lsp/servers.ts`](src/lsp/servers.ts)) returns every match in extension load
order; `clientsFor` ([`app/lsp.ts`](src/app/lsp.ts)) spawns and syncs each, and
diagnostics are kept per sender and merged, so one publish never wipes another's
marks. A linter and a language server serving the same files is the case this
exists for — `extensions/eslint` beside `extensions/typescript`, as eslint and
tsserver sit beside each other in VS Code. Feature requests are different: a
completion or a definition goes to each ready server in turn and the first real
answer wins, because load order cannot say which of them answers what.

**`settings` is the server's own configuration, passed through unvalidated.** It
is given both ways the protocol offers — answered to every `workspace/configuration`
item and pushed once as `didChangeConfiguration` after the handshake — because
servers differ in which they read. druk declares `workspace.configuration` for
this reason alone; without it a server never asks, and one whose entire behaviour
is configured does nothing at all. eslint is that server: it lints nothing until
it has been told `validate: "on"`. `workspace/diagnostic/refresh` is the other
half — a pull server that watches a config file says its answers went stale that
way, and druk re-pulls every document it holds.

### Add an extension contribution kind

An extension is a JSON manifest — `extension.json` in a folder under
`$XDG_CONFIG_HOME/druk/extensions/`, `<name>.json` for a one-file extension, and the same
two shapes under `<project>/.druk/extensions/`. It contributes themes, icon themes and
language servers, and nothing else: manifests are data, so installing one executes
nothing, and `bun build --compile` embeds only what it can see at build time — a
extension is by definition not that, which is why there is no code entry point to load.

To add a fourth kind: parse and validate it in
[`src/extensions/manifest.ts`](src/extensions/manifest.ts), put it on `Extension`
([`types.ts`](src/extensions/types.ts)), register it in `loadExtensions`
([`index.ts`](src/extensions/index.ts)), and give the registry that owns it a
`register…` / `clearExtension…` pair — the clear is what makes reload and disable work,
since a load must leave nothing behind from the load before.

Two rules the existing three follow:

- **Read every registry through a function.** `themeNames()`, `iconThemeNames()`,
  `servers()` — never a module-level constant computed from the table. Extensions are
  registered while `main()` runs, which is *after* `app/settings.ts` and
  `app/commands.ts` have been evaluated, so a `const THEME_NAMES = Object.keys(…)`
  captures the built-ins alone and an extension's theme silently never appears.
- **Load before the config is read.** `isThemeName` and `isIconThemeName` back the
  validators for `theme` and `iconTheme`, so an extension theme in the config is only a
  valid value once its extension has registered it. `main.tsx` calls `loadExtensions` first,
  and takes `disabledExtensions` from `readDisabledExtensions` — a deliberate pre-read of
  that one key, since deciding which extensions to skip cannot itself wait for a parsed
  config. Everything downstream still copes with an id going missing: `themeFor` and
  `iconFor` fall back rather than leave a hole, because an extension can be uninstalled
  while the config still names it.

### The market

`extensions/` in this repository *is* the market: one folder per extension, a generated
`extensions/index.json` beside them, served raw from `main`. A merged pull request is
installable immediately, which is the whole reason the content lives there rather
than in `src/` — druk ships two themes, one icon theme and no language servers, and
everything else it used to carry is an extension under that folder.

Five things hold it together:

- **The registry is a directory URL.** The index carries extension ids and nothing
  else fetchable; a manifest is always `<registry><id>/extension.json`. An index
  cannot aim a request at another host however it is written, and `extensionRegistry`
  is validated as https.
- **Fetch, then ask, then write.** [`core/market.ts`](src/core/market.ts) validates
  a manifest with `parseManifest` — the editor's own check — before it is written,
  and `app/market.ts` raises the confirm only once the manifest is in hand, so the
  prompt names the commands the extension will actually have druk spawn. That is the
  one part of a manifest that is not inert: installing runs nothing, but a language
  server is a program the next matching file will start.
- **Stricter at install than at load.** `loadExtensions` lets an extension keep its good
  contributions and reports the rest; `fetchExtension` refuses a manifest with *any*
  problem, because a market manifest is validated before it is merged
  (`test/extensions-repo.test.ts`) and anything wrong with one arriving over the wire
  means the registry served something other than what was reviewed.
- **Some of it ships inside the binary.** [`src/extensions/builtin.ts`](src/extensions/builtin.ts)
  imports a handful of the same manifests as JSON, so a first run highlights the
  languages most projects open with no network at all. A built-in is an ordinary
  extension otherwise — listed, disableable, and replaced outright by a copy of the
  same id on disk, which is how the market updates one. The static imports are
  load-bearing: a computed path resolves to nothing in the compiled binary, so the
  preinstalled set is spelled out rather than globbed.
- **The catalog is cached and best-effort.** `$XDG_CACHE_HOME/druk/market.json`,
  read synchronously at startup so the palette has a market before any request, and
  refreshed after six hours. Offline, the cache is the market; with neither, the
  Extensions menu says so and nothing else changes.

`bun run extensions` regenerates the index from the manifests, validating each one;
the committed index is asserted to match, so forgetting it fails `bun run check`.

### Add a setting

Add the field to `Config`, a value to `DEFAULTS`, and a validator to `VALIDATORS` in
[`src/core/config.ts`](src/core/config.ts) — the mapped type there fails to compile
until the key has one. Unknown or malformed values fall back to defaults, so a
hand-edited config can never break startup. Then add a row to `specs()` in
[`src/app/settings.ts`](src/app/settings.ts), with the `key` it edits: that key is
how the page knows the row is overridden by the project and can reset it.

### Settings in two layers

`~/.config/druk/config.json` holds every setting and is rewritten whole;
`<project>/.druk/settings.json` holds only what that project overrides, and wins.
`resolveConfig` merges them into the store the rest of the editor reads
(`settings.config`), while `settings.scope()` decides which file the page shows and
writes — `view()` is that scope's own value, `config` is what is in force. The three
settings that are also live state elsewhere (theme, transparency, vim mode) are pushed
from `patchLayer` against the effective config, so a user-scope write the project
shadows changes nothing on screen and a cleared override takes effect at once.

Object-valued settings (`formatters`, `lspServers`) override whole rather than merge
per entry: a project that sets `formatters` replaces the user's map, as VS Code does.

### Add a command

Add an action to `CommandActions` and an entry to `buildCommands` in
[`src/app/commands.ts`](src/app/commands.ts), then bind it in
[`src/app/actions.ts`](src/app/actions.ts) — the implementation itself belongs in
whichever controller owns that state (`workspace.ts`, `fileOps.ts`, `git.ts`, …).
For a keybinding, add the command to `BINDABLE` in
[`src/app/keymap.ts`](src/app/keymap.ts) with its default chords, a handler under the
same id in [`src/app/keyboard.ts`](src/app/keyboard.ts), and set the command's `hint`.

### Add a keybinding

The global keymap is data, not a chain of `if`s: `BINDABLE` in
[`src/app/keymap.ts`](src/app/keymap.ts) says which commands a key can run and what
chords each has by default, `handlers` in [`src/app/keyboard.ts`](src/app/keyboard.ts)
says what they do, and `test/keymap.test.ts` fails if either side gains an entry the
other lacks. `defaults` are the chords a menu advertises; `also` holds the spellings a
terminal needs that nobody would look for in one (`Ctrl+PgUp` for the previous tab).

The `keybindings` setting replaces a command's chords, so resolution has to settle
clashes rather than let two commands answer to one key. `resolveKeymap` gives a custom
binding precedence over any default — that is what rebinding means — and between two
custom bindings the one listed first in `BINDABLE` keeps the key. Both outcomes are
reported: the loser appears in `conflicts`, `App` warns about a rejected one on startup,
and the settings page refuses a chord another custom binding already holds instead of
quietly taking it. A value that is not a chord lands in `invalid` and the default stays,
so a hand-edited config cannot cost the editor a key.

`bindingProblem` in [`src/core/keybindings.ts`](src/core/keybindings.ts) is what keeps a
binding from breaking the editor: a chord without Ctrl (or a function key) would be
typing the textarea never sees, and the chords whose byte belongs to another key —
Ctrl+I is Tab, Ctrl+[ is Esc — are reserved outright.

Keys that belong to one pane (the tree's `a`/`r`/`d`, the source-control panel's
`c`/`p`/`b`) are not in this table: they are bare letters, so they can only be read
after the global chords have had their turn, and they stay `switch` cases in
`keyboard.ts`. Not rebindable, deliberately.

What the help overlay, peek strip and footer hints say still comes from `KEYS` in
[`src/ui/keys.ts`](src/ui/keys.ts) — a row names the commands it spells out in `ids`, and
`settings.ts` pushes the effective spellings in with `setKeyOverrides`, since nothing in
`ui/` may reach into `app/`. A row keeps its own hand-written spelling until one of its
commands is rebound; `test/keymap.test.ts` holds the two tables to each other, so a
default cannot drift from what is advertised.

Commands form a tree: an entry either runs (`run`) or opens a submenu (`children`),
never both. Group related commands under a parent to keep the root list short —
typing in the palette searches every leaf across all levels, so nesting never hides
anything. Use the `check()` marker when a submenu reflects current state (themes,
vim mode).

### Add a branch-comparison ref source

Resolve the source to a display name and commit OID before loading metadata, then pass a
`ComparisonIdentity` to `loadResolvedComparison` in
[`src/core/git.ts`](src/core/git.ts). The loader intentionally works from immutable OIDs:
letting a tag, remote-tracking branch, or other moving ref reach the diff subprocesses
would allow one comparison to mix two snapshots when the ref changes mid-load.

The current controller constrains compare to the checked-out branch and gets base choices
from `listBranches`. Add new picker choices in
[`src/app/comparison.ts`](src/app/comparison.ts), but keep ref resolution in `core/` so
the structured result remains usable without Solid or the TUI. Anything that resolves to a
commit reuses `changedFiles`, and with it every rename, binary and unusual-path case —
that shared helper is why commit detail needs no parser of its own, and why a root commit
is just a diff against the empty tree.

## Things worth knowing

- **Bun only.** OpenTUI's native core loads through Bun's FFI; Node has no FFI.
- **Highlight offsets.** `highlightOnce` returns absolute string offsets, but the edit
  buffer indexes text with newlines removed. `segmentsIn` converts between the two —
  without it, highlights drift right by one column per line above.
- **Key routing.** `useKeyboard` handlers run *before* the focused textarea, and
  `preventDefault()` hides a key from it — that is how vim normal mode captures keys. Any
  open modal sets `blocked` on the editor so it stops consuming input.
- **Global chords must claim their key.** OpenTUI's textarea has its own Ctrl bindings
  (`Ctrl+W` deletes a word, `Ctrl+F`/`Ctrl+B` move the caret, `Ctrl+←`/`→` jump a word), so
  a chord App handles without `preventDefault()` fires twice — closing a tab used to eat a
  word on the way out. The `claim()` wrapper in `src/app/keyboard.ts` exists for this.
- **`Ctrl+Shift` is not deliverable.** Outside the kitty keyboard protocol
  `Ctrl+Shift+<letter>` arrives byte-identical to `Ctrl+<letter>` with `shift: false`, so a
  shifted chord silently runs the unshifted command. Bindings accept `Ctrl+Opt` as well.
- **Esc is contested.** It leaves vim insert mode and moves focus to the tree. App's
  handler runs first and Solid applies focus synchronously, so it has to check `vimMode()`
  before surrendering the editor — otherwise the vim handler is already unfocused when it
  runs and never sees the key.
- **git paths are resolved.** `git rev-parse --show-toplevel` returns the real path
  (`/private/var/…`) while the tree holds what the user opened (`/var/…`), so status keys
  are rebased onto the caller's form before they can be looked up.
- **Gutter is imperative.** `minWidth` and `lineSigns` are constructor arguments or methods
  on `LineNumberRenderable`, not settable props, so `EditorPane` pokes them through a ref.
  Passing them as JSX props silently does nothing, and a fixed width clips line numbers
  once a file passes 99 lines.
- **Global handlers ignore preventDefault.** It stops the focused renderable, not sibling
  `useKeyboard` handlers — those must check `key.defaultPrevented` themselves.
- **Highlights are windowed.** Each `addHighlightByCharRange` is an FFI call, so pushing a
  whole 1500-line file costs ~270ms and repeats on every edit. `EditorPane` applies only
  the viewport plus `OVERSCAN` lines, re-applying when the cursor or a scroll moves the
  window. Segments carry a `line` for exactly this. `applyWindow` therefore has to run
  from the deferred cursor sync too: `↑`/`↓` fire no cursor-change event, so without it
  the window never leaves where the file opened and anything past `OVERSCAN` renders
  unstyled.
- **Highlighting is two stages, and the split is what keeps typing responsive.**
  `computeHighlights` parses (in the tree-sitter worker, off this thread) and returns a
  `Highlighted`; `segmentsIn` turns a *line range* of it into segments. Segmenting walks
  every character it is given, so doing the whole document cost more than the parse did —
  measured at 5 000 lines: 179ms parse, 152ms segmentation, and only the second number
  blocks. `EditorPane` caches the parse and segments each window once.
  `computeHighlights` also keeps the last eight parses keyed on the exact text (plus
  filetype and tab size), so switching back to a tab never repeats the worker
  round-trip — the cache is why first colour on a revisited tab is instant.
- **Everything per-document belongs on `Highlighted`, not in `segmentsIn`.** The line
  offsets, the specificity sort and the per-line capture buckets are computed once, at
  parse time, and this is not a micro-optimisation: any per-call pass over the whole
  capture list puts a floor under a *window* proportional to the whole file. Even the
  skip-scan (`h.end <= sliceStart → continue`) cost 0.4ms per line at 8 000 lines; the
  buckets took it to 0.005ms, and the earlier round of hoisting the sort had already
  turned 2.07ms into 0.155ms on a 20 000-line file — each floor paid on every scroll
  tick. `test/perf.test.tsx` guards it as a ratio against a whole-document pass, so a
  slow machine cannot make it pass by accident. Adding a per-window `.map()`,
  `.filter()` or `.sort()` over `ordered` reintroduces it.
- **Incremental parsing is not available for this.** The client does expose
  `createBuffer`/`updateBuffer`, and it is roughly twice as fast — but it reports
  highlights only for the lines the edit *touched*, not the ones it invalidates. Typing
  `/*` at the top of a 400-line file reports one row while a full parse recolours all 400,
  and there is no range-request API to fill the gap. Verified before ruling it out.
- **Async highlight staleness.** Results are only applied if the buffer text still
  matches the snapshot that was highlighted. `computeHighlights` also takes an `isStale`
  probe and answers `STALE` rather than sorting and segmenting work nobody will use.
- **Long lists must be windowed, not just culled.** The Zig core stops handing out
  renderables a few thousand in, and `viewportCulling` skips *drawing* off-screen
  children while still building them. So a `<For>` over every row is a hard failure,
  not a slow one: `FileTree` left the tree empty when a directory held 8000 entries. It
  renders a window between two spacer boxes, so the scrollbox's extent and mouse wheel
  still work. Do not "simplify" it back to rendering the whole list, and size the window
  from the terminal rather than with a constant — a fixed 200 rows left the bottom of the
  tree blank on a tall screen.
- **The editor scrollbar is ours; the sidebar's is OpenTUI's.** `FileTree` sits in a
  `<scrollbox>` with a real draggable scrollbar. The editor paints its own track, and
  dragging it cannot assign `editor.scrollY` — that is read-only at runtime, and moving
  the caret instead would retarget the cursor. The drag therefore synthesizes the one
  input the buffer accepts, a wheel event whose `delta` is in rows, aimed at
  coordinates inside the textarea so `ignoreScrollOutsideBounds` does not drop it.
- **Single-file mode is a different entry state, not a mode flag.** `druk file.ts` passes
  `openFile` to `App`, which then builds its initial state from that one file instead of
  from `loadSession` — one tab, no expanded folders, sidebar hidden — and skips
  `saveSession` entirely. Skipping the write is the part worth keeping: the folder's own
  layout is not this invocation's to overwrite with a one-tab, no-sidebar session. Nothing
  else in the app branches on it; `Ctrl+B`, the tree, search and git all work normally
  because `rootDir` is still a real directory.
- **One move function, because a folder move invalidates paths in bulk.** `movePath` in
  `src/app/fileOps.ts` backs renaming and `x`/`p` alike: it renames on disk and then
  remaps every tab, buffer, preview and expanded entry *at or under* the old path. A
  buffer left pointing at the old path saves the file back to where it used to be,
  recreating the folder that was just moved. Anything that relocates a path goes through
  here.
- **A one-column drag target needs capture on its parent.** Both draggable edges — the
  editor's scrollbar and the sidebar's divider — are one column wide, and a pointer
  leaves that within the first few rows of a vertical drag. Each event goes to whatever
  sits under the pointer, so the `onMouseDrag` handler lives on the enclosing row and a
  `dragging`/`resizing` signal, set on mouse-down over the handle, decides whether to
  act. Binding the drag to the handle itself makes the gesture die on the first stray
  pixel, which reads as a stuck scrollbar.
- **The watcher ignores `.git`, with two deliberate exceptions.** Reading git status
  rewrites `.git/index`, so a recursive watch that reacted to it would feed itself
  forever: status → index write → watcher → status. But a commit or checkout made in
  another terminal touches no working-tree file, and macOS coalesces everything under
  `.git` down to `.git/index.lock` — the very file to avoid. So `watchTree` adds separate
  watchers on `.git/HEAD` and `.git/refs`, which report a commit, checkout, reset or
  pack-refs and (verified) nothing that reading status does. The callback is told which
  kind of change a burst held, because reacting costs different amounts: re-reading
  ahead/behind is two subprocesses and only history moving can change it, so a plain save
  must not trigger it.
- **Unsupported files are refused at the door, not hidden.** `listDir` returns everything
  a directory holds, so the tree tells the truth about the filesystem; `openFile` is the
  only guard, and it opens no tab for anything `readFile` rejects. There used to be a
  `showHidden` setting and a binary tab showing a "cannot be shown" placeholder — both are
  gone, and a buffer can no longer exist for a file that is not text, which is what makes
  "never written back" structural rather than a check someone has to remember. The single
  exception to listing everything is `VCS_DIRS`: a `.git` store is not project content and
  would swamp the tree, the fuzzy picker and project search. Ordinary dotfiles are not in
  that class and stay visible by default. The opt-in `showDotfiles`/`respectGitignore`
  settings filter *tree rows only*, as a predicate `App` hands to `createTree` — the
  filter lives in `flattenVisible`, above `listDir`, so the picker, project search and
  the watcher still see every file, and an ignored directory is pruned at its top row
  (never descended into), which is why `ignoredPaths` can match git's collapsed
  `--directory` output by exact path.
- **A buffer's text is always LF and never BOM-prefixed; the file's own spelling rides
  along beside it.** `readTextFile` strips both and reports them as a `TextEncoding` on
  the `FileBuffer`, and `writeFile` puts them back. This is not tidiness: OpenTUI's edit
  buffer drops the `\r` of every CRLF break and rejoins lines with `\n`, and `TextDecoder`
  eats a leading BOM — so a raw CRLF or BOM buffer comes back from the engine different
  from what was read, and `onEditorChange`, which marks the buffer dirty on any difference,
  reads that as an edit. That was a file dirty the moment it opened and a Ctrl+S that
  rewrote every line of it (issue #38). Anything that re-reads a file has to carry the new
  encoding with the new text — `formatAfterSave` especially, since prettier writes LF and a
  buffer still claiming CRLF would convert its work straight back. `refText` normalizes for
  the same reason: the other side of a diff is a buffer, so a blob committed with CRLF
  would otherwise diff as every line changed.
- **Viewer tabs have no buffer.** `isViewerPath` branches before the `readFile` in
  `openFile`, so a PNG/JPEG or PDF gets a tab that flows through the normal
  preview/pin/session logic while `buffers` never learns about it — the no-buffer
  invariant above is how "never written back" extends to viewers. Everything that assumes
  a tab has a buffer must keep coping with one that does not: `onEditorChange` returns
  early (a phantom buffer created there would hand the viewer file to the save path), and
  `syncFromDisk` closes vanished bufferless tabs in a separate pass, since its main walk
  iterates `buffers`.
- **The viewer paints cells, not renderables.** `ImageView` and `PdfView` draw `▀` half-blocks
  (upper pixel foreground, lower background) straight into the frame from a `renderAfter`
  hook on one box. A `<text>` per cell would be cols×rows renderables — the Zig core
  stops handing them out a few thousand in, so a photo would blank the pane the way the
  unwindowed tree once did. OpenTUI detects `kitty_graphics`/`sixel` but exposes no way
  to emit them past the cell diff; when it does, that is the upgrade path.
- **The PDF viewer has one owner per App lifetime.** `App` keeps `PdfView` mounted and
  passes `null` while another kind of tab is active. The component hides its render tree,
  but that one open/close drain remains alive, so PDF → non-PDF → PDF cannot queue a new
  open from a second instance before the first instance's late document close.
- **git queries are synchronous, mutations are not.** `core/git.ts` runs `diff`,
  `status` and `rev-parse`/`rev-list` with `spawnSync` — they sit behind the gutter and
  tree marks and finish in milliseconds. Everything that writes (commit, push, stash,
  checkout, merge, branch create/rename/delete) goes through the async `mutate`, because a
  push talks to the network and would freeze the TUI for its duration. `createGitOp`
  serialises them, and anything that rewrites the working tree passes `touchesTree` so
  open buffers are pulled back from disk rather than waiting for the watcher.
- **Branch comparison is the one read-only query that runs off the render thread.** A
  branch's worth of changed files is more than a frame's worth of subprocess, so its five
  queries go through `gitAsync` rather than the synchronous `git` every other query uses.
  All of them are NUL-delimited (`-z`), because a path may contain a tab or a newline and
  the default output C-quotes it; a truncated record fails the whole read rather than
  dropping a row, which would read as "this file did not change". Blobs are fetched by
  object ID only once a row is opened. `app/comparison.ts` drops stale generations and
  caches comparisons, commits and blobs by resolved OID, so changing a ref invalidates the
  right result without making every cursor move call git.
- **Comparison means merge-base to compare tip.** The base branch tip establishes
  topology and ahead/behind counts, but the file list is
  `git diff <merge-base>..<compare>`. This excludes work introduced only on the base side
  after branches diverge. Default-base discovery follows a remote HEAD (preferring
  `origin`) and then an existing `init.defaultBranch`; it deliberately never guesses
  `main`, `master`, or the current branch.
- **git output is not capped at 1 MB.** `spawnSync` truncates there by default and
  reports ENOBUFS, which every caller in `core/git.ts` reads as "no output" — `status` in a
  repository with thousands of changed files would silently become "nothing changed" and
  the tree would show no marks. The helper raises `maxBuffer`.
- **git waits for the first frame.** Every query is a synchronous subprocess, and
  effects run inside the initial render pass, so `wireGitEffects` sits behind one
  deferred tick and `branch` starts null — `statusMap` alone can take hundreds of
  milliseconds in a large repository, all of it otherwise spent before anything is on
  screen. The marks and branch appear a beat later; nothing else changes cadence.
- **The diff page is a snapshot, and something has to refresh it.** `workspace.diffTab`
  holds one file's two texts as they read when it opened, so a commit, stash or save
  leaves it showing changes that are gone — `App` re-runs `actions.refreshDiff` on
  `git.revision()` and `editor.reloadKey()` for that reason, and closes the page once
  the path is no longer in the status map.
- **The diff is a tab, so its state lives in `workspace`, not beside the modals.**
  Two signals, not one: `diffTab` is the tab (on the strip, walked onto by Ctrl+←/→,
  closed only by `setDiff(null)`) and `diffShown` is whether it is the view on screen.
  `workspace.diff()` is the pair readers want — "what covers the editor slot". This is
  what makes `openFile` the single place the invariant holds: every way into a file
  goes through it, and it clears `diffShown` (and the settings page) without closing
  the tab. Owning it in `overlays` instead meant each caller had to remember, and the
  tree's Enter did not — a diff stayed on screen over the file just opened.
- **The source-control panel is the diff's pager, and its only entry point.** The page
  holds one file because `panes.gitCursor` says which: ↑/↓ in the panel move the cursor
  and swap the page under it, so nothing else may open a diff without moving that cursor
  first (`actions.gitDiffFile` shows the panel and selects the row). A page reached any
  other way would be one the arrows could not move from. Inside the page the arrows scroll
  and Tab toggles the layout — the panel and the page each own their arrows, so neither
  needs a chord, and that split only holds while the panel keeps the focus.
- **Branch comparison replaces the panel rather than sitting beside it.** `app/comparison.ts`
  owns its own file, commit and commit-file cursors and its caches; uppercase `B` enters it
  or picks a new base, lowercase `b` stays branch switching. Its detail page is layered over
  the editor like the working-tree diff, and Esc closes that detail before it leaves
  comparison.
- **Destroyed natives outlive the ref.** Closing the last tab swaps the textarea for the
  placeholder and destroys the native buffer while `editor` still points at it. Both
  pending timers touch it, so they are cleared from the ref's own `onCleanup` — the pane's
  `onCleanup` fires far too late and the timer throws from outside any handler.
- **Network.** druk makes two kinds of request, both at startup and both
  best-effort (2.5s timeout, failures ignored): one npm registry lookup for a newer
  druk, disabled by `checkUpdates: false`, and the extension market's `index.json`,
  disabled by `extensionUpdates: false` and cached for six hours in between. Everything
  after that is a fetch someone asked for — a manifest, because an extension is being
  installed. druk runs no git command that talks to a remote, which is also what
  keeps a credential prompt from ever opening `/dev/tty` behind the alt-screen and
  freezing the single render thread.
- **Session restore.** Tabs and their buffers are seeded synchronously in the component
  body, not in an effect — mounting the editor before its buffer exists renders an empty
  document and marks the file modified.
- **The compiled binary stages its native library, and the entry split is what makes
  that work.** dlopen cannot read the embedded filesystem, so Bun extracts the library
  to a *fresh* temp file every launch — and macOS validates the signature of a file it
  has never seen: ~250ms, against ~3ms for a known one. `core/assets.ts` therefore
  copies OpenTUI's own embedded library (found via `Bun.embeddedFiles`, keyed by its
  content-hashed name) to `~/.cache/druk/native/…` and points `OTUI_ASSET_ROOT` there;
  the first launch on a new build still takes the slow path and stages in the
  background. Two ordering rules keep it working: the staging is fully synchronous,
  and the app lives behind the dynamic import in `index.tsx` — bundled statically,
  Bun's scope hoisting runs `@opentui/core`'s top-level code *before* the entry's own
  statements, source import order notwithstanding, and the env var would be set after
  OpenTUI had already looked. `main.tsx` releases the root right after the imports:
  it holds only the library, and any later lookup under it (tree-sitter's wasm, on
  the first highlight) would throw and silently kill highlighting.

  PDFium follows the static-import rule without staging: `core/pdf.ts` imports its WASM
  with `with { type: 'file' }`, reads the embedded bytes and passes them as `wasmBinary`.
  PDFium's normal lookup for a sibling `.wasm` file cannot work inside Bun's compiled
  filesystem.
- **A Linux binary embeds two native libraries, and staging has to pick.** OpenTUI
  imports `@opentui/core-linux-<arch>` or its `-musl` sibling from a branch on
  `OPENTUI_LIBC`, and `bun install` keeps both packages on a glibc machine — only the
  musl one declares `libc` — so the bundler embeds both under content-hashed names
  that say nothing about which is which. Taking the first (druk 1.12.0) staged the
  musl library under the glibc key on every Linux install: the first launch worked,
  and every launch after it died in dlopen with `invalid ELF header`, because glibc's
  `/lib/<triple>/libc.so` is a linker script rather than an ELF. `forLibc` in
  `core/assets.ts` now reads each candidate's DT_NEEDED — `libc.so.6` for glibc,
  `libc.so` for musl — and stages nothing when that does not name exactly one. The
  cache directory is named after *every* embedded library for the same reason: the
  poisoned 1.12.0 directories can never be hit again.
- **Focused colors.** Inputs and the editor render focused, and OpenTUI then uses the
  `focused*` colors — setting only `textColor` leaves text in the renderable's default,
  which is invisible on most themes. `ui/TextInput.tsx` exists so no panel forgets.
- **A modal is a `ModalPanel`, not a hand-built box.** The scrim, the rounded border,
  the padding and the title colour are one component in `ui/Overlay.tsx`; twelve
  components used to spell them out, and the copies had begun to disagree about a
  column here and a colour there. `accent` is the only knob that changes the look, and
  it exists for the modals whose whole point is that they are not routine.
- **Subprocesses go through `core/process.ts`.** git mutations, the comparison
  queries, the user's formatter and an npm install of a language server all need a
  timeout that kills, output collected without growing without bound, a spawn failure
  reported as itself, and exactly one settle — `error` and `close` can both fire.
  Four hand-rolled copies each got one of those subtly wrong at some point.
- **Focus is synchronous.** Solid applies state during the keypress, so a key that moves
  focus into the editor also reaches the textarea unless the handler calls
  `preventDefault()`.
- **Conflicts.** Each buffer records the disk mtime it was last in sync with; saving over
  a file that changed underneath prompts instead of clobbering.
- **LSP servers are the user's, not druk's.** `src/lsp` spawns whatever
  `typescript-language-server`, `gopls`, … is on PATH (`lspServers` in the config
  overrides or disables per server; the settings page flips the same keys); a missing
  one is reported once in the status bar and that is all. Documents sync as full text —
  simple and impossible to desynchronize — and the didChange debounce in `src/app/lsp.ts`
  captures `{path, text}` inside the tracked effect run, so a tab switch during the wait
  can never re-aim an edit at the wrong document. Servers are torn down from App's
  `onCleanup` (which also covers tests) and one shared `process.on('exit')` backstop —
  shared so a dozen servers never trip Node's max-listeners warning mid-frame — and a
  server that never answers `initialize` is killed after a bounded wait instead of
  queueing notifications forever.
- **Completion is pure computation plus one popup.** `src/lsp/completion.ts` holds
  everything testable without a terminal — normalizing the wire reply, the fuzzy
  filter, snippet stripping, and edit application (the primary `textEdit` plus
  `additionalTextEdits`, applied back-to-front against the pre-edit document as the
  spec demands). `EditorPane` owns the state machine: printable keys are remembered
  and judged on the cursor-sync tick (after the buffer settled), the request flushes
  the didChange debounce first so the server answers against what is on screen, and
  a stale reply — a newer request, a changed file, a cursor that left the line — is
  dropped by generation counter. `ui/CompletionMenu.tsx` only paints. The global Esc
  handler consults `editor.completionOpen()` so dismissing the menu does not also
  move focus to the tree.
- **Navigation is two commands, and only one of them needs a server.** Go to
  definition is the language server's answer and nothing else. Open the file under
  the cursor tries the filesystem first — the token's own folder, then the project
  root, then the aliases `core/imports.ts` reads out of `tsconfig.json` /
  `jsconfig.json` — and asks the server only when none of that places the
  specifier. That order is what keeps a relative import working with LSP off,
  while `@/thing`, a bare package and an alias declared somewhere druk does not
  read still land: the server resolves those the way the project's own toolchain
  does. Both jump through `openAt` in `app/actions.ts`, which drops any page over
  the editor slot and skips the goto when the file refused to open — a goto sent
  anyway would aim at whatever is still on screen.
- **Inline problem text measures the buffer, not the string.** The message after a
  line's end (`lspInline`) is an absolutely-positioned overlay in `EditorPane`,
  placed with `lineInfo` — the line's *last* visual row and that row's used display
  columns — because wrapping makes both unknowable from the text alone. It re-reads
  on the textarea's `line-info-change`, the one event that fires after a re-wrap.
