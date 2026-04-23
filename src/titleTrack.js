const os = require('os');
const path = require('path');
const { state } = require('./state');

function formatTabCwd(cwd) {
  const home = os.homedir();
  if (cwd === home) return '~';
  return path.basename(cwd) || '/';
}

function resolveTildePath(p) {
  if (p === '~' || p === '~/') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function computeTabTitle(tab) {
  if (tab._customTitle) return tab._customTitle;
  return state._hostname + ': ' + formatTabCwd(tab.cwd);
}

function refreshTabTitle(tab) {
  tab.title = computeTabTitle(tab);
  updateTabBar();
}

function updateTabBar() {
  for (const tab of state.tabs) {
    const el = tab.tabEl?.querySelector('.tab-title');
    if (el && !el.isContentEditable) el.textContent = tab._customTitle || tab.title;
  }
}

function tabTrackTitle(tab, data) {
  const osc7 = data.match(/\x1b\]7;file:\/\/([^\x07\/]+)([^\x07]*)\x07/g);
  if (osc7) {
    const last = osc7[osc7.length - 1];
    const m7 = last.match(/\x1b\]7;file:\/\/([^\x07\/]+)([^\x07]*)\x07/);
    if (m7 && !tab._promptPrefix) {
      tab._promptPrefix = (process.env.USER || os.userInfo().username) + '@' + m7[1];
    }
    const raw = m7[2] || '';
    let cwd = decodeURIComponent(raw);
    cwd = cwd.replace(/^(\/\/[^/]+)?\/+/, '/').replace(/^\/\//, '/');
    if (!path.isAbsolute(cwd)) cwd = '/' + cwd;
    tab.cwd = cwd;
    refreshTabTitle(tab);
    return;
  }

  const osc0 = data.match(/\x1b\]0;([^\x07\x1b]*)/);
  if (osc0) {
    const rawTitle = osc0[1].trim();
    if (rawTitle) {
      const m = rawTitle.match(/^([^@]+@[^:]+):(.+)$/);
      if (m) {
        if (!tab._promptPrefix) tab._promptPrefix = m[1];
        tab.cwd = resolveTildePath(m[2].trim());
      }
      refreshTabTitle(tab);
    }
    return;
  }
}

module.exports = { tabTrackTitle, computeTabTitle, refreshTabTitle, updateTabBar, formatTabCwd, resolveTildePath };
