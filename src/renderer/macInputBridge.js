const { isMac } = require('./settings');
const { controlKeyBinding } = require('../shared/inputBindings');

function isMacImePunctuationKey(e) {
  if (!isMac || e.ctrlKey || e.altKey || e.metaKey) return false;
  if (!e.key || e.key.length !== 1) return false;
  return /^[\x21-\x7e]$/.test(e.key) && !/^[A-Za-z0-9]$/.test(e.key);
}

function attachMacImePunctuationBridge(pane) {
  if (!isMac || !pane.xtermHolder) return;

  function write(data) {
    if (!data || pane.richVisible || !pane.ptyProc) return;
    pane.ptyProc.write(data);
  }

  function clearPending() {
    if (!pane._macImePunctuationPending) return;
    clearTimeout(pane._macImePunctuationPending.timer);
    pane._macImePunctuationPending = null;
  }

  pane.xtermHolder.addEventListener('keydown', e => {
    if (!isMacImePunctuationKey(e)) return;
    clearPending();
    const fallback = e.key;
    e.stopPropagation();
    pane._macImePunctuationPending = {
      fallback,
      timer: setTimeout(() => {
        if (pane._macImePunctuationPending?.fallback === fallback) write(fallback);
        pane._macImePunctuationPending = null;
      }, 50)
    };
  }, true);

  pane.xtermHolder.addEventListener('keypress', e => {
    if (!pane._macImePunctuationPending) return;
    e.stopPropagation();
  }, true);

  function handleTextInput(e) {
    if (!pane._macImePunctuationPending || !e.data) return;
    const text = e.data;
    clearPending();
    pane._macImePunctuationHandled = { text, until: Date.now() + 80 };
    e.preventDefault();
    e.stopPropagation();
    write(text);
  }

  pane.xtermHolder.addEventListener('beforeinput', handleTextInput, true);
  pane.xtermHolder.addEventListener('input', handleTextInput, true);
}

function shouldSuppressMacFallbackData(pane, data) {
  const pending = pane._macImePunctuationPending;
  if (pending && data === pending.fallback) return true;
  const handled = pane._macImePunctuationHandled;
  if (handled && data === handled.text && Date.now() < handled.until) return true;
  return false;
}

module.exports = {
  controlKeyBinding,
  attachMacImePunctuationBridge,
  shouldSuppressMacFallbackData
};
