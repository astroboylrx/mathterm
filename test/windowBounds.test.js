const assert = require('assert');
const { clampRestoredBounds, chooseDisplay } = require('../src/shared/windowBounds');

const primary = {
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 28, width: 1920, height: 1012 }
};
const secondary = {
  bounds: { x: 1920, y: 0, width: 1280, height: 900 },
  workArea: { x: 1920, y: 24, width: 1280, height: 876 }
};

assert.deepStrictEqual(
  clampRestoredBounds({ x: 100, y: 120, width: 900, height: 640 }, [primary]),
  { x: 100, y: 120, width: 900, height: 640 }
);

assert.deepStrictEqual(
  clampRestoredBounds({ x: -500, y: -400, width: 900, height: 640 }, [primary]),
  { x: 0, y: 28, width: 900, height: 640 }
);

assert.deepStrictEqual(
  clampRestoredBounds({ x: 100, y: 80, width: 2400, height: 1600 }, [primary]),
  { x: 0, y: 28, width: 1920, height: 1012 }
);

assert.deepStrictEqual(
  clampRestoredBounds({ x: 3000, y: 700, width: 640, height: 360 }, [primary, secondary]),
  { x: 2560, y: 540, width: 640, height: 360 }
);

assert.strictEqual(
  chooseDisplay({ x: 2100, y: 100, width: 600, height: 400 }, [primary, secondary]),
  secondary
);

assert.strictEqual(
  chooseDisplay({ x: 5000, y: 100, width: 600, height: 400 }, [primary, secondary]),
  secondary
);

assert.deepStrictEqual(
  clampRestoredBounds({ width: 900, height: 640 }, [primary]),
  { width: 900, height: 640 }
);

console.log('window bounds tests passed');
