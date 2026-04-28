const { state } = require('./state');

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
