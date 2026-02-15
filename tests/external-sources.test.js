'use strict';

const assert = require('assert');
const { createExternalSources } = require('../src/lib/external-sources');

module.exports = async function run() {
  function formatDateLocal(date) {
    return date.getFullYear() +
      '-' + String(date.getMonth() + 1).padStart(2, '0') +
      '-' + String(date.getDate()).padStart(2, '0');
  }

  function addDaysLocal(baseDate, days) {
    const d = new Date(baseDate.getTime());
    d.setDate(d.getDate() + days);
    return formatDateLocal(d);
  }

  const calls = [];
  const weatherPayload = {
    weather: [{ main: 'Rain', icon: '10d' }],
    main: { temp: 24.6 },
    list: [
      { dt: 1771089600, main: { temp: 24 }, weather: [{ main: 'Clouds', icon: '03d' }] },
      { dt: 1771176000, main: { temp: 26 }, weather: [{ main: 'Rain', icon: '10d' }] },
      { dt: 1771262400, main: { temp: 23 }, weather: [{ main: 'Clear', icon: '01d' }] }
    ]
  };
  const sources = createExternalSources({
    weather: {
      provider: 'openweathermap',
      apiBase: 'http://api.openweathermap.org/data/2.5/weather',
      forecastApiBase: 'http://api.openweathermap.org/data/2.5/forecast',
      locationID: '2174003',
      appid: 'abc123',
      units: 'metric'
    },
    news: { feedUrl: '', maxItems: 5 },
    bins: { sourceUrl: '', propertyId: '123456' }
  }, {
    fetchText: async (url) => {
      calls.push(url);
      if (url.indexOf('/api/v1/properties/123456.json') > -1) {
        return JSON.stringify({
          upcoming: [
            { date: '2026-02-21', type: 'Recycle' }
          ]
        });
      }
      return JSON.stringify(weatherPayload);
    }
  });

  const weather = await sources.fetchWeather();
  assert.strictEqual(weather.summary, 'Rain');
  assert.strictEqual(weather.tempC, 24.6);
  assert.strictEqual(Array.isArray(weather.forecast), true);
  assert.strictEqual(weather.forecast.length, 3);
  const bins = await sources.fetchBins();
  assert.strictEqual(bins.nextType, 'Recycle');
  assert.strictEqual(bins.nextDate, '2026-02-21');
  assert.ok(calls[0].indexOf('id=2174003') > -1);
  assert.ok(calls[0].indexOf('appid=abc123') > -1);
  assert.ok(calls.some((u) => u.indexOf('/api/v1/properties/123456.json') > -1));

  const noKey = createExternalSources({
    weather: {
      provider: 'openweathermap',
      apiBase: 'http://api.openweathermap.org/data/2.5/weather',
      locationID: '2174003',
      appid: ''
    },
    news: { feedUrl: '', maxItems: 5 },
    bins: { sourceUrl: '' }
  }, {
    fetchText: async () => {
      throw new Error('should not fetch');
    }
  });

  const pending = await noKey.fetchWeather();
  assert.strictEqual(pending.summary, 'Configure OpenWeather appid');
  assert.strictEqual(pending.tempC, 0);

  const altBins = createExternalSources({
    weather: { provider: 'none' },
    news: { feedUrl: '', maxItems: 5 },
    bins: { sourceUrl: 'https://example.invalid/bins' }
  }, {
    fetchText: async () => JSON.stringify({
      services: [
        { service: 'General Waste', date: '2026-02-25' }
      ]
    })
  });

  const alt = await altBins.fetchBins();
  assert.strictEqual(alt.nextType, 'General Waste');
  assert.strictEqual(alt.nextDate, '2026-02-25');

  const nestedBins = createExternalSources({
    weather: { provider: 'none' },
    news: { feedUrl: '', maxItems: 5 },
    bins: { sourceUrl: 'https://example.invalid/nested-bins' }
  }, {
    fetchText: async () => JSON.stringify({
      data: {
        nextCollection: {
          stream: 'Green Bin',
          collectionDate: '2026-03-02'
        }
      }
    })
  });

  const nested = await nestedBins.fetchBins();
  assert.strictEqual(nested.nextType, 'Green Bin');
  assert.strictEqual(nested.nextDate, '2026-03-02');

  const deeplyNestedBins = createExternalSources({
    weather: { provider: 'none' },
    news: { feedUrl: '', maxItems: 5 },
    bins: { sourceUrl: 'https://example.invalid/deep-bins' }
  }, {
    fetchText: async () => JSON.stringify({
      collections: {
        upcoming: [
          {
            wasteStreams: [
              { streamType: 'Recycle Bin', collection: { dateLabel: '2026-03-09' } }
            ]
          }
        ]
      }
    })
  });

  const deep = await deeplyNestedBins.fetchBins();
  assert.strictEqual(deep.nextType, 'Recycle Bin');
  assert.strictEqual(deep.nextDate, '2026-03-09');

  const htmlErrorBins = createExternalSources({
    weather: { provider: 'none' },
    news: { feedUrl: '', maxItems: 5 },
    bins: { sourceUrl: 'https://example.invalid/html-bins' }
  }, {
    fetchText: async () => '<!doctype html><html><body>blocked</body></html>'
  });

  const unavailable = await htmlErrorBins.fetchBins();
  assert.strictEqual(unavailable.nextType, 'Bins unavailable');
  assert.strictEqual(unavailable.nextDate, 'Check source');

  const monthCalls = [];
  const monthBins = createExternalSources({
    weather: { provider: 'none' },
    news: { feedUrl: '', maxItems: 5 },
    bins: { sourceUrl: '', propertyId: '638788' }
  }, {
    fetchText: async (url) => {
      monthCalls.push(url);
      return JSON.stringify({
        upcoming: [{ date: '2026-02-25', type: 'Recycle' }]
      });
    }
  });
  await monthBins.fetchBins();
  const binsUrl = monthCalls[0] || '';
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  assert.ok(binsUrl.indexOf('/api/v1/properties/638788.json') > -1);
  assert.ok(binsUrl.indexOf('start=' + formatDateLocal(startOfMonth)) > -1);
  assert.ok(binsUrl.indexOf('end=' + formatDateLocal(endOfMonth)) > -1);

  const brisbaneStartFieldBins = createExternalSources({
    weather: { provider: 'none' },
    news: { feedUrl: '', maxItems: 5 },
    bins: { sourceUrl: 'https://example.invalid/brisbane-start-fields' }
  }, {
    now: () => new Date('2026-02-20T10:00:00+10:00'),
    fetchText: async () => JSON.stringify([
      { event_type: 'waste', start_date: '2026-02-02' },
      { event_type: 'organic', start: '2026-02-16' },
      { event_type: 'recycle', start: '2026-02-23' }
    ])
  });
  const brisbaneStartParsed = await brisbaneStartFieldBins.fetchBins();
  assert.strictEqual(brisbaneStartParsed.nextType, 'Recycle');
  assert.strictEqual(brisbaneStartParsed.nextDate, '2026-02-23');

  const binsDebugLogs = [];
  const binsWithDebug = createExternalSources({
    weather: { provider: 'none' },
    news: { feedUrl: '', maxItems: 5 },
    bins: { sourceUrl: 'https://example.invalid/brisbane-debug', debug: true }
  }, {
    now: () => new Date('2026-02-20T10:00:00+10:00'),
    logger: {
      log: (message) => binsDebugLogs.push(String(message))
    },
    fetchText: async () => JSON.stringify([
      { event_type: 'recycle', start: '2026-02-23' }
    ])
  });
  await binsWithDebug.fetchBins();
  assert.ok(binsDebugLogs.some((line) => line.indexOf('[bins] fetching: https://example.invalid/brisbane-debug') > -1));
  assert.ok(binsDebugLogs.some((line) => line.indexOf('[bins] selected: Recycle @ 2026-02-23') > -1));

  const rankingNow = new Date('2026-02-14T10:00:00+10:00');
  const prioritizedBins = createExternalSources({
    weather: { provider: 'none' },
    news: { feedUrl: '', maxItems: 5 },
    bins: { sourceUrl: 'https://example.invalid/prioritized' }
  }, {
    now: () => new Date(rankingNow.getTime()),
    fetchText: async () => JSON.stringify({
      upcoming: [
        { event_type: 'special', name: 'Kerbside Pickup', date: addDaysLocal(rankingNow, 2) },
        { event_type: 'general', date: addDaysLocal(rankingNow, 1) },
        { event_type: 'recycle', date: addDaysLocal(rankingNow, 5) }
      ]
    })
  });
  const prioritized = await prioritizedBins.fetchBins();
  assert.strictEqual(prioritized.nextType, 'Recycle');
  assert.strictEqual(prioritized.eventType, 'recycle');
  assert.strictEqual(prioritized.displayIcon, '♻');
  assert.strictEqual(prioritized.displayTone, 'yellow');

  const specialNameBins = createExternalSources({
    weather: { provider: 'none' },
    news: { feedUrl: '', maxItems: 5 },
    bins: { sourceUrl: 'https://example.invalid/special-name' }
  }, {
    now: () => new Date(rankingNow.getTime()),
    fetchText: async () => JSON.stringify({
      upcoming: [
        { event_type: 'special', name: 'Bulky Collection', date: addDaysLocal(rankingNow, 3) }
      ]
    })
  });
  const specialNamed = await specialNameBins.fetchBins();
  assert.strictEqual(specialNamed.nextType, 'Bulky Collection');
  assert.strictEqual(specialNamed.eventType, 'special');
  assert.strictEqual(specialNamed.displayIcon, '📦');

  const sameDayDate = formatDateLocal(rankingNow);
  const sameDayBeforeOneBins = createExternalSources({
    weather: { provider: 'none' },
    news: { feedUrl: '', maxItems: 5 },
    bins: { sourceUrl: 'https://example.invalid/same-day-before' }
  }, {
    now: () => new Date('2026-02-14T11:00:00+10:00'),
    fetchText: async () => JSON.stringify({
      upcoming: [
        { event_type: 'recycle', date: sameDayDate },
        { event_type: 'special', name: 'Kerbside Pickup', date: addDaysLocal(rankingNow, 1) }
      ]
    })
  });
  const sameDayBefore = await sameDayBeforeOneBins.fetchBins();
  assert.strictEqual(sameDayBefore.nextType, 'Today: Recycle');
  assert.strictEqual(sameDayBefore.nextDate, sameDayDate);
  assert.strictEqual(sameDayBefore.isToday, true);
  assert.strictEqual(sameDayBefore.subtitle, 'Put out now');
  assert.strictEqual(sameDayBefore.displayIcon, '♻');

  const sameDayAfterOneBins = createExternalSources({
    weather: { provider: 'none' },
    news: { feedUrl: '', maxItems: 5 },
    bins: { sourceUrl: 'https://example.invalid/same-day-after' }
  }, {
    now: () => new Date('2026-02-14T14:00:00+10:00'),
    fetchText: async () => JSON.stringify({
      upcoming: [
        { event_type: 'recycle', date: sameDayDate },
        { event_type: 'special', name: 'Kerbside Pickup', date: addDaysLocal(rankingNow, 1) }
      ]
    })
  });
  const sameDayAfter = await sameDayAfterOneBins.fetchBins();
  assert.strictEqual(sameDayAfter.nextType, 'Kerbside Pickup');
  assert.strictEqual(sameDayAfter.eventType, 'special');
  assert.strictEqual(sameDayAfter.displayIcon, '📦');
};
