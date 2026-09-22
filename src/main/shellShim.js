const SHIM_PREFIX = 'mathterm-shim-';

function createImgcatFunction() {
  return `unalias imgcat 2>/dev/null || true
imgcat() {
  if [ $# -eq 0 ]; then printf 'usage: imgcat <file>...\\n' >&2; return 1; fi
  local f file size tmp name b64
  for f in "$@"; do
    if [ ! -f "$f" ]; then printf 'imgcat: %s: not found\\n' "$f" >&2; continue; fi
    file="$f"
    size=$(stat -c%s "$f" 2>/dev/null || stat -f%z "$f" 2>/dev/null || echo 0)
    if [ "$size" -gt 20971520 ]; then
      tmp=$(mktemp --suffix=.jpg 2>/dev/null || mktemp -t imgcat.XXXXXX)
      if command -v magick >/dev/null 2>&1; then
        magick "$f" -resize '2048x2048>' -quality 85 "$tmp" 2>/dev/null && file="$tmp"
      elif command -v convert >/dev/null 2>&1; then
        convert "$f" -resize '2048x2048>' -quality 85 "$tmp" 2>/dev/null && file="$tmp"
      elif command -v sips >/dev/null 2>&1; then
        sips -Z 2048 "$f" --out "$tmp" >/dev/null 2>&1 && file="$tmp"
      else
        printf 'imgcat: %s is %s bytes; install ImageMagick (magick/convert) for auto-resize\\n' "$f" "$size" >&2
      fi
    fi
    name=$(printf '%s' "\${f##*/}" | base64 | tr -d '\\n')
    b64=$(base64 < "$file" | tr -d '\\n')
    printf '\\033]1337;File=name=%s;inline=1:%s\\a\\n' "$name" "$b64"
    [ -n "$tmp" ] && [ -f "$tmp" ] && rm -f "$tmp"
    tmp=
  done
}`;
}

// The bash rc that installs OSC 133 prompt marks (and imgcat). Also used by
// the WSL VT proxy, which writes it inside the distro and launches bash with
// `--rcfile` — keep the two call sites on this single template.
function createBashShimScript() {
  const markA = "printf '\\033]133;A\\007'";
  const markB = "printf '\\033]133;B\\007'";
  const markC = "printf '\\033]133;C\\007'";
  const markD = "printf '\\033]133;D;%s\\007'";
  const imgcatFn = createImgcatFunction();
  return `for f in /etc/profile; do [ -f "$f" ] && . "$f" && break; done
for f in ~/.bash_profile ~/.bash_login ~/.profile; do [ -f "$f" ] && . "$f" && break; done
[ -z "\$_MATHTERM_BASHRC_LOADED" ] && [ -f ~/.bashrc ] && . ~/.bashrc && export _MATHTERM_BASHRC_LOADED=1
_mathterm_preexec_invoke_exec() { case "\$_MATHTERM_PREEXEC" in 1|2) return;; esac; _MATHTERM_PREEXEC=1; ${markC}; }
trap '_mathterm_preexec_invoke_exec' DEBUG
_mt_user_prompt_command="\${PROMPT_COMMAND-}"
PROMPT_COMMAND="_mt_status=\\$?; _MATHTERM_PREEXEC=2; if [ -n \\"\\$_mt_user_prompt_command\\" ]; then eval \\"\\$_mt_user_prompt_command\\"; fi; ${markD} \\"\\$_mt_status\\"; ${markA}; _MATHTERM_PREEXEC=0"
case "\$PS1" in
  *'\\[\\e]133;B\\a\\]'*) ;;
  *) PS1="\${PS1}\\[\\e]133;B\\a\\]" ;;
esac
${imgcatFn}
`;
}

// The zsh shim dir contents (.zshenv/.zprofile/.zshrc/.zlogin) that install
// the same marks. Also used by the WSL VT proxy via ZDOTDIR — single template.
function createZshShimFiles() {
  const markA = "printf '\\033]133;A\\007'";
  const markB = "printf '\\033]133;B\\007'";
  const markC = "printf '\\033]133;C\\007'";
  const markD = "printf '\\033]133;D;%s\\007'";
  const imgcatFn = createImgcatFunction();
  const zshrc = `_mt_real_zdot="\$_MT_USER_ZDOTDIR"
if [ -f "$_mt_real_zdot/.zshrc" ]; then . "$_mt_real_zdot/.zshrc"; fi
mathterm_prompt_marker() { ${markA}; }
mathterm_prompt_end() { ${markB}; }
mathterm_preexec() { ${markC}; }
mathterm_precmd() { local _mt_ec=\$?; ${markD} "\$_mt_ec"; }
autoload -Uz add-zsh-hook
add-zsh-hook precmd mathterm_precmd
add-zsh-hook precmd mathterm_prompt_marker
add-zsh-hook preexec mathterm_preexec
zle -N zle-line-init mathterm_prompt_end
${imgcatFn}
`;
  return {
    '.zshenv': `# _MT_USER_ZDOTDIR is set by the parent process before zsh starts.\nif [ -z "\$_MT_USER_ZDOTDIR" ]; then export _MT_USER_ZDOTDIR="\$HOME"; fi\nif [ -f "\$_MT_USER_ZDOTDIR/.zshenv" ]; then . "\$_MT_USER_ZDOTDIR/.zshenv"; fi\n`,
    '.zprofile': `_mt_real_zdot="$_MT_USER_ZDOTDIR"; if [ -f "$_mt_real_zdot/.zprofile" ]; then . "$_mt_real_zdot/.zprofile"; fi\n`,
    '.zshrc': zshrc,
    '.zlogin': `_mt_real_zdot="$_MT_USER_ZDOTDIR"; if [ -f "$_mt_real_zdot/.zlogin" ]; then . "$_mt_real_zdot/.zlogin"; fi\n`
  };
}

