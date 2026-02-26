'use strict';

const assert = require('assert');
const { createExternalSources } = require('../src/lib/external-sources');

module.exports = async function run() {
  const calls = [];
  const now = new Date('2026-02-26T11:00:00+10:00');
  const sources = createExternalSources({
    weather: { provider: 'none' },
    news: { feedUrl: '', maxItems: 5 },
    bins: { sourceUrl: '', propertyId: '638788' }
  }, {
    now: () => new Date(now.getTime()),
    fetchText: async (url) => {
      calls.push(url);
      return JSON.stringify({ upcoming: [{ date: '2026-03-03', type: 'Recycle' }] });
    }
  });

  await sources.fetchBins();
  const binsUrl = calls[0] || '';
  assert.ok(binsUrl.indexOf('/api/v1/properties/638788.json') > -1);
  assert.ok(binsUrl.indexOf('start=2026-02-26') > -1);
  assert.ok(binsUrl.indexOf('end=2026-03-12') > -1);
};
