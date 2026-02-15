'use strict';

const assert = require('assert');
const http = require('http');
const { createFroniusClient } = require('../src/lib/fronius-client');

module.exports = async function run() {
  const server = http.createServer((req, res) => {
    if (req.url.indexOf('/GetArchiveData.cgi') > -1) {
      if (req.url.indexOf('StartDate=2026-02-15') > -1) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          Body: {
            Data: {
              meter: {
                Data: {
                  EnergyReal_WAC_Phase_1_Consumed: {
                    Values: {
                      '1739664000': 3000
                    }
                  },
                  EnergyReal_WAC_Phase_2_Consumed: {
                    Values: {
                      '1739664000': 1200
                    }
                  },
                  EnergyReal_WAC_Phase_3_Consumed: {
                    Values: {
                      '1739664000': 800
                    }
                  }
                }
              },
              EnergyReal_WAC_Sum_Produced: {
                Values: {
                  '1739664000': 15000
                }
              }
            }
          }
        }));
        return;
      }

      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        Body: {
          Data: {
            EnergyReal_WAC_Sum_Produced: {
              Values: {
                '1739491200': 12345,
                '1739577600': 23456
              }
            },
            EnergyReal_WAC_Plus_Absolute: {
              Values: {
                '1739491200': 6000,
                '1739577600': 7000
              }
            },
            EnergyReal_WAC_Minus_Absolute: {
              Values: {
                '1739491200': 2500,
                '1739577600': 3500
              }
            }
          }
        }
      }));
      return;
    }

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      Body: {
        Data: {
          Inverters: { '1': { P: 4200 } },
          Site: { P_Grid: -1000, P_Load: 3200 }
        }
      }
    }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const baseUrl = 'http://127.0.0.1:' + server.address().port;
    const client = createFroniusClient(baseUrl);
    const daily = await client.fetchDailySum('2026-02-14');
    assert.strictEqual(daily.dayGeneratedKwh, 23.456);
    assert.strictEqual(daily.dayImportKwh, 7);
    assert.strictEqual(daily.dayExportKwh, 3.5);

    const consumedFallback = await client.fetchDailySum('2026-02-15');
    assert.strictEqual(consumedFallback.dayGeneratedKwh, 15);
    assert.strictEqual(consumedFallback.dayImportKwh, 5);
    assert.strictEqual(consumedFallback.dayExportKwh, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};
