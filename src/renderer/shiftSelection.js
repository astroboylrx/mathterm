function shouldForceMouseSelection(term, event) {
  return event.button === 0
    && event.shiftKey
    && term?.modes?.mouseTrackingMode
    && term.modes.mouseTrackingMode !== 'none';
}

function eventToBufferCell(term, event) {
  const screen = term.element && term.element.querySelector('.xterm-screen');
  if (!screen || !term.cols || !term.rows) return null;
  const rect = screen.getBoundingClientRect();
  const cellW = rect.width / term.cols;
  const cellH = rect.height / term.rows;
  if (!(cellW > 0) || !(cellH > 0)) return null;
  const x = Math.min(term.cols - 1, Math.max(0, Math.floor((event.clientX - rect.left) / cellW)));
  const viewportY = Math.min(term.rows - 1, Math.max(0, Math.floor((event.clientY - rect.top) / cellH)));
  return { x, y: term.buffer.active.viewportY + viewportY };
}

function selectionLength(term, start, end) {
  if (!start || !end) return 0;
  return (end.y - start.y) * term.cols + end.x - start.x;
}

function orderedSelectionPoints(start, end) {
  if (!start || !end) return { anchor: start, focus: end };
  if (end.y < start.y || (end.y === start.y && end.x < start.x)) {
    return { anchor: end, focus: start };
  }
  return { anchor: start, focus: end };
}

function updateShiftSelection(term, start, end) {
  const { anchor, focus } = orderedSelectionPoints(start, end);
  const length = selectionLength(term, anchor, focus);
  if (length > 0) term.select(anchor.x, anchor.y, length);
  else term.clearSelection();
}

function attachShiftMouseSelection(pane, term) {
  const holder = pane?.xtermHolder;
  if (!holder || !term) return;

  holder.addEventListener('mousedown', event => {
    if (!shouldForceMouseSelection(term, event)) return;
    const start = eventToBufferCell(term, event);
    if (!start) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    term.focus();

    let last = start;
    updateShiftSelection(term, start, last);

    const onMouseMove = moveEvent => {
      moveEvent.preventDefault();
      moveEvent.stopImmediatePropagation();
      const next = eventToBufferCell(term, moveEvent);
      if (!next) return;
      last = next;
      updateShiftSelection(term, start, last);
    };

    const onMouseUp = upEvent => {
      upEvent.preventDefault();
      upEvent.stopImmediatePropagation();
      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('mouseup', onMouseUp, true);
      const end = eventToBufferCell(term, upEvent) || last;
      updateShiftSelection(term, start, end);
      term.focus();
    };

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseup', onMouseUp, true);
  }, true);
}

module.exports = {
  attachShiftMouseSelection,
  eventToBufferCell,
  orderedSelectionPoints,
  selectionLength,
  shouldForceMouseSelection
};
