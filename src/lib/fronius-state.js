'use strict';

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function createFroniusStateManager(options) {
  const estimatedAfterMs = (options && options.estimatedAfterMs) || (10 * 60 * 1000);

  const state = {
    realtime: {
      generatedW: 0,
      gridW: 0,
      loadW: 0,
      dayGeneratedKwh: 0,
      at: null
    },
    archive: {
      dayKey: null,
      dayGeneratedKwh: 0,
      dayImportKwh: 0,
      dayExportKwh: 0,
      generatedReady: false,
      importReady: false,
      exportReady: false,
      at: null
    },
    rolling: {
      dayKey: null,
      importKwh: 0,
      exportKwh: 0
    }
  };

  function applyRealtime(payload, nowMs) {
    const dayKey = new Date(nowMs).toDateString();
    if (state.rolling.dayKey !== dayKey) {
      state.rolling.dayKey = dayKey;
      state.rolling.importKwh = 0;
      state.rolling.exportKwh = 0;
    }

    if (state.realtime.at) {
      const dtHours = Math.max(0, (nowMs - state.realtime.at) / 3600000);
      const gridW = Number(state.realtime.gridW || 0);
      if (gridW > 0) {
        state.rolling.importKwh += (gridW / 1000) * dtHours;
      } else if (gridW < 0) {
        state.rolling.exportKwh += ((-gridW) / 1000) * dtHours;
      }
    }

    state.realtime = {
      generatedW: Number(payload.generatedW || 0),
      gridW: Number(payload.gridW || 0),
      loadW: Number(payload.loadW || 0),
      dayGeneratedKwh: Number(payload.dayGeneratedKwh || 0),
      at: nowMs
    };
  }

  function applyArchive(payload, nowMs) {
    const dayKey = new Date(nowMs).toDateString();
    state.archive = {
      dayKey,
      dayGeneratedKwh: Number(payload.dayGeneratedKwh || 0),
      dayImportKwh: Number(payload.dayImportKwh || 0),
      dayExportKwh: Number(payload.dayExportKwh || 0),
      generatedReady: true,
      importReady: true,
      exportReady: true,
      at: nowMs
    };
  }

  function estimateToday(nowMs) {
    const elapsedHours = state.realtime.at ? Math.max(0, (nowMs - state.realtime.at) / 3600000) : 0;
    const generatedExtra = Math.max(0, state.realtime.generatedW / 1000 * elapsedHours);
    const importExtra = Math.max(0, state.realtime.gridW / 1000 * elapsedHours);
    const exportExtra = Math.max(0, (state.realtime.gridW < 0 ? -state.realtime.gridW : 0) / 1000 * elapsedHours);

    return {
      generatedKwh: round3(state.archive.dayGeneratedKwh + generatedExtra),
      importKwh: round3(state.archive.dayImportKwh + importExtra),
      exportKwh: round3(state.archive.dayExportKwh + exportExtra),
      source: 'estimated'
    };
  }

  function getState(nowMs) {
    const dayKey = new Date(nowMs).toDateString();
    const archiveForToday = state.archive.dayKey === dayKey;
    const archiveAge = (archiveForToday && state.archive.at) ? nowMs - state.archive.at : Number.MAX_SAFE_INTEGER;
    const estimatedMode = archiveAge > estimatedAfterMs;

    const archiveGenerated = archiveForToday ? Number(state.archive.dayGeneratedKwh || 0) : 0;
    const archiveImport = archiveForToday ? Number(state.archive.dayImportKwh || 0) : 0;
    const archiveExport = archiveForToday ? Number(state.archive.dayExportKwh || 0) : 0;
    const generatedReady = !!(archiveForToday && state.archive.generatedReady);
    const importReady = !!(archiveForToday && state.archive.importReady);
    const exportReady = !!(archiveForToday && state.archive.exportReady);
    const realtimeGenerated = Number(state.realtime.dayGeneratedKwh || 0);
    const rollingImport = Number(state.rolling.importKwh || 0);
    const rollingExport = Number(state.rolling.exportKwh || 0);

    const todayBase = estimatedMode ? estimateToday(nowMs) : {
      generatedKwh: round3(archiveGenerated > 0 ? archiveGenerated : realtimeGenerated),
      importKwh: round3(archiveImport > 0 ? archiveImport : rollingImport),
      exportKwh: round3(archiveExport > 0 ? archiveExport : rollingExport),
      source: archiveGenerated > 0 ? 'archive' : 'realtime'
    };

    const today = Object.assign({}, todayBase, {
      generatedReady,
      importReady,
      exportReady
    });

    return {
      estimatedMode,
      realtime: {
        generatedW: state.realtime.generatedW,
        gridW: state.realtime.gridW,
        loadW: state.realtime.loadW,
        dayGeneratedKwh: state.realtime.dayGeneratedKwh,
        at: state.realtime.at
      },
      today,
      archiveAt: state.archive.at
    };
  }

  return {
    applyRealtime,
    applyArchive,
    getState
  };
}

module.exports = {
  createFroniusStateManager
};
