'use strict';

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function fixed(value) {
  return finiteNumber(value, 0).toFixed(2).replace(/\.00$/, '');
}

function renderGeneratedArea(series, dimensions) {
  const points = (Array.isArray(series) ? series : [])
    .slice(-720)
    .map((point) => ({
      secOfDay: Math.max(0, Math.min(86400, finiteNumber(point && point.secOfDay, 0))),
      value: Math.max(0, finiteNumber(point && point.value, 0))
    }));
  const paths = [];
  let segment = [];

  function flushSegment() {
    if (!segment.length) {
      return;
    }
    const first = segment[0];
    const last = segment[segment.length - 1];
    const commands = [
      'M ' + fixed(first.x) + ' ' + fixed(dimensions.bottom),
      'L ' + fixed(first.x) + ' ' + fixed(first.y)
    ];
    for (let i = 1; i < segment.length; i += 1) {
      const previous = segment[i - 1];
      const current = segment[i];
      const midpointX = (previous.x + current.x) / 2;
      const midpointY = (previous.y + current.y) / 2;
      commands.push(
        'Q ' + fixed(previous.x) + ' ' + fixed(previous.y) + ' ' + fixed(midpointX) + ' ' + fixed(midpointY)
      );
    }
    if (segment.length > 1) {
      commands.push('Q ' + fixed(last.x) + ' ' + fixed(last.y) + ' ' + fixed(last.x) + ' ' + fixed(last.y));
    }
    commands.push('L ' + fixed(last.x) + ' ' + fixed(dimensions.bottom), 'Z');
    paths.push(commands.join(' '));
    segment = [];
  }

  points.forEach((point) => {
    if (!(point.value > 0)) {
      flushSegment();
      return;
    }
    segment.push({
      x: dimensions.left + ((point.secOfDay / 86400) * dimensions.plotWidth),
      y: dimensions.bottom - ((point.value / dimensions.maxY) * dimensions.plotHeight)
    });
  });
  flushSegment();
  return paths;
}

function renderIsolationLine(points, dimensions, maxIso) {
  const list = Array.isArray(points) ? points : [];
  // Avoid the "single floating dot" flash while 14-day history is still warming.
  if (list.length < 2) {
    return [];
  }
  const left = dimensions.left;
  const bottom = dimensions.bottom;
  const plotWidth = dimensions.plotWidth;
  const plotHeight = dimensions.plotHeight;
  const coords = list.map(function toCoord(point, index) {
    const x = left + ((index / (list.length - 1)) * plotWidth);
    const y = bottom - ((Math.max(0, finiteNumber(point.mohm, 0)) / maxIso) * plotHeight);
    return { x: x, y: y };
  });
  const line = coords.map(function toPair(coord, index) {
    return (index === 0 ? 'M ' : 'L ') + fixed(coord.x) + ' ' + fixed(coord.y);
  }).join(' ');
  const last = coords[coords.length - 1];
  return [
    '<path d="' + line + '" fill="none" stroke="#1a1020" stroke-width="6.5" stroke-linejoin="round" stroke-linecap="round" stroke-opacity="0.34"/>',
    '<path d="' + line + '" fill="none" stroke="#d48bff" stroke-width="4.2" stroke-linejoin="round" stroke-linecap="round" stroke-opacity="0.62"/>',
    '<circle cx="' + fixed(last.x) + '" cy="' + fixed(last.y) + '" r="5.2" fill="#d48bff" fill-opacity="0.72" stroke="#1a1020" stroke-width="1.6" stroke-opacity="0.7"/>'
  ];
}

