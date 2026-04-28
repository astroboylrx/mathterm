const { state } = require('./state');
const { Osc1337Parser } = require('./osc1337');

class TabSession {
  constructor(id) {
    this.id = id;
    this.title = state._hostname + ': ~';
    this.cwd = window.mathterm.os.env.HOME;
    this.ptyProc = null;
    this._closing = false;
    this.term = null;
    this.fitAddon = null;
    this.searchAddon = null;
    this.searchOpen = false;
    this.searchQuery = '';
    this.searchCountText = '';
    this.searchMatches = [];
    this.activeSearchIndex = -1;
    this._searchResultDisposable = null;
    this.container = null;
    this.xtermHolder = null;
    this.searchHighlightLayer = null;
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
    this._promptStartYSet = new Set();
    this._shimDir = null;
    this._customTitle = null;
    this._commandRunning = false;
    this._commandStartY = undefined;
    this._commandEndY = undefined;
    this._promptStartY = undefined;
    this._promptBHandled = false;
    this._promptJumpFlash = null;
    this._promptJumpFlashTimer = null;
    this._promptJumpAnchorY = null;
    this._lastExitCode = '';
    this._macImePunctuationPending = null;
    this._macImePunctuationHandled = null;
    this.needsAttention = false;
    this.attentionLevel = null;
    this.attentionMessage = '';
    this.autoRender = false;
    this.zoomFactor = 1;
    this.osc1337Parser = new Osc1337Parser();
    this.inlineImages = [];
  }
}

module.exports = { TabSession };
