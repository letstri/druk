# The druk extension market

Every folder here is an extension. druk fetches `index.json` from this directory on
`main` and installs an extension by fetching `<id>/extension.json` — so **a merged pull
request is live for everyone**, without waiting for a druk release.

An extension is JSON and nothing else. Installing one runs no code, and druk validates
a manifest before it writes it.

## Two kinds, never both

An extension is either a **language** or an **appearance**. The check is enforced:

| Kind | Fields | What it adds |
| --- | --- | --- |
| language | `languages`, `languageServers` | Syntax highlighting for a language, and the server that serves it. |
| appearance | `themes`, `icons` | Colour schemes and file-icon sets. |

The two are installed for different reasons and change on different schedules, so a
Go extension that also repaints the editor is refused rather than half-registered.

## A language extension

```json
{
  "id": "nim",
  "name": "Nim",
  "version": "1.0.0",
  "description": "Nim highlighting and nimlangserver — shown in the market list, so make it searchable",
  "languages": [
    {
      "id": "nim",
      "label": "nim",
      "lineComment": "#",
      "grammar": { "wasm": "grammar.wasm", "query": "highlights.scm" },
      "extensions": [".nim", ".nims"]
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

`grammar` is one of three:

- `{ "vendored": "go" }` — a grammar druk already embeds (the keys are in
  `src/languages/grammars.ts`). Nothing to download: installing the extension fetches
  one small JSON. Every language extension in this folder uses this.
- `{ "bundled": true }` — a grammar OpenTUI carries: javascript, typescript,
  markdown, zig.
- `{ "wasm": "…", "query": "…" }` — files **in your extension's folder**, fetched on
  install. This is the case for a language druk vendors no grammar for, and the
  only reason to commit a `.wasm` here. Paths are relative and may not escape the
  folder.

With no usable grammar, use `patterns` instead — the regex is a string, and later
entries win the characters they overlap:

```json
"patterns": [
  { "group": "keyword", "re": "\\b(?:proc|let|var)\\b", "flags": "g" },
  { "group": "comment", "re": "#.*$", "flags": "gm" }
]
```

`extensions`, `filenames` and `filenamePattern` claim names OpenTUI cannot resolve
(`.tf`, `bun.lock`, `.env.local`). Without one of them the patterns never run and
the file renders plain. `install` is `{"kind": "npm", "packages": [...]}` when druk
can fetch the server itself, `{"kind": "manual", "command": "..."}` for a line to
print, and absent for a server that arrives with an SDK.

## A server-only extension: a linter

`languageServers` needs no `languages` beside it, and **a filetype may have more
than one server** — every one of them is spawned and synced, and their diagnostics
are merged rather than replacing each other. That is what lets a linter report
alongside the language server already serving the file, the way eslint sits beside
tsserver in VS Code. See [`eslint/extension.json`](eslint/extension.json).

A server that is configured rather than convention-driven carries `settings`: its
own configuration object, handed over untouched. druk gives it to the server both
ways the protocol allows — as the answer to every `workspace/configuration` request
and as one `didChangeConfiguration` push — because servers differ in which they
read, and eslint's reports nothing at all until it has been told to validate:

```json
"languageServers": [
  {
    "id": "eslint",
    "command": ["vscode-eslint-language-server", "--stdio"],
    "filetypes": ["typescript", "javascript"],
    "install": { "kind": "npm", "packages": ["vscode-langservers-extracted"] },
    "settings": { "validate": "on", "problems": {}, "nodePath": null }
  }
]
```

The keys are the server's, not druk's, and are passed through unvalidated — so a
server option added upstream needs no druk release. Find the minimum set by
running the server by hand: most refuse to work with a field missing and say
nothing about which.

## Categories

An extension's categories — `language`, `lsp`, `theme`, `icons` — are **derived
from what it contributes**, never declared. A manifest carrying `themes` is a
theme extension; a `categories` field would only ever be a way to be wrong about
that, so there is none. They are what the extensions panel's search matches
beside the name, and `bun run extensions` writes them into `index.json`.

## An appearance extension

`themes` needs every `ui` key `src/themes/types.ts` declares, all `#rrggbb`; copy a
published palette verbatim and cite it in `description`, as the shipped ones do.
`icons` maps names, extensions and folders to a **single-cell** glyph — a two-cell
one is dropped rather than drawn, since the tree gives an icon the arrow's column.
A Nerd Font glyph counts as one cell wherever it sits, including the Material
Design Icons range above U+F0000; set `"patchedFont": true` on a theme that uses
one, which is what makes druk say so when the theme is picked.

A map's value is a glyph, `{ "glyph": "…", "color": "#rrggbb" }`, or the name of
an entry in `definitions` — which is how a set that gives four thousand names an
icon spells each icon out once:

```json
"icons": [{
  "id": "material",
  "patchedFont": true,
  "definitions": {
    "typescript": { "glyph": "󰛦", "color": "#0288d1" },
    "folder-src": { "glyph": "󰅩", "color": "#4caf50", "open": "󰝰" }
  },
  "extensions": { "ts": "typescript" },
  "folders": { "src": "folder-src" }
}]
```

`open` is the form a folder takes while it is expanded — a named folder needs one
or expansion stops being readable, the icon having taken the arrow's column.
`names` and `folders` are matched whole, `.gitignore` dot and all, while an
extension is written either way (`ts` and `.ts` are one key). A folder is looked
up under the plain name too, so `github` covers `.github`, `_github` and
`__github__` and a manifest lists it once.

## Adding one

1. Make a folder named after the extension id — lowercase, `[\w.-]+`, and the same as
   the manifest's `id`. It is the URL druk fetches and the folder it installs into.
2. Write `extension.json`. Start at `"version": "1.0.0"`.
3. Run `bun run extensions` to regenerate `index.json`, and `bun run check`.
4. Open a pull request.

To change an extension, edit its manifest and **bump `version`** — that is the only
thing that makes installed copies notice. druk compares semver, so `1.0.1` is an
update and `1.0.0` re-published is not.

## Preinstalled extensions

A few of these ship inside the binary, so a fresh druk highlights code with no
network: typescript, json, markdown, html, css, yaml and toml. The list is
`src/extensions/builtin.ts`, and a preinstalled extension may carry no assets — it is
parsed without a folder, so a relative path would resolve to nothing. A preinstalled
extension updates with druk itself: the market never offers it an update, and a copy
of its id in an extensions folder is skipped and reported rather than loaded. Bumping
one's `version` therefore only reaches users through a druk release.

## Testing yours before it is merged

Drop the folder straight into `$XDG_CONFIG_HOME/druk/extensions/` (usually
`~/.config/druk/extensions/`) and press `r` in the extensions panel.
That path needs no registry at all, which is why `extensionRegistry` is only worth
changing when you are serving a whole fork.

## What the tests enforce

`test/extensions-repo.test.ts` fails the build if a manifest is one druk would reject,
if `index.json` is stale, if an extension mixes the two kinds, if two extensions claim the
same language, theme, icon or server id — and, for themes, if `currentLine` or
`indentGuide` sit far enough from `bg` to read as a block rather than a hint.

Note for palette families: druk's palette matches a query in order, so a flavor
whose name is a prefix of another's search hits comes first in `themes`. Catppuccin
lists Mocha before Macchiato for that reason.
