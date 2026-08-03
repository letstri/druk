# AGENTS.md

Instructions for AI agents working on **druk**, a terminal code editor.

`CLAUDE.md` is a symlink to this file — keep everything in here.

## What this project is

A TUI code editor built on [OpenTUI](https://github.com/anomalyco/opentui) (Solid
reconciler on a native Zig core). Shipped as a standalone binary — npm, Homebrew, a curl
installer — and run as a CLI.

Features: file tree with bulk file operations and opt-in hiding of dotfiles and
git-ignored files, a `▴` in the sidebar header that shuts every folder at once
(palette → View → Collapse folders in sidebar, which folds whichever of the two
sidebar views is up, and the button is drawn only while there is something to fold),
preview/pinned tabs, tree-sitter syntax
highlighting, search (current file and project-wide — the project scan and the fuzzy
file picker both skip git-ignored paths, whatever the tree's `respectGitignore` says, so
a build directory or an agent's worktree checkout is never a result; the panel previews
the selected hit in its file, syntax-coloured and with the hit picked out, over as many
lines either side as the terminal has room for, and folds a file behind its heading with
Tab or every file at once with Shift+Tab, which turns the results into a list of files;
palette → Find → Replace in project adds a replace field to that panel — rows preview the
hit beside its replacement, Enter applies one match, Ctrl+A applies everywhere behind a
confirm naming true counts past the 200-row display cap, open buffers take the edit
unsaved while closed files are written with their encoding kept, and the scan reads open
dirty buffers instead of their disk copies so what is listed is what is replaced),
command palette,
themes, vim mode, a caret shape (`cursorStyle` — block, line or underline, which vim mode
overrides while it is on, since there the shape is what tells normal from insert),
word wrap on by default with a toggle (`wrap`, palette → View → Toggle word wrap —
off, a long line's tail is reached by moving the cursor into it, since OpenTUI
scrolls sideways only with the caret),
git marks in tree/gutter/status bar plus a source-control panel in the sidebar
(changed files as a folder tree or a flat list — `gitPanelView` — folders folding on
→ / ←, or all of them from the header's `▴`) and palette commands for commit/undo/stash/push/fetch/pull — a push origin
rejects offers to merge origin in and push again, VS Code's prompt, rather than
naming the two commands and stopping — and for branches
(switch, create, create-from, merge, rename, delete), a diff view (inline or
side-by-side) for whichever change the panel's cursor is on — the arrows page through
them, the panel is the only way in, and the diff is a tab of its own in the strip
(`⇄ name`), so opening a file switches away from it instead of leaving it on top — a
comparison base that points marks, gutter, panel and diff at another branch instead of
HEAD (palette → Git → Compare against branch…), branch comparison against the
repository's default branch or any selected base (palette → Git → Compare branches, or
`B` in the panel) with merge-base file scoping, a commit list and lazily loaded diffs,
an image viewer (PNG/JPEG as half-block cells), a PDF viewer (page, zoom and pan controls
rendered into terminal cells), a rendered view for markdown files (`Ctrl+Opt+M`, palette → View — OpenTUI's
`<markdown>` renderable over the editor slot, per path so each tab keeps the view it
was left in, rendering the buffer rather than the file so unsaved edits show), themes that follow the OS light/dark appearance (`themeSync`, on by default, with
`themeLight` / `themeDark` picked separately and defaulting to the GitHub pair —
polled, since no OS offers a portable subscription; `DRUK_OS_APPEARANCE=dark|light`
forces the answer on a desktop none of the probes can read), themes previewed live
while the selection sits on one — in the palette's Themes submenu and in the settings
page's three theme lists — and put back when the list is left without confirming, an unpainted
background for a translucent terminal (`transparent` — editor, tab strip and
sidebar only; floating panels stay painted or the editor reads through them),
a settings page
(palette → Settings) that edits and persists every option live, with a filterable
value list per option, `/` to filter the rows themselves, and free-text fields for
the values no list holds (formatter entries, server commands, sidebar width) —
nothing requires hand-editing config.json, project-local settings in
`<project>/.druk/settings.json` that override the user's own key by key (VS Code's
arrangement: palette → "Settings: this project", or Tab on the page to swap files;
overridden rows are marked ◆ and Backspace resets one), LSP diagnostics from the user's own
language servers — a filetype may have several and every one of them is spawned,
synced and merged into one list of marks, which is how a linter (`extensions/eslint`,
`vscode-eslint-language-server`) reports beside the language server already serving
the file; a feature request goes to each in turn and keeps the first real answer,
since load order cannot say which of them answers completions —
(gutter marks, dots on a track beside the scrollbar — errors
and warnings only, left of the git track and deliberately a different glyph —
inline message text after the line, status-bar
counts, a problems list in the palette, spans given a faint severity tint — no
underline, which OpenTUI can only draw in the text's own colour — except where
the server tagged them Unnecessary, where unused code fades toward the
background instead; the
settings page toggles LSP, the inline text and each server, and edits per-server
commands; diagnostics arrive either way the protocol offers them — published, or
pulled with `textDocument/diagnostic` after every sync for the servers that
publish nothing; the project's own `node_modules/.bin` copy of a server is
preferred over anything global, and for TypeScript the project's installed
version *picks the server*: 7.x is the Go port, which ships no `tsserver.js` for
typescript-language-server to drive and speaks LSP itself, so a 7 project is
served by `tsc --lsp --stdio` and a 5/6 project by typescript-language-server; a
server that is not on PATH and has an npm package offers to install
itself — a confirm prompt, never a silent fetch, into `$XDG_DATA_HOME/druk/lsp`
rather than a global prefix, gated by `lspAutoInstall`; one that ships a
release binary instead (elixir's expert) is fetched the same way; and the
servers that come with a language toolchain print their install line instead; `typescriptTsdk`
picks which TypeScript typescript-language-server drives, empty leaving it to the
server — which prefers the open project's own copy; the servers restart on
demand, palette → Problems → Restart language servers, and by themselves once a
dependency directory settles after an install, since druk registers no watched
files and a server otherwise resolves imports against the `node_modules` it saw
at startup forever), a language-server status page (palette →
Problems → Language server status — each server's state, command and open
documents over a live log of its stderr, `window/logMessage` traffic and
lifecycle events; ↑↓ picks the server, `r` restarts them all, `d` deletes
druk's own copy of the selected one — a confirm naming the npm packages that
go with it, and refused for a server on PATH or in the project, which are not
druk's to remove — and the log survives a restart so the run before stays
readable), LSP autocomplete (a fuzzy-filtered menu that opens as you
type or on Ctrl+Space, applies auto-import edits, and is toggled by
`lspCompletion`), go to definition (F12, the server's answer in whichever of the
protocol's three shapes it comes) and open the file under the cursor
(`Ctrl+Opt+O` — the path or import specifier the cursor is in, resolved on disk
relative to the file and to the project root, then through the aliases
`tsconfig.json`/`jsconfig.json` declares, and only then handed to the language
server, which is what places a bare package or an alias druk cannot read),
a visit history — every tab the editor lands on, kept at the position it was left
at, walked with `Ctrl+Opt+Z` / `Ctrl+Opt+Y` or the ← → arrows at the left of the
tab strip, so a jump to a definition has a way back; a jump that stays inside the
open file is a stop of its own, since no tab changes to record one —
format on save through the user's own commands (`formatOnSave`
is the switch, `formatters` maps extensions to an in-place command — prettier,
eslint --fix, oxfmt, gofmt — with the saved file's path appended, or put where a
`{}` token sits, the project's own `node_modules/.bin` copy preferred over
anything global as it is for the language servers, and edited on the settings
page's Formatters row — file types and command as two fields, Tab between them —
as much as in the config file), custom shortcuts (`keybindings` maps a
command id to one chord, replacing whatever it had — the settings page's Shortcuts
row lists every bindable command with the key it answers to, refuses a chord another
custom binding holds and names whatever default a rebind takes the key from, while a
clash or a value that is not a chord is reported on startup),
file icons in the tree (`iconTheme` — `unicode` shapes any font has, or a theme a
extension contributes, `nerd-icons` in the market for a patched font; the glyph takes the expansion
arrow's column, since a folder icon has an open and a closed form, and the
default is `none` because nothing can ask a terminal what its font holds),
an extension system (JSON manifests in `$XDG_CONFIG_HOME/druk/extensions/<id>/extension.json`
— or `<id>.json` for a one-file extension — and in `<project>/.druk/extensions/` for a
project's own; a manifest contributes themes, icon themes and language servers,
and is data rather than code, so installing one runs nothing and the compiled
binary needs no loader; `disabledExtensions` shelves one without deleting it,
and a malformed manifest costs its extension that one contribution and is
reported on startup),
an extensions panel — the sidebar's third view beside Files and Git
(`Ctrl+Opt+X`, palette → Extensions → Extensions panel, or the `Ext` tab; Shift+Tab
cycles the three, and the strip falls to initials where the names do not fit):
`INSTALLED` lists every manifest, Enter turning one on or off and Backspace
uninstalling one that is not built in after a confirm that names the language
servers druk fetched for it, since those go with it and those are the megabytes; the market is **not on screen at all**
until it is searched for — not even as a folded heading, since a registry may
carry a thousand entries and none of them is what the panel is for — and a search
box drawn under the header at all times (`/`, or a click, starts typing into it)
is what raises the `AVAILABLE` section, over both sections at once, landing the
cursor on its first hit so the Enter after it installs; every extension has
*categories* — `language`, `lsp`, `theme`, `icons`, derived from what it
contributes and never declared, since a manifest carrying `themes` is a theme
extension and a field saying otherwise could only be wrong (`categoriesOf` in
`src/extensions/manifest.ts` is the one place that decides, and the catalog
carries them per row) — which the search matches beside the name and every id
and filetype a manifest registers, and which the row draws dim beside the name
wherever the sidebar has columns going spare; matches are capped at
fifty with a `+N more matches` row saying what was left out; `u` updates
everything and `r` re-reads the manifests. Only the two that are
settings — the startup check and the registry URL — are on the settings page,
an extension market — `extensions/` **in this repository**, one folder per extension, served
raw from `main`, so a merged pull request is installable without a druk release;
the panel's `AVAILABLE` section installs one after a confirm that names the
commands it would have druk spawn, an installed extension with a newer version in the
catalog is reported in the status bar at startup, a file whose language no
installed extension serves offers the extension that does, and a config naming a theme
nothing registers is offered its extension back (`extensionUpdates` turns the whole of
that off, `extensionRegistry` points it at a fork),
file watching with conflict prompts,
per-project session restore, and a startup update check.

**Everything extensible is an extension now, and most of them live in `extensions/`.**
An extension is one of two kinds and never both: a *language* extension (the grammar,
highlight query, patterns, line comment and label for one language, plus the
server that serves it) or an *appearance* extension (themes and icon themes).

What is compiled in: two themes (`dark` / `light`, the GitHub pair the defaults
name), the `unicode` icon theme, every tree-sitter grammar wasm — and a
*preinstalled* set of extension manifests, listed in `src/extensions/builtin.ts`:
typescript (ts/tsx/js/jsx), json, markdown, html, css, yaml and toml. Those are
the languages a first run has to highlight with no network.

Everything else — Go, Rust, Python, the other twenty-odd languages with their
servers, every palette beyond the GitHub pair, the Nerd Font icons — is a market
extension, and installing one fetches a single small JSON. The *grammar bytes* are
embedded either way, so a market language extension says
`"grammar": { "vendored": "go" }` and needs no download; a language druk vendors
no grammar for ships its own `.wasm` as an asset in the extension folder.

Adding a language, a server or a theme is therefore a JSON file and a
`bun run extensions`, not a source change.

## Runtime and tooling

- **Bun is required to develop** — OpenTUI's native core loads through Bun's FFI. Node
  cannot start the app from source (its `node:ffi` is not in any shipping release), so
  never "fix" a Bun dependency by switching the runtime. Users need nothing installed:
  `bun build --compile` bakes the Bun runtime, the native library and every grammar into
  one executable.
- **bun manages dependencies and scripts.** Do not use npm or pnpm for installs — the
  lockfile is `bun.lock`.
- **Say `bun run <script>`, not `bun <script>`.** `build` collides with Bun's own bundler
  subcommand, so `bun build` silently bundles nothing instead of running the script. This
  now includes `test`: bare `bun test` runs the whole suite in one process, where the
  files interfere — ~140 tests fail on leaked stdin/signal state that separate processes
  would isolate (`--isolate`'s fresh global is not enough). `bun run test` goes through
  `scripts/test.ts`, which runs each file in its own process, sequentially. Not
  `--parallel`: its concurrent workers can busy-spin at 100% CPU forever on macOS ARM
  (oven-sh/bun#27766, still present in 1.3.14) — the spin is synchronous, so bun's own
  per-test timeout never fires and only SIGKILL ends the worker. One bun process at a
  time has never triggered it; the script's per-file cap is a backstop.

```bash
bun install
bun run start            # run from source, opens the current directory
bun run start ./some/dir # run from source against a directory
bun run build            # compile a binary for this machine into dist/<target>/
./dist/*/druk .          # run what you just built (bin/druk.js finds it too)
bun run build linux-x64  # …or for a named target, if its native package is installed
bun run release          # package dist/ for npm + release archives (--publish to ship)
bun run formula          # Homebrew formula for those archives, into dist/release/druk.rb
bun run extensions          # regenerate extensions/index.json — the market's catalog
bun run test             # unit + UI, one file per process, sequential (~4 min)
bun test test/foo.tsx    # a single file, where the flag buys nothing
bun run check            # check-types + lint + format + test — the one to run
```

**Verify with `bun run check`, not its parts.** It is `check-types`, `lint`, `format` and
`test` in one, so running them separately only costs turns and invites a change called
done on three of the four. A single test file (`bun test test/foo.tsx`) while iterating is
fine — `bun run check` is still what says the change is finished.

Each file runs in its own process, so nothing may depend on state shared between files.
`test/setup.ts` is preloaded to give every process its own `XDG_CONFIG_HOME`; without it
the suite writes to your real `~/.config/druk`.

## Shipping

`bun run build` produces one executable; `bun run release` turns the executables in
`dist/` into an npm package and release archives carrying each binary and its third-party
notices. Six things about that are easy to break:

- **Assets must be static `with { type: 'file' }` imports.** Bun embeds only what it can
  see at build time, so a computed specifier or an `import.meta.resolve` call leaves the
  binary without that file. Every grammar and query goes through
  `src/languages/grammars.ts` for this reason. PDFium's WASM is likewise imported with
  `with { type: 'file' }` in `src/core/pdf.ts` and passed as `wasmBinary`, because its
  implicit sibling lookup cannot work inside Bun's compiled filesystem.
- **`index.tsx` must keep the app behind its dynamic import.** `core/assets.ts` stages
  the native library to a per-build cache and points `OTUI_ASSET_ROOT` at it — worth
  ~250ms of startup on macOS, which otherwise re-validates a freshly extracted dylib on
  every launch. Bundled statically, Bun's scope hoisting runs `@opentui/core`'s
  top-level code before the entry's own statements, so the env var would be set too
  late; the dynamic import in `index.tsx` is what forces the order (and is also why
  `druk --version` answers in milliseconds). Details in ARCHITECTURE.md.
- **The binary must not autoload `bunfig.toml`.** druk is opened inside other people's
  projects, and a standalone Bun binary otherwise reads the `bunfig.toml` it finds there —
  whose `preload` fails to resolve and kills startup. `build.ts` turns that off.
- **Cross-compiling needs the target's `@opentui/core-<platform>` package**, and
  `bun install` fetches the host's alone. That is why the release workflow uses one native
  runner per platform instead of five `--target` flags on one machine.
- **The GitHub release is uploaded before npm.** One package is published, `druk`, and it
  holds no binary: `bin/binary.mjs` fetches the archive for the machine from the release.
  Publishing npm first would leave a window where an install finds no asset.
- **There is deliberately no package per platform.** That is the usual arrangement, and
  it is what druk used to do, but creating a package needs a credential that can create
  packages — while the release authenticates as GitHub through OIDC and may only publish
  to `druk` itself. One package is what makes the release run unattended.

The repo's own `package.json` is `private`: what npm publishes is staged into
`dist/npm/druk` by `scripts/release.ts` — the shim, the postinstall, the README, the
LICENSE and the third-party notices, and nothing else.
Versions come from `package.json` — bump it and `.github/workflows/release.yml` builds
every platform, uploads the archives to the release and publishes to npm, with no manual
step. Two ways to start it: push a tag `v<version>`, or run the workflow from the Actions
tab, which tags the commit it runs on for you.

**`package.json` is the version, not the ref.** The published shim fetches its binaries
from `releases/download/v<version>`, so the release must carry exactly that tag — the
workflow reads the version once in `check` and every later step uses it. A tag push whose
name disagrees with `package.json` fails there, before five runners have built.

**The tag is pushed with git, not created by `gh`.** GITHUB_TOKEN may create a release
for a tag that exists, but `gh release create --target <sha>`, which has to create the
tag as well, comes back `403 Resource not accessible by integration` — with
`contents: write` granted and no ruleset in the way. Pushing the tag over the checkout's
credentials first is ordinary `contents: write` and works, so a manual run tags the
commit in its own step and `gh` only ever sees a tag that is already there.

**Every run ships, and both publishing steps go together.** There is no dry run: neither
step may be made conditional on its own, because druk 1.0.0 reached npm from a run whose
release upload was skipped, and the published shim spent its life fetching a release that
did not exist. Re-running a shipped version is safe — `release.ts` skips a version already
on the registry and the upload clobbers its assets.

**Homebrew needs the one credential the rest of the release does without.** The workflow
runs `bun run formula` after packaging, so `druk.rb` — checksummed against the archives
actually uploaded — is an asset of every release, and the `tap` job copies that asset to
`letstri/homebrew-tap` as `Formula/druk.rb`. That copy is the exception to publishing
unattended: GITHUB_TOKEN is scoped to this repository, and no OIDC arrangement exists for
pushing to another one, so it reads `TAP_TOKEN` — a fine-grained PAT with contents:write
on the tap and nothing else.

Both the tap and the secret exist, and 1.12.0 was the first release to reach them. A run
without `TAP_TOKEN` skips the `tap` job and says so in the annotations rather than failing
— which is what forks get, and is safe here in a way it is not for the two steps above:
nothing downstream reads the tap, so a formula left unupdated puts brew a version behind
rather than breaking an install. The formula is on the release either way, though it has
to be copied into a tap to be usable — Homebrew refuses a formula that is not in one, so a
downloaded `druk.rb` cannot be installed on its own.

**The generated formula must keep its `version` stanza.** It reads as redundant beside a
URL carrying the tag, and `brew audit` does warn about a redundant one — but not here.
Homebrew scans the version out of the archive's *stem*: its `foobar4.5.1` parser matches
trailing digits, and `druk-darwin-arm64` ends in `64`. Drop the stanza and every release
alike reports `stable 64`, so `brew upgrade letstri/tap/druk` — what `core/upgrade.ts`
tells brew users to run — never sees a new version.

**The formula ships bottles, and has to.** `bun run formula` also tars each binary as a
keg — `druk/<version>/bin/druk` — into `dist/release/druk-<version>.<tag>.bottle.tar.gz`,
and the `bottle do` block it writes points `root_url` at the same release. Without them a
`brew install` is a *source build* as far as Homebrew is concerned, whatever the formula's
`install` actually does: `FormulaInstaller#install` runs `perform_build_from_source_checks`
before it looks at what will be installed, which is fatal on a machine whose Xcode is older
than the running macOS asks for — a macOS beta rejecting the current release Xcode, which
is [#40](https://github.com/letstri/druk/issues/40) — and raises `UnbottledError` where no
developer tools are installed at all. Two details are load-bearing: the file names, because
brew derives a bottle's URL from a non-GitHub-Packages `root_url` as
`<name>-<version>.<tag>.bottle.tar.gz` (one dash, where `brew bottle` itself writes two);
and the tags, which name the *oldest* system a binary runs on rather than the one it was
built on — brew pours the newest bottle at or below the running macOS, so `arm64_ventura`
and `ventura` cover every later release, including ones a given druk predates.

## Architecture

Read [ARCHITECTURE.md](ARCHITECTURE.md) first. It has the folder map, the one-way
dependency rule, and recipes for the extension points:

| Want to add a… | Edit |
| --- | --- |
| language | a `languages` entry in a market manifest — `extensions/<language>/extension.json`, then `bun run extensions`. `grammar` is `{"vendored": "<key in src/languages/grammars.ts>"}` for one druk embeds, `{"bundled": true}` for one OpenTUI carries, or `{"wasm": "…", "query": "…"}` for files in the extension folder. `patterns` are `{group, re, flags}` (regex as a string) for a format with no usable grammar; `extensions` / `filenames` / `filenamePattern` claim the names OpenTUI resolves none of. Adding a *vendored* grammar is still a source change: two static imports in `src/languages/grammars.ts` |
| language server | a `languageServers` entry in a market manifest — `extensions/<language>/extension.json`, then `bun run extensions`. `install` is `{"kind": "npm", "packages": […]}` or `{"kind": "download", "urls": {"<platform>-<arch>": "…"}}` when druk can fetch it itself, and `{"kind": "manual", "command": "…"}` for a line to print — a `download` carries a `command` too, for the machines the release has no build for; `settings` is the server's own configuration object, passed through unvalidated (it is the *server's* shape, not druk's) and given to it both ways the protocol offers — answered to every `workspace/configuration` item and pushed once as `didChangeConfiguration`. Several servers may claim one filetype and all of them are spawned; users override per-server with the `lspServers` setting, which can only *replace* a command some extension declared (an empty one disables that server alone). A server whose command depends on what the project installed goes in `projectCommand` (`src/lsp/project.ts`) instead, which every server consults first — that part is code, and stays in `src/` |
| PDF viewer | rendering in `src/core/pdf.ts`, UI in `src/ui/PdfView.tsx`, and bufferless routing in `src/app/workspace.ts` |
| theme | a `themes` entry in a market manifest — `extensions/<family>/extension.json`, one extension per palette family (catppuccin carries its four flavors), then `bun run extensions`. Only `dark` and `light` are built in, in `src/themes/`, because the defaults name them. Chrome roles that are a *relationship* between two colours (`border`, `sidebarBg`, `solidBg`) are derived in `colorsFor` there and are never listed by a theme |
| icon theme | an `icons` entry in a market manifest — one codepoint per glyph, since the tree gives it the arrow's single column, and a two-cell glyph is dropped rather than drawn. `unicode` alone is built in (`src/icons/index.ts`), being the set any font already has |
| extension contribution kind | a list on the manifest (`src/extensions/manifest.ts`) parsed into `Extension` (`src/extensions/types.ts`), registered in `loadExtensions` (`src/extensions/index.ts`), and a `register…`/`clearExtension…` pair on whichever registry owns it — the registry has to be read through a function everywhere, since extensions load after the modules that list its contents are evaluated |
| previewable value | `preview` + `restore` on the palette `Command` (`src/app/commands.ts`) or on a row's `select` (`src/ui/SettingsView.tsx`) — `preview` paints while the selection sits on the value, `restore` runs when the list is torn down, so it must put back what the config says rather than remember what it replaced |
| setting | `src/core/config.ts` (`Config`, `DEFAULTS`, `VALIDATORS` — one validator per key, since the project file is read key by key) + a row in `src/app/settings.ts` (`specs`, with the `key` it edits) so the settings page shows it — the page windows its rows to the terminal height, so a test that asserts on a late row needs a tall terminal or arrow keys to reach it |
| command | `src/app/commands.ts` + bind it in `src/app/actions.ts`; the implementation goes in the controller that owns the state (`workspace.ts`, `fileOps.ts`, `git.ts`, …) |
| keybinding | a row in `BINDABLE` (`src/app/keymap.ts`) plus a handler under the same id in `src/app/keyboard.ts` — or, for an editor-only key, `src/ui/EditorPane.tsx` — advertised in `src/ui/keys.ts` (feeds the footer hints, help overlay, Ctrl+K peek and the welcome screen), with the row's `ids` naming the commands it spells out |
| git error message | a row in `KNOWN` in `src/core/git.ts`, with the git output it matches pinned in `test/git.test.tsx` |
| market extension | a folder under `extensions/` holding `extension.json`, then `bun run extensions` to regenerate `extensions/index.json` — `test/extensions-repo.test.ts` fails when the committed index is stale, and bumping the manifest `version` is what makes installed copies see an update |
| row in the extensions panel | `src/app/extensionsPanel.ts` (the row model, the cursor, the fold state and what Enter does); `src/ui/ExtensionsPanel.tsx` draws whatever `rows()` returns and reports clicks, and the keys live in `src/app/keyboard.ts` beside the tree's and the git panel's |
| sidebar view | `SidebarView` in `src/ui/SidebarTabs.tsx` (add a `short` initial — the strip falls back to those in a narrow sidebar), a branch in `App.tsx`'s sidebar, one in `keyboard.ts`'s pane switch, a `KeyScope` in `src/ui/keys.ts` with a `SCOPE_LABELS` entry in `KeyPeek.tsx`, and a `toggle…View` on `src/app/panes.ts` |
| branch-comparison behaviour | git queries and models in `src/core/git.ts`, state and caches in `src/app/comparison.ts`, rows in `ComparePanel` and the detail page in `ComparisonView` |

Key handlers subscribe through `useKeys` (`src/ui/useKeys.ts`), never OpenTUI's
`useKeyboard` directly: it renames a Ctrl chord to the US key the character sits on, so
a shortcut still fires with a Cyrillic layout up (`src/core/keylayout.ts`).

`src/app/commands.ts` is the feature index — read it to learn what the editor can do.

`ui/` and the feature folders (`core/`, `languages/`, `themes/`, `editor/`, `lsp/`) must never
import from `app/`. State lives in the `app/` controller modules (`createWorkspace`,
`createTree`, …), which `App.tsx` creates once in dependency order and composes;
components take props and call callbacks.

## Rules

### Comments

The bar is high: write a comment only when its absence would let someone break the code.
Assume the reader is competent and can read TypeScript — they don't need the "what", only
the "why you can't do the obvious thing".

Ask: **if I delete this comment, will the next person make a mistake?** If no, delete it.

Worth writing:

- A trap that will be "cleaned up" and reintroduce a bug — non-obvious ordering, a guard
  that looks redundant, a workaround for upstream behaviour.
- A convention the types don't carry — units, offset bases, which coordinate space a
  number lives in.
- An invariant two distant pieces of code silently depend on.

Not worth writing: restating the line below, naming a section, labelling parameters,
explaining a well-named function, TODOs, commented-out code.

```ts
// Bad — restates the code
// increment the counter
count++

// Bad — the signature already says this
/** Saves the file to disk. */
function saveFile(path: string, content: string) {}

// Good — deleting this comment invites a "simplification" that breaks every file
// highlightOnce returns absolute string offsets, but the edit buffer indexes
// text with newlines removed; without this every line drifts one column right.
```

Prefer making the comment unnecessary: a clearer name, a named constant, or a small
function usually beats a sentence explaining the mess.

### Keep this file current

When a change alters how someone works with the project — new script, new dependency,
new extension point, changed layout, changed workflow, a new rule or convention — update
`AGENTS.md` (and `ARCHITECTURE.md` when the structure moves) **in the same change**.
A stale agent file is worse than none.

### Verify behaviour, don't assume it

This is a TUI: type errors do not prove it works. Write a test — `bun test` renders the
real app off-screen and gives you the frame as text, so UI is assertable.

```tsx
const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
await press(t, i => i.pressEnter())          // opens the file
expect(t.captureCharFrame()).toContain('const a = 1')
```

`test/helpers.tsx` has `fixture()` (temp project), `launch()` (renders `<App/>`, and takes
a config and a terminal size), `press()`, `pressTimes()`, `openFile()`, `settle()`,
`until()`/`untilFrame()`/`untilGone()`, `pressEscape()`, `runCommand()` and
`loadMarketExtensions()`.
Highlight helpers live in `test/syntax.ts` instead — `parseHighlights()` and
`allSegments()` — so a unit test can use them without pulling in `<App/>`. Five rules the
harness exists to encode:

- **A test process starts with the preinstalled extensions and nothing else.**
  `test/setup.ts` registers them, so typescript, json, markdown, html, css, yaml and
  toml highlight as they do on a real first run. Anything else — Go, Python, tsrx,
  dotenv, a market theme — needs `loadMarketExtensions()` at the top of the file, which
  reads this repository’s `extensions/` folder as an extensions folder. A test that asserts
  on a *missing* extension (the market’s install offer) must not call it.

- **Yield before capturing.** The reconciler flushes on a macrotask; a frame captured
  straight after a key still shows the previous state. `press()`/`settle()` handle it.
- **Escape needs a gap.** Esc is the prefix of every arrow/function-key sequence, so the
  parser holds it until it knows nothing follows. Use `pressEscape()`, not
  `mockInput.pressEscape()`.
- **One flush per assertion, not per key.** A flush that repaints the editor costs ~20ms,
  so a loop of `await press(...)` is where a test's seconds go — and where the 5s budget
  went when the suite ran loaded. Send the keys, then flush once: `pressTimes()` for a
  repeated key, `openFile()` for the Ctrl+O dance. Only reach for a `press()` per key
  when an intermediate frame is what the test asserts on.
- **Poll for what you are waiting for.** `until()` renders until a condition holds, so a
  watcher event or an async highlight costs what it actually takes. A fixed
  `settle(t, 400)` is right only when the assertion is that *nothing* happened.
- **A fixture lives as long as its file.** `test/setup.ts` deletes every `fixture()`
  directory in a global `afterAll`, so nothing may expect one to outlive the file that
  made it. The sweep is not tidiness: a full run creates some three thousand temp
  projects, and when they accumulated across runs the temp folder reached ~100k
  entries, every `mkdtemp` in it slowed down, and whole files began timing out and
  being killed — which reads as flaky tests and is not.

`captureCharFrame()` returns text only — selection and focus are background colors, so
assert on something textual (a prompt appearing, the status bar, file contents on disk).

For a real end-to-end check, drive the built CLI in a PTY with an isolated
`XDG_CONFIG_HOME` so it never writes your real config.

### Solid, not React

Solid compiles JSX at build time and has no re-render — components run once and
signals update the terminal directly. Three rules follow:

- **Never destructure props.** `function X({ a })` freezes `a`; use `props.a`.
- Signals are functions: `count()` to read, `setCount(v)` to write. Derived values are
  `createMemo`; side effects are `createEffect(on(...))` / `onMount` / `onCleanup`.
- Lists need `<For each={...}>` and conditionals `<Show when={...}>` — a bare `.map()`
  or `&&` renders once and never updates.
- A fixed column of rows whose *values* change — the editor's scrollbar and its git and
  problem tracks — belongs in `<Index>`, not `<For>`. `For` is keyed by item, so a list
  of duplicate primitives tears renderables down and rebuilds them on every scroll tick;
  `Index` is keyed by position and only updates the row that changed.
- Shared mutable state must be a signal or store. A plain exported object (the theme
  palette, for one) updates in memory but repaints nothing.

The Solid transform is a Babel step, so it needs `bunfig.toml` preload entries for both
the app **and** `[test]`, and the build goes through `Bun.build` with
`@opentui/solid/bun-plugin` (tsdown/rolldown cannot do it).

Some OpenTUI element names are snake_case (`line_number` is the one druk uses).

### Style

- TypeScript strict; no `any` escapes without a reason.
- **No inline `as unknown as` casts.** Before reaching for one, check the real type —
  renderables extend `EventEmitter`, so `.on(...)` needs no cast at all. When a private
  OpenTUI member truly has no public type, confine the one cast to a small named helper
  with a comment saying why (`afterResize` and `ignoreScrollOutsideBounds` in
  `src/ui/EditorPane.tsx` are the pattern) — never spell casts out mid-expression in
  component or logic code.
- **Cut anything the user's own words reach to the columns it has.** OpenTUI's `<text>`
  wraps by word unless told otherwise, so a branch named after an issue title, a path, a
  commit subject or a server's diagnostic does not overflow quietly — it grows its row to
  two, five, ninety lines and takes the panel's layout with it, and a fixed-height header
  loses whatever it pushed past the last row. `cut()` in `src/ui/text.ts` fits a string to
  a budget (`wrapText` there is for the modals that show a whole message); `wrapMode="none"`
  on a one-line row is the backstop that makes a missed case a clipped string rather than a
  broken panel. A column that cannot shrink (`flexShrink={0}`) needs both, and needs to
  carry its own leading space — at the widths where both sides are cut there is no slack
  left to space them apart. `test/long-names.test.tsx` draws those surfaces at a hostile
  length; add to it rather than trusting a type.
- Prefer the smallest change that fits the surrounding code; match its idiom.
- Formatting and lint are enforced by oxfmt/oxlint — run them rather than hand-aligning.
- Keep modules focused; if a file is becoming a grab bag, split it along feature lines.

### Scope

- Do not add dependencies for things the standard library or OpenTUI already does.
- Do not commit or push unless asked.
- Do not edit `dist/` — it is generated and gitignored.
