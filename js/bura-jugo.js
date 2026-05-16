(function () {
  'use strict';

  var METEO_URL =
    'https://api.open-meteo.com/v1/forecast?latitude=43.508&longitude=16.440' +
    '&current=wind_speed_10m,wind_direction_10m,precipitation,weather_code' +
    '&hourly=wind_speed_10m,wind_direction_10m,precipitation_probability,precipitation' +
    '&timezone=Europe%2FZagreb&forecast_days=1';

  var POLL_MS = 300000;
  var ctx = {};
  var pollTimer = null;
  var lastAlerts = {};
  var weather = null;

  var ZONES = [
    {
      id: 'trumbiceva',
      nameHr: 'Trumbićeva obala (Matejuška)',
      nameEn: 'Trumbićeva waterfront (Matejuška)',
      latlng: [43.5070, 16.4415],
      type: 'coast',
      parkingWarn: true
    },
    {
      id: 'marjan',
      nameHr: 'Marjan',
      nameEn: 'Marjan hill',
      latlng: [43.5085, 16.4285],
      type: 'hill',
      nextbikeName: 'Marjan'
    },
    {
      id: 'bacvice',
      nameHr: 'Plaža Bačvice',
      nameEn: 'Bačvice beach',
      latlng: [43.5002, 16.4565],
      type: 'beach'
    },
    {
      id: 'kasjuni',
      nameHr: 'Kasjuni',
      nameEn: 'Kasjuni beach',
      latlng: [43.5018, 16.4212],
      type: 'beach'
    },
    {
      id: 'marjan-park',
      nameHr: 'Park-šuma Marjan',
      nameEn: 'Marjan forest park',
      latlng: [43.5110, 16.4250],
      type: 'park'
    }
  ];

  function isWildfireSeason() {
    var m = new Date().getMonth();
    return m >= 4 && m <= 9;
  }

  function isBura(windKmh, dirDeg) {
    var fromNorth = dirDeg >= 315 || dirDeg <= 90;
    return fromNorth && windKmh >= 40;
  }

  function isStrongBura(windKmh, dirDeg) {
    return isBura(windKmh, dirDeg) && windKmh >= 55;
  }

  function isJugo(windKmh, dirDeg) {
    return dirDeg >= 100 && dirDeg <= 200 && windKmh >= 25;
  }

  function isFloodRisk(precipMm, precipProb) {
    return precipMm >= 2 || precipProb >= 70;
  }

  function beachSignal(windKmh, precipMm, bura, jugo) {
    if (precipMm > 0.5 || bura || (jugo && windKmh > 35)) return 'none';
    if (windKmh < 25 && precipMm < 0.2) return 'good';
    return 'weak';
  }

  function fetchWeather() {
    return fetch(METEO_URL, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var c = data.current || {};
        var h = data.hourly || {};
        var nextPrecip = 0;
        var nextProb = 0;
        if (h.precipitation && h.precipitation.length) {
          nextPrecip = Math.max.apply(null, h.precipitation.slice(0, 6));
        }
        if (h.precipitation_probability && h.precipitation_probability.length) {
          nextProb = Math.max.apply(null, h.precipitation_probability.slice(0, 6));
        }
        weather = {
          windKmh: c.wind_speed_10m || 0,
          windDir: c.wind_direction_10m || 0,
          precip: c.precipitation || 0,
          code: c.weather_code,
          nextPrecip: nextPrecip,
          nextProb: nextProb,
          updated: Date.now()
        };
        return weather;
      });
  }

  function buildAlerts(w) {
    var alerts = [];
    var bura = isBura(w.windKmh, w.windDir);
    var strongBura = isStrongBura(w.windKmh, w.windDir);
    var jugo = isJugo(w.windKmh, w.windDir);
    var flood = isFloodRisk(w.nextPrecip, w.nextProb) || w.precip >= 1;

    if (isWildfireSeason()) {
      alerts.push({
        id: 'wildfire',
        level: 'warn',
        hr: 'Sezona požara — povećan oprez na Marjanu i okolici.',
        en: 'Wildfire season — extra caution on Marjan and surroundings.'
      });
    }

    if (strongBura) {
      alerts.push({
        id: 'bura-strong',
        level: 'danger',
        hr: 'Olujna bura (' + Math.round(w.windKmh) + ' km/h) — Nextbike na Marjanu može biti zatvoren.',
        en: 'Storm bura (' + Math.round(w.windKmh) + ' km/h) — Marjan Nextbike may be closed.'
      });
    } else if (bura) {
      alerts.push({
        id: 'bura',
        level: 'warn',
        hr: 'Bura puše (' + Math.round(w.windKmh) + ' km/h) — oprez pri vožnji i parkiranju uz more.',
        en: 'Bura wind (' + Math.round(w.windKmh) + ' km/h) — caution driving and parking by the sea.'
      });
    }

    if (jugo) {
      alerts.push({
        id: 'jugo',
        level: 'warn',
        hr: 'Jugo (' + Math.round(w.windKmh) + ' km/h) — vlaga i slabija vidljivost na obali.',
        en: 'Jugo (' + Math.round(w.windKmh) + ' km/h) — humid air and reduced visibility on the coast.'
      });
    }

    if (flood) {
      alerts.push({
        id: 'flood-trumbiceva',
        level: 'danger',
        hr: 'Ne parkiraj na Trumbićevoj — očekuje se plavljenje / plima.',
        en: 'Do not park on Trumbićeva — flooding / high tide expected.'
      });
    }

    return alerts;
  }

  function pushNotify(alert) {
    if (lastAlerts[alert.id]) return;
    lastAlerts[alert.id] = Date.now();
    if (ctx.showToast) {
      ctx.showToast(ctx.t(alert.hr, alert.en), alert.level === 'danger' ? 'error' : '');
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification('Ae! Bura & Jugo', {
          body: ctx.t(alert.hr, alert.en),
          icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="%2300D4AA"/></svg>'
        });
      } catch (e) { /* ignore */ }
    }
  }

  function renderBar() {
    var bar = document.getElementById('bura-live');
    if (!bar || !weather) return;
    var bura = isBura(weather.windKmh, weather.windDir);
    var jugo = isJugo(weather.windKmh, weather.windDir);
    var flood = isFloodRisk(weather.nextPrecip, weather.nextProb);
    bar.hidden = false;
    bar.className = 'bura-live show' + (bura || flood ? ' alert-danger' : jugo ? ' alert-warn' : '');
    var parts = ['Bura & Jugo'];
    if (bura) parts.push(ctx.t('Bura', 'Bura'));
    if (jugo) parts.push(ctx.t('Jugo', 'Jugo'));
    if (flood) parts.push(ctx.t('Plima', 'High water'));
    if (isWildfireSeason()) parts.push(ctx.t('Požari', 'Wildfires'));
    bar.innerHTML =
      '<span class="bura-live-dot"></span>' +
      '<span><strong>' + parts.join(' · ') + '</strong> — ' +
      Math.round(weather.windKmh) + ' km/h, ' + Math.round(weather.windDir) + '°</span>';
  }

  function renderPanel() {
    var list = document.getElementById('bura-alerts');
    var zones = document.getElementById('bura-zones');
    if (!list || !weather) return;
    list.innerHTML = '';
    buildAlerts(weather).forEach(function (a) {
      var li = document.createElement('li');
      li.className = 'bura-alert bura-' + a.level;
      li.textContent = ctx.t(a.hr, a.en);
      list.appendChild(li);
      pushNotify(a);
    });

    if (zones) {
      zones.innerHTML = '';
      ZONES.forEach(function (z) {
        var sig = beachSignal(weather.windKmh, weather.precip, isBura(weather.windKmh, weather.windDir), isJugo(weather.windKmh, weather.windDir));
        var row = document.createElement('div');
        row.className = 'bura-zone bura-signal-' + sig;
        var sigLabel = sig === 'good'
          ? ctx.t('Signal: vrijedi posjetiti', 'Signal: good time to visit')
          : sig === 'weak'
            ? ctx.t('Signal: slab', 'Signal: weak')
            : ctx.t('Bez signala — ne preporučujemo', 'No signal — not recommended');
        row.innerHTML =
          '<strong>' + ctx.t(z.nameHr, z.nameEn) + '</strong>' +
          '<span class="bura-zone-meta">' + sigLabel + '</span>';
        zones.appendChild(row);
      });
    }

    var tagline = document.getElementById('bura-tagline');
    if (tagline) {
      tagline.textContent = ctx.t(
        'Wildfire season. Bura. Flash floods on Trumbićeva obala.',
        'Wildfire season. Bura. Flash floods on Trumbićeva waterfront.'
      );
    }
  }

  function refresh() {
    return fetchWeather()
      .then(function () {
        renderBar();
        renderPanel();
      })
      .catch(function () {
        weather = {
          windKmh: 48,
          windDir: 35,
          precip: 0,
          nextPrecip: 0,
          nextProb: 10,
          updated: Date.now(),
          demo: true
        };
        renderBar();
        renderPanel();
        var meta = document.getElementById('bura-meta');
        if (meta) meta.textContent = ctx.t('Demo podaci (meteo nedostupan)', 'Demo data (weather unavailable)');
      });
  }

  function requestNotifyPermission() {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  function init(options) {
    ctx = options || {};
    requestNotifyPermission();
    refresh();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(refresh, POLL_MS);
  }

  window.AeBuraJugo = {
    init: init,
    refresh: refresh,
    getWeather: function () { return weather; }
  };
})();
