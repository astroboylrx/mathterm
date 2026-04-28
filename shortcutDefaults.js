function createDefaultShortcuts(isMac) {
  return {
    toggleMath: 'Mod+Shift+M',
    toggleAutoRender: 'Mod+Shift+R',
    openSearch: isMac ? 'Mod+F' : 'Mod+Shift+F',
    copy: isMac ? 'Mod+C' : 'Mod+Shift+C',
    paste: isMac ? 'Mod+V' : 'Mod+Shift+V',
    selectAll: isMac ? 'Mod+A' : 'Mod+Shift+A',
    prevPrompt: 'Mod+Shift+Up',
    nextPrompt: 'Mod+Shift+Down',
    selectLastCommand: null,
    scrollToCursor: null,
    splitPaneRight: isMac ? 'Mod+D' : 'Mod+Shift+D',
    splitPaneDown: isMac ? 'Mod+Shift+D' : 'Mod+Shift+E',
    closePane: isMac ? 'Mod+W' : 'Mod+Shift+W',
    nextPane: isMac ? 'Mod+]' : null,
    prevPane: isMac ? 'Mod+[' : null,
  };
}

const LEGACY_T14_SHORTCUTS = {
  prevPrompt: 'Ctrl+Up',
  nextPrompt: 'Ctrl+Down',
  selectLastCommand: 'Ctrl+Shift+Up',
  scrollToCursor: 'Ctrl+Shift+Down',
};

const LEGACY_MAC_SHORTCUTS = {
  openSearch: 'Mod+Shift+F',
  copy: 'Mod+Shift+C',
  paste: 'Mod+Shift+V',
  selectAll: 'Mod+Shift+A',
};

module.exports = {
  createDefaultShortcuts,
  LEGACY_T14_SHORTCUTS,
  LEGACY_MAC_SHORTCUTS
};
