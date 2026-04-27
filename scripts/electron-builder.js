#!/usr/bin/env node

const nodeModuleCollector = require('app-builder-lib/out/node-module-collector');
const { TraversalNodeModulesCollector } = require('app-builder-lib/out/node-module-collector/traversalNodeModulesCollector');

process.env.NO_UPDATE_NOTIFIER = process.env.NO_UPDATE_NOTIFIER || '1';

// npm 11 under Node 24 can produce empty captured output for electron-builder's
// npm dependency collector in this environment. Traversal avoids that CLI path.
const originalGetCollector = nodeModuleCollector.getCollectorByPackageManager;
nodeModuleCollector.getCollectorByPackageManager = function getCollectorByPackageManager(pm, rootDir, tempDirManager) {
  if (pm === nodeModuleCollector.PM.NPM) {
    return new TraversalNodeModulesCollector(rootDir, tempDirManager);
  }
  return originalGetCollector(pm, rootDir, tempDirManager);
};

require('electron-builder/cli');
