const mt = window.mathterm;

function createShellShim(shellCmd) {
  const isZsh = shellCmd.includes('zsh');
  const tmpDir = mt.fs.mkdtempSync(mt.path.join(mt.os.tmpdir(), 'mathterm-'));
  const markA = "printf '\\033]133;A\\007'";
  const markB = "printf '\\033]133;B\\007'";
  const markC = "printf '\\033]133;C\\007'";
  const markD = "printf '\\033]133;D;%s\\007'";

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
_mathterm_preexec_invoke_exec() { [ "\$_MATHTERM_PREEXEC" = "1" ] && return; _MATHTERM_PREEXEC=1; ${markC}; }
trap '_mathterm_preexec_invoke_exec' DEBUG
PROMPT_COMMAND="\${PROMPT_COMMAND:+\$PROMPT_COMMAND;}_MATHTERM_PREEXEC=0; ${markD} \\\$?; ${markA}"
case "\$PS1" in
  *'\\[\\e]133;B\\a\\]'*) ;;
  *) PS1="\${PS1}\\[\\e]133;B\\a\\]" ;;
esac
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
