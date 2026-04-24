
const state = {
  tabs: [],
  activeTabId: null,
  tabIdCounter: 0,
  dragTabId: null,
  tabContextMenuId: null,
  autoRender: true,
  _hostname: window.mathterm.os.hostname().split('.')[0],

  tabBar: null,
  termContainer: null,
  modeIndicator: null,
  autoIndicator: null,
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
}

module.exports = { state, getActiveTab, getTabIndex, updateStatusBar };
