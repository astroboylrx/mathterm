const assert = require('assert');
const { parseCliOptions } = require('../src/shared/cliOptions');

assert.deepStrictEqual(parseCliOptions(['mathterm', '--session', 'session.json']).sessionPath, 'session.json');
assert.deepStrictEqual(parseCliOptions(['mathterm', '--session=session.json']).sessionPath, 'session.json');
assert.deepStrictEqual(
  parseCliOptions(['electron', '--session', '-allow-file-access-from-files', '/tmp/complex_session.json']).sessionPath,
  '/tmp/complex_session.json'
);
assert.deepStrictEqual(
  parseCliOptions(['electron', '.', '--no-sandbox', '--session', '--allow-file-access-from-files', '/tmp/complex_session.json']).sessionPath,
  '/tmp/complex_session.json'
);
assert.deepStrictEqual(
  parseCliOptions(['electron', '--session', '-allow-file-access-from-files', '.', '/tmp/complex_session.json']).sessionPath,
  '/tmp/complex_session.json'
);
assert.deepStrictEqual(
  parseCliOptions(['electron', '--session', '-allow-file-access-from-files', '/workspace/mathterm', '/tmp/complex_session.json']).sessionPath,
  '/tmp/complex_session.json'
);
assert.strictEqual(parseCliOptions(['mathterm', '--session']).sessionPath, null);

console.log('cli options tests passed');