// zsh is launched with ZDOTDIR pointing at the shim dir, and zsh derives more
// than its rc files from that: compinit caches its dump at
// ${ZDOTDIR:-$HOME}/.zcompdump, and plugin managers key their caches off it the
// same way. A throwaway dir per pane therefore means a cold cache per pane,
// which costs a full $fpath rescan every time a tab opens (and surfaces any
// broken completion symlink on the box as an error before the first prompt).
// So the dir is stable and shared, at the same layout the WSL VT proxy already
// materializes inside the distro.
function shimCacheDir({ fs, path, os, isZsh }) {
  const base = path.join(os.homedir(), '.cache', 'mathterm');
  const dir = isZsh ? path.join(base, 'zsh') : base;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Panes start concurrently, so a pane must never read a half-written rc file.
// The content is fixed per build, so an up-to-date file is left alone: that
// skips the rename in the common case, and with it the chance of colliding
// with another pane reading the same shared file.
function writeShimFile(fs, path, filePath, content) {
  try {
    if (fs.readFileSync(filePath, 'utf8') === content) return;
  } catch {}
  const tmp = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2, 10)}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

function createShellShim({ fs, path, os, shellCmd, env = process.env } = {}) {
  if (!fs || !path || !os) throw new Error('shell shim requires fs, path, and os');
  if (!shellCmd) throw new Error('shell command is required');
  const isZsh = shellCmd.includes('zsh');
  const files = isZsh
    ? Object.entries(createZshShimFiles())
    : [['bashrc.sh', createBashShimScript()]];

  const materialize = dir => {
    for (const [name, content] of files) writeShimFile(fs, path, path.join(dir, name), content);
    return dir;
  };

  let shimDir;
  try {
    // mkdirSync succeeds on a directory that already exists but is read-only,
    // so the writes have to be inside the same try as the mkdir -- otherwise a
    // pane fails to open rather than falling back.
    shimDir = materialize(shimCacheDir({ fs, path, os, isZsh }));
  } catch {
    // The shared dir is unusable (no writable home, a file locked by another
    // process). Fall back to the throwaway dir older builds always used, which
    // removeShellShim still cleans up by name.
    shimDir = materialize(fs.mkdtempSync(path.join(os.tmpdir(), SHIM_PREFIX)));
  }

  const built = buildShellArgs({ path, shellCmd, shimDir, env });
  return { shimDir, shellArgs: built.args, shellEnv: built.env };
}

function buildShellArgs({ path, shellCmd, shimDir, env = process.env } = {}) {
  if (!path || !shellCmd || !shimDir) throw new Error('shell args require path, shell command, and shim dir');
  const isZsh = shellCmd.includes('zsh');
  if (isZsh) {
    return {
      args: ['-l', '-i'],
      env: {
        ...env,
        ZDOTDIR: shimDir,
        _MT_USER_ZDOTDIR: env.ZDOTDIR || env.HOME
      }
    };
  }
  return {
    args: ['--rcfile', path.join(shimDir, 'bashrc.sh'), '-i'],
    env
  };
}

// The shim dir is shared by every pane now, so closing one pane must not take
// it away from the others. Only the per-pane throwaway dirs older builds (and
// the no-home fallback above) create are still removable here.
function removeShellShim({ fs, shimDir } = {}) {
  if (!fs || !shimDir) return;
  if (!new RegExp(`(?:^|[\\\\/])${SHIM_PREFIX}[^\\\\/]*$`).test(shimDir)) return;
  try { fs.rmSync(shimDir, { recursive: true, force: true }); } catch {}
}

function sweepStaleShellShims({ fs, path, os, olderThanMs = 24 * 60 * 60 * 1000, now = Date.now() } = {}) {
  if (!fs || !path || !os) throw new Error('shell shim sweep requires fs, path, and os');
  const tmpRoot = os.tmpdir();
  let names = [];
  try { names = fs.readdirSync(tmpRoot); } catch { return 0; }
  let removed = 0;
  for (const name of names) {
    if (!name.startsWith(SHIM_PREFIX)) continue;
    const fullPath = path.join(tmpRoot, name);
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isDirectory()) continue;
      const age = now - stat.mtimeMs;
      if (age >= olderThanMs) {
        fs.rmSync(fullPath, { recursive: true, force: true });
        removed += 1;
      }
    } catch {}
  }
  return removed;
}

module.exports = {
  SHIM_PREFIX,
  createShellShim,
  createBashShimScript,
  createZshShimFiles,
  buildShellArgs,
  removeShellShim,
  sweepStaleShellShims
};
