// Developer option: save each Math Mode view -- the logical lines and what the
// display-math model and the old rules each made of them -- next to the config
// file, so the model can later be refined on real terminal output. Local only;
// the saved text is whatever the terminal showed.

const mt = window.mathterm;
const { SETTINGS_PATH } = require('./settings');

const MAX_CAPTURE_LINES = 6000;

function captureDir() {
  return mt.path.join(mt.path.dirname(SETTINGS_PATH), 'math-captures');
}

function saveMathCapture(record) {
  try {
    const dir = captureDir();
    mt.fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = mt.path.join(dir, `${stamp}.json`);
    mt.fs.writeFileSync(file, JSON.stringify(record));
    return file;
  } catch (err) {
    console.error('Failed to save Math Mode capture:', err);
    return null;
  }
}

// lines: logical lines ({ text, y, yEnd }); spans in line indices.
function buildMathCapture({ lines, promptIdx, fencedIdx, modelSpans, rulesSpans, cols, rows, detection, modelFormat }) {
  const start = Math.max(0, lines.length - MAX_CAPTURE_LINES);
  const inRange = i => i >= start;
  const shift = i => i - start;
  return {
    format: 1,
    savedAt: new Date().toISOString(),
    platform: mt.os.platform,
    cols,
    rows,
    detection,
    modelFormat,
    droppedLeadingLines: start,
    lines: lines.slice(start).map(l => l.text || ''),
    bufferRows: lines.slice(start).map(l => [l.y, l.yEnd !== undefined ? l.yEnd : l.y]),
    promptLines: promptIdx.filter(inRange).map(shift),
    fencedLines: fencedIdx.filter(inRange).map(shift),
    model: modelSpans.filter(s => s.end >= start)
      .map(s => ({ start: Math.max(0, s.start - start), end: shift(s.end), tags: s.tags.join('') })),
    rules: rulesSpans
  };
}

module.exports = { saveMathCapture, buildMathCapture, captureDir };
