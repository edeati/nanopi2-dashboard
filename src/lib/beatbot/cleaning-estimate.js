'use strict';

const fs = require('fs');

const MINUTE_MS = 60 * 1000;
const MAX_CYCLE_MINUTES = 360;
const CLEANING_STATUSES = new Set(['diving', 'cleaning']);
const IDLE_STATUSES = new Set(['standby', 'charging', 'charge_done', 'sleep', 'clean_done', 'clean_wait', 'dock_done']);
const RETURN_STATUSES = new Set(['emerge', 'return_trip', 'auto_dock', 'dock', 'clean_done']);

function loadDurations(file, logger) {
  try {
    const entries = Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')));
    return new Map(entries.filter(([, minutes]) =>
      Number.isFinite(minutes) && minutes >= 5 && minutes <= MAX_CYCLE_MINUTES));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn('[beatbot] could not read cleaning history: ' + err.message);
    }
    return new Map();
  }
}

function saveDurations(file, durations, logger) {
  try {
    fs.writeFileSync(file + '.tmp', JSON.stringify(Object.fromEntries(durations)));
    fs.renameSync(file + '.tmp', file);
  } catch (err) {
    logger.warn('[beatbot] could not save cleaning history: ' + err.message);
  }
}

function startOrResume(run, mode, timestamp) {
  run.mode = run.mode || mode;
  if (run.pausedAt !== null) {
    run.startedAt += timestamp - run.pausedAt;
    run.pausedAt = null;
  }
}

function createCleaningEstimate({ now = Date.now, historyPath, cycleMinutes = {}, logger }) {
  const runs = new Map();
  const durations = historyPath ? loadDurations(historyPath, logger) : new Map();

  function finishRun(id, run) {
    const minutes = (run.returningAt - run.startedAt) / MINUTE_MS;
    if (!run.observedStart || !run.mode || minutes < 5 || minutes > MAX_CYCLE_MINUTES) {
      return;
    }
    durations.set(JSON.stringify([id, run.mode]), minutes);
    if (historyPath) {
      saveDurations(historyPath, durations, logger);
    }
  }

  function endTime(id, run, timestamp) {
    const minutes = durations.get(JSON.stringify([id, run.mode])) || cycleMinutes[run.mode];
    const endAt = run.startedAt + minutes * MINUTE_MS;
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_CYCLE_MINUTES || endAt <= timestamp) {
      return null;
    }
    return new Date(endAt).toISOString();
  }

  function observePauseOrFinish(id, run, status, timestamp) {
    if (status === 'paused' && run.returningAt === null) {
      run.pausedAt = run.pausedAt ?? timestamp;
      return;
    }
    if (RETURN_STATUSES.has(status) && run.pausedAt === null) {
      // Observe the first return signal, then require a completed cycle before learning.
      run.returningAt = run.returningAt ?? timestamp;
      if (status !== 'clean_done') {
        return;
      }
      finishRun(id, run);
    }
    runs.delete(id);
  }

  function observeCleaning(id, workMode, run, previousStatus, timestamp) {
    if (run?.returningAt != null) {
      runs.delete(id);
      return null;
    }
    if (!run) {
      const observedStart = IDLE_STATUSES.has(previousStatus);
      if (!observedStart && previousStatus != null) {
        return null;
      }
      // Use the first observation as a provisional start for a cycle already underway.
      run = { startedAt: timestamp, mode: workMode, observedStart, pausedAt: null, returningAt: null };
      runs.set(id, run);
    }
    startOrResume(run, workMode, timestamp);
    return endTime(id, run, timestamp);
  }

  function update(device, previousStatus) {
    const { id, status, workMode } = device;
    const run = runs.get(id);
    if (device.errors.length || (run?.mode && workMode && run.mode !== workMode)) {
      runs.delete(id);
      return null;
    }
    const timestamp = now();
    if (CLEANING_STATUSES.has(status)) {
      return observeCleaning(id, workMode, run, previousStatus, timestamp);
    }
    if (run) {
      observePauseOrFinish(id, run, status, timestamp);
    }
    return null;
  }

  return { update, delete: (id) => runs.delete(id), clear: () => runs.clear() };
}

module.exports = { createCleaningEstimate };
