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
      opts.sessionPath = args[++i] || null;
    } else if (arg.startsWith('--session=')) {
      opts.sessionPath = arg.slice('--session='.length) || null;
    } else {
      opts.passthrough.push(arg);
    }
  }
  return opts;
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
