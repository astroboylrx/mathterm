// Pure helpers used by the rich-view virtualization code in richView.js.
// Kept DOM-free so they can be unit-tested directly under node.

const RICH_VIRTUAL_OVERSCAN_ROWS = 80;
const RICH_VIRTUAL_MAX_RENDERED_ROWS = 320;
const RICH_VIRTUAL_STRUCTURE_BACKSCAN_ROWS = 50;
const RICH_VIRTUAL_HEIGHT_SMOOTHING = 0.2;
const RICH_VIRTUAL_DEFAULT_LINE_HEIGHT = 24;
const RICH_VIRTUAL_EXPORT_MAX_ROWS = 50000;

function clampRowRange(targetY, sourceStartY, sourceEndY, overscanRows, maxRenderedRows) {
  if (sourceEndY < sourceStartY) {
    return { startY: sourceStartY, endY: sourceStartY - 1 };
  }
  const totalRows = sourceEndY - sourceStartY + 1;
  const window = Math.min(maxRenderedRows, totalRows);
  let startY = Math.max(sourceStartY, targetY - overscanRows);
  if (startY + window - 1 > sourceEndY) startY = sourceEndY - window + 1;
  if (startY < sourceStartY) startY = sourceStartY;
  const endY = Math.min(sourceEndY, startY + window - 1);
  return { startY, endY };
}

function scrollTopToRow(scrollTop, sourceStartY, averageRowHeight) {
  if (!Number.isFinite(averageRowHeight) || averageRowHeight <= 0) return sourceStartY;
  return sourceStartY + Math.floor(Math.max(0, scrollTop) / averageRowHeight);
}

function computeSpacerHeights(sourceStartY, sourceEndY, renderedStartY, renderedEndY, averageRowHeight) {
  const ah = Number.isFinite(averageRowHeight) && averageRowHeight > 0
    ? averageRowHeight : RICH_VIRTUAL_DEFAULT_LINE_HEIGHT;
  const topRows = Math.max(0, renderedStartY - sourceStartY);
  const bottomRows = Math.max(0, sourceEndY - renderedEndY);
  return { top: topRows * ah, bottom: bottomRows * ah };
}

function applyHeightSmoothing(prev, measured, alpha) {
  if (!Number.isFinite(measured) || measured <= 0) return prev;
  if (!Number.isFinite(prev) || prev <= 0) return measured;
  return prev + alpha * (measured - prev);
}

function coerceRenderToken(token) {
  if (token == null) return null;
  return String(token);
}

module.exports = {
  RICH_VIRTUAL_OVERSCAN_ROWS,
  RICH_VIRTUAL_MAX_RENDERED_ROWS,
  RICH_VIRTUAL_STRUCTURE_BACKSCAN_ROWS,
  RICH_VIRTUAL_HEIGHT_SMOOTHING,
  RICH_VIRTUAL_DEFAULT_LINE_HEIGHT,
  RICH_VIRTUAL_EXPORT_MAX_ROWS,
  clampRowRange,
  scrollTopToRow,
  computeSpacerHeights,
  applyHeightSmoothing,
  coerceRenderToken
};
