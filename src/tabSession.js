const { state } = require('./state');
const { Osc1337Parser } = require('./osc1337');

class TabSession {
  constructor(id) {
    this.id = id;
    this.title = state._hostname + ': ~';
    this.cwd = window.mathterm.os.env.HOME;
    this.ptyProc = null;
    this.term = null;
    this.fitAddon = null;
    this.searchAddon = null;
    this.container = null;
    this.xtermHolder = null;
    this.richView = null;
    this.richContent = null;
    this.richHint = null;
    this.richVisible = false;
    this.richAutoTriggered = false;
    this.sectionBuffer = '';
    this.sectionTimer = null;
    this.sectionHasLatex = false;
    this.sectionStartY = 0;
    this._sectionStartTime = 0;
    this.tabEl = null;
    this._promptPrefix = null;
    this._promptYSet = new Set();
    this._shimDir = null;
    this._customTitle = null;
    this._commandStartY = 0;
    this._commandEndY = 0;
    this._promptStartY = undefined;
    this._promptBHandled = false;
    this._lastExitCode = '';
    this.autoRender = true;
    this.osc1337Parser = new Osc1337Parser();
    this.inlineImages = [];
  }
}

module.exports = { TabSession };
