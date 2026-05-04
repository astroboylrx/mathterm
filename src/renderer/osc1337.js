// Streaming OSC 1337 inline-image parser. Designed for chunked PTY input where
// a single image's base64 payload spans many chunks; per-chunk work is O(chunk
// size), not O(accumulated bytes), and `indexOf` does the terminator search
// natively rather than a per-char JS loop.

const STATE_IDLE = 0;    // scanning for next OSC start
const STATE_PARAMS = 1;  // inside header, accumulating until ':'
const STATE_DATA = 2;    // inside base64, accumulating until BEL or ESC \\

const OSC_HEADER = '\x1b]1337;File=';

class Osc1337Parser {
  constructor() {
    this._state = STATE_IDLE;
    this._hold = '';        // small carry-over for partial markers across chunks
    this._params = '';
    this._b64Parts = [];
  }

  feed(data) {
    const images = [];
    let cleanData = '';
    const buf = this._hold + data;
    this._hold = '';
    let pos = 0;

    while (pos < buf.length) {
      if (this._state === STATE_IDLE) {
        const start = buf.indexOf(OSC_HEADER, pos);
        if (start === -1) {
          // No complete OSC header. Look only for a *prefix* of OSC_HEADER
          // at the tail of buf (within the last OSC_HEADER.length-1 chars);
          // otherwise pass everything through. Critically, an ESC that
          // begins something else (e.g. CSI \x1b[D from bash backspace echo)
          // must not be held back — that batches up keystrokes.
          const maxPrefix = OSC_HEADER.length - 1;
          const tailStart = Math.max(pos, buf.length - maxPrefix);
          let holdAt = -1;
          for (let k = tailStart; k < buf.length; k++) {
            if (buf[k] === '\x1b' && OSC_HEADER.startsWith(buf.substring(k))) {
              holdAt = k; break;
            }
          }
          if (holdAt !== -1) {
            cleanData += buf.substring(pos, holdAt);
            this._hold = buf.substring(holdAt);
          } else {
            cleanData += buf.substring(pos);
          }
          return { images, cleanData };
        }
        cleanData += buf.substring(pos, start);
        pos = start + OSC_HEADER.length;
        this._state = STATE_PARAMS;
        this._params = '';
      } else if (this._state === STATE_PARAMS) {
        const colon = buf.indexOf(':', pos);
        if (colon === -1) {
          this._params += buf.substring(pos);
          return { images, cleanData };
        }
        this._params += buf.substring(pos, colon);
        pos = colon + 1;
        this._state = STATE_DATA;
        this._b64Parts = [];
      } else { // STATE_DATA
        // Find earliest of BEL or ESC. ESC only counts as terminator if the
        // next byte is '\\'; otherwise treat it as part of the data run.
        const bel = buf.indexOf('\x07', pos);
        const esc = buf.indexOf('\x1b', pos);
        let term = -1, termLen = 1;
        if (bel !== -1 && (esc === -1 || bel < esc)) {
          term = bel; termLen = 1;
        } else if (esc !== -1) {
          if (esc === buf.length - 1) {
            // Trailing lone ESC; could be the start of "\x1b\\" continuing in
            // the next chunk. Hold it back.
            this._b64Parts.push(buf.substring(pos, esc));
            this._hold = '\x1b';
            return { images, cleanData };
          }
          if (buf[esc + 1] === '\\') {
            term = esc; termLen = 2;
          } else {
            // Stray ESC mid-payload — keep scanning past it.
            this._b64Parts.push(buf.substring(pos, esc + 1));
            pos = esc + 1;
            continue;
          }
        }
        if (term === -1) {
          this._b64Parts.push(buf.substring(pos));
          return { images, cleanData };
        }
        this._b64Parts.push(buf.substring(pos, term));
        pos = term + termLen;

        const base64 = this._b64Parts.join('');
        this._emitImage(images, this._params, base64);

        this._state = STATE_IDLE;
        this._params = '';
        this._b64Parts = [];
      }
    }
    return { images, cleanData };
  }

  _emitImage(images, paramStr, base64) {
    const params = {};
    for (const kv of paramStr.split(';')) {
      const eq = kv.indexOf('=');
      if (eq !== -1) params[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
    if (params.inline !== '1' || base64.length === 0) return;

    let name = 'image';
    if (params.name) {
      try { name = atob(params.name); } catch { name = params.name; }
    }
    let mime = 'image/png';
    if (base64.startsWith('/9j/')) mime = 'image/jpeg';
    else if (base64.startsWith('iVBORw')) mime = 'image/png';
    else if (base64.startsWith('R0lGOD')) mime = 'image/gif';
    else if (base64.startsWith('UklGR')) mime = 'image/webp';
    else if (base64.startsWith('PHN2Z') || base64.startsWith('PD94')) mime = 'image/svg+xml';
    images.push({
      params: { ...params, name },
      dataUrl: `data:${mime};base64,${base64}`,
    });
  }
}

module.exports = { Osc1337Parser };
