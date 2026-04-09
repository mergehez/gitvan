export type NavigationView = 'changes' | 'explorer' | 'history';
// export type NavigationView = 'changes' | 'history' | 'branches';

export type SettingsPanel = 'repositories' | 'accounts' | 'editors';

export type NativeCommand = {
    kind: 'open-settings';
    panel?: SettingsPanel;
};

export type RemoteOperation = 'fetch' | 'pull' | 'push';

export type RepoContextMenuAction =
    | 'fetch'
    | 'pull'
    | 'push'
    | 'publish'
    | 'open-with'
    | 'rename'
    | 'delete'
    | {
          kind: 'open-with-editor';
          editorPath: string;
      };

export type RepoContextMenuOptions = {
    canPublish: boolean;
    canPull: boolean;
    canPush: boolean;
    hasRemote: boolean;
    openWithEditors: EditorApp[];
};

export type IgnoreRepoPathMode = 'file' | 'directory' | 'pattern';

export type ChangeFileContextMenuIgnoreOption = {
    value: string;
    mode: IgnoreRepoPathMode;
};

export type ChangeFileContextMenuPrimaryAction = 'discard-changes' | 'delete-file' | 'revert-deletion';
export type ChangeFileContextMenuStageAction = 'stage-files' | 'unstage-files';

export type ChangeFileContextMenuOptions = {
    selectionCount: number;
    primaryAction: ChangeFileContextMenuPrimaryAction | undefined;
    stageAction: ChangeFileContextMenuStageAction;
    canIgnore: boolean;
    ignoreOptions: ChangeFileContextMenuIgnoreOption[];
    showCopyPaths: boolean;
    showRevealInFinder: boolean;
    showOpenWithDefaultProgram: boolean;
};

export type ChangeFileContextMenuAction =
    | { kind: 'discard-changes' }
    | { kind: 'stage-files' }
    | { kind: 'unstage-files' }
    | { kind: 'delete-file' }
    | { kind: 'revert-deletion' }
    | { kind: 'ignore-path'; value: string; mode: IgnoreRepoPathMode }
    | { kind: 'copy-file-path' }
    | { kind: 'copy-relative-file-path' }
    | { kind: 'reveal-in-finder' }
    | { kind: 'open-with-default-program' };

export type ChangeStatus = 'clean' | 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'unmerged' | 'type-changed';

export type RepoSidebarStatus = {
    branch: string | undefined;
    ahead: number;
    behind: number;
    hasRemote: boolean;
    hasUpstream: boolean;
    publishableCommits: number;
    changedFiles: number;
    stagedFiles: number;
    unstagedFiles: number;
    isDirty: boolean;
    error: string | undefined;
    lastScannedAt: string | undefined;
};

export type AccountSummary = {
    id: number;
    label: string;
    provider: string;
    authKind: string;
    username: string | undefined;
    host: string | undefined;
    hasSecret: boolean;
    isDefault: boolean;
    createdAt: string;
};

export type GroupSummary = {
    id: number;
    name: string;
    sequence: number;
    repoCount: number;
    createdAt: string;
};

export type OAuthProvider = 'github' | 'gitlab';

export type OAuthProviderSettings = {
    githubClientId: string;
    gitlabClientId: string;
    gitlabHost: string;
};

export type OAuthDeviceStartResult = {
    sessionId: string;
    provider: OAuthProvider;
    verificationUri: string;
    verificationUriComplete: string | undefined;
    userCode: string;
    intervalSeconds: number;
    expiresAt: string;
};

export type OAuthDevicePollResult =
    | {
          status: 'pending';
      }
    | {
          status: 'completed';
          bootstrap: AppBootstrapApi;
      };

export type CloneRepoSourceTab = 'github' | 'enterprise' | 'url';

export type CloneRepoDefaults = {
    parentDirectory: string;
};

export type CloneableRepo = {
    id: string;
    name: string;
    fullName: string;
    ownerLogin: string;
    description: string | undefined;
    isPrivate: boolean;
    cloneUrl: string;
    defaultBranch: string | undefined;
    updatedAt: string | undefined;
};

