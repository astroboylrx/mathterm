
const state = {
  tabs: [],
  activeTabId: null,
  tabIdCounter: 0,
  dragTabId: null,
  tabContextMenuId: null,
  _hostname: window.mathterm.os.hostname().split('.')[0],

  tabBar: null,
  termContainer: null,
  autoIndicator: null,
  mathBtn: null,
  renderInd: null,
  cwdLink: null,
  gitSep: null,
  gitBranch: null,
  searchBar: null,
  searchInput: null,
  searchCount: null,
  contextMenu: null,
};

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

function getActiveTab() {
  return state.tabs.find(t => t.id === state.activeTabId);
}

function getTabIndex(id) {
  return state.tabs.findIndex(t => t.id === id);
}

function updateStatusBar(tab) {
  if (tab.richVisible) state.mathBtn.classList.add('active');
  else state.mathBtn.classList.remove('active');
}

let _cwdSeq = 0;
async function updateStatusBarCwd(tab) {
  if (!state.cwdLink || !tab) return;
  const cwd = tab.cwd || '';
  state.cwdLink.textContent = formatCwdDisplay(cwd);
  state.cwdLink.dataset.cwd = cwd;
  const seq = ++_cwdSeq;
  const branch = await findGitBranch(cwd);
  if (seq !== _cwdSeq || tab.id !== state.activeTabId) return;
  if (branch) {
    state.gitBranch.textContent = '⎇ ' + branch;
    state.gitBranch.classList.remove('hidden');
    state.gitSep.classList.remove('hidden');
  } else {
    state.gitBranch.classList.add('hidden');
    state.gitSep.classList.add('hidden');
  }
}

module.exports = { state, getActiveTab, getTabIndex, updateStatusBar, updateStatusBarCwd };
