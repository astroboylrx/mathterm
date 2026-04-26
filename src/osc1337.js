class Osc1337Parser {
  constructor() {
    this._buf = '';
  }

  feed(data) {
    this._buf += data;
    const images = [];
    let cleanData = '';
    let i = 0;

    while (i < this._buf.length) {
      if (this._buf[i] === '\x1b' && this._buf.substr(i, 11) === '\x1b]1337;File') {
        const start = i;
        const colonPos = this._buf.indexOf(':', i + 11);
        if (colonPos === -1) break;

        let endPos = -1;
        let termLen = 1;
        for (let j = colonPos + 1; j < this._buf.length; j++) {
          if (this._buf[j] === '\x07') { endPos = j; termLen = 1; break; }
          if (this._buf[j] === '\x1b' && j + 1 < this._buf.length && this._buf[j + 1] === '\\') {
            endPos = j; termLen = 2; break;
          }
        }
        if (endPos === -1) break;

        const paramStr = this._buf.substring(i + 12, colonPos);
        const base64 = this._buf.substring(colonPos + 1, endPos);

        const params = {};
        for (const kv of paramStr.split(';')) {
          const eq = kv.indexOf('=');
          if (eq !== -1) params[kv.slice(0, eq)] = kv.slice(eq + 1);
        }

        if (params.inline === '1' && base64.length > 0) {
          const name = params.name ? decodeURIComponent(params.name) : 'image';
          const ext = name.split('.').pop().toLowerCase();
          const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
            : ext === 'gif' ? 'image/gif'
            : ext === 'svg' ? 'image/svg+xml'
            : ext === 'webp' ? 'image/webp'
            : 'image/png';
          images.push({
            params,
            dataUrl: `data:${mime};base64,${base64}`,
          });
        }

        cleanData += this._buf.substring(0, start);
        this._buf = this._buf.substring(endPos + termLen);
        i = 0;
      } else {
        i++;
      }
    }

    const last1337 = this._buf.lastIndexOf('\x1b]1337;');
    if (last1337 !== -1 && this._buf.indexOf(':', last1337) === -1) {
      cleanData += this._buf.substring(0, last1337);
      this._buf = this._buf.substring(last1337);
    } else {
      cleanData += this._buf;
      this._buf = '';
    }

    return { images, cleanData };
  }
}

module.exports = { Osc1337Parser };
