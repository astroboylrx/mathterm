const mt = window.mathterm;
const { state, updateStatusBarCwd } = require('./state');

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
  if (tab.id === state.activeTabId) updateStatusBarCwd(tab);
}

function updateTabBar() {
  for (const tab of state.tabs) {
    const el = tab.tabEl?.querySelector('.tab-title');
    if (el && !el.isContentEditable) el.textContent = tab._customTitle || tab.title;
    if (tab.tabEl) {
      tab.tabEl.classList.toggle('needs-attention', !!tab.needsAttention);
      tab.tabEl.classList.toggle('attention-error', tab.attentionLevel === 'error');
      tab.tabEl.title = tab.needsAttention ? (tab.attentionMessage || 'Command finished') : '';
    }
  }
}

function tabTrackTitle(tab, data) {
  if (!tab._titleBuf) tab._titleBuf = '';
  tab._titleBuf += data;
  if (tab._titleBuf.length > 8192) {
    tab._titleBuf = tab._titleBuf.slice(-4096);
  }

  let changed = false;
  let consumeUpto = 0;

  // OSC 7 (cwd notification: file://host/path), terminated by BEL (\x07) or ST (ESC \\)
  const osc7Re = /\x1b\]7;file:\/\/([^\x07\x1b\/]+)([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
  let lastM7 = null;
  let m;
  while ((m = osc7Re.exec(tab._titleBuf)) !== null) {
    lastM7 = m;
    if (osc7Re.lastIndex > consumeUpto) consumeUpto = osc7Re.lastIndex;
  }
  if (lastM7) {
    if (!tab._promptPrefix) {
      tab._promptPrefix = (mt.os.env.USER || mt.os.userInfo().username) + '@' + lastM7[1];
    }
    const raw = lastM7[2] || '';
    let cwd = decodeURIComponent(raw);
    cwd = cwd.replace(/^(\/\/[^/]+)?\/+/, '/').replace(/^\/\//, '/');
    if (!mt.path.isAbsolute(cwd)) cwd = '/' + cwd;
    tab.cwd = cwd;
    changed = true;
  }

  // OSC 0/1/2 (icon name / window title), same dual terminator support
  const osc012Re = /\x1b\][012];([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
  let lastM012 = null;
  while ((m = osc012Re.exec(tab._titleBuf)) !== null) {
    lastM012 = m;
    if (osc012Re.lastIndex > consumeUpto) consumeUpto = osc012Re.lastIndex;
  }
  if (lastM012) {
    const rawTitle = lastM012[1].trim();
    if (rawTitle) {
      const tm = rawTitle.match(/^([^@]+@[^:]+):(.+)$/);
      if (tm) {
        if (!tab._promptPrefix) tab._promptPrefix = tm[1];
        tab.cwd = resolveTildePath(tm[2].trim());
        changed = true;
      }
    }
  }

  if (consumeUpto > 0) tab._titleBuf = tab._titleBuf.slice(consumeUpto);

  if (changed) refreshTabTitle(tab);

  if (!tab._titleBuf.includes('\x1b]')) tab._titleBuf = '';
}

module.exports = { tabTrackTitle, computeTabTitle, refreshTabTitle, updateTabBar, formatTabCwd, resolveTildePath };
