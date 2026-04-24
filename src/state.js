
const state = {
  tabs: [],
  activeTabId: null,
  tabIdCounter: 0,
  dragTabId: null,
  tabContextMenuId: null,
  _hostname: window.mathterm.os.hostname().split('.')[0],

  tabBar: null,
  termContainer: null,
  modeIndicator: null,
  autoIndicator: null,
  cwdIndicator: null,
  exitIndicator: null,
  mathBtn: null,
  searchBar: null,
  searchInput: null,
  searchCount: null,
  contextMenu: null,
};

function getActiveTab() {
  return state.tabs.find(t => t.id === state.activeTabId);
}

function getTabIndex(id) {
  return state.tabs.findIndex(t => t.id === id);
}

function updateStatusBar(tab) {
  if (tab.richVisible) {
    state.modeIndicator.textContent = 'MATH';
    state.modeIndicator.classList.add('active');
    state.mathBtn.classList.add('active');
  } else {
    state.modeIndicator.textContent = 'TERMINAL';
    state.modeIndicator.classList.remove('active');
    state.mathBtn.classList.remove('active');
  }
  if (state.cwdIndicator && tab.cwd) {
    const home = window.mathterm.os.homedir();
    const display = tab.cwd === home ? '~'
      : tab.cwd.startsWith(home + '/') ? '~' + tab.cwd.slice(home.length)
      : tab.cwd;
    state.cwdIndicator.textContent = state._hostname + ': ' + display;
  }
  if (state.exitIndicator && tab._lastExitCode !== '') {
    const code = tab._lastExitCode;
    state.exitIndicator.textContent = code === '0' ? '✓' : '✗ ' + code;
    state.exitIndicator.className = code === '0' ? 'ok' : 'err';
  }
}

module.exports = { state, getActiveTab, getTabIndex, updateStatusBar };
