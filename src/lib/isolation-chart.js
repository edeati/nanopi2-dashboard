'use strict';

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function fixed(value) {
  return finiteNumber(value, 0).toFixed(2).replace(/\.00$/, '');
}

function toneForMohm(mohm) {
  if (mohm === null || mohm === undefined || mohm === '') {
    return 'unknown';
  }
  const value = Number(mohm);
  if (!Number.isFinite(value)) {
    return 'unknown';
  }
  if (value < 5) {
    return 'critical';
  }
  if (value < 15) {
    return 'watch';
  }
  return 'ok';
}

function strokeForTone(tone) {
  if (tone === 'critical') {
    return '#ff7350';
  }
  if (tone === 'watch') {
    return '#f2bb3c';
  }
  if (tone === 'ok') {
    return '#8edb7c';
  }
  return '#9eb0c3';
}

function renderIsolationChartSvg(options) {
  const opts = options || {};
  const width = Math.max(240, Math.min(1600, Math.round(finiteNumber(opts.width, 900))));
  const height = Math.max(48, Math.min(220, Math.round(finiteNumber(opts.height, 72))));
  const points = (Array.isArray(opts.points) ? opts.points : [])
    .map(function mapPoint(point) {
      return {
        day: String((point && point.day) || ''),
        hhmm: String((point && point.hhmm) || ''),
        mohm: Number(point && point.mohm)
      };
    })
    .filter(function keepValid(point) {
      return point.day && Number.isFinite(point.mohm);
    });

  const left = 40;
  const right = 54;
  const top = 10;
  const bottom = height - 14;
  const plotWidth = Math.max(1, width - left - right);
  const plotHeight = Math.max(1, bottom - top);
  const currentMohm = Number.isFinite(Number(opts.currentMohm))
    ? Number(opts.currentMohm)
    : (points.length ? points[points.length - 1].mohm : null);
  const tone = toneForMohm(currentMohm);
  const stroke = strokeForTone(tone);

  let maxY = 30;
  points.forEach(function trackMax(point) {
    maxY = Math.max(maxY, point.mohm);
  });
  if (Number.isFinite(currentMohm)) {
    maxY = Math.max(maxY, currentMohm);
  }
  maxY = Math.max(10, maxY * 1.08);

  const elements = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="PV isolation resistance history">',
    '<rect width="' + width + '" height="' + height + '" fill="#0e1014"/>',
    '<rect x="' + left + '" y="' + fixed(bottom - ((5 / maxY) * plotHeight)) + '" width="' + plotWidth + '" height="' + fixed(Math.min(plotHeight, (5 / maxY) * plotHeight)) + '" fill="#ff7350" fill-opacity="0.12"/>'
  ];

  [5, 15, 30].forEach(function drawGuide(level) {
    if (level > maxY) {
      return;
    }
    const y = bottom - ((level / maxY) * plotHeight);
    elements.push(
      '<line x1="' + left + '" y1="' + fixed(y) + '" x2="' + (width - right) + '" y2="' + fixed(y) + '" stroke="#96a5b8" stroke-opacity="0.18"/>',
      '<text x="' + (left - 4) + '" y="' + fixed(y + 3) + '" text-anchor="end" fill="#acbaca" fill-opacity="0.72" font-family="Arial,sans-serif" font-size="10">' + level + '</text>'
    );
  });

  if (points.length >= 2) {
    const coords = points.map(function toCoord(point, index) {
      const x = left + ((index / Math.max(1, points.length - 1)) * plotWidth);
      const y = bottom - ((point.mohm / maxY) * plotHeight);
      return { x: x, y: y, mohm: point.mohm };
    });
    const line = coords.map(function toPair(coord, index) {
      return (index === 0 ? 'M ' : 'L ') + fixed(coord.x) + ' ' + fixed(coord.y);
    }).join(' ');
    const area = line +
      ' L ' + fixed(coords[coords.length - 1].x) + ' ' + bottom +
      ' L ' + fixed(coords[0].x) + ' ' + bottom + ' Z';
    elements.push(
      '<path d="' + area + '" fill="' + stroke + '" fill-opacity="0.16"/>',
      '<path d="' + line + '" fill="none" stroke="' + stroke + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>'
    );
    const last = coords[coords.length - 1];
    elements.push(
      '<circle cx="' + fixed(last.x) + '" cy="' + fixed(last.y) + '" r="3.2" fill="' + stroke + '"/>'
    );
  } else if (points.length === 1) {
    const x = left + (plotWidth / 2);
    const y = bottom - ((points[0].mohm / maxY) * plotHeight);
    elements.push('<circle cx="' + fixed(x) + '" cy="' + fixed(y) + '" r="3.2" fill="' + stroke + '"/>');
  } else {
    elements.push(
      '<text x="' + (width / 2) + '" y="' + (height / 2 + 4) + '" text-anchor="middle" fill="#a7b2bf" font-family="Arial,sans-serif" font-size="12">Waiting for isolation history</text>'
    );
  }

  const label = Number.isFinite(currentMohm) ? (currentMohm.toFixed(1) + ' M\u03a9') : '--';
  elements.push(
    '<text x="' + (width - 8) + '" y="' + (top + 10) + '" text-anchor="end" fill="' + stroke + '" font-family="Arial,sans-serif" font-size="12" font-weight="700">' + label + '</text>',
    '<line x1="' + left + '" y1="' + bottom + '" x2="' + (width - right) + '" y2="' + bottom + '" stroke="#a6b2c4" stroke-opacity="0.4"/>',
    '</svg>'
  );
  return elements.join('');
}

module.exports = {
  renderIsolationChartSvg,
  toneForMohm
};
