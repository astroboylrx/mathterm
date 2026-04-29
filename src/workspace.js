const { state } = require('./state');

// Workspaces are the internal model for user-visible tabs. Each workspace owns
// a layout tree and one or more pane sessions.
class TabWorkspace {
  constructor(id) {
    this.id = id;
    this.title = state._hostname + ': ~';
    this.cwd = null;
    this.container = null;
    this.tabEl = null;
    this.panes = [];
    this.activePaneId = null;
    this.maximizedPaneId = null;
    this.layout = null;
    this._customTitle = null;
    this.needsAttention = false;
    this.attentionLevel = null;
    this.attentionMessage = '';
  }
}

module.exports = { TabWorkspace };
