# Druk

A code editor for the terminal. File tree, tabs, search, PDF viewing, git marks and syntax
highlighting for 30+ languages — keyboard and mouse.

![druk editing a TypeScript file](./screenshot.png)

## Install

druk is one self-contained executable. Nothing else to install — no Node, no Bun.

```bash
curl -fsSL https://druk.letstri.dev/install | bash
```

Or through a package manager:

```bash
brew install letstri/tap/druk
```

```bash
npm install -g druk
```

```bash
bun add -g druk
```

macOS (arm64, x64), Linux (arm64, x64) and Windows (x64). Binaries are also on the
[releases page](https://github.com/letstri/druk/releases).

To upgrade later, whichever way you installed:

```bash
druk update
```

It works out how this copy was installed — Homebrew, the install script, or a global
`npm`/`pnpm`/`yarn`/`bun` package — and runs that upgrade, printing the command first.

<details>
<summary>Install options</summary>

The script puts the binary in `~/.druk/bin` and adds it to your `PATH`. Pin a version with
`| bash -s -- --version 1.0.1`, or keep your shell config untouched with `--no-modify-path`.
The npm and bun packages are a launcher that downloads that same binary on install — set
`DRUK_DOWNLOAD_BASE` to a mirror if your network cannot reach GitHub.

</details>

## Open a project

```bash
druk                  # the current directory
druk ./my-app         # a directory
druk src/main.ts      # a single file
druk src/main.ts:42   # …opened at line 42
druk src/main.ts:42:7 # …at line 42, column 7
```

`npx druk` and `bunx druk` work without installing anything.

Given a file, druk opens it with the sidebar hidden — `Ctrl+B` brings the tree back, and
the folder around the file is still the project for search and git.

## The basics

The window is a **file tree** on the left, **tabs** along the top, the **editor**, and a
status bar with the branch, unsaved state and cursor position.

- `Tab` moves from the tree to the editor, `Esc` moves back.
- In the tree: `↑` `↓` to move, `→` `←` to open and close folders, `Enter` to open a file.
- The `▴` at the right of the sidebar header shuts every folder at once — in the file
  tree and in the source-control panel alike. It is there only while something is open;
  the palette has it as *View → Collapse folders in sidebar*.
- Opening a file from the tree previews it: the tab is *italic* and the next file you
  open takes its place. Double-click it, or start editing, and the tab stays for good.
- `Ctrl+S` saves; *File → Save all* in the palette writes every unsaved tab at once.
  Closing a tab with unsaved edits asks first.
- `F1` (or `Ctrl+Shift+P` where the terminal can send it) opens the command palette —
  every feature is in there, and typing filters it, so you never have to remember a
  shortcut. `F1` → `Keyboard shortcuts` shows them all.
- `Ctrl+P` opens any file in the project (fuzzy), as in VS Code.
- `Ctrl+K` peeks: a strip over the status bar listing every key that works right now,
  gone again on the next keypress.
- The mouse works throughout: click tabs, tree rows and the editor, drag the sidebar's
  edge to resize it, and scroll any pane.

## Shortcuts

| Key | Does |
| --- | --- |
| `F1` or `Ctrl+Opt+P` | Command palette |
| `Ctrl+P` or `Ctrl+O` | Open any file in the project (fuzzy) |
| `Ctrl+K` | Peek at every key for the pane you are in |
| `Ctrl+T` | Switch between open tabs |
| `Ctrl+S` | Save |
| `Ctrl+F` | Find in this file (`Tab` adds replace) |
| `Ctrl+R` | Find in the whole project |
| `Ctrl+G` | Go to line |
| `Ctrl+N` | New file |
| `Ctrl+W` | Close tab |
| `Ctrl+B` | Show / hide the sidebar |
| `Ctrl+Q` | Quit |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / cut / paste (system clipboard, OSC52 over SSH) |
| `Ctrl+/` or `Ctrl+L` | Toggle comment |
| `Opt+↑` / `↓` | Move line or selection |
| `Opt+Shift+↑` / `↓` | Duplicate line or selection |
| `Ctrl+Opt+T` | Reopen closed tab |
| `Ctrl+Opt+←` / `→` | Previous / next tab |
| `Ctrl+Opt+C` | Copy the path of this file (relative form in the palette) |
| `Ctrl+Opt+G` | Source control panel (commit / push) |
| `Ctrl+Opt+R` | Review panel (notes + pull-request comments) |
| `Ctrl+Opt+A` | Note this line for a review |
| `Ctrl+Opt+M` | Markdown: rendered / source |

In the tree: `a` new file, `A` new folder, `r` rename, `d` delete, `x` cut, `c` copy,
`p` paste here, `Shift+↑`/`↓` select several rows, `[` / `]` resize the sidebar.

Two things worth knowing: `Ctrl+C` copies when text is selected and quits when nothing is,
so it never throws away unsaved work. And most terminals cannot tell `Ctrl+Shift` apart
from plain `Ctrl`, so a second modifier is spelled `Ctrl+Opt` — terminals with the kitty
keyboard protocol take `Ctrl+Shift` too (`Ctrl+Shift+P` opens the palette there, as in
VS Code).

### The Opt / Alt key

druk names the key for your OS: `Opt` (Option, ⌥) on macOS, `Alt` everywhere else.
Every shortcut works in a stock terminal — nothing to configure. The line commands are
also in the palette (`F1`). Some terminals (macOS Terminal.app among them) cannot
send `Ctrl+/` at all — that is why *Toggle comment* also answers to `Ctrl+L`.

## Markdown

`Ctrl+Opt+M` reads a `.md` file as the document it is — headings, lists, tables, links,
quotes and syntax-lit code blocks — and the same key puts the text back. It is one tab in
two views, not two tabs: the strip marks the rendered one `¶ name`, and what it renders is
the buffer, so unsaved edits show up without saving first. `Tab` or `Esc` goes back to the
source; `↑` `↓`, `PgUp` / `PgDn` and `Ctrl+U` / `Ctrl+D` scroll it. Each file remembers
which of the two it was left in.

## PDF

Open a `.pdf` like any other file. Druk renders the current page directly in the
terminal: `PageUp` / `k` and `PageDown` / `j` move between pages, `+` / `-` zoom,
the arrows pan a zoomed page, and `0` fits it to the editor again. PDF tabs are
read-only; corrupt, encrypted, or unsupported documents stay closable and show the
reason they could not be rendered.

## Search

`Ctrl+F` searches the open file, `Ctrl+R` the project (`Ctrl+Opt+F` too — that is the one
to use in vim mode, where `Ctrl+R` is redo). Whatever you had selected is already in the box.

Results are grouped by file, each row showing the line number and the line with the hit
picked out, and the lines around the selected match are previewed underneath. `Tab` folds
the file you are on, so one file with forty hits stops burying the rest.

In file search, `Tab` opens the replace field instead: `Enter` replaces the selected match,
`Ctrl+A` replaces every match in the file.

The search outlives the panel. `Ctrl+F` reopens carrying the query you last gave it, on
the match you were last on — so closing the panel to look at the file and opening it again
costs nothing. The text arrives selected, so typing replaces it and a fresh search is no
slower than it was. With text selected in the editor, that wins instead: it is what you
mean now rather than what you meant last time.

The whole project replaces too: *Find → Replace in project* in the palette opens the
project search with the replace field showing, and every row previews the hit beside what
would replace it. `Enter` applies the selected match; `Ctrl+A` asks first — the confirm
names the real match and file counts, beyond the 200 rows the panel shows — then applies
everywhere. Open files take the edit in their buffer (the tab goes unsaved, and the active
file can undo it); closed files are written straight to disk, keeping their line endings.
With the replace field up, `Tab` moves between the two boxes; plain project search keeps
`Tab` for folding.

`Ctrl+C`, `Ctrl+W` and `Ctrl+R` toggle case-sensitive, whole-word and regex matching
while the search is open; the active ones are shown beside the match count.

## Files

`x` picks a file or folder up and `p` drops it in the folder you are on — paste onto a
*file* and it lands beside it, so you never have to aim exactly. `c` copies instead, and
keeps the clipboard, so the same thing can go into several folders. Nothing is overwritten:
a taken name gets a `copy` suffix (`app copy.ts`), which is also how you duplicate in place.

Open tabs, unsaved edits and expanded folders all follow whatever you move or rename.

Deleting, moving or copying a lot at once runs in the background: the status bar counts
what is done and the editor stays usable, instead of freezing until a `node_modules` is
gone.

## Git

Changed lines are marked in the gutter and again beside the scrollbar, where the whole
file's changes are visible at once — a mark there is somewhere to scroll to. Files in the
tree carry `M` `A` `U` `D` marks, and the status bar shows the branch and how far it is
from upstream — `⎇ main ↑2 ↓1 ~3` is two commits to push, one to pull, three changed
files. Work you do in another terminal shows up without a restart.

`Ctrl+Opt+G` swaps the sidebar for a small source-control panel, as in VS Code: the
changed files under the branch name. `↑↓` walks the changes and the diff for the one
under the cursor opens beside the panel — that is the way to read a diff, and the way
to move between them. `Tab` steps into the page (`Tab` again lays it out side by side,
`Esc` closes it), `c` commits (pick the files, type the message), `p` pushes, `b`
switches branch, and `Esc` puts the file tree back. *Git → Diff current file* in the
palette opens the panel on the file you are editing; commit, pull, fetch, stash,
undo-commit and the branch commands live beside it.

## Review

Reading a change means keeping track of what you meant to say about it. `Ctrl+Opt+A`
does that part for you: it notes the line — or the selection — the cursor is on as an
**issue**, **suggestion**, **question** or **note**, and the remark shows as `◆` in the
gutter and after the line. Notes are per project and survive a restart.

The review lives inside the source-control panel: the `◆` in its header opens it, as
does `r` there or `Ctrl+Opt+R` from anywhere, and `Git` stays the pressed tab — click it,
or press `Esc`, to get back to the change list. Every note sits under the file it is
about. The cursor is a pager: the file a remark is about goes up beside the list at its
line, and the remark opens as a card under that line the way a comment reads on GitHub —
`↑↓` walks it, `Enter` puts the caret there, `Backspace` drops a note. Opening it also
fetches the
comments on the pull request open for the current branch, which then read in the same
list and beside the same lines — `f` asks again, and *Fetch comments on open* in the
settings page turns the automatic one off.

The pull request can be on **GitHub, GitLab, Gitea/Forgejo or Bitbucket Cloud** — druk
reads the remote's URL to know which, self-hosted instances included. A private
repository wants a token in `GITHUB_TOKEN`, `GITLAB_TOKEN`, `GITEA_TOKEN`,
`BITBUCKET_TOKEN` or `DRUK_FORGE_TOKEN`; a public one needs none. druk only ever *reads*
a forge: nothing is posted, approved or resolved.

## Settings

Open the settings page from the palette (`F1` → `Settings`): one row per option,
`←→` steps the value and `Enter` opens a filterable list of every value — the way
to reach a theme without pressing an arrow twenty times. Every change applies
immediately and persists. Or edit
`~/.config/druk/config.json` directly — a bad value falls back to the default
instead of breaking startup.

| Setting | Default | |
| --- | --- | --- |
| `theme` | `"dark"` | `dark` and `light` ship with druk; ayu, catppuccin, dracula, everforest, gruvbox, kanagawa, nord, one-dark, rosé pine, solarized, tokyo night and vesper are one install away in the [extension market](#extensions) |
| `transparent` | `false` | set `true` to leave the editor, tab strip and sidebar unpainted, so a translucent terminal shows through |
| `iconTheme` | `"none"` | file icons in the tree: `unicode` (shapes any font has), or a set from the market — `nerd-icons` needs a patched font |
| `tabSize` | `2` | 1–16 |
| `cursorStyle` | `"block"` | `block`, `line` or `underline` — the caret's shape, which vim mode overrides while it is on, since there the shape is what tells normal from insert |
| `wrap` | `true` | set `false` to keep each line on one row — the tail of a long line is then reached by moving the cursor into it (palette → View → Toggle word wrap) |
| `vim` | `false` | normal / insert / visual modes, `hjkl w b 0 $ gg G`, counts, `i a o`, `x dd dw cw`, `v` + `d y c`, `yy p P`, `u` / `Ctrl+R` |
| `sidebarWidth` | `"auto"` | a quarter of the window, or pin 15–80 columns |
| `trimOnSave` | `false` | on save: strip trailing spaces and end the file with one newline |
| `autoSaveOnBlur` | `true` | save unsaved tabs when switching tabs or when the terminal window loses focus |
| `showDotfiles` | `true` | set `false` to hide dotfiles in the file tree |
| `respectGitignore` | `false` | set `true` to hide git-ignored files in the file tree |
| `diffView` | `"inline"` | `inline` or `split` — how the diff view lays out changes |
| `reviewForge` | `"auto"` | where pull-request comments come from: read off the remote's host, or pin `github` / `gitlab` / `gitea` / `bitbucket` for a self-hosted one, whose name says nothing about which it runs |
| `reviewRemote` | `"origin"` | which remote's URL says where the pull request lives |
| `reviewInline` | `true` | set `false` to keep review notes out of the text and in the gutter and panel only |
| `extensionUpdates` | `true` | check the extension market at startup: update notices, and the offer of an extension for a language or theme you are missing. `false` never contacts it |
| `extensionRegistry` | druk's own | an https folder holding `index.json` and `<id>/extension.json` — point it at a fork if you keep your own market |

druk also remembers each project's open tabs, active file and expanded folders, and
restores them the next time you open that directory.

## Extensions

**Almost everything druk can do with a language or a colour is an extension**, and the
market is a folder in this repository that druk reads directly — so a new theme, or
support for a new language, reaches you when its pull request merges, not when druk
next releases.

An extension is one of two kinds: a **language** (highlighting, and the language server
that serves it) or an **appearance** (themes and icon themes).

Out of the box druk highlights TypeScript, JavaScript and their React dialects,
JSON, Markdown, HTML, CSS and its preprocessors, YAML and TOML — those extensions ship
inside the binary. Go, Rust, Python, C, C++, Java, Ruby, Elixir, PHP, Swift, Lua,
Bash and about fifteen more are one install away, each bringing its language server
with it.
Themes beyond the GitHub pair and the Nerd Font icons are there too.

A language may have more than one server, and druk runs all of them — so the
**ESLint** extension reports beside whichever language server is already serving the
file, the way eslint sits beside tsserver in VS Code. It uses the project's own
`node_modules` copy when there is one.

`Ctrl+Opt+X` opens the extensions panel — the sidebar's third view, beside Files and
Git. `INSTALLED` lists what you have: `Enter` turns one off and back on, `Backspace`
uninstalls one — after a confirm naming the language servers druk fetched for it,
which are deleted with it.

Servers themselves are removable too: `d` on the language-server status page
(`F1` → `Problems` → `Language server status`) deletes druk's copy of the selected
one. Only ever druk's — a server on your `PATH` or in the project's `node_modules`
is not druk's to delete, and it says so instead.

The market is not listed. Search for it: the box at the top of the panel (`/`, or
click it) covers what you have and what the market offers alike, and an `AVAILABLE`
section appears with the matches. Every extension has **categories** — `language`,
`lsp`, `theme`, `icons` — and the search matches those as well as names and
language ids (`go`, `rust`), so you can find one by what it does rather than what
it is called. The categories are drawn beside the name when the sidebar is wide
enough for them — capped at fifty, with a row saying how many were
left out. The cursor lands on the first hit, so `Enter` installs, after showing what
the extension adds and, for a language server, the command druk would run. `u`
updates everything; `r` re-reads the manifests.

The two that are settings rather than extensions — whether to check the market at
startup, and the registry URL — are on the settings page.

druk also offers on its own: open a Go file with no Go extension and it says so, and a
config naming a theme you no longer have is offered the extension that carries it. When
an installed extension has a newer version, the status bar says so at startup, and the
page's `Update everything` row takes it. Installing is usually one small JSON file: the
grammars themselves are already in the binary.

Contributing one is a JSON file and a pull request: see
[`extensions/README.md`](https://github.com/letstri/druk/tree/main/extensions).

An extension is a JSON file, so you can also just write one. Drop it in
`~/.config/druk/extensions/` — either `<name>.json`, or `<name>/extension.json` — and
press `r` in the extensions panel. A project can carry its own in
`<project>/.druk/extensions/`.

An appearance extension:

```json
{
  "id": "my-pack",
  "name": "My Pack",
  "version": "1.0.0",
  "themes": [
    {
      "id": "my-theme",
      "name": "My Theme",
      "ui": { "bg": "#0d1117", "text": "#e6edf3", "...": "every colour, as #rrggbb" },
      "syntax": { "keyword": { "fg": "#ff7b72" }, "comment": { "fg": "#8b949e", "italic": true } }
    }
  ],
  "icons": [
    {
      "id": "my-icons",
      "name": "My Icons",
      "file": "·",
      "folder": "▸",
      "folderOpen": "▾",
      "extensions": { "ts": { "glyph": "▲", "color": "#3178c6" } },
      "names": { "package.json": "▤" },
      "folders": { "src": "▸" }
    }
  ]
}
```

And a language extension — the other kind, never mixed with the first:

```json
{
  "id": "nim",
  "name": "Nim",
  "version": "1.0.0",
  "languages": [
    {
      "id": "nim",
      "lineComment": "#",
      "extensions": [".nim"],
      "grammar": { "wasm": "grammar.wasm", "query": "highlights.scm" }
    }
  ],
  "languageServers": [
    {
      "id": "nim",
      "command": ["nimlangserver"],
      "filetypes": ["nim"],
      "install": { "kind": "manual", "command": "nimble install nimlangserver" }
    }
  ]
}
```

`grammar` can also be `{"vendored": "go"}` for one of the grammars already inside
druk, or `{"bundled": true}` for one OpenTUI carries; with no grammar at all, a
`patterns` list of regexes highlights the file instead — that is how YAML, SQL and
Terraform are done. [`extensions/README.md`](https://github.com/letstri/druk/tree/main/extensions)
has the full shape.

Copy the colours of a market theme out of
[`extensions/`](https://github.com/letstri/druk/tree/main/extensions) to see every `ui`
key and the syntax groups worth styling. Each icon must be a single-cell character —
an emoji is refused, because it would shift every name in the tree by a column. An
`id` that matches one already registered replaces it, so this is how to repaint
`dark`, or how a project's own extension folder overrides a market extension for the
languages that project uses.

Manifests are data, never code: installing an extension runs nothing — though a language
server it declares is a program druk starts when a matching file opens, which is why
the install prompt names that command. They are read at startup — `r` in the extensions
panel picks up a change without restarting. Its `INSTALLED` section turns one off
(`disabledExtensions` in the config), and a manifest with a mistake in it says so in the
status bar rather than failing quietly.
