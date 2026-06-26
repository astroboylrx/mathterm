const mt = window.mathterm;
const { state, getActivePane, updateStatusBarCwd } = require('./state');
const { markSessionChanged } = require('./sessionEvents');
const { makeCwdAdapter } = require('../shared/sessionFormat');
const { isRemoteDisplayHost, isValidLocalCwd } = require('../shared/spawnCwd');

const cwdAdapter = makeCwdAdapter({
  fs: mt.fs,
  path: mt.path,
  os: {
    homedir: mt.os.homedir,
    tmpdir: mt.os.tmpdir,
    env: mt.os.env
  },
  fallbackCwd: mt.os.env.HOME
});

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

function shortHost(host) {
  const value = String(host || '').trim();
  if (!value) return null;
  return value.includes(':') ? value : value.split('.')[0];
}

function computePaneTitle(pane) {
  return (pane.displayHost || state._hostname) + ': ' + formatTabCwd(pane.cwd);
}

function computeTabTitle(workspace) {
  if (workspace._customTitle) return workspace._customTitle;
  if (!workspace.panes || workspace.panes.length === 0) return workspace.title || state._hostname + ': ~';
  const activePane = workspace.panes.find(p => p.id === workspace.activePaneId) || workspace.panes[0];
  if (workspace.panes.length === 1) return computePaneTitle(activePane);
  return `${workspace.panes.length} panes - ${formatTabCwd(activePane.cwd)}`;
}

function refreshTabTitle(pane) {
  pane.title = computePaneTitle(pane);
  const workspace = pane.workspace;
  if (!workspace) return;
  if (workspace.panes.length <= 1 || workspace.activePaneId === pane.id) {
    workspace.cwd = pane.cwd;
  }
  workspace.title = computeTabTitle(workspace);
  updateTabBar();
  if (pane.id === getActivePane()?.id) updateStatusBarCwd(pane);
  markSessionChanged();
}

function updateTabBar() {
  for (const workspace of state.workspaces) {
    workspace.title = computeTabTitle(workspace);
    const el = workspace.tabEl?.querySelector('.tab-title');
    if (el && !el.isContentEditable) el.textContent = workspace._customTitle || workspace.title;
    if (workspace.tabEl) {
      workspace.tabEl.classList.toggle('needs-attention', !!workspace.needsAttention);
      workspace.tabEl.classList.toggle('attention-error', workspace.attentionLevel === 'error');
      workspace.tabEl.title = workspace.needsAttention ? (workspace.attentionMessage || 'Command finished') : '';
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
    const host = lastM7[1];
    const displayHost = shortHost(host);
    if (displayHost && tab.displayHost !== displayHost) {
      tab.displayHost = displayHost;
      changed = true;
    }
    const user = mt.os.env.USER || mt.os.userInfo().username;
    if (host && user) {
      const promptPrefix = user + '@' + host;
      if (tab._promptPrefix !== promptPrefix) {
        tab._promptPrefix = promptPrefix;
        changed = true;
      }
    }
    const raw = lastM7[2] || '';
    let cwd = decodeURIComponent(raw);
    cwd = cwd.replace(/^(\/\/[^/]+)?\/+/, '/').replace(/^\/\//, '/');
    if (!mt.path.isAbsolute(cwd)) cwd = '/' + cwd;
    if (tab.cwd !== cwd) {
      tab.cwd = cwd;
      changed = true;
    }
    if (!isRemoteDisplayHost(displayHost, state._hostname) && isValidLocalCwd(cwd, cwdAdapter)) {
      tab.localCwd = cwd;
    }
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
        if (tab._promptPrefix !== tm[1]) {
          tab._promptPrefix = tm[1];
          changed = true;
        }
        const displayHost = shortHost(tm[1].split('@').slice(1).join('@'));
        if (displayHost && tab.displayHost !== displayHost) {
          tab.displayHost = displayHost;
          changed = true;
        }
        const cwd = resolveTildePath(tm[2].trim());
        if (tab.cwd !== cwd) {
          tab.cwd = cwd;
          changed = true;
        }
        if (!isRemoteDisplayHost(displayHost, state._hostname) && isValidLocalCwd(cwd, cwdAdapter)) {
          tab.localCwd = cwd;
        }
      }
    }
  }

  if (consumeUpto > 0) tab._titleBuf = tab._titleBuf.slice(consumeUpto);

  if (changed) refreshTabTitle(tab);

  if (!tab._titleBuf.includes('\x1b]')) tab._titleBuf = '';
}

module.exports = { tabTrackTitle, computeTabTitle, refreshTabTitle, updateTabBar, formatTabCwd, resolveTildePath };
