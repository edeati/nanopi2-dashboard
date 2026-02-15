'use strict';

const { execFile } = require('child_process');

function defaultRunner(args, cwd) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, stdout: stdout || '', stderr: stderr || error.message });
        return;
      }
      resolve({ ok: true, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function createGitSyncService(options) {
  const cwd = options.cwd;
  const config = options.config;
  const runner = options.runner || ((args) => defaultRunner(args, cwd));

  const state = {
    lastAction: 'none',
    lastSuccessAt: null,
    lastError: null
  };

  async function runGit(args) {
    return runner(args, cwd);
  }

  async function sync() {
    const branch = config.branch || 'dev';
    const steps = [
      ['pull', '--rebase', 'origin', branch],
      ['push', 'origin', branch]
    ];

    for (const step of steps) {
      const result = await runGit(step);
      if (!result.ok) {
        state.lastAction = 'sync';
        state.lastError = result.stderr || 'git command failed';
        return { ok: false, detail: state.lastError };
      }
    }

    state.lastAction = 'sync';
    state.lastSuccessAt = new Date().toISOString();
    state.lastError = null;
    return { ok: true };
  }

  async function action(name) {
    if (name === 'sync') {
      return sync();
    }

    const branch = config.branch || 'dev';
    let args;
    if (name === 'pull') {
      args = ['pull', '--rebase', 'origin', branch];
    } else if (name === 'push') {
      args = ['push', 'origin', branch];
    } else {
      return { ok: false, detail: 'unsupported action' };
    }

    const result = await runGit(args);
    state.lastAction = name;
    if (result.ok) {
      state.lastSuccessAt = new Date().toISOString();
      state.lastError = null;
      return { ok: true };
    }
    state.lastError = result.stderr || 'git command failed';
    return { ok: false, detail: state.lastError };
  }

  async function status() {
    const result = await runGit(['status', '--short', '--branch']);
    return {
      ok: result.ok,
      summary: result.stdout.trim(),
      branch: config.branch || 'dev',
      autoSyncEnabled: !!config.autoSyncEnabled,
      intervalSeconds: Number(config.intervalSeconds || 300),
      lastAction: state.lastAction,
      lastSuccessAt: state.lastSuccessAt,
      lastError: state.lastError
    };
  }

  return {
    action,
    status
  };
}

module.exports = {
  createGitSyncService
};
