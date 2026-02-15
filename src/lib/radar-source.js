'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

function fetchBinary(urlString, insecureTLS) {
  return new Promise((resolve, reject) => {
    if (!urlString) {
      reject(new Error('radar source url missing'));
      return;
    }

    const url = new URL(urlString);
    const client = url.protocol === 'https:' ? https : http;
    const requestOptions = { method: 'GET' };

    if (url.protocol === 'https:' && insecureTLS) {
      requestOptions.rejectUnauthorized = false;
    }

    const req = client.request(url, requestOptions, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error('HTTP ' + res.statusCode));
          return;
        }
        resolve({
          contentType: res.headers['content-type'] || 'image/png',
          body: Buffer.concat(chunks)
        });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

function createRadarSource(config) {
  return {
    async fetchImage() {
      return fetchBinary(config.radar.sourceUrl, !!config.insecureTLS);
    }
  };
}

module.exports = {
  createRadarSource
};
