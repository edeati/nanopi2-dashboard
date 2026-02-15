'use strict';

const { requestWithDebug } = require('./http-debug');

function fetchBinary(urlString, insecureTLS, logger) {
  if (!urlString) {
    return Promise.reject(new Error('radar source url missing'));
  }
  return requestWithDebug({
    urlString,
    method: 'GET',
    insecureTLS,
    logger,
    service: 'external.radar.source'
  }).then((result) => ({
    contentType: result.contentType || 'image/png',
    body: result.body
  }));
}

function createRadarSource(config) {
  const logger = config.logger;
  return {
    async fetchImage() {
      return fetchBinary(config.radar.sourceUrl, !!config.insecureTLS, logger);
    }
  };
}

module.exports = {
  createRadarSource
};
