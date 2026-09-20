// Windows-only WSL VT proxy. ConPTY swallows OSC 10/11/12 terminal color
// queries on their way through wsl.exe, so TUI apps that probe the terminal's
// default colors (e.g. codex) time out and render degraded styles. For WSL
// panes we install a tiny Python3 shim inside the distro (cached per distro
// under $HOME/.cache/mathterm) that forwards the session byte stream
// transparently and answers those queries itself with MathTerm's theme
// colors. POSIX code paths never touch this module's functions.
const { execFileSync } = require('child_process');

const PROXY_STAMP = '# MT-VT-PROXY v1';

const PROXY_SCRIPT = `# MT-VT-PROXY v1
# MathTerm WSL VT proxy. ConPTY swallows OSC 10/11/12 terminal color queries
# on their way through wsl.exe, so apps that probe the terminal's default
# colors (to pick their theme) time out and render degraded styles. This shim
# forwards the session byte stream transparently between the outer
# (wsl.exe-bridged) pty and an inner pty running the login shell, and answers
# those color queries itself with MathTerm's theme colors (MT_TERM_FG/BG).
import fcntl
import os
import pwd
import pty
import re
import selectors
import signal
import struct
import sys
import termios
import time
import tty


def _rgb16(value, fallback):
    # '#rrggbb' -> 'rrrr/gggg/bbbb' (xterm 16-bit channels repeat the byte).
    for candidate in (value, fallback):
        s = str(candidate or '').strip().lower()
        if s.startswith('#'):
            s = s[1:]
        if len(s) == 6:
            try:
                int(s, 16)
            except ValueError:
                continue
            return '/'.join(s[i:i + 2] * 2 for i in (0, 2, 4))
    return '0000/0000/0000'


_FG = _rgb16(os.environ.get('MT_TERM_FG'), '#cccccc')
_BG = _rgb16(os.environ.get('MT_TERM_BG'), '#0c0c0c')
_REPLIES = {
    b'10': ('\\x1b]10;rgb:' + _FG + '\\x07').encode('ascii'),
    b'11': ('\\x1b]11;rgb:' + _BG + '\\x07').encode('ascii'),
    b'12': ('\\x1b]12;rgb:' + _FG + '\\x07').encode('ascii'),
}
_QUERY_RE = re.compile(rb'\\x1b\\](10|11|12);\\?(\\x07|\\x1b\\\\)')
_QUERY_HEADS = (b'\\x1b]10;?', b'\\x1b]11;?', b'\\x1b]12;?')


def _held_tail_len(buf):
    # Longest suffix of buf that could still grow into a complete query once
    # more bytes arrive (a query may be split across read chunks).
    for length in range(min(len(buf), 7), 0, -1):
        suffix = buf[-length:]
        for head in _QUERY_HEADS:
            if head.startswith(suffix):
                return length
            if suffix.startswith(head) and suffix[len(head):] == b'\\x1b':
                return length
    return 0


def _scan_output(buf):
    # Split buf into (forward now, hold back, replies). Queries are NOT
    # stripped from the stream; they are only answered additionally, with the
    # reply written towards the child like a real terminal emulator would.
    replies = [_REPLIES[m.group(1)] for m in _QUERY_RE.finditer(buf)]
    hold = _held_tail_len(buf)
    if hold:
        return buf[:-hold], buf[-hold:], replies
    return buf, b'', replies


def _login_shell():
    try:
        shell = pwd.getpwuid(os.getuid()).pw_shell
        if shell:
            return shell
    except Exception:
        pass
    return '/bin/bash'


def _exec_shell():
    shell = _login_shell()
    for candidate in (shell, '/bin/bash'):
        try:
            os.execvp(candidate, [candidate, '-l'])
        except Exception:
            pass
    os._exit(127)


def _run_proxy():
    pid, master = pty.fork()
    if pid == 0:
        _exec_shell()
        os._exit(127)  # never reached

    stdin_fd = sys.stdin.fileno()
    stdout_fd = sys.stdout.fileno()
    saved_termios = None
    try:
        saved_termios = termios.tcgetattr(stdin_fd)
        tty.setraw(stdin_fd)
    except Exception:
        saved_termios = None

    def sync_winsize(*_args):
        # fd 1 is the outer pty; mirror its size onto the inner pty.
        try:
            size = fcntl.ioctl(stdout_fd, termios.TIOCGWINSZ, b'\\0' * 8)
            rows, cols = struct.unpack('HH', size[:4])
            if rows and cols:
                fcntl.ioctl(master, termios.TIOCSWINSZ, size)
        except Exception:
            pass

    sync_winsize()
    try:
        signal.signal(signal.SIGWINCH, sync_winsize)
    except Exception:
        pass

    sel = selectors.DefaultSelector()
    try:
        sel.register(stdin_fd, selectors.EVENT_READ, 'stdin')
    except Exception:
        pass
    sel.register(master, selectors.EVENT_READ, 'master')

    tail = b''
    done = False
    while not done:
        try:
            events = sel.select()
        except InterruptedError:
            continue
        except Exception:
            break
        for key, _mask in events:
            if key.data == 'stdin':
                try:
                    data = os.read(stdin_fd, 65536)
                except OSError:
                    data = b''
                if not data:
                    # Outer pty went away: hang up the login shell and stop.
                    try:
                        os.kill(pid, signal.SIGHUP)
                    except Exception:
                        pass
                    done = True
                    break
                try:
                    os.write(master, data)
                except OSError:
                    done = True
                    break
            else:
                try:
                    data = os.read(master, 65536)
                except OSError:
                    data = b''  # EIO: the child closed the inner pty
                if not data:
                    done = True
                    break
                try:
                    forward, tail, replies = _scan_output(tail + data)
                except Exception:
                    forward, tail, replies = tail + data, b'', []
                for reply in replies:
                    try:
                        os.write(master, reply)
                    except OSError:
                        pass
                if forward:
                    try:
                        os.write(stdout_fd, forward)
                    except OSError:
                        done = True
                        break

    # Reap the child and propagate its exit status. Escalate if it lingers
    # (e.g. a TUI that ignores SIGHUP after the outer pty died).
    status = 0
    for attempt in range(50):
        try:
            reaped, status = os.waitpid(pid, os.WNOHANG)
        except OSError:
            break
        if reaped == pid:
            break
        if attempt == 20:
            try:
                os.kill(pid, signal.SIGKILL)
            except Exception:
                pass
        time.sleep(0.02)

    if tail:
        try:
            os.write(stdout_fd, tail)
        except OSError:
            pass
    if saved_termios is not None:
        try:
            termios.tcsetattr(stdin_fd, termios.TCSADRAIN, saved_termios)
        except Exception:
            pass
    if os.WIFEXITED(status):
        sys.exit(os.WEXITSTATUS(status))
    if os.WIFSIGNALED(status):
        sys.exit(128 + os.WTERMSIG(status))
    sys.exit(0)


def main():
    try:
        _run_proxy()
    except SystemExit:
        raise
    except BaseException:
        # Never leave the pane dead: fall back to a plain login shell, which
        # is exactly the behavior the pane would have without the proxy.
        _exec_shell()


main()
`;

