'use strict';

const assert = require('assert');

const {
  buildBomReflectivityTileUrl,
  parseBomReflectivityCapabilities,
  slippyToBomMatrixTile
} = require('../src/lib/bom-reflectivity');

module.exports = async function run() {
  const xml = [
    '<Capabilities>',
    '<Contents>',
    '<Layer>',
    '<ows:Title>atm_surf_air_precip_reflectivity_dbz</ows:Title>',
    '<ows:Identifier>atm_surf_air_precip_reflectivity_dbz</ows:Identifier>',
    '<Style isDefault="true"><ows:Identifier>default</ows:Identifier></Style>',
    '<Format>image/png</Format>',
    '<Dimension><ows:Identifier>time</ows:Identifier>',
    '<Default>2026-06-11T02:35:00Z</Default>',
    '<Value>2026-06-11T02:25:00Z</Value>',
    '<Value>2026-06-11T02:30:00Z</Value>',
    '<Value>2026-06-11T02:35:00Z</Value>',
    '</Dimension>',
    '<TileMatrixSetLink><TileMatrixSet>GoogleMapsCompatible_BoM</TileMatrixSet></TileMatrixSetLink>',
    '<ResourceURL format="image/png" resourceType="tile" template="https://api.example/wmts/{time}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png"></ResourceURL>',
    '</Layer>',
    '<TileMatrixSet>',
    '<ows:Identifier>GoogleMapsCompatible_BoM</ows:Identifier>',
    '<TileMatrix><ows:Identifier>7</ows:Identifier><TopLeftCorner>11584952.000000 -583562.846447</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>22</MatrixWidth><MatrixHeight>17</MatrixHeight></TileMatrix>',
    '</TileMatrixSet>',
    '</Contents>',
    '</Capabilities>'
  ].join('');

  const parsed = parseBomReflectivityCapabilities(xml);
  assert.strictEqual(parsed.layer, 'atm_surf_air_precip_reflectivity_dbz');
  assert.strictEqual(parsed.matrixSet, 'GoogleMapsCompatible_BoM');
  assert.strictEqual(parsed.defaultTime, '2026-06-11T02:35:00Z');
  assert.deepStrictEqual(parsed.times, [
    '2026-06-11T02:25:00Z',
    '2026-06-11T02:30:00Z',
    '2026-06-11T02:35:00Z'
  ]);
  assert.strictEqual(parsed.matrices['7'].matrixWidth, 22);

  assert.strictEqual(
    buildBomReflectivityTileUrl(parsed.template, {
      wmtsBaseUrl: 'https://api.example/wmts/1.0.0/WMTSCapabilities.xml',
      layer: 'atm_surf_air_precip_reflectivity_dbz',
      time: '2026-06-11T02:35:00Z',
      tileMatrixSet: 'GoogleMapsCompatible_BoM',
      tileMatrix: 7,
      tileRow: 11,
      tileCol: 16
    }),
    'https://api.example/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=atm_surf_air_precip_reflectivity_dbz&STYLE=default&FORMAT=image%2Fpng&TILEMATRIXSET=GoogleMapsCompatible_BoM&TILEMATRIX=7&TILEROW=11&TILECOL=16&TIME=2026-06-11T02%3A35%3A00Z'
  );

  assert.deepStrictEqual(
    slippyToBomMatrixTile(7, 118, 77, parsed.matrices['7']),
    { tileCol: 16, tileRow: 11 }
  );

  assert.throws(
    function outOfRange() {
      slippyToBomMatrixTile(7, 0, 0, parsed.matrices['7']);
    },
    function isOutOfRange(error) {
      return error && error.statusCode === 404;
    }
  );
};
