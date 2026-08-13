# AGENTS.md

Instructions for AI agents working on **druk**, a terminal code editor.

`CLAUDE.md` is a symlink to this file — keep everything in here.

## What this project is

A TUI code editor built on [OpenTUI](https://github.com/anomalyco/opentui) (Solid
reconciler on a native Zig core). Shipped as a standalone binary — npm, Homebrew, a curl
installer — and run as a CLI.

Features: file tree with bulk file operations and opt-in hiding of dotfiles and
git-ignored files, the sidebar (Files / Git / Review / Extensions) on the left or the right
(`sidebarPosition`, settings → Files → Sidebar position, or palette → View →
Toggle sidebar position), a `▴` in the sidebar header that shuts every folder at once
(palette → View → Collapse folders in sidebar, which folds whichever of the two
sidebar views is up, and the button is drawn only while there is something to fold),
copy the path of a file to the system clipboard (`Ctrl+Opt+C`, palette → File → Copy
path / Copy relative path — whichever file the tree's cursor is on while the tree has
the keyboard, and the open file otherwise; sent over OSC 52 as well as to `pbcopy`/
`wl-copy`, so it reaches the clipboard of the terminal an SSH session is really on,
and a path outside the project has no relative form so it copies absolute and says so),
preview/pinned tabs that say what state their file is in — a dirty one keeps the `●`
where the close × goes, and a file its language server has something to say about
wears that server's worst mark (`●` error, `▲` warning, the glyphs the status bar and
the problems list use) in the slot before its name, with the name in the same colour;
the mark outranks the file icon rather than sitting beside it, so a tab that starts
erroring shifts nothing —
a quick look at the row under the tree's cursor that opens no
tab at all (Space in the tree, palette → View → Preview file — the file over the
editor slot, syntax-coloured, following the cursor as ↑↓ walks the tree and paging
with PgUp/PgDn, since the tree keeps the keyboard; Enter opens the file for real and
ends the mode, Space or Esc closes it, and a folder, an image, a PDF or a file too
big to read says so rather than showing nothing), tree-sitter syntax
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
dirty buffers instead of their disk copies so what is listed is what is replaced;
the last search of each scope outlives its panel — Ctrl+F and Ctrl+Opt+F each reopen
carrying the query that scope was last given, on the row it was last left on and with
the files it was left folded, with the text selected so the first keystroke replaces
it, so reading a hit and coming back is not a search thrown away; the toggles ride
along, being a mode rather than part of one query, and a selection wins over the
remembered query, being this moment's intent against the last one's, and brings back
neither row nor folds),
command palette,
themes, vim mode, a caret shape (`cursorStyle` — block, line or underline, which vim mode
overrides while it is on, since there the shape is what tells normal from insert),
word wrap on by default with a toggle (`wrap`, palette → View → Toggle word wrap —
off, a long line's tail is reached by moving the cursor into it, since OpenTUI
scrolls sideways only with the caret),
scrolling on past the last line until it is the only one left on screen
(`scrollPastEnd`, on as it is in VS Code, settings → Editor → Scroll past end —
the buffer stops with the last line at the *bottom*, so the end of a file is
otherwise read from the very edge of the terminal; `allowScrollPastEnd` in
`src/ui/EditorPane.tsx` rewrites the renderable's `handleScroll` for it, and has
to drag the caret along and drop the scroll margin while it is out there, the
renderer keeping the caret on screen being what would otherwise pull the view
straight back),
selecting a word by double-click and a line by triple-click (OpenTUI has no such
event, so both are counted from consecutive mouse-downs at one cell, the way the
file tree already counts its own; a line terminator is not a token, so a click
past the end of a line or on a blank line selects nothing rather than the `\n` —
which the next keystroke would otherwise pull the following line up over),
deleting whole lines (`Ctrl+Opt+D`, palette → Editor → Delete line — the cursor's
line, or every line a selection touches, the newline that ends each of them
included; the chord is D rather than every GUI editor's Ctrl+Shift+K, which is a
shifted Ctrl chord no terminal can deliver. It exists because a *selection* that
reaches the end of a line quietly covers the newline as well and the renderer
paints nothing there, so deleting one that looked like exactly one line pulled the
line below up onto the line above — [#75](https://github.com/letstri/druk/issues/75)),
going to the start of the current line (`Ctrl+Opt+B`, palette → Editor → Go to
beginning of line — Ctrl+E is the textarea's end of line, and Ctrl+A is select-all,
so the readline pair has no beginning half left; Ctrl+Opt+E already unfolds),
code folding (`Ctrl+Opt+S` / `Ctrl+Opt+E`, palette → Editor → Fold / Unfold block at
cursor, and fold/unfold everything: blocks come from indentation rather than from the
grammar, so they work for the languages druk paints with `patterns` and no tree at
all; a `▾` sits between the line number and the code of every foldable block and
`▸` where one is closed — clicking it folds or opens that block, since a terminal has
no hover to hide the control behind, and the column it needs is only reserved for a
file that has something to fold; the collapsed line says `⋯ N lines` after its text —
and, on the row the caret is on, the chord that opens it again, the `▸` being an
affordance only a mouse has —
and the gutter keeps the file's own numbering across the gap, a tab comes back folded
the way it was left, and anything that replaces the text wholesale — undo, a reload,
replace, moving lines — opens the file first),
git marks in tree/gutter/status bar plus a source-control panel in the sidebar
(changed files as a folder tree or a flat list — `gitPanelView` — folders folding on
→ / ←, or all of them from the header's `▴`; the files sit under VS Code's two
headings, `Staged Changes` and `Changes` — and, mid-merge, `Merge Changes` above both,
where every unmerged path sits as one row whatever porcelain's two columns say, Space
(git add) marks it resolved into Staged Changes, and Enter opens the file at its first
`<<<<<<<` marker — and Space is what moves a row between them —
`+`/`−` drawn on the cursor's row alone for a file or folder, a terminal having no
hover to hide a button behind, and always on the `Staged Changes` / `Changes` /
`Merge Changes` heading (that is VS Code's `+` on a group header, so every file
under it is staged or unstaged at once without walking onto the heading first). A
path staged and then edited again is a row under *each* heading, which is
what git reports and what makes staging the rest of it a thing to do, and the two
rows diff different things: staged is HEAD against the index, unstaged the index
against the working tree. Space on a heading or a folder carries everything under it,
folded or not. A commit box sits under the panel's
header, VS Code's message field: `c` (or a click) puts the keyboard in it, Enter
commits the index with its words — or, with nothing staged, offers to commit every
change behind a confirm naming the count — Esc leaves the rows with the message kept,
and under it a `✓ Commit` button beside `⇅ sync` (with the ↑↓ counts; `⇡ publish` on
a branch origin has never seen — one press pulls what origin has and pushes, `s` the
same). Under the change list sit VS Code's sync sections — `Incoming` and `Outgoing`,
the commits the branch is behind and ahead of its upstream by (capped at fifty rows a
side; the header's counts stay true), each folding like a heading, `↓`/`↑` where a
file wears its icon, and Enter opening the commit over the editor slot — the branch
comparison's detail page (`ComparisonView`) reused without a comparison, files paged
with ←/→ (`createCommitView` in `src/app/commitView.ts`). An empty heading is not
drawn, and
none of it exists against a comparison base, where there is no index to speak of),
for however many repositories the
opened folder holds: a folder that only *contains* checkouts (`~/code`, a folder of
worktrees) is scanned `gitScanDepth` levels down and every repository found is queried
in its own root, with the status bar and the panel header naming it (`beta/main`)
and each command acting on the *active* one — the repository of the change under the
panel's cursor, else of the open file, else the only one there is;
and file-level discard from a changed row (`d` or palette → Git → Discard changes,
all confirmed and scoped to that row's repository), plus palette
commands for commit/undo/stash/push/fetch/pull/sync, the VS Code commit variants
(Commit & push, Commit & sync, Commit (amend) — amend opens its prompt carrying the
old subject), Stashes… (a filterable picker — `ListPicker`, the `BranchPicker`
arrangement for any list of named things — then apply/pop/drop, drop behind a
confirm), Create/Delete tag…, Add/Remove remote… (name then URL as two prompts;
removal confirmed, it being config), and File history… (the open file's last fifty
commits, renames followed, a pick opening the commit over the editor the way an
Incoming/Outgoing row does) — a push origin
rejects offers to merge origin in and push again, VS Code's prompt, rather than
naming the two commands and stopping — and for branches
(switch, create, create-from, merge, rename, delete), a diff view (inline or
side-by-side — an added or deleted file is inline whatever `diffView` says, having no
second side to put beside it, the rows split view pads a side with are hatched
rather than left reading as blank editor — a terminal has no fill patterns, so the
strokes are written into the pane's own content — and a big change draws plain, the
header saying so: the renderable applies syntax as one native edit per span, and a
package-lock-sized document feeds it millions, minutes of frozen editor, so color
stops past a megabyte of sides or a thousand patch rows, and past ten thousand rows
the patch itself is cut with the header keeping the change's true counts) for whichever change the panel's cursor is
on — the arrows page through
them and Enter opens the changed file itself over the diff (a folder row folds
instead), the panel is the only way in, and the diff is a tab of its own in the strip
(`⇄ name`), so opening a file switches away from it instead of leaving it on top — a
comparison base that points marks, gutter, panel and diff at another branch instead of
HEAD (palette → Git → Compare against branch…), branch comparison against the
repository's default branch or any selected base (palette → Git → Compare branches, or
`B` in the panel) with merge-base file scoping, a commit list and lazily loaded diffs,
a review panel — a button of its own in the strip, carrying the count when there is one
(`Review 3`, falling to `R` in a narrow sidebar), and reached by `r` in the
source-control panel, by `Ctrl+Opt+R`, or from the palette; it is in the Shift+Tab cycle
with the other three and Esc leaves it the way the others are left — for reading
code with the remarks beside it: `Ctrl+Opt+A` drops a note on the line or selection under
the cursor (issue / suggestion / question / note, each spelled out in the palette as
well as behind the chooser), the notes show as `◆` in the gutter and after the line
(`reviewInline`, with the panel's chord after a remark the row was too narrow for —
the same "name the key where the text ran out" rule the diagnostics follow); a remark is
answered with `r` in the panel (palette → Review → Reply), which makes the two a thread —
an answer is a *note of its own* carrying the other's id in `parent`, never a field on
the note it answers, which is what keeps a conversation append-only and so safe for two
writers at once: an agent answers by appending `{"parent": "<id>", "author": "claude"}`
and druk's merge cannot lose it. The panel draws the answers under what they answer
(`↳ you`, `↳ @claude`), the card under the line shows the whole thread, the row after
the line says `ISSUE ↳2` since one line has room for the count and nothing more, `r`
answers whatever the card is showing (a heading stands in for its file's first remark,
as it does everywhere else), a reply to a reply joins the same thread rather than
nesting, deleting a note takes its answers with it, and a reply whose note another
writer deleted is listed on its own rather than vanishing. Notes
outlive the session in `review.json` beside the config — a file druk
does not own alone: an agent editing it while druk is open is the intended flow, so
another writer's notes appear live (the config directory is watched; a rename-replaced
file would strand a watcher on the file itself), druk's saves merge with what the file
holds rather than clobbering it (an id both sides hold is the file's to win — druk never
changes a note after creating it), land by temp-and-rename so a reader never catches
half a file, and set an unreadable file aside as `review.json.corrupt-<ts>` rather than
rewriting it from nothing; the panel's
cursor pages the editor the way the source-control panel's pages the diff — the remark's
file goes up in a preview tab at its line, the keyboard staying in the panel, and the
remark itself opens as a card under that line, GitHub's arrangement — drawn in a gap of
blank rows opened for it (`spacedView` in `src/editor/folds.ts`, the same "hand the buffer
a different text" trick a fold is), so it hides no code and the gutter's numbering carries
on across it: `spacers` names the rows that stand for no line and the gutter draws no
number on them (`setHideLineNumbers`), while `real` repeats the anchor's line so nothing
downstream has to learn about a row belonging to none. Three rules keep those rows
harmless: they are never in `source`, so saving, diffing and highlighting cannot see them;
`syncDocument` refuses to read the buffer back while a gap is open; and the card is torn
down the moment the *editor* takes the keyboard, which is what stops rows the file has not
from ever being typed into — `baseFold` is the folds alone and `folded()` is what the
buffer holds, which is the split that keeps a gap from being remembered or reconciled as
one. The trailing text is suppressed on the line the card is under so nothing is said
twice. Nothing in the review touches a network — a review is what the reader and the
agent sharing `review.json` have said to each other, and there is no forge, no token
and no fetch. An empty panel is where that is explained: it spells out the chord that
notes a line (asked of the keymap with `chordFor`, so a rebind renames it), the keys the
panel answers to, and where the notes are kept, since that is the half an agent has to
be told,
an image viewer (PNG/JPEG as half-block cells), a PDF viewer (page, zoom and pan controls
rendered into terminal cells), a rendered view for markdown files (`Ctrl+Opt+M`, palette → View — OpenTUI's
`<markdown>` renderable over the editor slot, per path so each tab keeps the view it
was left in, rendering the buffer rather than the file so unsaved edits show, and reached
from a `¶ preview` / `¶ source` button at the right of the tab strip that is drawn only
while a markdown tab is up — the command alone is one nobody finds), mermaid fences drawn
as diagrams in that view rather than printed as source (flowcharts, state, class and ER
through one layered graph engine; sequence diagrams and pie charts of their own; anything
else — gantt, mindmap, timeline — falls back to the fenced source), themes that follow the OS light/dark appearance (`themeSync`, on by default, with
`themeLight` / `themeDark` picked separately and defaulting to the GitHub pair —
polled, since no OS offers a portable subscription; `DRUK_OS_APPEARANCE=dark|light`
forces the answer on a desktop none of the probes can read), themes previewed live
while the selection sits on one — in the palette's Themes submenu and in the settings
page's three theme lists — and put back when the list is left without confirming;
icon sets pick and preview the same way (palette → File icons, which names the sets
wanting a patched font *before* one is chosen and the tree has gone to tofu) — a
theme previews through the theme store, which is already separate from the config,
while `iconTheme` is read straight off it, so previewing one without writing it to
disk needs `activeIconTheme`, the layer in `settings.ts` the tree reads instead,
an unpainted
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
since load order cannot say which of them answers completions, and the one that
answered is remembered per file, since `completionItem/resolve` only means
anything to the server that listed the item —
a single-file component is the case that needs *two* of them at once: since 3.0
the Vue server does no TypeScript of its own (there is no `hybridMode: false`
left to turn it back on), so `extensions/vue` names a second server —
`typescript-language-server` carrying `@vue/typescript-plugin`, which is what
makes a tsserver read a `.vue` at all — and the two divide the file, the tsserver
answering inside `<script>` and in interpolations and the Vue server answering
tags, directives and `<style>`. The Vue server reaches that tsserver *through
druk*: it sends a `tsserver/request` notification and blocks until the client
comes back with `tsserver/response`, which `answerTsserverRequests`
(`src/lsp/client.ts`) and `relayTsserverRequest` (`src/app/lsp.ts`) turn into a
`typescript.tsserverRequest` command put to a sibling server for the same
filetype. Every such request must be answered — with `null` when nothing can —
or the feature the server was serving never completes: an unanswered one is
completion in a `.vue` file that simply never opens a menu —
(gutter marks, dots on a track beside the scrollbar — errors
and warnings only, left of the git track and deliberately a different glyph —
inline message text after the line — what broke and not how to fix it, since a
server appends its advice to the same sentence (`help:`, `note:`, a second
paragraph) and that half is the longer one, so the row carries `headline()`'s
part of it and an ellipsis where there is more; `Ctrl+Opt+I`, palette → Problems →
Show problem at cursor reads the whole of it, the same modal as the list over the
cursor's line alone, which is what a terminal has instead of a hover — and the
chord is drawn dim after the note *on the caret's row alone*, since a key nobody
has been told about is a key nobody presses, and the same hint down every line
would be noise (`chordFor` in `src/ui/keys.ts` reads the spelling in force, so a
rebind renames the hint and unbinding it removes one) — status-bar
counts, a problems list in the palette — errors above warnings, each row the
severity glyph in its own colour, the path from the project root in a column the
rows share, the message, and the rule that fired (`eslint(import/no-cycle)`),
over a block that spells the selected row's whole message out, since a server's
sentence is routinely longer than a row and a list of them cut mid-word is a list
of diagnostics nobody can read — spans given a faint severity tint — no
underline, which OpenTUI can only draw in the text's own colour — except where
the server tagged them Unnecessary, where unused code fades toward the
background instead, and where it tagged them Deprecated, where the span is
struck through and keeps its colour — the strike is a text attribute
`SyntaxStyle.registerStyle` drops, so that one style is written to the native
table directly (`registerStruckThrough` in `src/languages/highlight.ts`); the
settings page toggles LSP, the inline text and each server, and edits per-server
commands; diagnostics arrive either way the protocol offers them — published, or
pulled with `textDocument/diagnostic` after every sync for the servers that
publish nothing; the project's own `node_modules/.bin` copy of a server is
preferred over anything global, and for TypeScript the project's installed
version *picks the server*: 7.x is the Go port, which ships no `tsserver.js` for
typescript-language-server to drive and speaks LSP itself, so a 7 project is
served by `tsc --lsp --stdio` and a 5/6 project by typescript-language-server; a
server that is not on PATH and has an npm package offers to install
itself — a prompt, never a silent fetch, naming the package managers on PATH so
the fetch goes through whichever of npm, bun or pnpm the user keeps (not yarn:
Berry resolves through Plug'n'Play and writes no `node_modules` for druk to find
the binary in), into `$XDG_DATA_HOME/druk/lsp`
rather than a global prefix, gated by `lspAutoInstall`; the answer is asked for
once and recorded in the prefix, since a `node_modules` written half by one
manager and half by another is a tree neither can take apart, and node has to be
there whatever fetched them, the servers being `#!/usr/bin/env node` scripts;
one that ships a
release binary instead (elixir's expert) is fetched the same way; and the
servers that come with a language toolchain print their install line instead; `typescriptTsdk`
picks which TypeScript typescript-language-server drives, empty leaving it to the
server — which prefers the open project's own copy; the servers restart on
demand, palette → Problems → Restart language servers, once an installed
extension brings servers of its own, and by themselves once a
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
`lspCompletion` — a row carries the kind glyph, the label with its matched
letters lit, the server's own signature and, at the right edge, where the symbol
comes from; under the list a counter names the selected item's kind, the key that
takes it (`Tab accepts` — dropped rather than cut on a row too narrow for it, and
the only place that says so while the menu covers the footer) and its
place in the list, and a panel carries that item's full signature and documentation,
markdown flattened for a terminal, fetched with `completionItem/resolve` once
the selection has rested a moment and cached per item; the panel's rows are
reserved rather than measured, so the box is one size for as long as it is open
— an item's docs change on every keystroke and a box that fitted itself to them
would jump under the cursor — and a pane too short for both drops the panel and
keeps the list), go to definition (F12, the server's answer in whichever of the
protocol's three shapes it comes) and open the file under the cursor
(`Ctrl+Opt+O` — the path or import specifier the cursor is in, resolved on disk
relative to the file and to the project root, then through the aliases
`tsconfig.json`/`jsconfig.json` declares, and only then handed to the language
server, which is what places a bare package or an alias druk cannot read),
a fuzzy file picker (`Ctrl+P` / `Ctrl+O`, and the same modal for Switch tab) that
reads a trailing `:line` or `:line:col` off the query as a destination rather than
as part of the path — the shape a compiler or a stack trace prints, so it is what
gets pasted in — filtering on what is left of it, echoing the landing place in its
footer, and clamping a line past the end of the file onto its last one,
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
as much as in the config file; Format document runs the same command on demand
(`Ctrl+Opt+L`, palette → Editor — Shift+Alt+F is not a distinct terminal chord
here, and Ctrl+Opt+F is already Find in project), Format open files does every
open text tab that has a formatter, and Save without formatting writes the
buffer without running one even when format-on-save is on), custom shortcuts (`keybindings` maps a
command id to one chord, replacing whatever it had — the settings page's Shortcuts
row lists every bindable command with the key it answers to, refuses a chord another
custom binding holds and names whatever default a rebind takes the key from, while a
clash or a value that is not a chord is reported on startup),
file icons in the tree and the source-control panel (`iconTheme` — `unicode` shapes any
font has, or a theme a
extension contributes: `material-icons` in the market is the Material Icon Theme's
associations and colours drawn with Material Design Icons, `nerd-icons` a smaller
Devicons set, both wanting a patched font, which they declare with `patchedFont`
so the editor can say so; the glyph takes the expansion
arrow's column, since a folder icon has an open and a closed form — in the git panel
that is the column a file row spent on nothing, so the two sidebar views line their
names up either way — and the
default is `none` because nothing can ask a terminal what its font holds; the same
icon reaches the tab strip with `tabIcons`, off by default because the strip is one
row and a column per tab is a tab fewer on a narrow terminal),
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
servers druk fetched for it, since those go with it and those are the megabytes;
`AVAILABLE` lists the whole registry minus what is already installed, so what can
be had is on screen without having to guess a name first — opening the view is
what fetches the catalog (`market.ready()`, the shared first fetch, from an effect
in `App.tsx`; deliberately not gated on `extensionUpdates`, which silences druk's
*own* offers, where opening this panel is the user asking) — and both headings
fold, since that list is long by default; a search box drawn under the header at
all times (`/`, or a click, starts typing into it) narrows both sections at once,
landing the cursor on its first hit so the Enter after it installs; every extension has
*categories* — `language`, `lsp`, `theme`, `icons`, derived from what it
contributes and never declared, since a manifest carrying `themes` is a theme
extension and a field saying otherwise could only be wrong (`categoriesOf` in
`src/extensions/manifest.ts` is the one place that decides, and the catalog
carries them per row) — which the search matches beside the name and every id
and filetype a manifest registers, and which the row draws dim beside the name
wherever the sidebar has columns going spare; the market list is capped at
fifty with a row saying what was left out — druk's own registry is well under
that, so the cap is for a fork's; `u` updates
everything and `r` re-reads the manifests. Only the two that are
settings — the startup check and the registry URL — are on the settings page,
an extension market — `extensions/` **in this repository**, one folder per extension, served
raw from `main`, so a merged pull request is installable without a druk release;
the panel's `AVAILABLE` section installs one after a confirm that names the
commands it would have druk spawn, an installed extension with a newer version in the
catalog is updated automatically by the startup check, the status bar saying so
(never a preinstalled one, which is part of the binary and updates with druk itself —
a disk copy of a built-in's id is skipped and reported rather than loaded; the confirm
is for first installs alone, an update being a question already answered), a file whose language no
installed extension serves offers the extension that does, and a config naming a theme
nothing registers is offered its extension back (`extensionUpdates` turns the whole of
that off, `extensionRegistry` points it at a fork),
file watching with conflict prompts, a save-all palette command (every unsaved tab
through the same clash-safe path the blur autosave uses, skips and failures named),
per-project session restore, and a startup update check.

**Everything extensible is an extension now, and most of them live in `extensions/`.**
An extension is one of two kinds and never both: a *language* extension (the grammar,
highlight query, patterns, line comment and label for one language, plus the
server that serves it) or an *appearance* extension (themes and icon themes).

What is compiled in: two themes (`dark` / `light`, the GitHub pair the defaults
name), the `unicode` icon theme, every tree-sitter grammar wasm — and a
*preinstalled* set of extension manifests, listed in `src/extensions/builtin.ts`:
typescript (ts/tsx/js/jsx), json, markdown, html, css, yaml, toml and dotenv. Those
are the languages a first run has to highlight with no network — dotenv among them
because a `.env` is a file every project has and nobody thinks to install a language
extension for.

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
bun run packages         # .deb/.rpm from the linux binaries, into dist/release/ (needs nfpm)
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

**The deb/rpm packages are a hard step of the release, not a tap-style extra.** The
publish job fetches nfpm pinned by version and by a SHA-256 written into the workflow
(a checksum fetched beside the artifact would verify nothing) and runs
`bun run packages` after the formula. It fails the release when it fails, on purpose:
`druk update` points system installs at these assets, so a release without them is the
published-pointer-to-nothing failure the npm and upload steps already refuse to allow
each other — the tap's graceful skip is for a result nothing reads.

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
| language | a `languages` entry in a market manifest — `extensions/<language>/extension.json`, then `bun run extensions`. `grammar` is `{"vendored": "<key in src/languages/grammars.ts>"}` for one druk embeds, `{"bundled": true}` for one OpenTUI carries, or `{"wasm": "…", "query": "…"}` for files in the extension folder. `patterns` are `{group, re, flags}` (regex as a string) for a format with no usable grammar; `extensions` / `filenames` / `filenamePattern` claim the names OpenTUI resolves none of. Adding a *vendored* grammar is still a source change: two static imports in `src/languages/grammars.ts`. A grammar that leaves another language's code as one opaque token (vue's `<script>` body is a single `raw_text`) captures that span as `@injection.<filetype>` in its query, and `resolveInjections` (`src/languages/highlight.ts`) reparses it with that filetype's grammar — one level deep, and skipped when no registered language carries that grammar |
| language server | a `languageServers` entry in a market manifest — `extensions/<language>/extension.json`, then `bun run extensions`. `install` is `{"kind": "npm", "packages": […]}` or `{"kind": "download", "urls": {"<platform>-<arch>": "…"}}` when druk can fetch it itself, and `{"kind": "manual", "command": "…"}` for a line to print — a `download` carries a `command` too, for the machines the release has no build for; `settings` is the server's own configuration object, passed through unvalidated (it is the *server's* shape, not druk's) and given to it both ways the protocol offers — answered to every `workspace/configuration` item and pushed once as `didChangeConfiguration`. Several servers may claim one filetype and all of them are spawned; users override per-server with the `lspServers` setting, which can only *replace* a command some extension declared (an empty one disables that server alone). A server whose command depends on what the project installed goes in `projectCommand` (`src/lsp/project.ts`) instead, which every server consults first — that part is code, and stays in `src/`, as does anything a manifest cannot spell: `initialize` options are `initializationOptionsFor` in `src/app/lsp.ts`, which is where typescript's tsdk and `vue-typescript`'s plugin path (a directory, found by `vuePluginLocation`) are worked out |
| PDF viewer | rendering in `src/core/pdf.ts`, UI in `src/ui/PdfView.tsx`, and bufferless routing in `src/app/workspace.ts` |
| mermaid diagram type | a parser in `src/core/mermaid/parse.ts` answering one of the models in `model.ts`, and a renderer for it in `index.ts`. A type that is a graph of boxes needs no renderer — map it onto `GraphDiagram` and `graph.ts` lays it out. Lines are drawn as the directions they leave a cell in (`canvas.ts`), never as characters, so corners and crossings resolve themselves; `set`/`text` are for glyphs that must win over a line. A type nothing draws must parse to `unsupported`, which is what makes the fence fall back to its source |
| theme | a `themes` entry in a market manifest — `extensions/<family>/extension.json`, one extension per palette family (catppuccin carries its four flavors), then `bun run extensions`. Only `dark` and `light` are built in, in `src/themes/`, because the defaults name them. Chrome roles that are a *relationship* between two colours (`border`, `sidebarBg`, `solidBg`) are derived in `colorsFor` there and are never listed by a theme. A `syntax` map lists *root* scopes and the sub-scopes it wants to differ: `styleIdForGroup` walks `type.builtin` → `type` by itself, and `FALLBACK_GROUP` (`src/languages/highlight.ts`) is what saves a root the theme never heard of — `attribute` → `property`, `constructor` → `function`, `namespace` → `type`. A group nothing resolves to paints as plain text, which is why that walk decides membership with `getStyle` and not with `getStyleId`: the native style table invents an id for any name it is asked about, so `getStyleId` never answers null |
| icon theme | an `icons` entry in a market manifest — one codepoint per glyph, since the tree gives it the arrow's single column, and a two-cell glyph is dropped rather than drawn (a Nerd Font one is not two-cell, wherever in the private-use planes it sits). A map's value may name an entry in `definitions`, whose `open` is the expanded form of a folder, so a set of thousands lists each icon once. `unicode` alone is built in (`src/icons/index.ts`), being the set any font already has |
| extension contribution kind | a list on the manifest (`src/extensions/manifest.ts`) parsed into `Extension` (`src/extensions/types.ts`), registered in `loadExtensions` (`src/extensions/index.ts`), and a `register…`/`clearExtension…` pair on whichever registry owns it — the registry has to be read through a function everywhere, since extensions load after the modules that list its contents are evaluated |
| tooltip on a chrome button | `useTooltip('<command id>')` on the element (`src/ui/tooltip.ts`), plus `ref` on its box — `TooltipLayer` draws every registered target, so nothing else has to change. A chord in force is what makes a tooltip exist at all: an unbound command draws nothing, the chord being the only thing a tooltip ever says |
| previewable value | `preview` + `restore` on the palette `Command` (`src/app/commands.ts`) or on a row's `select` (`src/ui/SettingsView.tsx`) — `preview` paints while the selection sits on the value, `restore` runs when the list is torn down, so it must put back what the config says rather than remember what it replaced |
| setting | `src/core/config.ts` (`Config`, `DEFAULTS`, `VALIDATORS` — one validator per key, since the project file is read key by key) + a row in `src/app/settings.ts` (`specs`, with the `key` it edits) so the settings page shows it — the page windows its rows to the terminal height, so a test that asserts on a late row needs a tall terminal or arrow keys to reach it (the wheel moves that window too, leaving the selection where the keyboard left it — a test wheeling it needs a flush per tick, OpenTUI's scroll acceleration dropping events sent faster than its minimum interval) |
| command | `src/app/commands.ts` + bind it in `src/app/actions.ts`; the implementation goes in the controller that owns the state (`workspace.ts`, `fileOps.ts`, `git.ts`, …) |
| keybinding | a row in `BINDABLE` (`src/app/keymap.ts`) plus a handler under the same id in `src/app/keyboard.ts` — or, for an editor-only key, `src/ui/EditorPane.tsx` — advertised in `src/ui/keys.ts` (feeds the footer hints, help overlay, Ctrl+K peek and the welcome screen), with the row's `ids` naming the commands it spells out |
| git error message | a row in `KNOWN` in `src/core/git.ts`, with the git output it matches pinned in `test/git.test.tsx` |
| terminal progress | the one status slot (`src/app/status.ts`) — a git mutation, bulk file op or install occupies it. A background operation takes it with `claimBusy`, which hands back the release and refuses to hand back anything else: an install that finds the slot taken runs without it rather than clearing a bulk delete's counter, since that would idle the bar mid-rewrite *and* reopen `whileFree` for a second op. `setBusy` is for updating a count already claimed. `reportProgress` (`src/core/progress.ts`) writes OSC 9;4 so Ghostty, WezTerm, iTerm2, kitty, Windows Terminal and recent VTE draw their own loader; an unsupported terminal is a no-op, and an exit hook puts the indicator out where `onCleanup` never runs |
| market extension | a folder under `extensions/` holding `extension.json`, then `bun run extensions` to regenerate `extensions/index.json` — `test/extensions-repo.test.ts` fails when the committed index is stale, and bumping the manifest `version` is what makes installed copies see an update |
| row in the extensions panel | `src/app/extensionsPanel.ts` (the cursor, the fold state and what Enter does); `src/ui/ExtensionsPanel.tsx` owns the `ExtensionRow` type, draws whatever `rows()` returns and reports clicks, and the keys live in `src/app/keyboard.ts` beside the tree's and the git panel's. Row/view-model types live in the ui component and the controller imports them — the `SettingRow` arrangement, enforced by `test/boundaries.test.ts` |
| sidebar view | `SidebarView` in `src/ui/SidebarTabs.tsx` (add a `short` initial — the strip falls back to those in a narrow sidebar), a branch in `App.tsx`'s sidebar, one in `keyboard.ts`'s pane switch, a `KeyScope` in `src/ui/keys.ts` with a `SCOPE_LABELS` entry in `KeyPeek.tsx`, a `toggle…View` on `src/app/panes.ts`, and its place in the Shift+Tab cycle, which is spelt out as one `showView` per pane block in `keyboard.ts` rather than held as a list |
| branch-comparison behaviour | git queries and models in `src/core/git.ts`, state and caches in `src/app/comparison.ts`, rows in `ComparePanel` and the detail page in `ComparisonView` |
| review row or key | `src/app/review.ts` (the notes, their replies, the fetched comments, the rows and what Enter does); `ui/ReviewPanel.tsx` draws `rows()` and reports clicks, the keys sit in `keyboard.ts` beside the git panel's, and the note's shape and where it is persisted are `src/core/review.ts`. A reply is a note carrying `parent`, so anything that lists remarks reads `threadStarts()` rather than `notes()` — a thread is one mark, one heading count and one card |
| source-control row kind | `ChangeRow` in `src/core/changeTree.ts` — `changeRows` builds the headings and `rowArea`/`rowRel`/`foldKey` are how a row's fold state is addressed, the area being part of the key because one path can sit under both headings at once. `changesFor` answers what a row *stands for*, and reads the change list rather than the rows: a folded folder's files are not in `rows` and staging one still has to reach them |
| git command | run it in `git.activeRepo()`, never in `rootDir` — the opened folder may hold several repositories and be none itself. A mutation goes through `gitOp`, which refuses when no repository is picked and *hands the chosen one to the callback*; an operation offered for a particular row pins `options.repo` so a later refresh cannot redirect it. A query asks `git.repoFor(path)` for the repository of the path it is about. A path passed after `--` is a *pathspec*, so it goes through `literal()` (`src/core/git.ts`) — `[`, `*` and `?` are glob metacharacters there, and `git clean -f -- '[id].tsx'` deletes `i.tsx` as well. Which repositories exist is `discoverRepos` (`src/core/repos.ts`), refreshed in `wireGitEffects` |

Key handlers subscribe through `useKeys` (`src/ui/useKeys.ts`), never OpenTUI's
`useKeyboard` directly: it renames a Ctrl chord to the US key the character sits on, so
a shortcut still fires with a Cyrillic layout up (`src/core/keylayout.ts`).

Anything clickable tints under the pointer: `useHover` (`src/ui/hover.ts`) wired to
`onMouseOver`/`onMouseOut` on the element's box — the events bubble, so one pair on a
row covers its texts — painting `ui.hoverBg`, a derived colour like `border`. Selection
outranks hover (`rowBg` in `src/ui/list.ts` encodes that for the sidebar panels), and
whole-pane focus clicks are not buttons, so they get no tint.

A chrome button also carries a tooltip: `useTooltip` (`src/ui/tooltip.ts`) is `useHover`
plus a `ref` and the id of the command the button runs, and `TooltipLayer` (mounted by
`App.tsx`, gated on the `tooltips` setting) draws whatever is registered. A tooltip is
that command's chord and nothing else — resting the pointer on one button gives that
button's, holding Ctrl or Cmd for half a second lights every registered button's at once.
Both halves wait: a chip drawn the moment the pointer crossed a button would flash chord
after chord as the mouse travelled the tab strip on its way to the editor, so hovering
counts out a dwell of its own (`DWELL_MS`), re-counted from the start on each button the
pointer reaches. The *tint* is not delayed — that is the button answering the pointer, and
one that took half a second to admit it is a button would read as a dead cell. No labels
either way: each of these buttons is already on screen with its own name or glyph, so a
box reading `Files` under a button labelled `Files` would be a box saying nothing. The
chord comes from `chordFor`, so a rebind renames a tooltip and an unbound command has none
at all — which is the intended shape, not a gap: binding one is what brings its tooltip
back. Six things are load-bearing:

- **The peek needs the kitty keyboard protocol**, which is why `src/main.tsx` asks for
  `events` *and* `allKeysAsEscapes`: a modifier is reported as a key of its own only when
  every key is, and its press and release only with event types on. Neither costs the
  existing keyboard anything — a release is emitted as `keyrelease`, which nothing but the
  peek listens to, and a key arriving as `CSI <code> u` parses back to the same name
  (`test/keylayout.test.tsx` drives the editor through that encoding, Cyrillic included).
  A terminal with no protocol ignores the request, and the peek is simply not there.
- **`useTooltip` is the one exception to the `useKeys` rule** above: `useKeys` cannot ask
  for release events, and a modifier's name needs no layout translation.
- **Tooltips are siblings of the app's rows, not a layer over them.** A renderable claims
  the cells it paints in the hit grid whether or not it handles a mouse event, so a
  full-screen box would swallow every click in the editor.
- **A tooltip is one row filled `statusBg`/`statusFg`, with no border and no shadow.** A
  border is drawable and costs two rows and two columns, which a dozen peek chips cannot
  afford; a shadow is not drawable at all, a cell holding one background, so "dimming what
  is behind" is painting solid dark cells over the editor. Colour is therefore the only
  thing separating a tooltip from content, and that pair is the one every palette
  guarantees legible — `panelBg` is the surface a floating *panel* is built from, which a
  tooltip is not.
- **The peek lights the buttons as well as naming their keys** — `useTooltip` returns
  `lit()` beside `hovered()`, and every call site paints its hover tint from that, so a
  screenful of chords says which control each one runs. It follows that a peek tooltip
  may never be drawn *over* a control: `placeTooltips` takes every registered box as an
  obstacle, which is why `useTooltip` registers a control with no command too. A hover
  chip is one, so it sits against its button and may cover a neighbour — walking around
  the explorer header is what used to put Ext's chord on the file list.
- **Placement is `placeTooltips` (`src/ui/tooltipLayout.ts`)**, pure and tested on its
  own: away from the nearer edge of the screen (the tab strip is row 0, the status bar the
  last), never over a control during a peek, stacked onto further rows where two would
  collide, and dropped where the terminal has run out — half a row of overlapping text
  says less than nothing. Hover passes no obstacles, so the chip stays on the nearest row.

The status bar's groups are buttons too, VS Code's arrangement: the branch opens the
branch switcher, the `↑↓` counts sync, `~n` shows the source-control panel, the problem
counts open the problems list, `● unsaved` saves, `Ln, Col` goes to a line, and a footer
hint runs the command its key advertises — `hintsFor` (`src/ui/keys.ts`) carries the
command id for that, and `installKeyboard` returns `run(id)` so a click and its key
cannot drift apart. Each group is a `Group` in `src/ui/StatusBar.tsx`, whose padding is
part of the target; the git group is drawn as three of them and `gitText()` stays the
one string the row's width is computed from.

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

`IMPROVEMENTS.md` is the roadmap and lives under the same rule, but a different
trigger: update it when a change makes one of its claims *false* — an item it lists as
missing that now ships, a module size it quotes, a piece of debt it calls open. Tick the
item off in the same change rather than leaving the file to be revalidated later; it once
drifted twelve minor versions behind, and a roadmap nobody trusts is a roadmap nobody
reads. Not every commit touches it — a change that ships nothing it tracks and
contradicts nothing it says leaves it alone. Its header carries the commit and version
it was last checked against, so bump that when you do revalidate it wholesale.

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
  `test/setup.ts` registers them, so typescript, json, markdown, html, css, yaml,
  toml and dotenv highlight as they do on a real first run. Anything else — Go, Python,
  tsrx, a market theme — needs `loadMarketExtensions()` at the top of the file, which
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
