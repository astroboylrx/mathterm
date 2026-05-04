let suppressDepth = 0;

function markSessionChanged(detail = {}) {
  if (suppressDepth > 0) return;
  window.dispatchEvent(new CustomEvent('mathterm-session-changed', { detail }));
}

function withSessionChangesSuppressed(fn) {
  suppressDepth++;
  try {
    return fn();
  } finally {
    suppressDepth--;
  }
}

module.exports = {
  markSessionChanged,
  withSessionChangesSuppressed
};
