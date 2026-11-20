'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = async function run() {
  const html = fs.readFileSync(path.join(process.cwd(), 'public/dashboard.html'), 'utf8');

  const staticPanel = { hidden: true };
  const staticContent = {};
  const stripTrack = {};
  const layout = new Set();
  const context = vm.createContext({
    poolCleanerCardNode: staticPanel,
    poolCleanerStaticNode: staticContent,
    bottomRowNode: { classList: { toggle(name, show) { if (show) layout.add(name); else layout.delete(name); } } },
    weatherBinsStripTrackNode: stripTrack,
    lastPoolCleanerSig: '',
    lastCombinedStripSig: '',
    escapeHtml: String,
    attachPoolCleanerPark() {},
    buildWeatherStripCards: () => [],
    buildBinsStripCards: () => [],
    buildReminderStripCards: () => []
  });
  for (const name of [
    'buildPoolCleanerCard', 'renderPoolCleanerMode', 'poolCleanerIsActive', 'poolCleanerStateIcon',
    'renderPoolCleanerEstimate', 'poolCleanerSignature',
    'renderPoolCleanerBattery', 'renderPoolCleanerStatic', 'buildCombinedStripCards',
    'combinedStripSignature', 'renderCombinedStripCard', 'renderCombinedStrip'
  ]) {
    vm.runInContext(html.match(new RegExp('^      function ' + name + '\\([^\\n]+\\n[\\s\\S]*?^      \\}', 'm'))[0], context);
  }
  const applyStrip = html.slice(html.indexOf('        var nextPoolCleanerCard ='), html.indexOf('        var newsHeadlines ='));
  const cleaner = { id: 'test', battery: 68, online: false, status: 'standby' };
  context.state = { beatbot: { devices: [cleaner] } };
  vm.runInContext(applyStrip, context);
  assert.ok(staticPanel.hidden && !layout.has('has-static-pool-cleaner'), 'offline strip should reclaim the static column');
  assert.match(stripTrack.innerHTML, /#i-pc-offline/);
  for (const card of stripTrack.innerHTML.match(/<article\b[\s\S]*?<\/article>/g)) {
    assert.match(card.replace(/<[^>]*>/g, '').trim(), /^Pool Cleaner\s*68%$/);
  }

  cleaner.online = true;
  vm.runInContext(applyStrip, context);
  assert.ok(!staticPanel.hidden && layout.has('has-static-pool-cleaner'));
  assert.doesNotMatch(stripTrack.innerHTML, /#i-pc-offline/);

  cleaner.online = false;
  cleaner.status = 'diving';
  cleaner.statusLabel = 'Diving';
  cleaner.workMode = 'fast';
  cleaner.availableWorkModes = ['fast', 'standard', 'cec', 'wall'];
  cleaner.supportedActions = ['return', 'start', 'pause'];
  cleaner.estimatedEndAt = new Date(Date.now() + 3600000).toISOString();
  vm.runInContext(applyStrip, context);
  assert.ok(!staticPanel.hidden, 'underwater cleaner should stay in the static column');
  assert.ok(staticContent.innerHTML.includes('<time datetime="' + cleaner.estimatedEndAt));

  assert.match(staticContent.innerHTML, /Estimated end time/);
  assert.match(staticContent.innerHTML, /Diving/);
  assert.match(staticContent.innerHTML, /Last known/);
  assert.match(staticContent.innerHTML, /68%/);
  assert.match(staticContent.innerHTML, />Floor</);
  assert.match(staticContent.innerHTML, /href="#i-pc-mode-floor"/);
  assert.doesNotMatch(staticContent.innerHTML, /<(?:button|select)\b/, 'underwater card has no controls');

  cleaner.estimatedEndAt = new Date(Date.now() + 7200000).toISOString();
  vm.runInContext(applyStrip, context);
  assert.ok(staticContent.innerHTML.includes(cleaner.estimatedEndAt), 'a new estimate should refresh the static card');

  cleaner.workMode = 'wall';
  vm.runInContext(applyStrip, context);
  assert.match(staticContent.innerHTML, />Waterline</);
  assert.match(staticContent.innerHTML, /href="#i-pc-mode-waterline"/);
  assert.doesNotMatch(staticContent.innerHTML, /href="#i-pc-mode-floor"/);

  cleaner.online = true;
  cleaner.status = 'return_trip';
  cleaner.estimatedEndAt = null;
  vm.runInContext(applyStrip, context);
  assert.doesNotMatch(staticContent.innerHTML, /<time\b|<button\b/, 'automatic return needs no estimate or Park action');

  cleaner.status = 'clean_done';
  vm.runInContext(applyStrip, context);
  assert.match(staticContent.innerHTML, /<button\b[^>]*>Park<\/button>/, 'an online cleaner can be parked after a cycle');
  assert.doesNotMatch(staticContent.innerHTML, /Last known/);

  context.state.beatbot.stale = true;
  vm.runInContext(applyStrip, context);
  assert.doesNotMatch(staticContent.innerHTML, /<button\b/, 'stale data cannot establish whether parking is available');
  context.state.beatbot.stale = false;
  cleaner.supportedActions = [];
  vm.runInContext(applyStrip, context);
  assert.doesNotMatch(staticContent.innerHTML, /<button\b/, 'a cleaner without the capability has no Park action');

  cleaner.online = false;
  cleaner.status = 'standby';
  cleaner.battery = null;
  vm.runInContext(applyStrip, context);
  assert.ok(staticPanel.hidden && !layout.has('has-static-pool-cleaner'));
  assert.match(stripTrack.innerHTML, /<strong>--<\/strong>/, 'unknown battery should not appear as zero percent');
};
