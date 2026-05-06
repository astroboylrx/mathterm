function defaultRandom() {
  return Math.random();
}

function defaultNow() {
  return Date.now();
}

function createRuntimeIdFactory({ now = defaultNow, random = defaultRandom } = {}) {
  let counter = 0;

  function next(kind) {
    if (!kind || typeof kind !== 'string') throw new Error('runtime id kind is required');
    counter += 1;
    const timePart = Math.max(0, Math.floor(Number(now()) || 0)).toString(36);
    const counterPart = counter.toString(36);
    const randomPart = Math.floor(Math.max(0, Math.min(0.999999999, Number(random()) || 0)) * 0x1000000)
      .toString(36)
      .padStart(5, '0');
    return `${kind}-${timePart}-${counterPart}-${randomPart}`;
  }

  return {
    next,
    nextWorkspaceBackendId: () => next('workspace'),
    nextPaneBackendId: () => next('pane')
  };
}

module.exports = { createRuntimeIdFactory };
