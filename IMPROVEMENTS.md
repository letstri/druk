# Improvements & roadmap

What is worth building, fixing or removing next. Items are ticked off in the change that
ships them (see AGENTS.md § "Keep this file current").

**Last reviewed:** 2026-09-21 against `main` @ `f2a6e34`. Baseline: **v1.31.1**.

---

## 1. Open debt

| Area | Problem |
| --- | --- |
| `ui/EditorPane.tsx` (3105 lines) | The one grab bag left: highlighting, scrollbar and tracks, folds, the problem card, the completion menu, selection and the OpenTUI overrides all live here. Split along those lines, not by line count |
| `core/git.ts` (1924 lines) | Queries, mutations, remote/forge URLs, the graph and the error table in one module. The error table and `forgeCommitUrl` are the easy lifts |
| Git queries are still `spawnSync` | Four of them, on the render loop. Fine on this repository, felt on a large monorepo |
| Project search walks synchronously | `searchProject` / `planProjectReplace` traverse and read every file inside a memo. Bounded by `DEFAULT_LIMIT` and a 140 ms debounce, so it has not bitten — a background walk with progressive results is the fix when it does |
| Windows is shipped but unexercised | No Windows job in CI beyond the release build, and path separators are easy to get wrong (`sep`, not `/`) |
| Keymap has three sources | `keys.ts` + `keyboard.ts` + `commands.ts` must agree by hand; a binding added to one and not the others simply does nothing |
| One LSP client per server id | The command is resolved from the *first* file opened for that id (`spawnFor`), so a monorepo mixing TypeScript 5 and 7 keeps whichever server that file wanted. The fix is a client per workspace package — a lifecycle change, not a guard |
| An abandoned LSP request is dropped, not cancelled | `request` carries a 30s deadline, so nothing hangs, but closing the completion menu sends no `$/cancelRequest` and the server keeps working on it |
| `workspace/configuration` ignores `section` | Every item is answered with the same settings object. Right for eslint, wrong for a server asking about two sections at once — and a naive walk would break eslint, since a manifest stores server settings unwrapped |
| `review.json` is read-modify-written | `saveNotes` re-reads and keeps ids it did not know about, so an agent's note survives; nothing locks the file between that read and the `writeAtomic`, so two saves in the same instant leave the later one's view |

## 2. Missing features, roughly in order of how often they are wanted

### Language intelligence
Definition, references, implementation, type definition, document and workspace symbols,
the calls of a symbol, completion, diagnostics and format-on-save all ship. What the protocol still offers and druk
does not ask for:

| Item | Effort |
| --- | --- |
| Hover — a symbol's type and doc under the caret, in the problem card's box | M |
| Rename symbol across the project (`textDocument/rename` + `prepareRename`) | M |
| Signature help while typing a call | M |
| Code actions / quick fixes on a diagnostic | L |

### Editing
| Item | Effort |
| --- | --- |
| Bracket match and jump | M |
| Expand / shrink selection (tree-sitter node walk) | M |
| Select all matches in the file (the multi-cursor half worth having) | L |
| Spaces vs tabs, detect indent, EditorConfig — only `tabSize` exists today | M |
| Join / sort / trim a selection | S |
| Block comments for HTML and CSS (line comments only today) | S |

### Git
| Item | Effort |
| --- | --- |
| Stage / discard a **hunk** from the diff — whole files only today | L |
| Blame on demand | M |
| Async status for large repositories | M |

### Search
| Item | Effort |
| --- | --- |
| User exclude globs | M |
| Search history beyond the one remembered query per scope | S |
| Progressive project search (see §1) | M |

### Navigation
| Item | Effort |
| --- | --- |
| Recent files picker | M |
| Split panes — after `EditorPane` is split | XL |
| Zen mode | S |

### Vim
`%`, `*`/`#`, `/` `?` `n` `N`, `.`, marks, the jump list, visual block, macros and `:`.
Registers, operators, text objects and `Ctrl-d/u` are in.

### Product
| Item | Effort |
| --- | --- |
| JSON Schema for `config.json` and `.druk/settings.json` | M |
| Windows terminal matrix in CI | M |
| Perf budgets in CI (startup, first frame, a large-file open) | M |
| Telemetry: none, deliberately, and documented as such | — |

## 3. Not now

- Interactive rebase, mergetool, a full git client. druk is git-lite on purpose.
- Replacing Neovim. Vim mode is a power option, not the product.
- A plugin API that runs code. Extensions are JSON manifests, which is what lets the
  compiled binary need no loader.
- Remote / SSH editing, a debugger, an integrated terminal.
