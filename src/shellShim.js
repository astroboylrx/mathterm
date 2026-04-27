const mt = window.mathterm;

function createShellShim(shellCmd) {
  const isZsh = shellCmd.includes('zsh');
  const tmpDir = mt.fs.mkdtempSync(mt.path.join(mt.os.tmpdir(), 'mathterm-'));
  const markA = "printf '\\033]133;A\\007'";
  const markB = "printf '\\033]133;B\\007'";
  const markC = "printf '\\033]133;C\\007'";
  const markD = "printf '\\033]133;D;%s\\007'";

  // imgcat: base64-encode a file and emit OSC 1337 inline-image; mathterm's
  // Osc1337Parser captures it for the rich view. POSIX-portable across bash/zsh.
  // Files larger than 20 MB are downscaled to 2048px on the longest side via
  // ImageMagick (\`magick\` or \`convert\`) or macOS \`sips\`, with graceful
  // fallback to the original file when no downscaler is installed.
  const imgcatFn = `unalias imgcat 2>/dev/null || true
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
    mt.fs.writeFileSync(mt.path.join(tmpDir, '.zshenv'),
      `# _MT_USER_ZDOTDIR is set by the parent process before zsh starts.\nif [ -z "\$_MT_USER_ZDOTDIR" ]; then export _MT_USER_ZDOTDIR="\$HOME"; fi\nif [ -f "\$_MT_USER_ZDOTDIR/.zshenv" ]; then . "\$_MT_USER_ZDOTDIR/.zshenv"; fi\n`);
    mt.fs.writeFileSync(mt.path.join(tmpDir, '.zprofile'), `_mt_real_zdot="$_MT_USER_ZDOTDIR"; if [ -f "$_mt_real_zdot/.zprofile" ]; then . "$_mt_real_zdot/.zprofile"; fi\n`);
    mt.fs.writeFileSync(mt.path.join(tmpDir, '.zshrc'), zshrc);
    mt.fs.writeFileSync(mt.path.join(tmpDir, '.zlogin'), `_mt_real_zdot="$_MT_USER_ZDOTDIR"; if [ -f "$_mt_real_zdot/.zlogin" ]; then . "$_mt_real_zdot/.zlogin"; fi\n`);
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
    mt.fs.writeFileSync(mt.path.join(tmpDir, 'bashrc.sh'), bashrc);
  }

  return tmpDir;
}

function buildShellArgs(shellCmd, shimDir) {
  const isZsh = shellCmd.includes('zsh');
  if (isZsh) {
    return { args: ['-l', '-i'], env: {
      ...mt.os.env,
      ZDOTDIR: shimDir,
      _MT_USER_ZDOTDIR: mt.os.env.ZDOTDIR || mt.os.env.HOME
    }};
  } else {
    // Note: no `-l` here. Bash login shells do NOT source `--rcfile`; they
    // only read /etc/profile + ~/.bash_profile.  The bashrc.sh shim manually
    // sources profile files and then installs OSC 133 prompt markers via
    // PROMPT_COMMAND.  zsh avoids this because ZDOTDIR redirects its entire
    // dotfile chain, including login-shell files.
    return { args: ['--rcfile', mt.path.join(shimDir, 'bashrc.sh'), '-i'], env: mt.os.env };
  }
}

module.exports = { createShellShim, buildShellArgs };
