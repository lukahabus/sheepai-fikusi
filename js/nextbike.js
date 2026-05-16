(function () {
  'use strict';

  var GBFS_BASE = 'https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_hr/hr/';
  var LIVE_URL = 'https://maps.nextbike.net/maps/nextbike-live.json?city=445';
  var SPLIT_BBOX = { minLat: 43.48, maxLat: 43.55, minLon: 16.38, maxLon: 16.52 };
  var SURPLUS_RATIO = 0.8;
  var DEFICIT_RATIO = 0.2;
  var PICKUP_BONUS = 8;
  var RETURN_BONUS = 12;
  var POLL_MS = 60000;

  var ctx = {};
  var stations = [];
  var markers = {};
  var pollTimer = null;
  var lastClaimed = {};

  function inSplitBBox(lat, lon) {
    return lat >= SPLIT_BBOX.minLat && lat <= SPLIT_BBOX.maxLat &&
      lon >= SPLIT_BBOX.minLon && lon <= SPLIT_BBOX.maxLon;
  }

  function classifyStation(bikes, docks, capacity) {
    var cap = capacity || Math.max(1, bikes + docks);
    var fill = bikes / cap;
    if (fill >= SURPLUS_RATIO) return 'surplus';
    if (fill <= DEFICIT_RATIO) return 'deficit';
    return 'normal';
  }

  function parseGbfsStation(info, status) {
    var cap = info.capacity || 10;
    var bikes = status ? (status.num_bikes_available || 0) : 0;
    var docks = status ? (status.num_docks_available || 0) : 0;
    if (!info.capacity && bikes + docks > 0) cap = bikes + docks;
    return {
      id: String(info.station_id),
      name: info.name,
      latlng: [info.lat, info.lon],
      capacity: cap,
      bikes: bikes,
      docks: docks,
      kind: classifyStation(bikes, docks, cap),
      source: 'gbfs'
    };
  }

  function parseLivePlace(place) {
    var bikes = place.bikes_available_to_rent || place.bikes || 0;
    var racks = place.free_racks != null ? place.free_racks : (place.spots || 0);
    var cap = Math.max(1, bikes + racks);
    return {
      id: String(place.uid || place.number || place.name),
      name: place.name || 'Nextbike',
      latlng: [place.lat, place.lng],
      capacity: cap,
      bikes: bikes,
      docks: racks,
      kind: classifyStation(bikes, racks, cap),
      source: 'live'
    };
  }

  var FALLBACK = [
    { id: 'split-riva', name: 'Riva', latlng: [43.5081, 16.4404], capacity: 12, bikes: 10, docks: 2, kind: 'surplus' },
    { id: 'split-kampus', name: 'Kampus / Sveučilište', latlng: [43.5128, 16.4598], capacity: 10, bikes: 2, docks: 8, kind: 'deficit' },
    { id: 'split-sukoisan', name: 'Sukoišan', latlng: [43.5195, 16.4688], capacity: 8, bikes: 7, docks: 1, kind: 'surplus' },
    { id: 'split-firule', name: 'Firule', latlng: [43.5035, 16.4655], capacity: 9, bikes: 1, docks: 8, kind: 'deficit' },
    { id: 'split-marjan', name: 'Marjan', latlng: [43.5085, 16.4285], capacity: 6, bikes: 5, docks: 1, kind: 'surplus' },
    { id: 'split-trumbiceva', name: 'Trumbićeva', latlng: [43.5072, 16.4418], capacity: 8, bikes: 4, docks: 4, kind: 'normal' }
  ];

  function jitterFallback() {
    return FALLBACK.map(function (s) {
      var bikes = s.bikes + Math.floor(Math.random() * 3) - 1;
      var docks = Math.max(0, s.capacity - bikes);
      bikes = Math.max(0, Math.min(s.capacity, bikes));
      return {
        id: s.id,
        name: s.name,
        latlng: s.latlng,
        capacity: s.capacity,
        bikes: bikes,
        docks: docks,
        kind: classifyStation(bikes, docks, s.capacity),
        source: 'demo'
      };
    });
  }

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function loadFromGbfs() {
    return Promise.all([
      fetchJson(GBFS_BASE + 'station_information.json'),
      fetchJson(GBFS_BASE + 'station_status.json')
    ]).then(function (res) {
      var infoList = res[0].data.stations || [];
      var statusList = res[1].data.stations || [];
      var statusMap = {};
      statusList.forEach(function (st) { statusMap[st.station_id] = st; });
      var split = infoList.filter(function (st) {
        return inSplitBBox(st.lat, st.lon);
      });
      if (!split.length) return [];
      return split.map(function (info) {
        return parseGbfsStation(info, statusMap[info.station_id]);
      });
    });
  }

  function loadFromLive() {
    return fetchJson(LIVE_URL).then(function (data) {
      var places = [];
      (data.countries || []).forEach(function (country) {
        (country.cities || []).forEach(function (city) {
          (city.places || []).forEach(function (place) {
            if (place.lat != null && place.lng != null) places.push(place);
          });
        });
      });
      if (!places.length && data.places) places = data.places;
      return places.map(parseLivePlace);
    });
  }

  function refreshStations() {
    return loadFromGbfs()
      .then(function (list) {
        if (list.length) return list;
        return loadFromLive();
      })
      .then(function (list) {
        if (list.length) {
          stations = list;
          updateMeta(true);
          return;
        }
        stations = jitterFallback();
        updateMeta(false);
      })
      .catch(function () {
        return loadFromLive().then(function (list) {
          if (list.length) {
            stations = list;
            updateMeta(true);
            return;
          }
          stations = jitterFallback();
          updateMeta(false);
        }).catch(function () {
          stations = jitterFallback();
          updateMeta(false);
        });
      })
      .then(function () {
        renderMarkers();
        renderList();
      });
  }

  function updateMeta(live) {
    var el = document.getElementById('nextbike-meta');
    if (!el || !ctx.t) return;
    el.textContent = live
      ? ctx.t('GBFS / Nextbike live · osvježava se svake minute', 'GBFS / Nextbike live · refreshes every minute')
      : ctx.t('Demo stanice Split (GBFS privremeno nedostupan)', 'Demo Split stations (GBFS temporarily unavailable)');
  }

  function stationIcon(st) {
    var cls = 'nb-pin nb-' + st.kind;
    var label = st.kind === 'surplus'
      ? (ctx.t ? ctx.t('Izvor', 'Source') : 'Izvor')
      : st.kind === 'deficit'
        ? (ctx.t ? ctx.t('Povrat', 'Return') : 'Povrat')
        : '';
    var html =
      '<div class="' + cls + '">' +
        '<span class="nb-bikes">' + st.bikes + '</span>' +
        (label ? '<span class="nb-tag">' + label + '</span>' : '') +
      '</div>';
    return ctx.makePinIcon ? ctx.makePinIcon(html, 34) : L.divIcon({
      className: 'pin-wrap map-pin-scaled',
      html: html,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });
  }

  function renderMarkers() {
    if (!ctx.map) return;
    var ids = {};
    stations.forEach(function (st) {
      ids[st.id] = true;
      if (!markers[st.id]) {
        var m = L.marker(st.latlng, { icon: stationIcon(st), zIndexOffset: 300 });
        m.on('click', function () {
          if (document.getElementById('panel-bike').hidden && ctx.setMode) ctx.setMode('bike');
          showStationToast(st);
        });
        m.addTo(ctx.map);
        markers[st.id] = m;
      } else {
        markers[st.id].setLatLng(st.latlng);
        markers[st.id].setIcon(stationIcon(st));
      }
    });
    Object.keys(markers).forEach(function (id) {
      if (!ids[id]) {
        ctx.map.removeLayer(markers[id]);
        delete markers[id];
      }
    });
  }

  function showStationToast(st) {
    var msg;
    if (st.kind === 'surplus') {
      msg = ctx.t(
        st.name + ' — suficit (' + st.bikes + ' bajkova). Preuzmi: +' + PICKUP_BONUS + ' Gušti.',
        st.name + ' — surplus (' + st.bikes + ' bikes). Pick up: +' + PICKUP_BONUS + ' Gušti.'
      );
    } else if (st.kind === 'deficit') {
      msg = ctx.t(
        st.name + ' — deficit (' + st.docks + ' slobodnih mjesta). Vrati: +' + RETURN_BONUS + ' Gušti.',
        st.name + ' — deficit (' + st.docks + ' free docks). Return: +' + RETURN_BONUS + ' Gušti.'
      );
    } else {
      msg = st.name + ' — ' + st.bikes + ' / ' + st.capacity;
    }
    if (ctx.showToast) ctx.showToast(msg, '');
  }

  function claimBonus(st, action) {
    var key = st.id + '-' + action;
    var now = Date.now();
    if (lastClaimed[key] && now - lastClaimed[key] < 300000) {
      if (ctx.showToast) ctx.showToast(ctx.t('Bonus već iskorišten (5 min).', 'Bonus already claimed (5 min).'), 'error');
      return;
    }
    lastClaimed[key] = now;
    var pts = action === 'pickup' ? PICKUP_BONUS : RETURN_BONUS;
    if (ctx.addPoints) {
      ctx.addPoints(pts, ctx.t('Nextbike +' + pts + ' Gušti!', 'Nextbike +' + pts + ' Gušti!'));
    }
  }

  function renderList() {
    var list = document.getElementById('nextbike-list');
    var empty = document.getElementById('nextbike-empty');
    if (!list) return;
    list.innerHTML = '';
    var surplus = stations.filter(function (s) { return s.kind === 'surplus'; });
    var deficit = stations.filter(function (s) { return s.kind === 'deficit'; });

    function addSection(title, items, action) {
      if (!items.length) return;
      var h = document.createElement('p');
      h.className = 'nextbike-section-title';
      h.textContent = title;
      list.appendChild(h);
      items.forEach(function (st) {
        var li = document.createElement('li');
        li.className = 'spot-item nextbike-item nb-item-' + st.kind;
        li.innerHTML =
          '<div><strong>' + st.name + '</strong>' +
          '<div class="meta">🚲 ' + st.bikes + ' · 🅿 ' + st.docks + ' / ' + st.capacity + '</div></div>';
        var btn = document.createElement('button');
        if (action === 'pickup') {
          btn.textContent = ctx.t('Preuzmi (+' + PICKUP_BONUS + ')', 'Pick up (+' + PICKUP_BONUS + ')');
          btn.addEventListener('click', function () { claimBonus(st, 'pickup'); });
        } else {
          btn.textContent = ctx.t('Vrati (+' + RETURN_BONUS + ')', 'Return (+' + RETURN_BONUS + ')');
          btn.addEventListener('click', function () { claimBonus(st, 'return'); });
        }
        li.appendChild(btn);
        list.appendChild(li);
      });
    }

    addSection(ctx.t('🟢 Izvor bodova — suficit (>80%)', '🟢 Point sources — surplus (>80%)'), surplus, 'pickup');
    addSection(ctx.t('🔵 Odredište s bonusom — deficit (<20%)', '🔵 Bonus destinations — deficit (<20%)'), deficit, 'return');

    if (empty) empty.hidden = stations.length > 0;
  }

  function setVisible(on) {
    Object.keys(markers).forEach(function (id) {
      var layer = markers[id];
      if (!layer || !ctx.map) return;
      if (on) {
        if (!ctx.map.hasLayer(layer)) layer.addTo(ctx.map);
      } else if (ctx.map.hasLayer(layer)) {
        ctx.map.removeLayer(layer);
      }
    });
  }

  function init(options) {
    ctx = options || {};
    refreshStations();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(refreshStations, POLL_MS);
  }

  function onModeChange(mode) {
    setVisible(mode === 'bike');
    if (mode === 'bike') renderList();
  }

  window.AeNextbike = {
    init: init,
    onModeChange: onModeChange,
    refresh: refreshStations,
    getStations: function () { return stations.slice(); }
  };
})();
