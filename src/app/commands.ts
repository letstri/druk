/**
 * Command registry — the catalogue of everything druk can do. This tree is the
 * command palette (F1 / Ctrl+Shift+P), so it doubles as the feature index.
 *
 * A command either runs (`run`) or opens a submenu (`children`), never both.
 * Typing in the palette searches every leaf across all levels, so nesting keeps
 * the list short without hiding anything.
 *
 * To add a command: add an action to `CommandActions`, then an entry below. Set
 * `hint` when a keybinding also triggers it (keybindings live in App).
 */
import { NOTE_KINDS, NOTE_LABELS } from '../core/review'
import type { NoteKind } from '../core/review'
import type { FoldOp } from '../editor/folds'
import { iconThemeLabel, iconThemeNames, iconThemeNeedsFont } from '../icons'
import { themeLabel, themeNames } from '../themes'
import type { ThemeName } from '../themes'
import { ALT } from '../ui/keys'

export interface Command {
  id: string
  label: string
  /** Keybinding shown right-aligned, e.g. "Ctrl+S". Leaves only. */
  hint?: string
  run?: () => void
  /** Paint a value while the selection sits on it — used by the themes submenu. */
  preview?: () => void
  /** Put back what the config says, once the preview is over. */
  restore?: () => void
  children?: Command[]
}

export interface CommandActions {
  save: () => void
  saveAll: () => void
  openFile: () => void
  switchTab: () => void
  closeOthers: () => void
  closeAll: () => void
  gotoLine: () => void
  gotoDefinition: () => void
  openFileUnderCursor: () => void
  undo: () => void
  redo: () => void
  findInFile: () => void
  findInProject: () => void
  replaceInFile: () => void
  replaceInProject: () => void
  newFile: () => void
  newFolder: () => void
  rename: () => void
  cutForMove: () => void
  copyForPaste: () => void
  copyPath: () => void
  copyRelativePath: () => void
  paste: () => void
  remove: () => void
  closeTab: () => void
  reopenTab: () => void
  nextTab: () => void
  prevTab: () => void
  navBack: () => void
  navForward: () => void
  toggleFocus: () => void
  toggleSidebar: () => void
  collapseSidebar: () => void
  toggleGitView: () => void
  togglePreview: () => void
  toggleMarkdown: () => void
  toggleWrap: () => void
  setTheme: (name: ThemeName) => void
  previewTheme: (name: ThemeName) => void
  restoreTheme: () => void
  setIconTheme: (id: string) => void
  previewIcons: (id: string) => void
  restoreIcons: () => void
  lineOp: (op: 'comment' | 'up' | 'down' | 'duplicate') => void
  foldOp: (op: FoldOp) => void
  triggerCompletion: () => void
  openSettings: () => void
  openProjectSettings: () => void
  problemsList: () => void
  problemsNext: () => void
  problemsPrev: () => void
  restartLsp: () => void
  uninstallServer: (id: string) => void
  lspStatus: () => void
  gitDiffFile: () => void
  gitCompareBranches: () => void
  gitDiffBase: () => void
  gitDiffBaseReset: () => void
  /** Not a command: the panel's cursor is what opens a diff, and this is it. */
  showDiff: (path: string) => void
  /** Not commands: the source-control panel's cursor, moved and pressed. */
  gitMoveTo: (row: number) => void
  gitActivateRow: (row: number) => void
  gitOpenRow: (row: number) => void
  /** Not a command: `App` runs it when git or a buffer moves under an open diff. */
  refreshDiff: () => void
  gitCommit: () => void
  gitUndoCommit: () => void
  gitPush: () => void
  gitFetch: () => void
  gitPull: () => void
  gitStash: () => void
  gitStashPop: () => void
  gitSwitchBranch: () => void
  gitNewBranch: () => void
  gitNewBranchFrom: () => void
  gitMergeBranch: () => void
  gitRenameBranch: () => void
  gitDeleteBranch: () => void
  gitDeleteBranchForce: () => void
  openReview: () => void
  reviewNote: () => void
  reviewNoteOf: (kind: NoteKind) => void
  reviewFetch: () => void
  reviewClear: () => void
  /** Not commands: the review panel's cursor, moved and pressed. */
  reviewMoveTo: (row: number) => void
  /** The cursor as a pager — move it, and put the code it points at up. */
  reviewMove: (delta: number) => void
  /** The code the cursor already points at, for the panel just opened. */
  reviewShow: () => void
  reviewActivate: (row: number) => void
  reviewCollapseAll: () => void
  openExtensions: () => void
  reloadExtensions: () => void
  updateExtensions: () => void
  checkExtensionUpdates: () => void
  showHelp: () => void
  quit: () => void
}

export interface CommandContext {
  activeTheme: ThemeName
  activeIconTheme: string
}

