#!/usr/bin/env node
const path = require('path');
const { spawn } = require('child_process');
const { parseCliOptions, cliUsage } = require('../cliOptions');

if (parseCliOptions(process.argv).help) {
  console.log(cliUsage('mathterm'));
  process.exit(0);
}

let electron;
try {
  electron = require('electron');
} catch {
  console.error('MathTerm CLI requires Electron in this checkout. Run npm install first.');
  process.exit(1);
}

const appRoot = path.resolve(__dirname, '..');
const child = spawn(electron, [appRoot, ...process.argv.slice(2)], {
  stdio: 'inherit'
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
