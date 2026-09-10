const mt = window.mathterm;
const { settings } = require('./settings');
const { resolveDefaultProfile } = require('../shared/shellProfiles');

// Shell profiles are detected once in the main process (Windows Terminal
// config import + our own probing) and cached here for the window lifetime.
let profiles = null;
let detectedDefaultProfileId = null;

// Last-resort list when detection fails; the POSIX entry mirrors the
// historical hard-coded spawnPaneShell command exactly.
function fallbackProfiles() {
  if (mt.os.platform === 'win32') {
    return [{ id: 'auto:powershell', name: 'Windows PowerShell', command: 'powershell.exe', args: [], useShim: false }];
  }
  return [{ id: 'posix:default', name: 'Default', command: mt.os.env.SHELL || '/bin/bash', args: [], useShim: true }];
}

async function initProfiles() {
  if (profiles) return;
  try {
    const result = await mt.ipc.invoke('list-shell-profiles');
    if (result?.ok && Array.isArray(result.profiles) && result.profiles.length) {
      profiles = result.profiles;
      detectedDefaultProfileId = result.defaultProfileId || null;
      return;
    }
  } catch (err) {
    console.error('Failed to detect shell profiles:', err);
  }
  profiles = fallbackProfiles();
  detectedDefaultProfileId = null;
}

function getProfiles() {
  return profiles || fallbackProfiles();
}

function defaultProfile() {
  return resolveDefaultProfile(getProfiles(), settings.defaultProfile, detectedDefaultProfileId) || getProfiles()[0];
}

function profileById(id) {
  return getProfiles().find(p => p.id === id) || null;
}

// Resolve the profile for a pane: its stored id when that profile still
// exists, otherwise the current default.
function profileForPane(profileId) {
  return profileById(profileId) || defaultProfile();
}

module.exports = { initProfiles, getProfiles, defaultProfile, profileById, profileForPane };
