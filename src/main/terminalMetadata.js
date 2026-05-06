const OSC_MAX = 8192;

function resolveTildePath(value, home) {
  if (value === '~' || value === '~/') return home;
  if (value.startsWith('~/')) return `${home}/${value.slice(2)}`;
  return value;
}

function cwdFromFileUri(uriPath) {
  let cwd = decodeURIComponent(uriPath || '');
  cwd = cwd.replace(/^(\/\/[^/]+)?\/+/, '/').replace(/^\/\//, '/');
  if (!cwd.startsWith('/')) cwd = `/${cwd}`;
  return cwd;
}

class TerminalMetadataTracker {
  constructor({ cwd = null, home = null, user = process.env.USER || '', now = Date.now } = {}) {
    this.cwd = cwd;
    this.home = home || cwd || null;
    this.user = user;
    this.title = null;
    this.promptPrefix = null;
    this.command = {
      running: false,
      startedAt: 0,
      endedAt: 0,
      lastExitCode: '',
      endedWithAttachedView: false
    };
    this._now = now;
    this._state = 'normal';
    this._osc = '';
    this._oscEsc = false;
    this._sawEsc = false;
  }

  feed(data) {
    const updates = [];
    for (const ch of String(data || '')) {
      if (this._state === 'osc') {
        if (this._oscEsc) {
          if (ch === '\\') {
            this._finishOsc(updates);
          } else {
            this._appendOsc('\x1b');
            this._appendOsc(ch);
          }
          this._oscEsc = false;
        } else if (ch === '\x07') {
          this._finishOsc(updates);
        } else if (ch === '\x1b') {
          this._oscEsc = true;
        } else {
          this._appendOsc(ch);
        }
        continue;
      }

      if (this._sawEsc) {
        if (ch === ']') {
          this._state = 'osc';
          this._osc = '';
          this._oscEsc = false;
        }
        this._sawEsc = false;
      } else if (ch === '\x1b') {
        this._sawEsc = true;
      }
    }
    return updates;
  }

  snapshot() {
    return {
      cwd: this.cwd,
      title: this.title,
      promptPrefix: this.promptPrefix,
      command: { ...this.command }
    };
  }

  _appendOsc(ch) {
    if (this._osc.length < OSC_MAX) this._osc += ch;
  }

  _finishOsc(updates) {
    this._state = 'normal';
    this._oscEsc = false;
    const payload = this._osc;
    this._osc = '';
    const update = this._handleOsc(payload);
    if (update) updates.push(update);
  }

  _handleOsc(payload) {
    if (payload.startsWith('7;file://')) {
      return this._handleOsc7(payload.slice('7;file://'.length));
    }
    if (/^[012];/.test(payload)) {
      return this._handleTitle(payload.slice(2).trim());
    }
    if (payload.startsWith('133;')) {
      return this._handleOsc133(payload.slice('133;'.length));
    }
    return null;
  }

  _handleOsc7(rest) {
    const slash = rest.indexOf('/');
    if (slash === -1) return null;
    const host = rest.slice(0, slash);
    const cwd = cwdFromFileUri(rest.slice(slash));
    if (!this.promptPrefix && host) this.promptPrefix = `${this.user}@${host}`;
    if (this.cwd === cwd) return null;
    this.cwd = cwd;
    return { type: 'cwd', cwd };
  }

  _handleTitle(rawTitle) {
    if (!rawTitle) return null;
    let changed = false;
    const out = { type: 'title' };
    if (this.title !== rawTitle) {
      this.title = rawTitle;
      out.title = rawTitle;
      changed = true;
    }
    const match = rawTitle.match(/^([^@]+@[^:]+):(.+)$/);
    if (match) {
      if (!this.promptPrefix) this.promptPrefix = match[1];
      const cwd = resolveTildePath(match[2].trim(), this.home || '');
      if (cwd && this.cwd !== cwd) {
        this.cwd = cwd;
        out.cwd = cwd;
        changed = true;
      }
    }
    return changed ? out : null;
  }

  _handleOsc133(rest) {
    const code = rest[0] || '';
    if (code === 'C') {
      this.command.running = true;
      this.command.startedAt = this._now();
      return { type: 'command-started', command: { ...this.command } };
    }
    if (code === 'D') {
      const exitCode = rest.length > 2 ? rest.slice(2).split(';')[0].trim() : '';
      this.command.running = false;
      this.command.endedAt = this._now();
      this.command.lastExitCode = exitCode;
      this.command.endedWithAttachedView = false;
      return { type: 'command-ended', command: { ...this.command } };
    }
    if (code === 'A' || code === 'B') return { type: 'prompt', code };
    return null;
  }
}

function createTerminalMetadataTracker(opts) {
  return new TerminalMetadataTracker(opts);
}

module.exports = {
  TerminalMetadataTracker,
  createTerminalMetadataTracker,
  cwdFromFileUri,
  resolveTildePath
};
