'use strict';

const assert = require('assert');
const http = require('http');
const { createFroniusClient } = require('../src/lib/fronius-client');

module.exports = async function run() {
  let lastArchivePath = '';
  const server = http.createServer((req, res) => {
    if (req.url.indexOf('/GetArchiveData.cgi') > -1) {
      if (req.url.indexOf('SeriesType=Detail') > -1) {
        if (req.url.indexOf('StartDate=2026-02-19') > -1) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            Body: {
              Data: {
                EnergyReal_WAC_Sum_Produced: {
                  Values: {
                    '25200': 12000,
                    '27000': 18000,
                    '28800': 24000
                  }
                },
                EnergyReal_WAC_SelfConsumption: {
                  Values: {
                    '25200': 6000,
                    '27000': 9000,
                    '28800': 12000
                  }
                },
                EnergyReal_WAC_Sum_Consumed: {
                  Values: {
                    '25200': 7000,
                    '27000': 11000,
                    '28800': 14000
                  }
                },
                'meter:123': {
                  Data: {
                    EnergyReal_WAC_Plus_Absolute: {
                      Values: {
                        '25200': 1000,
                        '27000': 1020,
                        '28800': 1030
                      }
                    },
                    EnergyReal_WAC_Minus_Absolute: {
                      Values: {
                        '25200': 200,
                        '27000': 260,
                        '28800': 300
                      }
                    }
                  }
                }
              }
            }
          }));
          return;
        }
        if (req.url.indexOf('StartDate=2026-02-18') > -1) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            Body: {
              Data: {
                EnergyReal_WAC_Sum_Produced: {
                  Values: {
                    '25200': 12000,
                    '27000': 18000,
                    '28800': 24000
                  }
                },
                'inverter/1': {
                  Data: {
                    EnergyReal_WAC_Sum_Produced: {
                      Values: {
                        '25200': 120,
                        '27000': 180,
                        '28800': 240
                      }
                    }
                  }
                },
                'meter:123': {
                  Data: {
                    EnergyReal_WAC_Plus_Absolute: {
                      Values: {
                        '25200': 1000,
                        '27000': 1020,
                        '28800': 1030
                      }
                    },
                    EnergyReal_WAC_Minus_Absolute: {
                      Values: {
                        '25200': 200,
                        '27000': 260,
                        '28800': 300
                      }
                    }
                  }
                }
              }
            }
          }));
          return;
        }
        if (req.url.indexOf('StartDate=2026-02-17') > -1) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            Body: {
              Data: {
                EnergyReal_WAC_Sum_Produced: {
                  Values: {
                    '25200': 1000,
                    '27000': 5000,
                    '28800': 9000
                  }
                },
                'inverter/1': {
                  Data: {
                    EnergyReal_WAC_Sum_Produced: {
                      Values: {
                        '28800': 50
                      }
                    }
                  }
                },
                'meter:123': {
                  Data: {
                    EnergyReal_WAC_Plus_Absolute: {
                      Values: {
                        '25200': 1000,
                        '27000': 1020,
                        '28800': 1030
                      }
                    },
                    EnergyReal_WAC_Minus_Absolute: {
                      Values: {
                        '25200': 200,
                        '27000': 260,
                        '28800': 300
                      }
                    }
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
              'inverter/1': {
                Data: {
                  EnergyReal_WAC_Sum_Produced: {
                    Values: {
                      '28800': 161
                    }
                  }
                }
              },
              'meter:123': {
                Data: {
                  EnergyReal_WAC_Sum_Produced: {
                    Values: {
                      '25200': 12,
                      '27000': 66,
                      '28800': 161
                    }
                  },
                  EnergyReal_WAC_Plus_Absolute: {
                    Values: {
                      '25200': 1000,
                      '27000': 1008,
                      '28800': 1016
                    }
                  },
                  EnergyReal_WAC_Minus_Absolute: {
                    Values: {
                      '25200': 200,
                      '27000': 206,
                      '28800': 214
                    }
                  }
                }
              }
            }
          }
        }));
        return;
      }

      lastArchivePath = req.url;
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
    const client = createFroniusClient(baseUrl, { timeZone: 'Australia/Brisbane' });
    const daily = await client.fetchDailySum('2026-02-14');
    assert.strictEqual(daily.dayGeneratedKwh, 23.456);
    assert.strictEqual(daily.dayImportKwh, 7);
    assert.strictEqual(daily.dayExportKwh, 3.5);

    const consumedFallback = await client.fetchDailySum('2026-02-15');
    assert.strictEqual(consumedFallback.dayGeneratedKwh, 15);
    assert.strictEqual(consumedFallback.dayImportKwh, 5);
    assert.strictEqual(consumedFallback.dayExportKwh, 0);

    const detail = await client.fetchDailyDetail('2026-02-16');
    assert.strictEqual(Object.keys(detail.producedWhBySecond).length, 3, 'daily detail should choose fuller produced series (meter fallback)');
    assert.strictEqual(detail.producedWhBySecond['25200'], 12);
    assert.strictEqual(detail.producedWhBySecond['28800'], 161);
    const detailTopLevel = await client.fetchDailyDetail('2026-02-17');
    assert.strictEqual(Object.keys(detailTopLevel.producedWhBySecond).length, 3, 'daily detail should include top-level produced series when present');
    assert.strictEqual(detailTopLevel.producedWhBySecond['25200'], 1000);
    assert.strictEqual(detailTopLevel.producedWhBySecond['28800'], 9000);
    const detailEqualLength = await client.fetchDailyDetail('2026-02-18');
    assert.strictEqual(detailEqualLength.producedWhBySecond['25200'], 12000, 'daily detail should not prefer inverter series when equal-length top-level series exists');
    assert.strictEqual(detailEqualLength.producedWhBySecond['28800'], 24000, 'daily detail should keep higher-fidelity produced series');
    const detailWithSelfLoad = await client.fetchDailyDetail('2026-02-19');
    assert.strictEqual(detailWithSelfLoad.selfWhBySecond['25200'], 6000, 'daily detail should expose explicit self-consumption series when available');
    assert.strictEqual(detailWithSelfLoad.loadWhBySecond['28800'], 14000, 'daily detail should expose explicit load/consumed series when available');

    const RealDate = Date;
    class FakeDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) {
          super('2026-02-15T14:31:00.000Z');
          return;
        }
        super(...args);
      }

      static now() {
        return new RealDate('2026-02-15T14:31:00.000Z').getTime();
      }
    }

    global.Date = FakeDate;
    try {
      await client.fetchDailySum();
    } finally {
      global.Date = RealDate;
    }
    assert.ok(lastArchivePath.indexOf('StartDate=2026-02-16') > -1, 'default daily sum query should use local day, not UTC ISO day');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};