export type Repo = {
    id: number;
    name: string;
    path: string;
    sequence: number;
    groupId: number | undefined;
    groupName: string | undefined;
    accountId: number | undefined;
    accountLabel: string | undefined;
    addedAt: string;
    lastOpenedAt: string | undefined;
    status: RepoSidebarStatus;
};

export type FileChangeEntry = {
    path: string;
    previousPath: string | undefined;
    stagedStatus: ChangeStatus;
    unstagedStatus: ChangeStatus;
    displayStatus: string;
};

export type RepoChangesData = {
    staged: FileChangeEntry[];
    unstaged: FileChangeEntry[];
};

export type RepoStashEntry = {
    ref: string;
    message: string;
    createdAtRelative: string | undefined;
};

export type RepoStashDetail = RepoStashEntry & {
    files: CommitFileEntry[];
};

export type MergeConflictFile = {
    path: string;
    conflictCount: number | undefined;
};

export type MergeConflictResolvedFile = {
    path: string;
};

export type MergeConflictFileDetails = {
    path: string;
    base: string;
    current: string;
    incoming: string;
    result: string;
    conflictCount: number | undefined;
};

export type MergeConflictState = {
    isMerging: boolean;
    targetBranch: string | undefined;
    incomingBranch: string | undefined;
    conflictedFiles: MergeConflictFile[];
    mergedFiles: MergeConflictResolvedFile[];
    canCommit: boolean;
};

export type FileDiffRequestKind = 'staged' | 'unstaged';

export type FileDiffNonCodePreview = {
    kind: 'image';
    originalSrc: string | undefined;
    modifiedSrc: string | undefined;
};

export type FileDiffStats = {
    oldSizeBytes: number;
    newSizeBytes: number;
    addedLines: number;
    removedLines: number;
};

export type FileDiffEntry = {
    label: string;
    kind: 'staged' | 'unstaged' | 'untracked';
    patch: string;
    original: string;
    modified: string;
    stats: FileDiffStats;
    nonCodePreview?: FileDiffNonCodePreview;
    previewMessage?: string;
};

export type FileDiffData = {
    path: string;
    entry: FileDiffEntry;
};

export type CommitSummary = {
    sha: string;
    shortSha: string;
    summary: string;
    authorName: string;
    authorEmail: string;
    authoredAt: string;
    refs: string[];
    isUnpushed: boolean;
};

export type CommitFileEntry = {
    path: string;
    previousPath: string | undefined;
    status: ChangeStatus;
    hadConflict?: boolean;
};

export type CommitDetail = CommitSummary & {
    body: string;
    files: CommitFileEntry[];
    patch: string;
};

export type CommittedFileEntry = {
    path: string;
    sizeBytes: number;
};

export type CommittedTreeData = {
    commitSha: string | undefined;
    files: CommittedFileEntry[];
};

export type CommittedFilePreview = {
    kind: 'image';
    src: string;
};

export type CommittedFileData = {
    commitSha: string | undefined;
    path: string;
    sizeBytes: number;
    content: string;
    preview?: CommittedFilePreview;
    previewMessage?: string;
};

export type HistoryData = {
    commits: CommitSummary[];
};

export type BranchSummary = {
    name: string;
    refName: string;
    kind: 'local' | 'remote';
    isCurrent: boolean;
    upstream: string | undefined;
    ahead: number;
    behind: number;
    commit: string | undefined;
    subject: string | undefined;
};

export type BranchesData = {
    currentBranch: string | undefined;
    local: BranchSummary[];
    remote: BranchSummary[];
};

export type DiffViewMode = 'changes' | 'full-file';

export type AppBootstrapApi = {
    repos: Repo[];
    groups: GroupSummary[];
    accounts: AccountSummary[];
    selectedRepoId: number | undefined;
};

export type EditorApp = {
    path: string;
    label: string;
};

export type CommitFormState = {
    summary: string;
    description: string;
    amend: boolean;
};

export type EditorSettings = {
    editors: EditorApp[];
    defaultEditorPath: string | undefined;
    diffFontSize: number;
    diffViewMode: DiffViewMode;
    showWhitespaceChanges: boolean;
    activeView: NavigationView;
    showBranches: boolean;
};