/** Marks the entry matching the current setting, so submenus show state. */
const check = (on: boolean) => (on ? '* ' : '  ')

export function buildCommands(actions: CommandActions, ctx: CommandContext): Command[] {
  return [
    { id: 'open', label: 'Open file…', hint: 'Ctrl+P', run: actions.openFile },
    { id: 'save', label: 'Save file', hint: 'Ctrl+S', run: actions.save },
    { id: 'goto', label: 'Go to line…', hint: 'Ctrl+G', run: actions.gotoLine },
    { id: 'undo', label: 'Undo', hint: 'Ctrl+Z', run: actions.undo },
    { id: 'redo', label: 'Redo', hint: 'Ctrl+Y', run: actions.redo },
    {
      id: 'find',
      label: 'Find',
      children: [
        { id: 'find.file', label: 'In current file', hint: 'Ctrl+F', run: actions.findInFile },
        {
          id: 'find.project',
          label: 'In project',
          hint: 'Ctrl+R',
          run: actions.findInProject,
        },
        {
          id: 'find.replace',
          label: 'Replace in current file',
          hint: 'Ctrl+F then Tab',
          run: actions.replaceInFile,
        },
        {
          id: 'find.replaceProject',
          label: 'Replace in project',
          run: actions.replaceInProject,
        },
      ],
    },
    {
      id: 'file',
      label: 'File',
      children: [
        { id: 'file.saveAll', label: 'Save all', run: actions.saveAll },
        { id: 'file.new', label: 'New file', hint: 'Ctrl+N', run: actions.newFile },
        { id: 'file.newDir', label: 'New folder', hint: `Ctrl+${ALT}+N`, run: actions.newFolder },
        { id: 'file.rename', label: 'Rename…', hint: 'r', run: actions.rename },
        { id: 'file.cut', label: 'Cut for moving', hint: 'x', run: actions.cutForMove },
        { id: 'file.copy', label: 'Copy', hint: 'c', run: actions.copyForPaste },
        { id: 'file.paste', label: 'Paste here', hint: 'p', run: actions.paste },
        {
          id: 'file.copyPath',
          label: 'Copy path',
          hint: `Ctrl+${ALT}+C`,
          run: actions.copyPath,
        },
        {
          id: 'file.copyRelativePath',
          label: 'Copy relative path',
          run: actions.copyRelativePath,
        },
        { id: 'file.delete', label: 'Delete…', hint: 'd', run: actions.remove },
      ],
    },
    {
      id: 'git',
      label: 'Git',
      children: [
        // The only way in: it opens the source-control panel on this file, which
        // is where the cursor pages through every other change.
        { id: 'git.diffFile', label: 'Diff current file', run: actions.gitDiffFile },
        // What the whole editor compares against — the panel names the branch
        // while one is picked, so the pair reads as a mode you are in or out of.
        { id: 'git.diffBase', label: 'Compare against branch…', run: actions.gitDiffBase },
        {
          id: 'git.diffBaseReset',
          label: 'Compare against HEAD',
          run: actions.gitDiffBaseReset,
        },
        {
          id: 'git.compare',
          label: 'Compare branches',
          hint: 'B in source control',
          run: actions.gitCompareBranches,
        },
        { id: 'git.commit', label: 'Commit…', run: actions.gitCommit },
        { id: 'git.undo', label: 'Undo last commit', run: actions.gitUndoCommit },
        { id: 'git.push', label: 'Push', run: actions.gitPush },
        { id: 'git.fetch', label: 'Fetch', run: actions.gitFetch },
        { id: 'git.pull', label: 'Pull (fast-forward only)', run: actions.gitPull },
        { id: 'git.stash', label: 'Stash changes', run: actions.gitStash },
        { id: 'git.stashPop', label: 'Stash pop', run: actions.gitStashPop },
        {
          id: 'git.branch',
          label: 'Branch',
          children: [
            {
              id: 'git.branch.switch',
              label: 'Switch branch…',
              hint: 'b in source control',
              run: actions.gitSwitchBranch,
            },
            { id: 'git.branch.new', label: 'New branch…', run: actions.gitNewBranch },
            { id: 'git.branch.newFrom', label: 'New branch from…', run: actions.gitNewBranchFrom },
            {
              id: 'git.branch.merge',
              label: 'Merge branch into current…',
              run: actions.gitMergeBranch,
            },
            { id: 'git.branch.rename', label: 'Rename branch…', run: actions.gitRenameBranch },
            { id: 'git.branch.delete', label: 'Delete branch…', run: actions.gitDeleteBranch },
            {
              id: 'git.branch.deleteForce',
              label: 'Delete branch (force)…',
              run: actions.gitDeleteBranchForce,
            },
          ],
        },
      ],
    },
    {
      // Reading code with an agent beside you: notes on lines, the pull
      // request's own comments, and the Markdown block that carries both into a
      // prompt. Nothing here writes to a forge — the clipboard is the way out.
      id: 'review',
      label: 'Review',
      children: [
        {
          id: 'review.panel',
          label: 'Review panel',
          hint: `Ctrl+${ALT}+R`,
          run: actions.openReview,
        },
        {
          id: 'review.note',
          label: 'Note this line…',
          hint: `Ctrl+${ALT}+A`,
          run: actions.reviewNote,
        },
        // The four spelled out as well as behind the chooser: a palette that
        // knows what you meant is one keystroke shorter than one that asks.
        ...NOTE_KINDS.map(kind => ({
          id: `review.note.${kind}`,
          label: `Note this line as ${NOTE_LABELS[kind].toLowerCase()}…`,
          run: () => actions.reviewNoteOf(kind),
        })),
        {
          id: 'review.fetch',
          label: 'Fetch pull request comments',
          run: actions.reviewFetch,
        },
        { id: 'review.clear', label: 'Clear review notes', run: actions.reviewClear },
      ],
    },
    {
      id: 'problems',
      label: 'Problems',
      children: [
        { id: 'problems.list', label: 'List problems', run: actions.problemsList },
        { id: 'problems.next', label: 'Next problem', run: actions.problemsNext },
        { id: 'problems.prev', label: 'Previous problem', run: actions.problemsPrev },
        {
          id: 'problems.restart',
          label: 'Restart language servers',
          run: actions.restartLsp,
        },
        {
          id: 'problems.servers',
          label: 'Language server status',
          run: actions.lspStatus,
        },
      ],
    },
    {
      id: 'tabs',
      label: 'Tabs',
      children: [
        { id: 'tabs.switch', label: 'Switch to…', hint: 'Ctrl+T', run: actions.switchTab },
        { id: 'tabs.close', label: 'Close tab', hint: 'Ctrl+W', run: actions.closeTab },
        {
          id: 'tabs.reopen',
          label: 'Reopen closed tab',
          hint: `Ctrl+${ALT}+T`,
          run: actions.reopenTab,
        },
        { id: 'tabs.closeOthers', label: 'Close other tabs', run: actions.closeOthers },
        { id: 'tabs.closeAll', label: 'Close all tabs', run: actions.closeAll },
        { id: 'tabs.next', label: 'Next tab', hint: `Ctrl+${ALT}+→`, run: actions.nextTab },
        { id: 'tabs.prev', label: 'Previous tab', hint: `Ctrl+${ALT}+←`, run: actions.prevTab },
        // Not the tab order but the order they were visited in — a jump to a
        // definition and the way back from it, the arrows on the strip do this.
        { id: 'nav.back', label: 'Go back', hint: `Ctrl+${ALT}+Z`, run: actions.navBack },
        {
          id: 'nav.forward',
          label: 'Go forward',
          hint: `Ctrl+${ALT}+Y`,
          run: actions.navForward,
        },
      ],
    },
    {
      id: 'view',
      label: 'View',
      children: [
        {
          id: 'view.sidebar',
          label: 'Toggle sidebar',
          hint: 'Ctrl+B',
          run: actions.toggleSidebar,
        },
        {
          id: 'view.git',
          label: 'Source control (commit / push)',
          hint: `Ctrl+${ALT}+G`,
          run: actions.toggleGitView,
        },
        {
          id: 'view.collapse',
          label: 'Collapse folders in sidebar',
          hint: '▴ in its header',
          run: actions.collapseSidebar,
        },
        {
          id: 'view.preview',
          label: 'Preview file (no tab)',
          hint: 'Space in tree',
          run: actions.togglePreview,
        },
        {
          id: 'view.markdown',
          label: 'Markdown: rendered / source',
          hint: `Ctrl+${ALT}+M`,
          run: actions.toggleMarkdown,
        },
        {
          id: 'view.wrap',
          label: 'Toggle word wrap',
          run: actions.toggleWrap,
        },
        {
          id: 'view.focus',
          label: 'Focus tree / editor',
          hint: 'Tab in · Esc out',
          run: actions.toggleFocus,
        },
      ],
    },
    {
      id: 'themes',
      label: 'Themes',
      // Only the picker: following the OS appearance, the light and dark slots
      // and the transparent background are set once, so they live on the settings
      // page. This list stays for the arrow-through live preview.
      // `themeNames()`, not a constant: an extension's themes are registered at
      // startup and belong in this list exactly like the shipped ones.
      children: themeNames().map(name => ({
        id: `themes.${name}`,
        label: `${check(ctx.activeTheme === name)}${themeLabel(name)}`,
        preview: () => actions.previewTheme(name),
        restore: () => actions.restoreTheme(),
        run: () => actions.setTheme(name),
      })),
    },
    {
      id: 'icons',
      label: 'File icons',
      // Beside Themes and for the same reason: the arrow-through preview is the
      // whole of choosing one, and a set that wants a patched font says so here
      // rather than after it has been picked and the tree has gone to tofu.
      children: iconThemeNames().map(id => ({
        id: `icons.${id}`,
        label: `${check(ctx.activeIconTheme === id)}${iconThemeLabel(id)}${
          iconThemeNeedsFont(id) ? ' — needs a patched font' : ''
        }`,
        preview: () => actions.previewIcons(id),
        restore: () => actions.restoreIcons(),
        run: () => actions.setIconTheme(id),
      })),
    },
    {
      id: 'editor',
      label: 'Editor',
      children: [
        // Under Editor rather than at the root: the root list is as long as the
        // palette can draw, and typing finds a leaf at any level anyway.
        {
          id: 'goto.definition',
          label: 'Go to definition',
          hint: 'F12',
          run: actions.gotoDefinition,
        },
        {
          id: 'goto.file',
          label: 'Open file under cursor',
          hint: `Ctrl+${ALT}+O`,
          run: actions.openFileUnderCursor,
        },
        // Also commands because the chords are not always sendable: some layouts
        // have no byte for Ctrl+/ at all.
        {
          id: 'editor.comment',
          label: 'Toggle comment',
          hint: 'Ctrl+/ · Ctrl+L',
          run: () => actions.lineOp('comment'),
        },
        {
          id: 'editor.lineUp',
          label: 'Move line up',
          hint: `${ALT}+↑`,
          run: () => actions.lineOp('up'),
        },
        {
          id: 'editor.lineDown',
          label: 'Move line down',
          hint: `${ALT}+↓`,
          run: () => actions.lineOp('down'),
        },
        {
          id: 'editor.duplicate',
          label: 'Duplicate line',
          hint: `${ALT}+Shift+↓`,
          run: () => actions.lineOp('duplicate'),
        },
        {
          id: 'editor.complete',
          label: 'Trigger autocomplete',
          hint: 'Ctrl+Space',
          run: actions.triggerCompletion,
        },
        {
          id: 'editor.fold',
          label: 'Fold block at cursor',
          hint: `Ctrl+${ALT}+S`,
          run: () => actions.foldOp('fold'),
        },
        {
          id: 'editor.unfold',
          label: 'Unfold block at cursor',
          hint: `Ctrl+${ALT}+E`,
          run: () => actions.foldOp('unfold'),
        },
        {
          id: 'editor.foldAll',
          label: 'Fold everything',
          run: () => actions.foldOp('foldAll'),
        },
        {
          id: 'editor.unfoldAll',
          label: 'Unfold everything',
          run: () => actions.foldOp('unfoldAll'),
        },
      ],
    },
    {
      id: 'extensions',
      label: 'Extensions',
      children: [
        // A sidebar view rather than a submenu of its own: installing, disabling
        // and uninstalling are one list of the same things, and a palette that
        // walks in and out of itself between them reads as three unrelated
        // commands. What is left here is what has no row in that list.
        {
          id: 'extensions.panel',
          label: 'Extensions panel',
          hint: `Ctrl+${ALT}+X`,
          run: actions.openExtensions,
        },
        {
          id: 'extensions.check',
          label: 'Check for extension updates',
          run: actions.checkExtensionUpdates,
        },
        { id: 'extensions.update', label: 'Update extensions', run: actions.updateExtensions },
        // Manifests are read once, at startup — this is how a theme being
        // written is seen without restarting the editor.
        { id: 'extensions.reload', label: 'Reload extensions', run: actions.reloadExtensions },
      ],
    },
    // Vim, tab size, trim, auto-save and the rest live on the settings page —
    // the palette carries features, not configuration. Themes stay above for
    // the arrow-through live preview.
    { id: 'settings', label: 'Settings', run: actions.openSettings },
    // The same page on its other file — the one that stays with the project.
    {
      id: 'settings-project',
      label: 'Settings: this project',
      run: actions.openProjectSettings,
    },
    { id: 'help', label: 'Keyboard shortcuts', run: actions.showHelp },
    { id: 'quit', label: 'Quit', hint: 'Ctrl+Q', run: actions.quit },
  ]
}

export interface FlatCommand {
  command: Command
  /** Breadcrumb of ancestor labels, e.g. ["Themes"]. */
  trail: string[]
}

/** Every runnable leaf, with its path — used while filtering. */
export function flattenCommands(commands: Command[], trail: string[] = []): FlatCommand[] {
  return commands.flatMap(command =>
    command.children
      ? flattenCommands(command.children, [...trail, command.label])
      : [{ command, trail }],
  )
}
