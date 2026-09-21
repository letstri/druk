# Druk

A code editor for the terminal. File tree, tabs, search, git marks and syntax
highlighting for 30+ languages — keyboard and mouse.

![druk editing a TypeScript file](./screenshot.png)

## Install

druk is one self-contained executable. Nothing else to install — no Node, no Bun.

```bash
curl -fsSL https://druk.sh/install | bash
```

Or through a package manager:

```bash
brew install letstri/tap/druk
npm install -g druk
bun add -g druk
```

On Debian or Ubuntu take the `.deb` from the
[releases page](https://github.com/letstri/druk/releases) (`sudo dpkg -i druk_*.deb`);
on Fedora or openSUSE the `.rpm` (`sudo rpm -U druk-*.rpm`). macOS (arm64, x64),
Linux (arm64, x64) and Windows (x64).

`druk update` upgrades whichever way you installed, printing the command first.

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
druk src/main.ts:42:7 # …at line 42, column 7
```

`npx druk` and `bunx druk` work without installing anything.

## The basics

A **file tree** on the left, **tabs** along the top, the **editor**, and a status bar with
the branch, unsaved state and cursor position.

- `Tab` moves from the tree to the editor, `Esc` moves back. In the tree: `↑` `↓` to move,
  `→` `←` to open and close folders, `Enter` to open a file.
- Opening a file from the tree previews it: the tab is *italic* and the next file you open
  takes its place. Double-click it, or start editing, and it stays.
- `F1` opens the command palette — every feature is in there, so no shortcut has to be
  remembered. `Ctrl+K` lists every key that works right now.
- The mouse works throughout. Selecting code copies it — including to the clipboard of the
  machine you are SSH'd from.

## Shortcuts

| Key | Does |
| --- | --- |
| `F1` or `Ctrl+Opt+P` | Command palette |
| `Ctrl+P` or `Ctrl+O` | Open any file in the project (fuzzy) |
| `Ctrl+K` | Peek at every key for the pane you are in |
| `Ctrl+T` | Switch between open tabs |
| `Ctrl+S` | Save |
| `Ctrl+F` | Find in this file (`Tab` adds replace) |
| `Ctrl+Opt+F` | Find in the whole project (`Ctrl+R` too, outside vim mode) |
| `Ctrl+G` | Go to line |
| `Ctrl+N` | New file |
| `Ctrl+W` | Close tab |
| `Ctrl+B` | Show / hide the sidebar |
| `Ctrl+Q` | Quit |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / cut / paste (system clipboard, OSC52 over SSH) |
| `Ctrl+U` | Delete to the start of the line — what macOS terminals send for `Cmd+Delete` |
| `Ctrl+/` or `Ctrl+L` | Toggle comment |
| `Opt+↑` / `↓` | Move line or selection |
| `Opt+Shift+↑` / `↓` | Duplicate line or selection |
| `Ctrl+Opt+T` | Reopen closed tab |
| `F8` / `Shift+F8` | Next / previous problem |
| `Ctrl+Opt+←` / `→` | Previous / next tab |
| `Ctrl+Opt+C` | Copy the path of this file |
| `Ctrl+Opt+G` | Source control panel |
| `Ctrl+Opt+R` | Review panel |
| `Ctrl+Opt+A` | Note this line for a review |
| `Ctrl+Opt+M` | Markdown: rendered / source |
| `Ctrl+Opt+X` | Extensions panel |
| `Ctrl+Opt+W` | Switch workspace (worktrees + recent folders) |

In the tree: `a` new file, `A` new folder, `r` rename, `d` delete, `x` cut, `c` copy,
`p` paste here, `Shift+↑`/`↓` select several rows, `[` / `]` resize the sidebar.

`Ctrl+C` copies when text is selected and quits when nothing is. Most terminals cannot
tell `Ctrl+Shift` from plain `Ctrl`, so a second modifier is spelled `Ctrl+Opt` —
terminals speaking the kitty keyboard protocol take `Ctrl+Shift` too. `Opt` is Option (⌥)
on macOS, `Alt` everywhere else.

Non-English layouts, dead keys and IMEs work: shortcuts follow the physical key, typing
follows the text your layout produces. On macOS, configuring Option solely as a Meta key
prevents character entry.

## Search

`Ctrl+F` searches the open file, `Ctrl+Opt+F` the project. Whatever you had selected is
already in the box, and the panel reopens with the query and position you left it on.
Results are grouped by file with the hit previewed in context; `Tab` folds a file.

`Tab` in file search opens the replace field (*Find → Replace in project* for the
project): `Enter` replaces the selected match, `Ctrl+A` every match. `Ctrl+C`, `Ctrl+W`
and `Ctrl+R` toggle case-sensitive, whole-word and regex matching.

## Files

`x` picks a file or folder up, `c` copies, `p` drops it in the folder you are on — paste
onto a *file* and it lands beside it. Nothing is overwritten: a taken name gets a `copy`
suffix. Open tabs, unsaved edits and expanded folders follow whatever you move or rename,
and bulk operations run in the background.

## Git

Changed lines are marked in the gutter and beside the scrollbar; files in the tree carry
`M` `A` `U` `D` marks, and the status bar shows the branch and its distance from upstream
(`⎇ main ↑2 ↓1 ~3`). Work done in another terminal shows up without a restart.

`Ctrl+Opt+G` swaps the sidebar for a source-control panel: `↑↓` walks the changes and
opens the diff beside it, `a` stacks every file in one scrollable page, `c` commits,
`d` discards, `p` pushes, `b` switches branch, `s` syncs, `g` opens the commit graph.
Pull, fetch, stash, undo-commit, branch comparison, worktrees and conflict resolution are
in the palette.

## Review

`Ctrl+Opt+A` notes the line or selection under the cursor as an **issue**, **suggestion**,
**question** or **note**, shown as `◆` in the gutter and after the line. `Ctrl+Opt+R`
opens the panel: `↑↓` pages the file beside the list and opens the remark as a card under
its line, `r` answers one (making a thread), `Backspace` drops one.

Notes live in `review.json` beside the config, keyed by project — **an agent can read and
answer them while druk is open**, and the panel updates as it writes. Nothing goes over a
network: there is no forge to configure and no token to set.

## Settings

`F1` → `Settings`: one row per option, `←→` steps the value, `Enter` opens a filterable
list. Changes apply immediately and persist. Or edit `~/.config/druk/config.json`, which a
project can override in `<project>/.druk/settings.json`.

| Setting | Default | |
| --- | --- | --- |
| `theme` | `"dark"` | `dark` and `light` ship with druk; ayu, catppuccin, dracula, everforest, gruvbox, kanagawa, nord, one-dark, rosé pine, solarized, tokyo night and more are one install away in the [market](#extensions) |
| `transparent` | `false` | leave the editor, tab strip and sidebar unpainted, for a translucent terminal |
| `iconTheme` | `"none"` | file icons: `unicode`, or a set from the market — `nerd-icons` needs a patched font |
| `tabSize` | `2` | 1–16 |
| `cursorStyle` | `"block"` | `block`, `line` or `underline` (vim mode overrides it) |
| `wrap` | `true` | `false` keeps each line on one row |
| `scrollPastEnd` | `true` | scroll on past the last line |
| `vim` | `false` | normal / insert / visual modes, `hjkl w b 0 $ gg G`, `f t F T`, counts, `i a o`, `x dd dw cw`, `v` + `d y c`, `yy p P`, `u` / `Ctrl+R` |
| `sidebarWidth` | `"auto"` | a quarter of the window, or pin 15–80 columns |
| `sidebarPosition` | `"left"` | which side the sidebar sits on |
| `trimOnSave` | `false` | strip trailing spaces, end the file with one newline |
| `autoSaveOnBlur` | `true` | save unsaved tabs on tab switch or window blur |
| `showDotfiles` | `true` | `false` hides dotfiles in the tree |
| `respectGitignore` | `false` | `true` hides git-ignored files in the tree |
| `diffView` | `"inline"` | `inline` or `split` |
| `reviewInline` | `true` | `false` keeps review notes out of the text |
| `extensionUpdates` | `true` | check the market at startup; `false` never contacts it |
| `extensionRegistry` | druk's own | point it at a fork if you keep your own market |

druk remembers each project's open tabs, active file and expanded folders. `Ctrl+Opt+W`
switches to another folder — every worktree of the open repositories, then every folder
druk has been opened on.

## Extensions

**Almost everything druk does with a language or a colour is an extension**, and the
market is a folder in this repository that druk reads directly — so a new theme or
language reaches you when its pull request merges, not when druk next releases.

Out of the box: TypeScript, JavaScript and their React dialects, JSON, Markdown, HTML,
CSS, YAML and TOML. Go, Rust, Python, C, C++, Java, Ruby, Elixir, PHP, Swift, Lua, Bash
and about fifteen more are one install away, each bringing its language server. A language
may have several servers and druk runs all of them — so **ESLint** reports beside
whichever language server already serves the file.

`Ctrl+Opt+X` opens the extensions panel: `/` searches what you have and what the market
offers alike, `Enter` installs (or toggles an installed one) after naming what it adds and
any command druk would run, `Backspace` uninstalls, `u` updates everything. druk also
offers on its own — open a Go file with no Go extension and it says so.

An extension is a JSON manifest — installing one runs nothing. Write your own into
`~/.config/druk/extensions/<name>.json`, or a project's `<project>/.druk/extensions/`, and
press `r` in the panel:

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

An extension is one kind or the other: a **language** (as above) or an **appearance**
(`themes` and `icons`). `grammar` can also be `{"vendored": "go"}` for a grammar already
inside druk, or a `patterns` list of regexes where no grammar exists. An `id` matching one
already registered replaces it — that is how to repaint `dark`.

[`extensions/README.md`](https://github.com/letstri/druk/tree/main/extensions) has the full
shape, and contributing one is a JSON file and a pull request.
