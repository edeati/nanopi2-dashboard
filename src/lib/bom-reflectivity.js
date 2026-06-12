'use strict';

const { requestWithDebug } = require('./http-debug');

const DEFAULT_WMTS_URL = 'https://api.bom.gov.au/apikey/v1/mapping/timeseries/wmts/1.0.0/WMTSCapabilities.xml';
const DEFAULT_LAYER = 'atm_surf_air_precip_reflectivity_dbz';
const DEFAULT_MATRIX_SET = 'GoogleMapsCompatible_BoM';
const WEB_MERCATOR_HALF_WORLD = 20037508.342789244;
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Linux; Android 13; Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DEFAULT_REFERER = 'https://www.bom.gov.au/weather-and-climate/rain-radar-and-weather-maps';

function decodeXml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractTag(text, tagName) {
  const re = new RegExp('<' + tagName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '>([^<]*)');
  const match = re.exec(String(text || ''));
  return match ? decodeXml(match[1]) : '';
}

function parseTileMatrices(xml, matrixSetId) {
  const text = String(xml || '');
  const sets = text.split('<TileMatrixSet>').slice(1);
  for (const rawSet of sets) {
    const setBody = rawSet.split('</TileMatrixSet>', 1)[0];
    const id = extractTag(setBody, 'ows:Identifier');
    if (id !== matrixSetId) continue;

    const matrices = {};
    const matrixParts = setBody.split('<TileMatrix>').slice(1);
    matrixParts.forEach(function parseMatrix(rawMatrix) {
      const body = rawMatrix.split('</TileMatrix>', 1)[0];
      const matrixId = extractTag(body, 'ows:Identifier');
      const topLeft = extractTag(body, 'TopLeftCorner').split(/\s+/).map(Number);
      const tileWidth = Number(extractTag(body, 'TileWidth') || 256);
      const tileHeight = Number(extractTag(body, 'TileHeight') || 256);
      const matrixWidth = Number(extractTag(body, 'MatrixWidth') || 0);
      const matrixHeight = Number(extractTag(body, 'MatrixHeight') || 0);
      if (matrixId && topLeft.length >= 2 && matrixWidth > 0 && matrixHeight > 0) {
        matrices[matrixId] = {
          id: matrixId,
          topLeftX: topLeft[0],
          topLeftY: topLeft[1],
          tileWidth,
          tileHeight,
          matrixWidth,
          matrixHeight
        };
      }
    });
    return matrices;
  }
  return {};
}

function parseBomReflectivityCapabilities(xml, options) {
  const opts = options || {};
  const layerId = String(opts.layer || DEFAULT_LAYER);
  const preferredMatrixSet = String(opts.matrixSet || DEFAULT_MATRIX_SET);
  const text = String(xml || '');
  const layers = text.split('<Layer>').slice(1);
  let selectedLayer = '';

  for (const rawLayer of layers) {
    const body = rawLayer.split('</Layer>', 1)[0];
    if (extractTag(body, 'ows:Identifier') === layerId) {
      selectedLayer = body;
      break;
    }
  }
  if (!selectedLayer) {
    throw new Error('bom_reflectivity_layer_missing');
  }

  const values = [];
  const valueRe = /<Value>([^<]+)<\/Value>/g;
  let match;
  while ((match = valueRe.exec(selectedLayer)) !== null) {
    values.push(decodeXml(match[1]));
  }

  const templateMatch = /template="([^"]+)"/.exec(selectedLayer);
  const matrixSet = extractTag(selectedLayer, 'TileMatrixSet') || preferredMatrixSet;
  return {
    layer: layerId,
    matrixSet,
    defaultTime: extractTag(selectedLayer, 'Default'),
    times: values,
    template: templateMatch ? decodeXml(templateMatch[1]) : '',
    matrices: parseTileMatrices(text, matrixSet)
  };
}

