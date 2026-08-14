'use strict';

// Direct port of beatbot-cloud-python/src/beatbot_cloud/protocol.py
// Values come from the Beatbot API; do not edit manually.

const STATUS_MAP = {
  0: 'standby',
  1: 'goto_charge',
  2: 'charging',
  3: 'charge_done',
  4: 'paused',
  5: 'cleaning',
  6: 'sleep',
  7: 'return_trip',
  8: 'clean_done',
  9: 'remote_control',
  10: 'clean_wait',
  11: 'wifi_connect',
  12: 'diving',
  13: 'emerge',
  14: 'auto_dock',
  15: 'finish_connect',
  16: 'dock',
  17: 'self_cleaning',
  18: 'replenish_energy',
  19: 'chase_light',
  20: 'dock_done'
};

// Human-readable labels for dashboard display
const STATUS_LABELS = {
  standby: 'Standby',
  goto_charge: 'Returning to dock',
  charging: 'Charging',
  charge_done: 'Charged',
  paused: 'Paused',
  cleaning: 'Cleaning',
  sleep: 'Sleep',
  return_trip: 'Returning',
  clean_done: 'Cleaning complete',
  remote_control: 'Remote control',
  clean_wait: 'Waiting',
  wifi_connect: 'Connecting',
  diving: 'Diving',
  emerge: 'Emerging',
  auto_dock: 'Docking',
  finish_connect: 'Connected',
  dock: 'Docked',
  self_cleaning: 'Self cleaning',
  replenish_energy: 'Recharging',
  chase_light: 'Chase light',
  dock_done: 'Docked'
};

// pool_clean_bot error bitmask: [error_name, bit_mask]
// Ordered as in protocol.py ERROR_BITS_BY_CATEGORY
const ERROR_BITS = [
  ['dust_box_full', 1 << 0],
  ['dust_box_loss', 1 << 1],
  ['power_low', 1 << 2],
  ['power_cutting', 1 << 3],
  ['env_high_temperature', 1 << 4],
  ['env_low_temperature', 1 << 5],
  ['motor_error', 1 << 6],
  ['motor_wheel_left', 1 << 7],
  ['motor_wheel_right', 1 << 8],
  ['motor_thruster_left', 1 << 9],
  ['motor_thruster_right', 1 << 10],
  ['motor_pump', 1 << 11],
  ['motor_airpump_left', 1 << 12],
  ['motor_airpump_right', 1 << 13],
  ['motor_brush', 1 << 14],
  ['motor_reagent', 1 << 15],
  ['motor_rod', 1 << 16],
  ['enter_shawdow_water_error', 1 << 17],
  ['trapped', 1 << 18],
  ['charge_high_temperature', 1 << 19],
  ['charge_low_temperature', 1 << 20],
  ['motor_thruster', 1 << 21],
  ['platform_clean_err', 1 << 22]
];

// Human-readable labels for errors
const ERROR_LABELS = {
  dust_box_full: 'Filter full',
  dust_box_loss: 'Filter missing',
  power_low: 'Low battery',
  power_cutting: 'Power loss',
  env_high_temperature: 'High temperature',
  env_low_temperature: 'Low temperature',
  motor_error: 'Motor error',
  motor_wheel_left: 'Left wheel fault',
  motor_wheel_right: 'Right wheel fault',
  motor_thruster_left: 'Left thruster fault',
  motor_thruster_right: 'Right thruster fault',
  motor_pump: 'Pump fault',
  motor_airpump_left: 'Left air pump fault',
  motor_airpump_right: 'Right air pump fault',
  motor_brush: 'Brush fault',
  motor_reagent: 'Reagent motor fault',
  motor_rod: 'Rod motor fault',
  enter_shawdow_water_error: 'Shadow water entry error',
  trapped: 'Trapped',
  charge_high_temperature: 'Charging overheating',
  charge_low_temperature: 'Charging too cold',
  motor_thruster: 'Thruster fault',
  platform_clean_err: 'Platform clean error'
};

/**
 * Decode a raw work_status integer into a status key string.
 * @param {number} rawStatus
 * @returns {string|null}
 */
function statusFor(rawStatus) {
  const key = STATUS_MAP[rawStatus];
  return key || null;
}

/**
 * Return the display label for a status key.
 * @param {string|null} statusKey
 * @returns {string|null}
 */
function statusLabel(statusKey) {
  if (!statusKey) {
    return null;
  }
  return STATUS_LABELS[statusKey] || statusKey;
}

/**
 * Decode a raw error_code bitmask into an array of active error key strings.
 * @param {number} errorCode
 * @returns {string[]}
 */
function errorsFor(errorCode) {
  if (!errorCode) {
    return [];
  }
  const active = [];
  for (let i = 0; i < ERROR_BITS.length; i += 1) {
    if (errorCode & ERROR_BITS[i][1]) {
      active.push(ERROR_BITS[i][0]);
    }
  }
  return active;
}

/**
 * Convert error keys into human-readable labels.
 * @param {string[]} errorKeys
 * @returns {string[]}
 */
function errorLabels(errorKeys) {
  return errorKeys.map(function (k) {
    return ERROR_LABELS[k] || k;
  });
}

// Beatbot interface names used throughout the integration
const INTERFACES = {
  VACUUM_STATE: 'vacuum.state',
  VACUUM_BATTERY: 'vacuum.battery',
  SENSOR_ERROR: 'sensor.error',
  WORK_MODE: 'select.work_mode',
  VACUUM_START: 'vacuum.start',
  VACUUM_PAUSE: 'vacuum.pause',
  VACUUM_RETURN: 'vacuum.return_to_base',
  CHILD_LOCK: 'switch.child_lock',
  VOICE_DISTURB: 'switch.voice_disturb'
};

const PRODUCT_CATEGORY = {
  POOL_CLEAN_BOT: 'pool_clean_bot',
  CLEAN_BASE_STATION: 'clean_base_station',
  LAWN_MOWER: 'lawn_mower'
};

module.exports = {
  STATUS_MAP,
  STATUS_LABELS,
  ERROR_BITS,
  ERROR_LABELS,
  INTERFACES,
  PRODUCT_CATEGORY,
  statusFor,
  statusLabel,
  errorsFor,
  errorLabels
};