function renderSolarChartSvg(options) {
  const opts = options || {};
  const width = Math.max(320, Math.min(1600, Math.round(finiteNumber(opts.width, 900))));
  const height = Math.max(140, Math.min(800, Math.round(finiteNumber(opts.height, 260))));
  const bins = (Array.isArray(opts.bins) ? opts.bins : []).slice(0, 96);
  const generatedSeries = (Array.isArray(opts.generatedSeries) ? opts.generatedSeries : []).slice(-720);
  const isolationPoints = (Array.isArray(opts.isolationPoints) ? opts.isolationPoints : [])
    .map(function mapIso(point) {
      return {
        day: String((point && point.day) || ''),
        hhmm: String((point && point.hhmm) || ''),
        mohm: Number(point && point.mohm)
      };
    })
    .filter(function keepIso(point) {
      return Number.isFinite(point.mohm);
    });
  const currentIsolationMohm = Number.isFinite(Number(opts.currentIsolationMohm))
    ? Number(opts.currentIsolationMohm)
    : (isolationPoints.length ? isolationPoints[isolationPoints.length - 1].mohm : null);
  // Live MΩ + inverter OK/ERR live in HTML chrome around the chart, not inside the SVG.
  const showIsolationAxis = isolationPoints.length >= 2;
  const inverterW = Math.max(2000, finiteNumber(opts.inverterCapacityKw, 6.3) * 1000);
  const left = 44;
  const right = showIsolationAxis ? 40 : 12;
  const top = 12;
  const bottom = height - 28;
  const plotWidth = Math.max(1, width - left - right);
  const plotHeight = Math.max(1, bottom - top);
  const bucketHours = bins.length ? 24 / bins.length : 1;
  let maxY = inverterW;
  let maxIso = 30;

  bins.forEach((item) => {
    const bin = item || {};
    const selfW = Math.max(0, finiteNumber(bin.selfWh, 0)) / bucketHours;
    const importW = Math.max(0, finiteNumber(bin.importWh, 0)) / bucketHours;
    maxY = Math.max(maxY, selfW + importW, Math.max(0, finiteNumber(bin.generatedWh, 0)) / bucketHours);
  });
  generatedSeries.forEach((point) => {
    maxY = Math.max(maxY, Math.max(0, finiteNumber(point && point.value, 0)));
  });
  isolationPoints.forEach(function trackIso(point) {
    maxIso = Math.max(maxIso, point.mohm);
  });
  if (Number.isFinite(currentIsolationMohm)) {
    maxIso = Math.max(maxIso, currentIsolationMohm);
  }
  maxIso = Math.max(10, maxIso * 1.08);

  const dimensions = { left, bottom, plotWidth, plotHeight, maxY };
  const elements = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Solar generation and usage history">',
    '<rect width="' + width + '" height="' + height + '" fill="#0e1014"/>'
  ];

  for (let level = 2000; level <= Math.floor(maxY / 2000) * 2000; level += 2000) {
    const y = bottom - ((level / maxY) * plotHeight);
    elements.push(
      '<line x1="' + left + '" y1="' + fixed(y) + '" x2="' + (width - right) + '" y2="' + fixed(y) + '" stroke="#96a5b8" stroke-opacity="0.16"/>',
      '<text x="' + (left - 5) + '" y="' + fixed(y + 4) + '" text-anchor="end" fill="#acbaca" fill-opacity="0.76" font-family="Arial,sans-serif" font-size="12">' + Math.round(level / 1000) + 'kW</text>'
    );
  }

  for (let hour = 0; hour <= 21; hour += 3) {
    const x = left + ((hour / 24) * plotWidth);
    elements.push(
      '<line x1="' + fixed(x) + '" y1="' + top + '" x2="' + fixed(x) + '" y2="' + bottom + '" stroke="#96a5b8" stroke-opacity="0.22"/>',
      '<text x="' + fixed(x) + '" y="' + (bottom + 17) + '" text-anchor="middle" fill="#acbaca" fill-opacity="0.82" font-family="Arial,sans-serif" font-size="14">' + String(hour).padStart(2, '0') + '</text>'
    );
  }

  renderGeneratedArea(generatedSeries, dimensions).forEach((pathData) => {
    elements.push('<path d="' + pathData + '" fill="#ffe27a" fill-opacity="0.28"/>');
  });

  if (bins.length) {
    const slotWidth = plotWidth / bins.length;
    bins.forEach((item, index) => {
      const bin = item || {};
      const selfW = Math.max(0, finiteNumber(bin.selfWh, 0)) / bucketHours;
      const importW = Math.max(0, finiteNumber(bin.importWh, 0)) / bucketHours;
      const selfHeight = (selfW / maxY) * plotHeight;
      const importHeight = (importW / maxY) * plotHeight;
      const x = left + (index * slotWidth);
      const barWidth = Math.max(1, slotWidth - 1);
      if (importHeight > 0) {
        elements.push('<rect x="' + fixed(x) + '" y="' + fixed(bottom - importHeight) + '" width="' + fixed(barWidth) + '" height="' + fixed(importHeight) + '" fill="#70a8ff" fill-opacity="0.46"/>');
      }
      if (selfHeight > 0) {
        elements.push('<rect x="' + fixed(x) + '" y="' + fixed(bottom - importHeight - selfHeight) + '" width="' + fixed(barWidth) + '" height="' + fixed(selfHeight) + '" fill="#8edb7c" fill-opacity="0.82"/>');
      }
    });
  }

  if (isolationPoints.length >= 2) {
    [5, 15, 30].forEach(function drawIsoGuide(level) {
      if (level > maxIso) {
        return;
      }
      const y = bottom - ((level / maxIso) * plotHeight);
      elements.push(
        '<text x="' + (width - 6) + '" y="' + fixed(y + 3) + '" text-anchor="end" fill="#d48bff" fill-opacity="0.52" font-family="Arial,sans-serif" font-size="12">' + level + '</text>'
      );
    });
    renderIsolationLine(isolationPoints, dimensions, maxIso).forEach(function pushIso(part) {
      elements.push(part);
    });
  }

  elements.push(
    '<line x1="' + left + '" y1="' + bottom + '" x2="' + (width - right) + '" y2="' + bottom + '" stroke="#a6b2c4" stroke-opacity="0.46"/>',
    bins.length || generatedSeries.length
      ? ''
      : '<text x="' + (width / 2) + '" y="' + (height / 2) + '" text-anchor="middle" fill="#a7b2bf" font-family="Arial,sans-serif" font-size="16">Waiting for solar history</text>',
    '</svg>'
  );
  return elements.join('');
}

module.exports = {
  renderSolarChartSvg
};