// execFileSync is injectable so tests can drive every branch without wsl.exe.
function createWslVtProxy({ execFileSync: execFileSyncImpl = execFileSync } = {}) {
  const availability = new Map();

  function isProxyInstalled(distro) {
    try {
      const current = execFileSyncImpl(
        'wsl.exe',
        ['-d', distro, '--exec', 'bash', '-c', 'cat "$HOME/.cache/mathterm/vt-proxy.py" 2>/dev/null || true'],
        { timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      );
      return typeof current === 'string' && current.includes(PROXY_STAMP);
    } catch {
      return false;
    }
  }

  function writeProxy(distro) {
    try {
      execFileSyncImpl(
        'wsl.exe',
        ['-d', distro, '--exec', 'bash', '-c', 'mkdir -p "$HOME/.cache/mathterm" && cat > "$HOME/.cache/mathterm/vt-proxy.py"'],
        { timeout: 5000, input: PROXY_SCRIPT, stdio: ['pipe', 'ignore', 'ignore'] }
      );
      return true;
    } catch {
      return false;
    }
  }

  function ensureProxyInstalled(distro) {
    if (!distro) return false;
    const key = String(distro);
    if (availability.has(key)) return availability.get(key);
    let ok = false;
    try {
      execFileSyncImpl('wsl.exe', ['-d', key, '--exec', 'python3', '-c', 'pass'], { timeout: 3000, stdio: 'pipe' });
      ok = isProxyInstalled(key) || writeProxy(key);
    } catch {
      ok = false;
    }
    availability.set(key, ok);
    return ok;
  }

  // Wrap a WSL shell profile so its pane launches the VT proxy inside the
  // distro instead of the bare login shell. Non-WSL profiles (and WSL
  // profiles on hosts where the proxy cannot be installed) pass through
  // unchanged. The wrapped args keep '-d <distro>' so profile dedupe keys
  // (and anything else keyed on the distro arg) still work.
  function maybeWrapWslProfile(profile) {
    if (!profile || typeof profile.command !== 'string') return profile;
    const base = profile.command.split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();
    if (base !== 'wsl') return profile;
    const args = Array.isArray(profile.args) ? profile.args : [];
    const dIndex = args.indexOf('-d');
    const distro = dIndex >= 0 ? args[dIndex + 1] : null;
    if (!distro) return profile;
    if (!ensureProxyInstalled(distro)) return profile;
    return {
      ...profile,
      args: [
        ...args.slice(0, dIndex),
        '-d', distro, '--cd', '~',
        '--exec', 'bash', '-lc', 'exec python3 "$HOME/.cache/mathterm/vt-proxy.py"'
      ]
    };
  }

  return { ensureProxyInstalled, maybeWrapWslProfile };
}

const defaultProxy = createWslVtProxy();

// Lazy spawn-time variant of maybeWrapWslProfile. Detection returns bare WSL
// profiles (see shellProfiles.js) so startup never blocks on synchronous
// wsl.exe round-trips; the proxy install check runs here instead, only when a
// WSL pane is actually launched, and only once per distro per session (the
// result is cached). Non-WSL commands pass through unchanged.
function maybeWrapWslSpawn(shellCmd, shellArgs, proxy = defaultProxy) {
  const wrapped = proxy.maybeWrapWslProfile({
    command: shellCmd,
    args: Array.isArray(shellArgs) ? shellArgs : []
  });
  return { shellCmd: wrapped.command, shellArgs: wrapped.args };
}

// WSL pane environment extras. WSL only imports a Windows env var when it is
// listed in WSLENV, and setting WSLENV replaces WSL's built-in default
// (WT_SESSION:WT_PROFILE_ID), so keep those. COLORTERM=truecolor (added to
// every pane by ptyManager) is propagated so TUI apps inside WSL see
// MathTerm's truecolor support regardless of how MathTerm was launched.
// MT_TERM_FG/BG (when the renderer supplied valid theme colors) feed the VT
// proxy's OSC query answers.
function wslPaneEnvExtras(shellCmd, terminalColors, { platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') return undefined;
  const base = String(shellCmd || '').split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();
  if (base !== 'wsl') return undefined;
  const existing = String(env.WSLENV || '').split(':').filter(Boolean);
  const existingNames = new Set(existing.map(entry => entry.split('/')[0]));
  const names = ['WT_SESSION', 'WT_PROFILE_ID', 'COLORTERM'];
  const extras = {};
  const valid = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  const fg = terminalColors && terminalColors.fg;
  const bg = terminalColors && terminalColors.bg;
  if (valid(fg) && valid(bg)) {
    extras.MT_TERM_FG = fg;
    extras.MT_TERM_BG = bg;
    names.push('MT_TERM_FG', 'MT_TERM_BG');
  }
  extras.WSLENV = existing.concat(names.filter(name => !existingNames.has(name))).join(':');
  return extras;
}

module.exports = {
  PROXY_SCRIPT,
  PROXY_STAMP,
  createWslVtProxy,
  ensureProxyInstalled: defaultProxy.ensureProxyInstalled,
  maybeWrapWslProfile: defaultProxy.maybeWrapWslProfile,
  maybeWrapWslSpawn,
  wslPaneEnvExtras
};
