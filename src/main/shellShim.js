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

function createShellShim({ fs, path, os, shellCmd, env = process.env } = {}) {
  if (!fs || !path || !os) throw new Error('shell shim requires fs, path, and os');
  if (!shellCmd) throw new Error('shell command is required');
  const isZsh = shellCmd.includes('zsh');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), SHIM_PREFIX));
  const markA = "printf '\\033]133;A\\007'";
  const markB = "printf '\\033]133;B\\007'";
  const markC = "printf '\\033]133;C\\007'";
  const markD = "printf '\\033]133;D;%s\\007'";
  const imgcatFn = createImgcatFunction();

  if (isZsh) {
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
    fs.writeFileSync(path.join(tmpDir, '.zshenv'),
      `# _MT_USER_ZDOTDIR is set by the parent process before zsh starts.\nif [ -z "\$_MT_USER_ZDOTDIR" ]; then export _MT_USER_ZDOTDIR="\$HOME"; fi\nif [ -f "\$_MT_USER_ZDOTDIR/.zshenv" ]; then . "\$_MT_USER_ZDOTDIR/.zshenv"; fi\n`);
    fs.writeFileSync(path.join(tmpDir, '.zprofile'), `_mt_real_zdot="$_MT_USER_ZDOTDIR"; if [ -f "$_mt_real_zdot/.zprofile" ]; then . "$_mt_real_zdot/.zprofile"; fi\n`);
    fs.writeFileSync(path.join(tmpDir, '.zshrc'), zshrc);
    fs.writeFileSync(path.join(tmpDir, '.zlogin'), `_mt_real_zdot="$_MT_USER_ZDOTDIR"; if [ -f "$_mt_real_zdot/.zlogin" ]; then . "$_mt_real_zdot/.zlogin"; fi\n`);
  } else {
    const bashrc = `for f in /etc/profile; do [ -f "$f" ] && . "$f" && break; done
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
    fs.writeFileSync(path.join(tmpDir, 'bashrc.sh'), bashrc);
  }

  return {
    shimDir: tmpDir,
    shellArgs: buildShellArgs({ path, shellCmd, shimDir: tmpDir, env }).args,
    shellEnv: buildShellArgs({ path, shellCmd, shimDir: tmpDir, env }).env
  };
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

function removeShellShim({ fs, shimDir } = {}) {
  if (!fs || !shimDir) return;
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
  buildShellArgs,
  removeShellShim,
  sweepStaleShellShims
};
