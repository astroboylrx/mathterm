const mt = window.mathterm;
const { getActivePane } = require('./state');
const { materializeFullRichView, drainKatexQueue } = require('./richView');

const MAX_CANVAS_DIM = 32767;
const MAX_CANVAS_AREA = 32768 * 8192;
const DPR_DOWNSHIFT_DIM = 16000;
const TILE_HEIGHT = 4096;

function _measureRichElement(richEl, contentEl) {
  // .rich-view live padding is 16px 20px 0; print CSS uses 16px 20px (16 bottom).
  // richEl.scrollHeight = top-padding + content + 0 = 16 + content. Print adds
  // 16 more at bottom, so page height = scrollHeight + 16 to match exactly.
  const w = Math.max(200, Math.max(richEl.clientWidth, contentEl.scrollWidth + 40));
  const h = Math.max(100, richEl.scrollHeight + 16);
  return { w, h };
}

function _createLiveRichClone(tab) {
  const container = _prepareRichClone(tab.richView);
  container.classList.add('rich-view-export');
  container.style.position = 'absolute';
  container.style.left = '-100000px';
  container.style.top = '0';
  container.style.width = tab.richView.clientWidth + 'px';
  container.style.height = 'auto';
  container.style.maxHeight = 'none';
  container.style.overflow = 'visible';
  container.style.opacity = '1';
  container.style.pointerEvents = 'none';
  document.body.appendChild(container);
  return {
    container,
    content: container.querySelector('.rich-content') || container
  };
}

function _createExportView(tab) {
  if (tab.richVirtual && tab.richVirtual.active) return materializeFullRichView(tab);
  return _createLiveRichClone(tab);
}

function _removeExportView(view) {
  try { view?.container?.remove(); } catch {}
}

function _printExportCss(w, h) {
  return `
    @page { size: ${w}px ${h}px; margin: 0; }
    @media print {
      body > *:not(.rich-view-export) { display: none !important; }
      .rich-view-export {
        display: block !important;
        position: static !important;
        left: auto !important;
        top: auto !important;
        width: ${w}px !important;
        height: auto !important;
        max-height: none !important;
        overflow: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
        border: none !important;
        padding: 16px 20px !important;
      }
    }
  `;
}

function _showExportFailure(kind, err) {
  const message = err && err.error ? err.error : String(err || 'Unknown export error');
  window.alert(`${kind} export failed:\n\n${message}`);
  return { error: message };
}

function _finishExportResult(kind, result) {
  if (result && result.error) return _showExportFailure(kind, result);
  return result;
}

async function exportPdf() {
  const tab = getActivePane();
  if (!tab || !tab.richVisible) {
    return _showExportFailure('PDF', 'Math view must be open to export.');
  }

  let exportView;
  try {
    exportView = _createExportView(tab);
  } catch (err) {
    return _showExportFailure('PDF', err);
  }

  try {
    await drainKatexQueue();
    const { w, h } = _measureRichElement(exportView.container, exportView.content);

    const styleEl = document.createElement('style');
    styleEl.id = 'export-page-style';
    styleEl.textContent = _printExportCss(w, h);
    document.head.appendChild(styleEl);

    try {
      const result = await mt.ipc.invoke('export-pdf', { w, h });
      return _finishExportResult('PDF', result);
    } catch (err) {
      return _showExportFailure('PDF', err);
    } finally {
      styleEl.remove();
    }
  } finally {
    _removeExportView(exportView);
  }
}

function _collectRootCustomProps() {
  const styles = document.documentElement.style;
  const decls = [];
  for (const name of styles) {
    if (name.startsWith('--')) {
      decls.push(`${name}: ${styles.getPropertyValue(name)};`);
    }
  }
  return decls.length ? `:root, html, body, div { ${decls.join(' ')} }` : '';
}

async function _collectStylesheetText() {
  const parts = [_collectRootCustomProps()];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    try { rules = sheet.cssRules; } catch { rules = null; }
    if (rules) {
      for (const rule of Array.from(rules)) parts.push(rule.cssText);
    } else if (sheet.href) {
      try {
        const r = await fetch(sheet.href);
        parts.push(await r.text());
      } catch {}
    }
  }
  return parts.filter(Boolean).join('\n');
}

function _xmlEscape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _exportDpr(w, h) {
  const preferred = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const preferredW = Math.floor(w * preferred);
  const preferredH = Math.floor(h * preferred);
  const preferredArea = preferredW * preferredH;

  if (Math.max(w, h) > DPR_DOWNSHIFT_DIM
    || preferredW > MAX_CANVAS_DIM
    || preferredH > MAX_CANVAS_DIM
    || preferredArea > MAX_CANVAS_AREA) {
    return 1;
  }
  return preferred;
}

