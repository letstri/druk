import type { ConflictSide } from '../core/conflicts'
import { NOTE_KINDS, NOTE_LABELS } from '../core/review'
import type { NoteKind } from '../core/review'
import type { FoldOp } from '../editor/folds'
import { iconThemeLabel, iconThemeNames, iconThemeNeedsFont } from '../icons'
import { themeLabel, themeNames } from '../themes'
import type { ThemeName } from '../themes'
import type { ChangeSection, ChangesMeta } from '../ui/ChangesView'
import type { Command } from '../ui/CommandPalette'
import { ALT, rebound } from '../ui/keys'

export type { Command } from '../ui/CommandPalette'

export interface CommandActions {
  save: () => void
  saveAll: () => void
  saveWithoutFormatting: () => void
  formatDocument: () => void
  formatOpenFiles: () => void
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
  toggleSidebarPosition: () => void
  setTheme: (name: ThemeName) => void
  previewTheme: (name: ThemeName) => void
  restoreTheme: () => void
  setIconTheme: (id: string) => void
  previewIcons: (id: string) => void
  restoreIcons: () => void
  lineOp: (op: 'comment' | 'up' | 'down' | 'duplicate' | 'delete') => void
  lineHome: () => void
  foldOp: (op: FoldOp) => void
  triggerCompletion: () => void
  switchWorkspace: () => void
  openWorkspace: () => void
  newWorktree: () => void
  switchWorktree: () => void
  removeWorktree: () => void
  openSettings: () => void
  openProjectSettings: () => void
  problemsList: () => void
  problemsAtCursor: () => void
  problemsNext: () => void
  problemsPrev: () => void
  restartLsp: () => void
  uninstallServer: (id: string) => void
  lspStatus: () => void
  conflictNext: () => void
  conflictPrev: () => void
  conflictResolve: () => void
  conflictAccept: (side: ConflictSide) => void
  gitDiffFile: () => void
  gitDiffAll: () => void
  toggleDiffLayout: () => void
  allChanges: () => ChangeSection[]
  allChangesMeta: () => ChangesMeta
  gitCompareBranches: () => void
  gitDiffBase: () => void
  gitDiffBaseReset: () => void
  gitMoveTo: (row: number) => void
  gitActivateRow: (row: number) => void
  gitOpenRow: (row: number) => void
  gitDiscard: () => void
  gitToggleStage: (at?: number) => void
  gitToggleStageKey: (key: string) => void
  openChangeKey: (key: string, line: number | null) => void
  gitLandOnFile: () => void
  refreshChanges: () => void
  gitCommit: () => void
  gitCommitAndPush: () => void
  gitCommitAndSync: () => void
  gitCommitAmend: () => void
  gitFocusMessage: () => void
  gitCommitBox: () => void
  gitUndoCommit: () => void
  gitPush: () => void
  gitSync: () => void
  gitFetch: () => void
  gitPull: () => void
  gitStash: () => void
  gitStashPop: () => void
  gitStashList: () => void
  gitNewTag: () => void
  gitDeleteTag: () => void
  gitAddRemote: () => void
  gitRemoveRemote: () => void
  gitFileHistory: () => void
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
  reviewReply: () => void
  reviewClear: () => void
  reviewMoveTo: (row: number) => void
  reviewMove: (delta: number) => void
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
          hint: `Ctrl+${ALT}+F`,
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
        {
          id: 'file.saveWithoutFormatting',
          label: 'Save without formatting',
          run: actions.saveWithoutFormatting,
        },
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
        { id: 'git.diffFile', label: 'Diff current file', run: actions.gitDiffFile },
        {
          id: 'git.diffAll',
          label: 'Show all changes',
          hint: 'a in source control',
          run: actions.gitDiffAll,
        },
        {
          id: 'git.diffLayout',
          label: 'Toggle diff layout (inline / side-by-side)',
          hint: 'S in source control',
          run: actions.toggleDiffLayout,
        },
        {
          id: 'git.stage',
          label: 'Stage / unstage selection',
          hint: 'Space in source control',
          run: actions.gitToggleStage,
        },
        {
          id: 'git.discard',
          label: 'Discard changes',
          hint: 'd in source control',
          run: actions.gitDiscard,
        },
        {
          id: 'git.conflictResolve',
          label: 'Resolve conflict at cursor…',
          hint: `Ctrl+${ALT}+U`,
          run: actions.conflictResolve,
        },
        {
          id: 'git.acceptOurs',
          label: 'Accept current change (ours)',
          run: () => actions.conflictAccept('ours'),
        },
        {
          id: 'git.acceptTheirs',
          label: 'Accept incoming change (theirs)',
          run: () => actions.conflictAccept('theirs'),
        },
        {
          id: 'git.acceptBoth',
          label: 'Accept both changes',
          run: () => actions.conflictAccept('both'),
        },
        {
          id: 'git.conflictNext',
          label: 'Next conflict',
          hint: `Ctrl+${ALT}+J`,
          run: actions.conflictNext,
        },
        { id: 'git.conflictPrev', label: 'Previous conflict', run: actions.conflictPrev },
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
        // The palette filters by first substring match in this order: plain verbs above the compounds.
        { id: 'git.push', label: 'Push', run: actions.gitPush },
        { id: 'git.fetch', label: 'Fetch', run: actions.gitFetch },
        { id: 'git.pull', label: 'Pull (fast-forward only)', run: actions.gitPull },
        { id: 'git.sync', label: 'Sync (pull & push)', run: actions.gitSync },
        { id: 'git.commitPush', label: 'Commit & push…', run: actions.gitCommitAndPush },
        { id: 'git.commitSync', label: 'Commit & sync…', run: actions.gitCommitAndSync },
        { id: 'git.commitAmend', label: 'Commit (amend)…', run: actions.gitCommitAmend },
        { id: 'git.stash', label: 'Stash changes', run: actions.gitStash },
        { id: 'git.stashPop', label: 'Stash pop', run: actions.gitStashPop },
        { id: 'git.stashList', label: 'Stashes…', run: actions.gitStashList },
        { id: 'git.fileHistory', label: 'File history…', run: actions.gitFileHistory },
        { id: 'git.tagNew', label: 'Create tag…', run: actions.gitNewTag },
        { id: 'git.tagDelete', label: 'Delete tag…', run: actions.gitDeleteTag },
        { id: 'git.remoteAdd', label: 'Add remote…', run: actions.gitAddRemote },
        { id: 'git.remoteRemove', label: 'Remove remote…', run: actions.gitRemoveRemote },
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
        ...NOTE_KINDS.map(kind => ({
          id: `review.note.${kind}`,
          label: `Note this line as ${NOTE_LABELS[kind].toLowerCase()}…`,
          run: () => actions.reviewNoteOf(kind),
        })),
        {
          id: 'review.reply',
          label: 'Reply to the remark under the cursor…',
          run: actions.reviewReply,
        },
        { id: 'review.clear', label: 'Clear review notes', run: actions.reviewClear },
      ],
    },
    {
      id: 'problems',
      label: 'Problems',
      children: [
        { id: 'problems.list', label: 'List problems', run: actions.problemsList },
        {
          id: 'problems.detail',
          label: 'Show problem at cursor',
          hint: `Ctrl+${ALT}+I`,
          run: actions.problemsAtCursor,
        },
        { id: 'problems.next', label: 'Next problem', hint: 'F8', run: actions.problemsNext },
        {
          id: 'problems.prev',
          label: 'Previous problem',
          hint: `${ALT}+F8`,
          run: actions.problemsPrev,
        },
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
          id: 'view.sidebarPosition',
          label: 'Toggle sidebar position',
          run: actions.toggleSidebarPosition,
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
      // `themeNames()`, not a constant: an extension's themes are registered at startup.
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
        // Commands as well as chords: some layouts have no byte for Ctrl+/ at all.
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
          id: 'editor.lineStart',
          label: 'Go to beginning of line',
          hint: `Ctrl+${ALT}+B`,
          run: actions.lineHome,
        },
        {
          id: 'editor.deleteLine',
          label: 'Delete line',
          hint: `Ctrl+${ALT}+D`,
          run: () => actions.lineOp('delete'),
        },
        {
          id: 'editor.format',
          label: 'Format document',
          hint: `Ctrl+${ALT}+L`,
          run: actions.formatDocument,
        },
        {
          id: 'editor.formatOpen',
          label: 'Format open files',
          run: actions.formatOpenFiles,
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
        { id: 'extensions.reload', label: 'Reload extensions', run: actions.reloadExtensions },
      ],
    },
    {
      id: 'workspace',
      label: 'Workspace',
      children: [
        {
          id: 'workspace.switch',
          label: 'Switch workspace…',
          hint: `Ctrl+${ALT}+W`,
          run: actions.switchWorkspace,
        },
        { id: 'workspace.open', label: 'Open folder…', run: actions.openWorkspace },
        {
          id: 'workspace.worktreeSwitch',
          label: 'Switch worktree…',
          hint: 'w in source control',
          run: actions.switchWorktree,
        },
        { id: 'workspace.worktreeNew', label: 'New worktree…', run: actions.newWorktree },
        { id: 'workspace.worktreeRemove', label: 'Remove worktree…', run: actions.removeWorktree },
      ],
    },
    { id: 'settings', label: 'Settings', run: actions.openSettings },
    {
      id: 'settings-project',
      label: 'Settings: this project',
      run: actions.openProjectSettings,
    },
    { id: 'help', label: 'Keyboard shortcuts', run: actions.showHelp },
    { id: 'quit', label: 'Quit', hint: 'Ctrl+Q', run: actions.quit },
  ]
}

// The tip goes out before `run`: an operation with something of its own to say wins the slot.
export function withKeymap(commands: Command[], ran: (id: string) => void): Command[] {
  return commands.map(command => {
    if (command.children) return { ...command, children: withKeymap(command.children, ran) }
    const key = rebound(command.id)
    const hint = key === null ? command.hint : key || undefined
    const run = command.run
    return {
      ...command,
      hint,
      run:
        run &&
        (() => {
          ran(command.id)
          run()
        }),
    }
  })
}
