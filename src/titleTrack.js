const mt = window.mathterm;
const { state } = require('./state');

function formatTabCwd(cwd) {
  const home = mt.os.homedir();
  if (cwd === home) return '~';
  return mt.path.basename(cwd) || '/';
}

function resolveTildePath(p) {
  if (p === '~' || p === '~/') return mt.os.homedir();
  if (p.startsWith('~/')) return mt.path.join(mt.os.homedir(), p.slice(2));
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
  if (!tab._titleBuf) tab._titleBuf = '';
  tab._titleBuf += data;
  if (tab._titleBuf.length > 8192) {
    tab._titleBuf = tab._titleBuf.slice(-4096);
  }

  let changed = false;

  const osc7 = tab._titleBuf.match(/\x1b\]7;file:\/\/([^\x07\/]+)([^\x07]*)\x07/g);
  if (osc7) {
    const last = osc7[osc7.length - 1];
    const m7 = last.match(/\x1b\]7;file:\/\/([^\x07\/]+)([^\x07]*)\x07/);
    if (m7 && !tab._promptPrefix) {
      tab._promptPrefix = (mt.os.env.USER || mt.os.userInfo().username) + '@' + m7[1];
    }
    const raw = m7[2] || '';
    let cwd = decodeURIComponent(raw);
    cwd = cwd.replace(/^(\/\/[^/]+)?\/+/, '/').replace(/^\/\//, '/');
    if (!mt.path.isAbsolute(cwd)) cwd = '/' + cwd;
    tab.cwd = cwd;
    changed = true;
    const end = tab._titleBuf.lastIndexOf('\x07') + 1;
    tab._titleBuf = tab._titleBuf.slice(end);
  }

  const osc0 = tab._titleBuf.match(/\x1b\]0;([^\x07\x1b]*)\x07/);
  if (osc0) {
    const rawTitle = osc0[1].trim();
    if (rawTitle) {
      const m = rawTitle.match(/^([^@]+@[^:]+):(.+)$/);
      if (m) {
        if (!tab._promptPrefix) tab._promptPrefix = m[1];
        tab.cwd = resolveTildePath(m[2].trim());
        changed = true;
      }
    }
    const end = tab._titleBuf.indexOf('\x07', tab._titleBuf.indexOf('\x1b]0;')) + 1;
    if (end > 0) tab._titleBuf = tab._titleBuf.slice(end);
  }

  if (changed) refreshTabTitle(tab);

  if (!tab._titleBuf.includes('\x1b]')) tab._titleBuf = '';
}

module.exports = { tabTrackTitle, computeTabTitle, refreshTabTitle, updateTabBar, formatTabCwd, resolveTildePath };
