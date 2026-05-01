const { isMac } = require('./settings');

function macOptionMetaBinding(e) {
  if (!isMac || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (e.code === 'KeyF') return { sequence: '\x1bf', text: '\u0192' };
  if (e.code === 'KeyB') return { sequence: '\x1bb', text: '\u222b' };
  if (e.code === 'KeyD') return { sequence: '\x1bd', text: '\u2202' };
  if (e.key === 'Backspace') return { sequence: '\x1b\x7f', text: null };
  return null;
}

function clearMacOptionMetaPending(pane) {
  if (!pane?._macOptionMetaPending) return;
  clearTimeout(pane._macOptionMetaPending.timer);
  pane._macOptionMetaPending = null;
}

function markMacOptionMetaPending(pane, binding) {
  if (!binding.text) return;
  clearMacOptionMetaPending(pane);
  const until = Date.now() + 120;
  pane._macOptionMetaPending = {
    text: binding.text,
    until,
    timer: setTimeout(() => {
      if (pane._macOptionMetaPending?.until === until) pane._macOptionMetaPending = null;
    }, 120)
  };
}

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

  function suppressOptionMetaTextInput(e) {
    const pending = pane._macOptionMetaPending;
    if (!pending || !e.data || e.data !== pending.text || Date.now() > pending.until) return;
    e.preventDefault();
    e.stopPropagation();
    pane._macOptionMetaHandled = { text: pending.text, until: Date.now() + 80 };
    clearMacOptionMetaPending(pane);
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

  pane.xtermHolder.addEventListener('beforeinput', suppressOptionMetaTextInput, true);
  pane.xtermHolder.addEventListener('input', suppressOptionMetaTextInput, true);
  pane.xtermHolder.addEventListener('beforeinput', handleTextInput, true);
  pane.xtermHolder.addEventListener('input', handleTextInput, true);
}

function shouldSuppressMacFallbackData(pane, data) {
  const optionPending = pane._macOptionMetaPending;
  if (optionPending && data === optionPending.text && Date.now() <= optionPending.until) {
    clearMacOptionMetaPending(pane);
    return true;
  }
  const optionHandled = pane._macOptionMetaHandled;
  if (optionHandled && data === optionHandled.text && Date.now() < optionHandled.until) return true;
  const pending = pane._macImePunctuationPending;
  if (pending && data === pending.fallback) return true;
  const handled = pane._macImePunctuationHandled;
  if (handled && data === handled.text && Date.now() < handled.until) return true;
  return false;
}

module.exports = {
  macOptionMetaBinding,
  markMacOptionMetaPending,
  attachMacImePunctuationBridge,
  shouldSuppressMacFallbackData
};
