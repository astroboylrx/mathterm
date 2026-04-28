const { getActivePane, isActivePane, updateStatusBar } = require('./state');
const { settings } = require('./settings');

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;

function _clampZoom(value) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(value * 10) / 10));
}

function zoomFontSize(tab) {
  return Math.max(6, Math.round(settings.fontSize * (tab.zoomFactor || 1)));
}

function applyZoomToTab(tab) {
  if (!tab) return;
  const fontSize = zoomFontSize(tab);
  if (tab.term) tab.term.options.fontSize = fontSize;
  if (tab.richView) tab.richView.style.fontSize = fontSize + 'px';
  if (tab.fitAddon && isActivePane(tab)) {
    requestAnimationFrame(() => tab.fitAddon.fit());
  }
  if (isActivePane(tab)) updateStatusBar(tab);
}

function setZoom(tab, value) {
  if (!tab) return;
  tab.zoomFactor = _clampZoom(value);
  applyZoomToTab(tab);
}

function zoomActive(delta) {
  const tab = getActivePane();
  if (!tab) return;
  setZoom(tab, (tab.zoomFactor || 1) + delta);
}

function resetActiveZoom() {
  setZoom(getActivePane(), 1);
}

function zoomInActiveTab() {
  zoomActive(ZOOM_STEP);
}

function zoomOutActiveTab() {
  zoomActive(-ZOOM_STEP);
}

function isZoomShortcut(e, isMac) {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const otherMod = isMac ? e.ctrlKey : e.metaKey;
  if (!mod || otherMod || e.altKey) return false;
  return e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0';
}

module.exports = {
  applyZoomToTab,
  zoomInActiveTab,
  zoomOutActiveTab,
  resetActiveZoom,
  isZoomShortcut,
};