function isoTimeToEpochSeconds(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

function slippyToBomMatrixTile(z, x, y, matrix) {
  const zoom = Number(z);
  const col = Number(x);
  const row = Number(y);
  if (!Number.isFinite(zoom) || !Number.isFinite(col) || !Number.isFinite(row) || !matrix) {
    const error = new Error('bom_reflectivity_tile_out_of_range');
    error.statusCode = 404;
    throw error;
  }

  const span = (WEB_MERCATOR_HALF_WORLD * 2) / Math.pow(2, zoom);
  const xMin = -WEB_MERCATOR_HALF_WORLD + col * span;
  const yMax = WEB_MERCATOR_HALF_WORLD - row * span;
  const tileCol = Math.floor(((xMin - matrix.topLeftX) / span) + 1e-9);
  const tileRow = Math.floor(((matrix.topLeftY - yMax) / span) + 1e-9);

  if (
    tileCol < 0 ||
    tileRow < 0 ||
    tileCol >= matrix.matrixWidth ||
    tileRow >= matrix.matrixHeight
  ) {
    const error = new Error('bom_reflectivity_tile_out_of_range');
    error.statusCode = 404;
    throw error;
  }

  return { tileCol, tileRow };
}

function buildBomReflectivityTileUrl(template, params) {
  const baseUrl = String(params.wmtsBaseUrl || DEFAULT_WMTS_URL)
    .replace(/\/1\.0\.0\/WMTSCapabilities\.xml(?:\?.*)?$/i, '')
    .replace(/\/WMTSCapabilities\.xml(?:\?.*)?$/i, '')
    .replace(/\/1\.0\.0(?:\?.*)?$/i, '')
    .replace(/[?&]$/, '');
  const query = [
    ['SERVICE', 'WMTS'],
    ['REQUEST', 'GetTile'],
    ['VERSION', '1.0.0'],
    ['LAYER', params.layer || DEFAULT_LAYER],
    ['STYLE', 'default'],
    ['FORMAT', 'image/png'],
    ['TILEMATRIXSET', params.tileMatrixSet],
    ['TILEMATRIX', params.tileMatrix],
    ['TILEROW', params.tileRow],
    ['TILECOL', params.tileCol],
    ['TIME', params.time]
  ].map(function encodePair(pair) {
    return encodeURIComponent(String(pair[0])) + '=' + encodeURIComponent(String(pair[1]));
  }).join('&');
  return baseUrl + '?' + query;
}

function createBomReflectivityClient(config) {
  const cfg = config || {};
  const radarConfig = cfg.radar || {};
  const insecureTLS = !!cfg.insecureTLS;
  const logger = cfg.logger;
  const wmtsUrl = String(radarConfig.bomReflectivityWmtsUrl || DEFAULT_WMTS_URL);
  const layer = String(radarConfig.bomReflectivityLayer || DEFAULT_LAYER);
  const preferredMatrixSet = String(radarConfig.bomReflectivityMatrixSet || DEFAULT_MATRIX_SET);
  const maxFrames = Math.max(1, Number(radarConfig.bomReflectivityFrameCount || radarConfig.gifMaxFrames || 9));
  const userAgent = String(radarConfig.bomReflectivityUserAgent || DEFAULT_USER_AGENT);

  const state = {
    host: wmtsUrl,
    frames: [],
    updatedAt: null,
    error: null,
    template: '',
    matrixSet: preferredMatrixSet,
    matrices: {}
  };

  function requestOptions(urlString, service) {
    return {
      urlString,
      method: 'GET',
      followRedirects: true,
      maxRedirects: 4,
      insecureTLS,
      logger,
      service,
      headers: {
        Accept: 'image/png,application/xml,text/xml,*/*;q=0.8',
        Referer: DEFAULT_REFERER,
        'User-Agent': userAgent
      }
    };
  }

  async function refresh() {
    try {
      const result = await requestWithDebug(requestOptions(wmtsUrl, 'external.bom.reflectivity.capabilities'));
      const parsed = parseBomReflectivityCapabilities(result.body.toString('utf8'), {
        layer,
        matrixSet: preferredMatrixSet
      });
      const times = parsed.times.length ? parsed.times : [parsed.defaultTime].filter(Boolean);
      state.frames = times.slice(-maxFrames).map(function mapTime(time) {
        return { time: isoTimeToEpochSeconds(time), path: time };
      });
      state.template = parsed.template;
      state.matrixSet = parsed.matrixSet || preferredMatrixSet;
      state.matrices = parsed.matrices || {};
      state.updatedAt = new Date().toISOString();
      state.error = null;
    } catch (error) {
      state.error = error.message || 'bom_reflectivity_refresh_failed';
    }
  }

  async function fetchTileByPath(framePath, z, x, y) {
    const time = String(framePath || '');
    const matrix = state.matrices[String(z)];
    const translated = slippyToBomMatrixTile(z, x, y, matrix);
    const tileUrl = buildBomReflectivityTileUrl(state.template, {
      wmtsBaseUrl: wmtsUrl,
      layer,
      time,
      tileMatrixSet: state.matrixSet,
      tileMatrix: z,
      tileRow: translated.tileRow,
      tileCol: translated.tileCol
    });
    return requestWithDebug(requestOptions(tileUrl, 'external.bom.reflectivity.tile'));
  }

  async function fetchTile(frameIndex, z, x, y) {
    const index = Number(frameIndex);
    if (!Number.isInteger(index) || index < 0 || index >= state.frames.length) {
      throw new Error('frame index out of range');
    }
    return fetchTileByPath(state.frames[index].path, z, x, y);
  }

  function getState() {
    return {
      host: state.host,
      frames: state.frames.slice(),
      updatedAt: state.updatedAt,
      error: state.error
    };
  }

  return {
    refresh,
    fetchTile,
    fetchTileByPath,
    getState
  };
}

module.exports = {
  DEFAULT_LAYER,
  DEFAULT_MATRIX_SET,
  DEFAULT_WMTS_URL,
  buildBomReflectivityTileUrl,
  createBomReflectivityClient,
  parseBomReflectivityCapabilities,
  slippyToBomMatrixTile
};
