'use strict';

const crypto = require('crypto');

function hashPassword(password, salt, iterations) {
  return crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
}

function safeEqual(a, b) {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function verifyPassword(password, authConfig) {
  const hash = hashPassword(password, authConfig.passwordSalt, authConfig.passwordIterations);
  return safeEqual(hash, authConfig.passwordHash);
}

module.exports = {
  hashPassword,
  verifyPassword
};
