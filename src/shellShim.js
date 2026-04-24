const mt = window.mathterm;

function createShellShim(shellCmd) {
  const isZsh = shellCmd.includes('zsh');
  const tmpDir = mt.fs.mkdtempSync(mt.path.join(mt.os.tmpdir(), 'mathterm-'));
  const markA = "printf '\\033]133;A\\007'";
  const markC = "printf '\\033]133;C\\007'";
  const markD = "printf '\\033]133;D;%s\\007'";

  if (isZsh) {
    const zshrc = `_mt_real_zdot="\$_MT_USER_ZDOTDIR"
if [ -f "$_mt_real_zdot/.zshrc" ]; then . "$_mt_real_zdot/.zshrc"; fi
mathterm_prompt_marker() { ${markA}; }
mathterm_preexec() { ${markC}; }
mathterm_precmd() { ${markD} "\\$?"; }
precmd_functions=(mathterm_precmd \${precmd_functions[@]})
precmd_functions+=(mathterm_prompt_marker)
preexec_functions+=(mathterm_preexec)
`;
    mt.fs.writeFileSync(mt.path.join(tmpDir, '.zshenv'),
      `if [ -f "$HOME/.zshenv" ]; then . "$HOME/.zshenv"; fi\nexport _MT_USER_ZDOTDIR="\${ZDOTDIR:-$HOME}"\nZDOTDIR=${tmpDir}\n`);
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
`;
    mt.fs.writeFileSync(mt.path.join(tmpDir, 'bashrc.sh'), bashrc);
  }

  return tmpDir;
}

function buildShellArgs(shellCmd, shimDir) {
  const isZsh = shellCmd.includes('zsh');
  if (isZsh) {
    return { args: ['-l', '-i'], env: { ...mt.os.env, ZDOTDIR: shimDir } };
  } else {
    return { args: ['--rcfile', mt.path.join(shimDir, 'bashrc.sh'), '-i'], env: mt.os.env };
  }
}

module.exports = { createShellShim, buildShellArgs };
