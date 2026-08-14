# Improvements & roadmap

Living analysis of what to improve, change, refactor, or remove so druk can become
the best terminal editor for developers.

**Last reviewed:** 2026-07-29 (revalidated against `main` @ `e597f5d` + uncommitted
SidebarTabs work). Baseline: **v1.6.0**. Settings page, image viewer, hide filters,
and VS Code key layout are **on `main`** (PR #13 / `a94c30b` merge).

Update this file when priorities shift or items ship.

---

## What changed since the first review

| Item | Status now |
| --- | --- |
| `showDotfiles` / `respectGitignore` dead config | **Shipped** (`dd7b578`) — tree filter via `hiddenNodes` + `ignoredPaths`; settings toggles |
| Diff layout toggle only in code | **Shipped** — Settings page row “Diff layout”; also `onToggleMode` in DiffView |
| Settings scattered in palette | **Shipped** — `SettingsView` page; palette is features, not config (themes stay for live preview) |
| VS Code key layout | **Shipped** — `Ctrl+P` = fuzzy open, `F1` / `Ctrl+Opt+P` / `Ctrl+Shift+P` = palette |
| Git credential hang | **Shipped** — `GIT_TERMINAL_PROMPT=0` on mutations |
| Git failure messages | **Shipped** — `failureLine` prefers `fatal:` over hint noise |
| README settings table | **Updated** — includes dotfiles / gitignore / diffView |
| Image viewer | **Shipped** (`a94c30b`) — `image.ts`, `ImageView.tsx`, no-buffer tabs, tests; half-block notes in ARCHITECTURE |
| README “git is read-only” | **Fixed** — README § Git describes panel + palette mutations |
| ARCHITECTURE “git is read-only” | **Still wrong** — folder map + “git is read-only” bullet contradict `commit`/`push`/… |
| Tree-only hide policy | **Documented** in ARCHITECTURE + README (“in the file tree”); search/fuzzy still unrestricted by design |
| `file.ts:42:7` column | **Still dropped** — only line is applied |
| Project-wide replace | **Still missing** (in-file replace-all only) |
| Language intelligence | **Still none** |
| Sidebar Files / Git tabs | **In flight (uncommitted)** — `SidebarTabs.tsx` + `panes.showView` |

---

## What this revalidation checked

Claims re-checked against the tree (not just the previous doc):

| Claim | Verdict |
| --- | --- |
| Version baseline v1.6.0 | True (`package.json` + tag) |
| Hide settings + settings page + F1/Ctrl+P | True, on `main` |
| Image viewer “uncommitted” | **False** — tracked in HEAD; tests `image.test.ts` / `image-view.test.tsx` |
| README git still read-only | **False** — README already describes commit/push/stash/… |
| ARCHITECTURE git still read-only | **True** — lines ~45 and ~319–322 still lie |
| Tree-only hide undocument | **Mostly false** — ARCHITECTURE is explicit; README table says “file tree” |
| `file:line:col` | Still true — `resolveTarget` regex accepts col, `Target` has no `col`, `App` calls `requestGoto(line, 0)` |
| Module sizes | Still exact: EditorPane 1044, vim 802, DiffView 573, SearchPanel 481, workspace 469, SettingsView 272 |
| Project replace / find next / save all | Still absent as product features |
| Test harness size | ~87 files under `test/` (was “~84+”) |
| Mutations list | commit, undo, push, fetch, pull, stash, stash pop, diff file/all — matches doc |
| Uncommitted delta | Sidebar tab strip only (`App`/`panes`/`FileTree`/`GitPanel` + new `SidebarTabs`) |

---

## Product thesis

> **VS Code muscle memory in a real TUI** — file tree, preview tabs, mouse, palette,
> settings page, search — shipped as **one binary**, no extension zoo.

Recent keybinding + settings + image + sidebar-panel work **reinforces** that thesis.
Sidebar Files/Git tabs are the next small VS Code-shaped polish. Keep doubling down.

| Keep / double down | Deliberate non-goals (for now) |
| --- | --- |
| Instant open, single binary | Extension marketplace |
| Tree + tabs + mouse + palette + settings page | Embedded AI chat |
| Great search & project nav | Full IDE debugger |
| Git as daily driver (view + safe mutations) | Interactive rebase / mergetool |
| Language intelligence *when it stays fast* | Language servers that freeze the TUI |
| Vim as optional power mode | Replacing Neovim for hardcore users |

**Success bar:** Live in druk for TypeScript / Python / Go / Rust without opening VS Code
for navigation, search, git, or basic diagnostics.

### Current strengths (preserve)

- One-way deps; controllers in `App.tsx`
- Commands as feature index; **settings as a page** (clean separation)
- Tree-sitter highlight pipeline + perf tests
- FileTree windowing; git watcher design
- `claim()` for Ctrl chords; test harness ~87 files
- Tree hide filters that prune ignored directories at the top (`--directory`)
- Mutation path that never prompts on the TTY
- Image tabs without buffers (never on the save path)
- Page slot model (settings / diff / image share the editor slot)

---

## 1. Critical debt still open

### 1.1 ARCHITECTURE still claims git is read-only — **highest remaining hygiene bug**

| File | Problem |
| --- | --- |
| `README.md` § Git | **Fixed** — panel + palette mutations described |
| `ARCHITECTURE.md` | Still: folder map `core/git.ts` = “read-only queries”; bullet “git is read-only… There is no commit, push, stash…” |
| `AGENTS.md` | **Correct** — marks + commit/push/stash/… |

**Action:** Rewrite ARCHITECTURE to describe query vs mutate in one module (or split the
module and docs together). Note serial runner, `touchesTree`, `GIT_TERMINAL_PROMPT=0`.
List non-goals: force push, checkout branch, discard hunk.

Optional README polish: mention the image viewer (PNG/JPEG half-blocks) — code and
ARCHITECTURE have it; user-facing README does not.

### 1.2 CLI column still ignored

`resolveTarget` accepts `file.ts:42:7` (regex `(?::\d+)?`) but `Target` only has
`line`. `main.tsx` → `App` → `editor.requestGoto(line, 0)` always. Wire `col` through.

### 1.3 ~~Image viewer uncommitted~~ — **done**

Shipped on `main`. Remaining image work is product polish, not “land the feature”:

- README mention (see §1.1 optional)
- Clear refuse / status for non-PNG/JPEG when opened somehow (P7.4)
- Kitty/sixel when OpenTUI exposes it (P7.3)

### 1.4 Large modules (unchanged)

| File | ~Lines | Suggested split |
| --- | --- | --- |
| `ui/EditorPane.tsx` | 1044 | highlight, scrollbar, clipboard gate, vim/typing |
| `editor/vim.ts` | 802 | motions / operators / text objects |
| `ui/DiffView.tsx` | 573 | layout / highlight / nav |
| `ui/SearchPanel.tsx` | 481 | model / keyboard / render |
| `app/workspace.ts` | 469 | open-close-save / disk sync / session |
| `ui/SettingsView.tsx` | 272 | new; keep focused |

Split **as you touch** features. EditorPane remains the bottleneck.

### 1.5 Hide policy is tree-only (by design, documented)

ARCHITECTURE and the README settings wording already say tree-only. Still true that:

- Fuzzy open and project search see everything (plus hardcoded `SKIPPED_DIRS`)
- Users who set `respectGitignore` may still *expect* search to match
- `node_modules` (and friends) are always skipped in search; other ignored paths are not

**Optional later:** shared ignore helper + `search.respectGitignore` setting. Not a
docs emergency anymore.

### 1.6 Sidebar tabs (in flight)

Uncommitted on top of `main`:

- `SidebarTabs` strip (Files | Git) above the sidebar body
- `panes.showView` so mouse can switch views without only the Ctrl+Opt+G toggle
- FileTree/GitPanel `flexGrow` so they fill under the strip; GitPanel window math −1 row

Finish with tests (tab click / `showView` / pageRows) and land as the next small ship.

---

## 2. Architecture notes from the new work

### Good patterns to keep

- **Settings page owns config; palette owns features** — themes left in palette for
  arrow-through live preview is the right exception
- **Page slot model** — settings, diff, and image share the editor slot; `Ctrl+W` / Esc
  close the frontmost page; mutual exclusion when opening one
- **`hiddenNodes` + `flattenVisible(hidden)`** — prune at directory boundary; matches
  `git ls-files --directory`
- **`failureLine`** — status bar shows the signal, not git’s advice dump
- **`GIT_TERMINAL_PROMPT=0`** — non-negotiable for any future mutate
- **Image tabs without buffers** — “never written back” is structural
- **Sidebar as multi-view panel** — tabs + `showView` (once landed) match VS Code SC

### Remaining engineering debt

| Area | Improvement |
| --- | --- |
| Git queries still `spawnSync` | Async + debounce for monorepos; keep first-frame deferral |
| `ignoredPaths` re-run with tree refresh | OK for now; watch cost on huge ignore sets |
| Project search sync walk | Background + progressive results + cancel |
| Keymap triple source | `keys.ts` + `keyboard.ts` + `commands.ts` still drift risk |
| Config | JSON Schema; optional project-local overlay |
| OpenTUI | Kitty/sixel for images; incremental highlight if upstream fixes |

### Refactors worth doing

1. EditorPane decomposition  
2. Keybinding registry (one table)  
3. `core/git` query vs mutate split (ARCHITECTURE already wants this)  
4. Shared ignore policy module when search should match the tree  
5. Session v2 (cursor, scroll, preview vs pin)

### Avoid

- Extension system early  
- Full Neovim parity  
- Extra undo stacks  
- Putting every toggle back into the palette (settings page won)

---

## 3. Feature roadmap

Effort: **S** &lt;1 day · **M** few days · **L** week+ · **XL** multi-week.

### P0 — Finish the current surface

| ID | Item | Effort | Notes |
| --- | --- | --- | --- |
| P0.1 | Fix ARCHITECTURE git docs (query vs mutate) | S | §1.1 — README already honest |
| P0.2 | `file:line:col` | S | §1.2 |
| P0.3 | Land SidebarTabs (Files / Git strip) | S | §1.6 — tests + ship |
| P0.4 | README: mention image viewer | S | code already shipped |
| P0.5 | **Project-wide replace** (preview + confirm) | M | Still the big daily-driver hole |
| P0.6 | Find next / previous without reopening panel | S | |
| P0.7 | Save all | S | only `autoSaveOnBlur` / single save today |

~~P0 showDotfiles / respectGitignore~~ — **done**  
~~P0 settings / diff layout UI~~ — **done**  
~~P0 credential hang~~ — **done**  
~~P0 image viewer~~ — **done**  
~~P0 document tree-only hide~~ — **done** (ARCHITECTURE + README table)

### P1 — Language intelligence

| ID | Item | Effort |
| --- | --- | --- |
| P1.0 | Format on save / format command (external) | M |
| P1.1 | Diagnostics list + gutter (shell runners or LSP) | L |
| P1.2 | Go to definition / references | L |
| P1.3 | Hover | M |
| P1.4 | Completions | XL |
| P1.5 | Document symbols (tree-sitter first) | M |

**Phase 0** before full LSP: configured formatters + `problems` from `tsc` / `ruff` /
`eslint`. Then JSON-RPC client, never on the key path.

### P2 — Editing power

| ID | Item | Effort |
| --- | --- | --- |
| P2.1 | Bracket match + jump | M |
| P2.2 | Select all matches in file | L |
| P2.3 | Expand selection | M |
| P2.4 | Soft wrap toggle + ruler | S |
| P2.5 | Spaces vs tabs + EditorConfig | M |
| P2.6 | Detect indent | S |
| P2.7 | Block comments (HTML/CSS) | S |
| P2.8 | Join / sort / trim selection | S |

### P3 — Vim 80%

| Priority | Ops |
| --- | --- |
| High | `%` · `*`/`#` · `/` `?` `n` `N` · `.` · `iw`/`aw`/`i"`/`a"` |
| Medium | Marks, jump list, `Ctrl-d/u`, named registers |
| Low | Visual block, macros, `:` |

`f`/`t`/`F`/`T` and the `;` `,` that repeat them are shipped — `editor/vim.ts`,
tests in `test/vim-find.test.tsx`.

### P4 — Navigation & workspace

| ID | Item | Effort |
| --- | --- | --- |
| P4.1 | Recent files | M |
| P4.2 | Recent projects | M |
| P4.3 | Restore cursor + scroll per tab | M |
| P4.4 | Jump back / forward | M |
| P4.5 | Split panes | XL — after EditorPane split |
| P4.6 | Zen mode | S |

### P5 — Git depth

| ID | Item | Effort |
| --- | --- | --- |
| P5.1 | Discard file (hard confirm) | M |
| P5.2 | Stage / discard hunk from diff | L |
| P5.3 | Blame on demand | M |
| P5.4 | Branch checkout | M |
| P5.5 | Conflict-marker nav | M |
| P5.6 | Async status for large repos | M |

Mutations already: commit, undo commit, push, fetch, pull, stash, stash pop, diff file/all.

### P6 — Search quality

| ID | Item | Effort |
| --- | --- | --- |
| P6.1 | User exclude globs | M |
| P6.2 | Optional search respects gitignore / hide dots | M |
| P6.3 | Search history | S |
| P6.4 | Better fuzzy basename scoring | M |
| P6.5 | Progressive project search | M |

### P7 — Languages & media

| ID | Item | Effort |
| --- | --- | --- |
| P7.1 | Markdown preview | M |
| P7.2 | YAML / Svelte when grammars work | M |
| P7.3 | Kitty/sixel images | L |
| P7.4 | Clear refuse for non-PNG/JPEG | S |

### P8 — Product

| ID | Item | Effort |
| --- | --- | --- |
| P8.1 | Publish Homebrew tap | M |
| P8.2 | “Open config file” command | S |
| P8.3 | Config JSON Schema | M |
| P8.4 | Windows terminal matrix | M |
| P8.5 | Perf budgets in CI | M |
| P8.6 | Telemetry: none (document) | — |

---

## 4. Competitive gap map

| Capability | Micro | Helix | Neovim | **Druk now** | Target |
| --- | --- | --- | --- | --- | --- |
| Mouse + tree + tabs | Partial | No | Extensions | **Strong** | Best-in-class |
| Settings UX | Basic | Config file | Extensions | **Strong** (live page) | Keep |
| VS Code-like chords | Partial | No | Configurable | **Stronger** (`Ctrl+P` / F1) | Keep |
| Single binary | Yes | Yes | No | **Strong** | Keep |
| Tree-sitter | No | Yes | Yes | **Strong** | Keep |
| Image open | — | — | Extensions | **Good** (half-block PNG/JPEG) | Kitty later |
| LSP / diagnostics | Extensions | Yes | Yes | **None** | Must close |
| Multi-cursor | Yes | Select | Extensions | **None** | Select-all-matches |
| Git UI | Basic | None built-in | Extensions | **Good+** (panel; tabs landing) | Best TUI git-lite |
| Project replace | Yes | Yes | Yes | **No** | Close |
| Configurable keys | Yes | Yes | Yes | **Hardcoded** | Medium |
| Extensions | Small | No | Huge | **None** | Stay none |

---

## 5. Release themes (revised)

### v1.7 — Trust & polish

- ARCHITECTURE git truth (query vs mutate)  
- Land SidebarTabs  
- `file:line:col`  
- README image viewer mention  
- (Settings page + hide settings + image viewer + key layout already on `main`)

### v1.8 — Search & replace

- Project-wide replace  
- Find next/prev  
- Exclude globs / optional ignore in search  
- Fuzzy scoring  

### v1.9 — Editor power

- EditorPane split  
- Bracket matching  
- Select all matches  
- EditorConfig  
- Vim search + `.`  

### v2.0 — Language awareness

- Format + problems  
- Diagnostics gutter  
- Goto definition  
- Format on save  

### Later

- Splits, blame, hunk stage, completions, Homebrew public tap  

---

## 6. Testing bar

Keep:

- Frame assertions for UI  
- `perf.test.tsx` ratios  
- Named cast helpers only  
- `bun run check`  

Add / extend for:

- Settings page (exists: `settings-view.test.tsx`)  
- Image viewer (exists: `image.test.ts`, `image-view.test.tsx`)  
- SidebarTabs / `showView` (missing while uncommitted)  
- Project replace edge cases  
- `file:line:col`  
- Git failureLine + credential env (partially covered in `git.test.tsx`)  

---

## 7. Explicit “not now”

1. Extension API  
2. Embedded terminal  
3. Debugger / DAP  
4. Collaborative editing  
5. AI as a core dependency  
6. Full vim ex line  
7. Multi-root until splits  
8. Reimplementing OpenTUI’s buffer  

---

## 8. Top 10 remaining (reordered)

1. **Fix ARCHITECTURE git docs** (query vs mutate — README already honest).  
2. **Project-wide replace**.  
3. **`file:line:col`**.  
4. **Land SidebarTabs** + tests.  
5. **Language pipeline** (format + diagnostics first).  
6. **Split EditorPane**.  
7. **Async git / search** for monorepos.  
8. **Select all matches** + find next/prev.  
9. **Vim `/` + `.`**.  
10. **Homebrew tap** + optional search-ignore policy.

---

## 9. Open product decisions

1. Should hide-dotfiles / gitignore eventually apply to **search and fuzzy open**?  
2. LSP timing: v1.9 polish vs jump to v2.0 language work?  
3. Git discard / checkout — power vs safety brand?  
4. Themes: keep live preview in palette forever, or only settings?  
5. Integrated terminal: still no?

**Defaults still recommended:** tree-only hide (already documented); LSP in v2.0 theme;
vim 80%; discard with hard confirm; themes stay in palette; no extensions; no embedded
terminal.
