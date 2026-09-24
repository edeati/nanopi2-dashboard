'use strict';

const assert = require('assert');
const { pickCurrentIsolationMohm } = require('../src/server');

module.exports = async function run() {
  assert.strictEqual(pickCurrentIsolationMohm({ isolationMohm: null }, []), null);
  assert.strictEqual(pickCurrentIsolationMohm({ isolationMohm: null }, [{ mohm: 8.6 }]), 8.6,
    'null live R_iso should fall back to latest archive sample');
  assert.strictEqual(pickCurrentIsolationMohm({ isolationMohm: 0 }, [{ mohm: 8.6 }]), 0,
    'a real live 0 reading should be kept');
  assert.strictEqual(pickCurrentIsolationMohm({ isolationMohm: 12.5 }, [{ mohm: 8.6 }]), 12.5);
  assert.strictEqual(pickCurrentIsolationMohm(null, [{ mohm: 4.9 }, { mohm: 8.6 }]), 8.6);
};
