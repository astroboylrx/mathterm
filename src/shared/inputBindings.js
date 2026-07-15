function modifier(input, domName, electronName) {
  return !!(input && (input[domName] ?? input[electronName]));
}

function controlKeyBinding(input) {
  if (!modifier(input, 'ctrlKey', 'control')
      || modifier(input, 'shiftKey', 'shift')
      || modifier(input, 'altKey', 'alt')
      || modifier(input, 'metaKey', 'meta')) return null;
  if (input.code === 'Slash' || input.key === '/') return '\x1f';
  return null;
}

module.exports = { controlKeyBinding };