function _assertCanvasFits(w, h, dpr) {
  const pixelW = Math.floor(w * dpr);
  const pixelH = Math.floor(h * dpr);
  const area = pixelW * pixelH;
  if (pixelW > MAX_CANVAS_DIM || pixelH > MAX_CANVAS_DIM || area > MAX_CANVAS_AREA) {
    throw new Error(`PNG export is too large for Chromium canvas (${pixelW}x${pixelH}). Try PDF export or reduce the scrollback exported at once.`);
  }
}

function _prepareRichClone(richEl) {
  const clone = richEl.cloneNode(true);
  clone.style.position = 'static';
  clone.style.height = 'auto';
  clone.style.maxHeight = 'none';
  clone.style.overflow = 'visible';
  clone.style.opacity = '1';
  clone.style.borderColor = 'transparent';
  clone.classList.add('visible');
  const cloneHint = clone.querySelector('.rich-hint');
  if (cloneHint) cloneHint.remove();
  return clone;
}

function _createTileSvgUrl({ cloneTemplate, cssText, w, h, tileY, tileH, bg, fg, fontFamily, fontSize, lineHeight }) {
  const viewport = document.createElement('div');
  viewport.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  viewport.style.cssText = [
    `width:${w}px`,
    `height:${tileH}px`,
    `overflow:hidden`,
    `background:${bg}`,
    `color:${fg}`,
    `font-family:${fontFamily}`,
    `font-size:${fontSize}`,
    `line-height:${lineHeight}`,
    `padding:0`,
    `margin:0`,
    `box-sizing:border-box`,
  ].join(';');

  const translated = document.createElement('div');
  translated.style.cssText = [
    `width:${w}px`,
    `min-height:${h}px`,
    `transform:translateY(-${tileY}px)`,
    `transform-origin:top left`,
    `background:${bg}`,
    `color:${fg}`,
    `font-family:${fontFamily}`,
    `font-size:${fontSize}`,
    `line-height:${lineHeight}`,
    `padding:0`,
    `margin:0`,
    `box-sizing:border-box`,
  ].join(';');
  translated.appendChild(cloneTemplate.cloneNode(true));
  viewport.appendChild(translated);

  const xhtml = new XMLSerializer().serializeToString(viewport);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${tileH}">`
    + `<defs><style>${_xmlEscape(cssText)}</style></defs>`
    + `<foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject>`
    + `</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function _loadImage(url) {
  const img = new Image();
  return new Promise((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to rasterize math view'));
    img.src = url;
  });
}

async function exportPng() {
  const tab = getActivePane();
  if (!tab || !tab.richVisible) {
    return _showExportFailure('PNG', 'Math view must be open to export.');
  }

  let exportView;
  try {
    exportView = _createExportView(tab);
  } catch (err) {
    return _showExportFailure('PNG', err);
  }

  try {
    await drainKatexQueue();
    const richEl = exportView.container;
    const { w, h } = _measureRichElement(richEl, exportView.content);
    const richStyle = getComputedStyle(richEl);
    const bg = richStyle.backgroundColor || '#000';
    const fg = richStyle.color || '#fff';
    const fontFamily = richStyle.fontFamily;
    const fontSize = richStyle.fontSize;
    const lineHeight = richStyle.lineHeight;

    const cssText = await _collectStylesheetText();
    const cloneTemplate = _prepareRichClone(richEl);
    const dpr = _exportDpr(w, h);
    _assertCanvasFits(w, h, dpr);

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    for (let tileY = 0; tileY < h; tileY += TILE_HEIGHT) {
      const tileH = Math.min(TILE_HEIGHT, h - tileY);
      const url = _createTileSvgUrl({
        cloneTemplate, cssText, w, h, tileY, tileH,
        bg, fg, fontFamily, fontSize, lineHeight
      });
      const img = await _loadImage(url);
      ctx.drawImage(img, 0, tileY);
    }

    const dataUrl = canvas.toDataURL('image/png');
    const result = await mt.ipc.invoke('save-png', dataUrl);
    return _finishExportResult('PNG', result);
  } catch (err) {
    return _showExportFailure('PNG', err);
  } finally {
    _removeExportView(exportView);
  }
}

module.exports = { exportPdf, exportPng };
