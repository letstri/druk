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
  gotoImplementation: () => void
  gotoReferences: () => void
  gotoSymbol: () => void
  gotoTypeDefinition: () => void
  gotoWorkspaceSymbol: () => void
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
  gitCommitGraph: () => void
  openCommitOnWeb: () => void
  openGraphCommit: () => void
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

export function buildCommands(
  actions: CommandActions,
  ctx: CommandContext
): Command[] {
  return [
    { hint: 'Ctrl+P', id: 'open', label: 'Open file…', run: actions.openFile },
    { hint: 'Ctrl+S', id: 'save', label: 'Save file', run: actions.save },
    { hint: 'Ctrl+G', id: 'goto', label: 'Go to line…', run: actions.gotoLine },
    { hint: 'Ctrl+Z', id: 'undo', label: 'Undo', run: actions.undo },
    { hint: 'Ctrl+Y', id: 'redo', label: 'Redo', run: actions.redo },
    {
      children: [
        {
          hint: 'Ctrl+F',
          id: 'find.file',
          label: 'In current file',
          run: actions.findInFile,
        },
        {
          hint: `Ctrl+${ALT}+F`,
          id: 'find.project',
          label: 'In project',
          run: actions.findInProject,
        },
        {
          hint: 'Ctrl+F then Tab',
          id: 'find.replace',
          label: 'Replace in current file',
          run: actions.replaceInFile,
        },
        {
          id: 'find.replaceProject',
          label: 'Replace in project',
          run: actions.replaceInProject,
        },
      ],
      id: 'find',
      label: 'Find',
    },
    {
      children: [
        { id: 'file.saveAll', label: 'Save all', run: actions.saveAll },
        {
          id: 'file.saveWithoutFormatting',
          label: 'Save without formatting',
          run: actions.saveWithoutFormatting,
        },
        {
          hint: 'Ctrl+N',
          id: 'file.new',
          label: 'New file',
          run: actions.newFile,
        },
        {
          hint: `Ctrl+${ALT}+N`,
          id: 'file.newDir',
          label: 'New folder',
          run: actions.newFolder,
        },
        { hint: 'r', id: 'file.rename', label: 'Rename…', run: actions.rename },
        {
          hint: 'x',
          id: 'file.cut',
          label: 'Cut for moving',
          run: actions.cutForMove,
        },
        {
          hint: 'c',
          id: 'file.copy',
          label: 'Copy',
          run: actions.copyForPaste,
        },
        {
          hint: 'p',
          id: 'file.paste',
          label: 'Paste here',
          run: actions.paste,
        },
        {
          hint: `Ctrl+${ALT}+C`,
          id: 'file.copyPath',
          label: 'Copy path',
          run: actions.copyPath,
        },
        {
          id: 'file.copyRelativePath',
          label: 'Copy relative path',
          run: actions.copyRelativePath,
        },
        { hint: 'd', id: 'file.delete', label: 'Delete…', run: actions.remove },
      ],
      id: 'file',
      label: 'File',
    },
    {
      children: [
        {
          id: 'git.diffFile',
          label: 'Diff current file',
          run: actions.gitDiffFile,
        },
        {
          hint: 'a in source control',
          id: 'git.diffAll',
          label: 'Show all changes',
          run: actions.gitDiffAll,
        },
        {
          hint: 'S in source control',
          id: 'git.diffLayout',
          label: 'Toggle diff layout (inline / side-by-side)',
          run: actions.toggleDiffLayout,
        },
        {
          hint: 'Space in source control',
          id: 'git.stage',
          label: 'Stage / unstage selection',
          run: actions.gitToggleStage,
        },
        {
          hint: 'd in source control',
          id: 'git.discard',
          label: 'Discard changes',
          run: actions.gitDiscard,
        },
        {
          hint: `Ctrl+${ALT}+U`,
          id: 'git.conflictResolve',
          label: 'Resolve conflict at cursor…',
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
          hint: `Ctrl+${ALT}+J`,
          id: 'git.conflictNext',
          label: 'Next conflict',
          run: actions.conflictNext,
        },
        {
          id: 'git.conflictPrev',
          label: 'Previous conflict',
          run: actions.conflictPrev,
        },
        {
          id: 'git.diffBase',
          label: 'Compare against branch…',
          run: actions.gitDiffBase,
        },
        {
          id: 'git.diffBaseReset',
          label: 'Compare against HEAD',
          run: actions.gitDiffBaseReset,
        },
        {
          hint: 'B in source control',
          id: 'git.compare',
          label: 'Compare branches',
          run: actions.gitCompareBranches,
        },
        { id: 'git.commit', label: 'Commit…', run: actions.gitCommit },
        {
          id: 'git.undo',
          label: 'Undo last commit',
          run: actions.gitUndoCommit,
        },
        // The palette filters by first substring match in this order: plain verbs above the compounds.
        { id: 'git.push', label: 'Push', run: actions.gitPush },
        { id: 'git.fetch', label: 'Fetch', run: actions.gitFetch },
        {
          id: 'git.pull',
          label: 'Pull (fast-forward only)',
          run: actions.gitPull,
        },
        { id: 'git.sync', label: 'Sync (pull & push)', run: actions.gitSync },
        {
          id: 'git.commitPush',
          label: 'Commit & push…',
          run: actions.gitCommitAndPush,
        },
        {
          id: 'git.commitSync',
          label: 'Commit & sync…',
          run: actions.gitCommitAndSync,
        },
        {
          id: 'git.commitAmend',
          label: 'Commit (amend)…',
          run: actions.gitCommitAmend,
        },
        {
          hint: 'g in source control',
          id: 'git.graph',
          label: 'Commit graph',
          run: actions.gitCommitGraph,
        },
        {
          hint: 'o in the commit graph',
          id: 'git.openCommitWeb',
          label: 'Open commit on remote',
          run: actions.openCommitOnWeb,
        },
        { id: 'git.stash', label: 'Stash changes', run: actions.gitStash },
        { id: 'git.stashPop', label: 'Stash pop', run: actions.gitStashPop },
        { id: 'git.stashList', label: 'Stashes…', run: actions.gitStashList },
        {
          id: 'git.fileHistory',
          label: 'File history…',
          run: actions.gitFileHistory,
        },
        { id: 'git.tagNew', label: 'Create tag…', run: actions.gitNewTag },
        {
          id: 'git.tagDelete',
          label: 'Delete tag…',
          run: actions.gitDeleteTag,
        },
        {
          id: 'git.remoteAdd',
          label: 'Add remote…',
          run: actions.gitAddRemote,
        },
        {
          id: 'git.remoteRemove',
          label: 'Remove remote…',
          run: actions.gitRemoveRemote,
        },
        {
          children: [
            {
              hint: 'b in source control',
              id: 'git.branch.switch',
              label: 'Switch branch…',
              run: actions.gitSwitchBranch,
            },
            {
              id: 'git.branch.new',
              label: 'New branch…',
              run: actions.gitNewBranch,
            },
            {
              id: 'git.branch.newFrom',
              label: 'New branch from…',
              run: actions.gitNewBranchFrom,
            },
            {
              id: 'git.branch.merge',
              label: 'Merge branch into current…',
              run: actions.gitMergeBranch,
            },
            {
              id: 'git.branch.rename',
              label: 'Rename branch…',
              run: actions.gitRenameBranch,
            },
            {
              id: 'git.branch.delete',
              label: 'Delete branch…',
              run: actions.gitDeleteBranch,
            },
            {
              id: 'git.branch.deleteForce',
              label: 'Delete branch (force)…',
              run: actions.gitDeleteBranchForce,
            },
          ],
          id: 'git.branch',
          label: 'Branch',
        },
      ],
      id: 'git',
      label: 'Git',
    },
    {
      children: [
        {
          hint: `Ctrl+${ALT}+R`,
          id: 'review.panel',
          label: 'Review panel',
          run: actions.openReview,
        },
        {
          hint: `Ctrl+${ALT}+A`,
          id: 'review.note',
          label: 'Note this line…',
          run: actions.reviewNote,
        },
        ...NOTE_KINDS.map((kind) => ({
          id: `review.note.${kind}`,
          label: `Note this line as ${NOTE_LABELS[kind].toLowerCase()}…`,
          run: () => actions.reviewNoteOf(kind),
        })),
        {
          id: 'review.reply',
          label: 'Reply to the remark under the cursor…',
          run: actions.reviewReply,
        },
        {
          id: 'review.clear',
          label: 'Clear review notes',
          run: actions.reviewClear,
        },
      ],
      id: 'review',
      label: 'Review',
    },
    {
      children: [
        {
          id: 'problems.list',
          label: 'List problems',
          run: actions.problemsList,
        },
        {
          hint: `Ctrl+${ALT}+I`,
          id: 'problems.detail',
          label: 'Show problem at cursor',
          run: actions.problemsAtCursor,
        },
        {
          hint: 'F8',
          id: 'problems.next',
          label: 'Next problem',
          run: actions.problemsNext,
        },
        {
          hint: `${ALT}+F8`,
          id: 'problems.prev',
          label: 'Previous problem',
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
      id: 'problems',
      label: 'Problems',
    },
    {
      children: [
        {
          hint: 'Ctrl+T',
          id: 'tabs.switch',
          label: 'Switch to…',
          run: actions.switchTab,
        },
        {
          hint: 'Ctrl+W',
          id: 'tabs.close',
          label: 'Close tab',
          run: actions.closeTab,
        },
        {
          hint: `Ctrl+${ALT}+T`,
          id: 'tabs.reopen',
          label: 'Reopen closed tab',
          run: actions.reopenTab,
        },
        {
          id: 'tabs.closeOthers',
          label: 'Close other tabs',
          run: actions.closeOthers,
        },
        { id: 'tabs.closeAll', label: 'Close all tabs', run: actions.closeAll },
        {
          hint: `Ctrl+${ALT}+→`,
          id: 'tabs.next',
          label: 'Next tab',
          run: actions.nextTab,
        },
        {
          hint: `Ctrl+${ALT}+←`,
          id: 'tabs.prev',
          label: 'Previous tab',
          run: actions.prevTab,
        },
        {
          hint: `Ctrl+${ALT}+Z`,
          id: 'nav.back',
          label: 'Go back',
          run: actions.navBack,
        },
        {
          hint: `Ctrl+${ALT}+Y`,
          id: 'nav.forward',
          label: 'Go forward',
          run: actions.navForward,
        },
      ],
      id: 'tabs',
      label: 'Tabs',
    },
    {
      children: [
        {
          hint: 'Ctrl+B',
          id: 'view.sidebar',
          label: 'Toggle sidebar',
          run: actions.toggleSidebar,
        },
        {
          hint: `Ctrl+${ALT}+G`,
          id: 'view.git',
          label: 'Source control (commit / push)',
          run: actions.toggleGitView,
        },
        {
          hint: '▴ in its header',
          id: 'view.collapse',
          label: 'Collapse folders in sidebar',
          run: actions.collapseSidebar,
        },
        {
          hint: 'Space in tree',
          id: 'view.preview',
          label: 'Preview file (no tab)',
          run: actions.togglePreview,
        },
        {
          hint: `Ctrl+${ALT}+M`,
          id: 'view.markdown',
          label: 'Markdown: rendered / source',
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
          hint: 'Tab in · Esc out',
          id: 'view.focus',
          label: 'Focus tree / editor',
          run: actions.toggleFocus,
        },
      ],
      id: 'view',
      label: 'View',
    },
    {
      // `themeNames()`, not a constant: an extension's themes are registered at startup.
      children: themeNames().map((name) => ({
        id: `themes.${name}`,
        label: `${check(ctx.activeTheme === name)}${themeLabel(name)}`,
        preview: () => actions.previewTheme(name),
        restore: () => actions.restoreTheme(),
        run: () => actions.setTheme(name),
      })),
      id: 'themes',
      label: 'Themes',
    },
    {
      children: iconThemeNames().map((id) => ({
        id: `icons.${id}`,
        label: `${check(ctx.activeIconTheme === id)}${iconThemeLabel(id)}${
          iconThemeNeedsFont(id) ? ' — needs a patched font' : ''
        }`,
        preview: () => actions.previewIcons(id),
        restore: () => actions.restoreIcons(),
        run: () => actions.setIconTheme(id),
      })),
      id: 'icons',
      label: 'File icons',
    },
    {
      children: [
        {
          hint: 'F12',
          id: 'goto.definition',
          label: 'Go to definition',
          run: actions.gotoDefinition,
        },
        {
          id: 'goto.references',
          label: 'Find references',
          run: actions.gotoReferences,
        },
        {
          id: 'goto.implementation',
          label: 'Go to implementation',
          run: actions.gotoImplementation,
        },
        {
          id: 'goto.typeDefinition',
          label: 'Go to type definition',
          run: actions.gotoTypeDefinition,
        },
        {
          id: 'goto.symbol',
          label: 'Go to symbol in file',
          run: actions.gotoSymbol,
        },
        {
          id: 'goto.workspaceSymbol',
          label: 'Go to symbol in project',
          run: actions.gotoWorkspaceSymbol,
        },
        {
          hint: `Ctrl+${ALT}+O`,
          id: 'goto.file',
          label: 'Open file under cursor',
          run: actions.openFileUnderCursor,
        },
        // Commands as well as chords: some layouts have no byte for Ctrl+/ at all.
        {
          hint: 'Ctrl+/ · Ctrl+L',
          id: 'editor.comment',
          label: 'Toggle comment',
          run: () => actions.lineOp('comment'),
        },
        {
          hint: `${ALT}+↑`,
          id: 'editor.lineUp',
          label: 'Move line up',
          run: () => actions.lineOp('up'),
        },
        {
          hint: `${ALT}+↓`,
          id: 'editor.lineDown',
          label: 'Move line down',
          run: () => actions.lineOp('down'),
        },
        {
          hint: `${ALT}+Shift+↓`,
          id: 'editor.duplicate',
          label: 'Duplicate line',
          run: () => actions.lineOp('duplicate'),
        },
        {
          hint: `Ctrl+${ALT}+B`,
          id: 'editor.lineStart',
          label: 'Go to beginning of line',
          run: actions.lineHome,
        },
        {
          hint: `Ctrl+${ALT}+D`,
          id: 'editor.deleteLine',
          label: 'Delete line',
          run: () => actions.lineOp('delete'),
        },
        {
          hint: `Ctrl+${ALT}+L`,
          id: 'editor.format',
          label: 'Format document',
          run: actions.formatDocument,
        },
        {
          id: 'editor.formatOpen',
          label: 'Format open files',
          run: actions.formatOpenFiles,
        },
        {
          hint: 'Ctrl+Space',
          id: 'editor.complete',
          label: 'Trigger autocomplete',
          run: actions.triggerCompletion,
        },
        {
          hint: `Ctrl+${ALT}+S`,
          id: 'editor.fold',
          label: 'Fold block at cursor',
          run: () => actions.foldOp('fold'),
        },
        {
          hint: `Ctrl+${ALT}+E`,
          id: 'editor.unfold',
          label: 'Unfold block at cursor',
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
      id: 'editor',
      label: 'Editor',
    },
    {
      children: [
        {
          hint: `Ctrl+${ALT}+X`,
          id: 'extensions.panel',
          label: 'Extensions panel',
          run: actions.openExtensions,
        },
        {
          id: 'extensions.check',
          label: 'Check for extension updates',
          run: actions.checkExtensionUpdates,
        },
        {
          id: 'extensions.update',
          label: 'Update extensions',
          run: actions.updateExtensions,
        },
        {
          id: 'extensions.reload',
          label: 'Reload extensions',
          run: actions.reloadExtensions,
        },
      ],
      id: 'extensions',
      label: 'Extensions',
    },
    {
      children: [
        {
          hint: `Ctrl+${ALT}+W`,
          id: 'workspace.switch',
          label: 'Switch workspace…',
          run: actions.switchWorkspace,
        },
        {
          id: 'workspace.open',
          label: 'Open folder…',
          run: actions.openWorkspace,
        },
        {
          hint: 'w in source control',
          id: 'workspace.worktreeSwitch',
          label: 'Switch worktree…',
          run: actions.switchWorktree,
        },
        {
          id: 'workspace.worktreeNew',
          label: 'New worktree…',
          run: actions.newWorktree,
        },
        {
          id: 'workspace.worktreeRemove',
          label: 'Remove worktree…',
          run: actions.removeWorktree,
        },
      ],
      id: 'workspace',
      label: 'Workspace',
    },
    { id: 'settings', label: 'Settings', run: actions.openSettings },
    {
      id: 'settings-project',
      label: 'Settings: this project',
      run: actions.openProjectSettings,
    },
    { id: 'help', label: 'Keyboard shortcuts', run: actions.showHelp },
    { hint: 'Ctrl+Q', id: 'quit', label: 'Quit', run: actions.quit },
  ]
}

// The tip goes out before `run`: an operation with something of its own to say wins the slot.
export function withKeymap(
  commands: Command[],
  ran: (id: string) => void
): Command[] {
  return commands.map((command) => {
    if (command.children) {
      return { ...command, children: withKeymap(command.children, ran) }
    }
    const key = rebound(command.id)
    const hint = key === null ? command.hint : key || undefined
    const { run } = command
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
