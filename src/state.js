
// Model note: a workspace is the user-visible tab; each workspace owns one or
// more panes. We keep "tab" compatibility aliases because users and older code
// are used to terminal tabs, but new terminal-session logic should say pane.

const state = {
  workspaces: [],
  activeWorkspaceId: null,
  tabIdCounter: 0,
  paneIdCounter: 0,
  dragTabId: null,
  tabContextMenuId: null,
  _hostname: window.mathterm.os.hostname().split('.')[0],

  tabBar: null,
  termContainer: null,
  autoIndicator: null,
  mathBtn: null,
  renderInd: null,
  zoomInd: null,
  cwdLink: null,
  gitSep: null,
  gitBranch: null,
  searchBar: null,
  searchInput: null,
  searchCount: null,
  contextMenu: null,
};

Object.defineProperty(state, 'tabs', {
  get() { return state.workspaces; }
});

Object.defineProperty(state, 'activeTabId', {
  get() { return state.activeWorkspaceId; },
  set(v) { state.activeWorkspaceId = v; }
});

const _branchCache = new Map();

async function findGitBranch(cwd) {
  if (_branchCache.has(cwd)) return _branchCache.get(cwd);
  const mt = window.mathterm;
  let dir = cwd;
  for (let i = 0; i < 30; i++) {
    try {
      const head = await mt.fs.readFileAsync(mt.path.join(dir, '.git', 'HEAD'), 'utf8');
      const m = head.match(/^ref: refs\/heads\/(.+)$/m);
      const result = m ? m[1].trim() : (head.trim().match(/^[a-f0-9]{7,}/) ? head.trim().slice(0, 7) : null);
      _branchCache.set(cwd, result);
      return result;
    } catch {}
    const parent = mt.path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  _branchCache.set(cwd, null);
  return null;
}

function formatCwdDisplay(cwd) {
  const home = window.mathterm.os.homedir();
  if (cwd === home) return '~';
  if (cwd.startsWith(home + '/')) return '~' + cwd.slice(home.length);
  return cwd;
}

function getActiveWorkspace() {
  return state.workspaces.find(w => w.id === state.activeWorkspaceId);
}

function getActivePane() {
  const workspace = getActiveWorkspace();
  if (!workspace) return null;
  return workspace.panes.find(p => p.id === workspace.activePaneId) || workspace.panes[0] || null;
}

function getActiveTab() {
  return getActivePane();
}

function getTabIndex(id) {
  return state.workspaces.findIndex(w => w.id === id);
}

function getWorkspaceIndex(id) {
  return getTabIndex(id);
}

function getPaneWorkspace(paneId) {
  return state.workspaces.find(w => w.panes.some(p => p.id === paneId)) || null;
}

function getPaneById(paneId) {
  const workspace = getPaneWorkspace(paneId);
  return workspace ? workspace.panes.find(p => p.id === paneId) : null;
}

function isActivePane(pane) {
  if (!pane) return false;
  const workspace = getActiveWorkspace();
  return !!workspace && workspace.activePaneId === pane.id;
}

function forEachPane(fn) {
  for (const workspace of state.workspaces) {
    for (const pane of workspace.panes) fn(pane, workspace);
  }
}

function updateStatusBar(tab) {
  if (tab.richVisible) state.mathBtn.classList.add('active');
  else state.mathBtn.classList.remove('active');
  if (state.zoomInd) {
    const pct = Math.round((tab.zoomFactor || 1) * 100);
    state.zoomInd.textContent = pct === 100 ? '' : pct + '%';
    state.zoomInd.classList.toggle('hidden', pct === 100);
    state.zoomInd.title = pct === 100 ? '' : `Pane zoom: ${pct}%`;
  }
}

let _cwdSeq = 0;
async function updateStatusBarCwd(tab) {
  if (!state.cwdLink || !tab) return;
  const cwd = tab.cwd || '';
  state.cwdLink.textContent = formatCwdDisplay(cwd);
  state.cwdLink.dataset.cwd = cwd;
  const seq = ++_cwdSeq;
  const branch = await findGitBranch(cwd);
  if (seq !== _cwdSeq || tab.id !== getActivePane()?.id) return;
  if (branch) {
    state.gitBranch.textContent = '⎇ ' + branch;
    state.gitBranch.classList.remove('hidden');
    state.gitSep.classList.remove('hidden');
  } else {
    state.gitBranch.classList.add('hidden');
    state.gitSep.classList.add('hidden');
  }
}

module.exports = {
  state,
  getActiveWorkspace,
  getActivePane,
  getActiveTab,
  getTabIndex,
  getWorkspaceIndex,
  getPaneWorkspace,
  getPaneById,
  isActivePane,
  forEachPane,
  updateStatusBar,
  updateStatusBarCwd
};
