function parseCliOptions(argv = process.argv) {
  const opts = {
    help: false,
    sessionPath: null,
    passthrough: []
  };
  const args = argv.slice(1);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--session') {
      opts.sessionPath = findSessionPathArgument(args, i + 1);
    } else if (arg.startsWith('--session=')) {
      opts.sessionPath = arg.slice('--session='.length) || null;
    } else {
      opts.passthrough.push(arg);
    }
  }
  return opts;
}

function findSessionPathArgument(args, startIndex) {
  const candidates = [];
  for (let i = startIndex; i < args.length; i++) {
    const arg = args[i];
    if (!isSessionPathCandidate(arg)) continue;
    candidates.push(arg);
  }
  return candidates.find(arg => /\.json$/i.test(arg)) || candidates[0] || null;
}

function isSessionPathCandidate(arg) {
  if (!arg || arg.startsWith('-')) return false;
  return arg !== '.' && arg !== './';
}

function cliUsage(command = 'mathterm') {
  return [
    `Usage: ${command} [options]`,
    '',
    'Options:',
    '  --session <file>  Load a session JSON file and restore it on startup',
    '  -h, --help        Show this help'
  ].join('\n');
}

module.exports = {
  parseCliOptions,
  cliUsage
};
