function isPromptLine(tab, text, y) {
  if (y !== undefined && tab._promptYSet.has(y)) return true;
  return false;
}

module.exports = { isPromptLine };
