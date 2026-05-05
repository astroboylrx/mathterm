const DEFAULT_MIN_WIDTH = 360;
const DEFAULT_MIN_HEIGHT = 240;

function clampRestoredBounds(bounds, displays, opts = {}) {
  if (!bounds || typeof bounds !== 'object') return null;
  const rawWidth = Number(bounds.width);
  const rawHeight = Number(bounds.height);
  if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight)) return null;

  const display = chooseDisplay(bounds, displays);
  const workArea = display?.workArea || display?.bounds || display;
  if (!isUsableRect(workArea)) {
    return sanitizeBounds(bounds, opts);
  }

  const minWidth = Number.isFinite(Number(opts.minWidth)) ? Math.max(1, Number(opts.minWidth)) : DEFAULT_MIN_WIDTH;
  const minHeight = Number.isFinite(Number(opts.minHeight)) ? Math.max(1, Number(opts.minHeight)) : DEFAULT_MIN_HEIGHT;
  const width = clampSize(Math.round(rawWidth), minWidth, Math.round(workArea.width));
  const height = clampSize(Math.round(rawHeight), minHeight, Math.round(workArea.height));
  const out = { width, height };

  if (Number.isFinite(Number(bounds.x))) {
    out.x = clampNumber(Math.round(Number(bounds.x)), Math.round(workArea.x), Math.round(workArea.x + workArea.width - width));
  }
  if (Number.isFinite(Number(bounds.y))) {
    out.y = clampNumber(Math.round(Number(bounds.y)), Math.round(workArea.y), Math.round(workArea.y + workArea.height - height));
  }
  return out;
}

function sanitizeBounds(bounds, opts = {}) {
  const minWidth = Number.isFinite(Number(opts.minWidth)) ? Math.max(1, Number(opts.minWidth)) : DEFAULT_MIN_WIDTH;
  const minHeight = Number.isFinite(Number(opts.minHeight)) ? Math.max(1, Number(opts.minHeight)) : DEFAULT_MIN_HEIGHT;
  const out = {
    width: Math.max(minWidth, Math.round(Number(bounds.width))),
    height: Math.max(minHeight, Math.round(Number(bounds.height)))
  };
  if (Number.isFinite(Number(bounds.x))) out.x = Math.round(Number(bounds.x));
  if (Number.isFinite(Number(bounds.y))) out.y = Math.round(Number(bounds.y));
  return out;
}

function chooseDisplay(bounds, displays) {
  const list = Array.isArray(displays) ? displays.filter(Boolean) : [];
  if (!list.length) return null;
  const rect = normalizedRect(bounds);
  if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y)) return list[0];

  let best = null;
  let bestArea = -1;
  for (const display of list) {
    const displayRect = display?.bounds || display?.workArea || display;
    if (!isUsableRect(displayRect)) continue;
    const area = intersectionArea(rect, displayRect);
    if (area > bestArea) {
      best = display;
      bestArea = area;
    }
  }
  if (best && bestArea > 0) return best;

  let nearest = null;
  let nearestDistance = Infinity;
  for (const display of list) {
    const displayRect = display?.bounds || display?.workArea || display;
    if (!isUsableRect(displayRect)) continue;
    const distance = centerDistanceSquared(rect, displayRect);
    if (distance < nearestDistance) {
      nearest = display;
      nearestDistance = distance;
    }
  }
  return nearest || list[0];
}

function normalizedRect(bounds) {
  const width = Math.max(1, Math.round(Number(bounds.width) || DEFAULT_MIN_WIDTH));
  const height = Math.max(1, Math.round(Number(bounds.height) || DEFAULT_MIN_HEIGHT));
  const out = { width, height };
  if (Number.isFinite(Number(bounds.x))) out.x = Math.round(Number(bounds.x));
  if (Number.isFinite(Number(bounds.y))) out.y = Math.round(Number(bounds.y));
  return out;
}

function isUsableRect(rect) {
  return rect && Number.isFinite(Number(rect.x)) && Number.isFinite(Number(rect.y))
    && Number.isFinite(Number(rect.width)) && Number(rect.width) > 0
    && Number.isFinite(Number(rect.height)) && Number(rect.height) > 0;
}

function intersectionArea(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function centerDistanceSquared(a, b) {
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  return (ax - bx) ** 2 + (ay - by) ** 2;
}

function clampSize(value, min, max) {
  if (!Number.isFinite(max) || max <= 0) return Math.max(min, value);
  return Math.max(Math.min(min, max), Math.min(Math.max(value, min), max));
}

function clampNumber(value, min, max) {
  if (max < min) return min;
  return Math.max(min, Math.min(value, max));
}

module.exports = {
  clampRestoredBounds,
  chooseDisplay
};
