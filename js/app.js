(function () {
  'use strict';

  var SPLIT_CENTER = [43.5133, 16.4827];
  var CLAIM_COST = 15;
  var LEAVE_REWARD = 10;
  var REPORT_REWARD = 5;
  var LEAVE_SECONDS = 300;
  var OPEN_SPOT_SECONDS = 300;
  var START_POINTS = 8;
  var STORAGE_KEY = 'slobodno-misto-v2';
  var PIN_BASE = 20;
  var isHr = document.documentElement.lang === 'hr';

  var REWARDS = {
    coffee: { cost: 30, emoji: '☕', hr: 'Kava — Kafić Žnjan', en: 'Coffee — Žnjan café' },
    bus: { cost: 50, emoji: '🚌', hr: 'Promet karta — 24h', en: 'Bus pass — 24h' },
    pizza: { cost: 45, emoji: '🍕', hr: 'Pizza Margherita — Žnjan', en: 'Margherita pizza — Žnjan' },
    cinema: { cost: 65, emoji: '🎬', hr: 'Kino ulaznica — CineStar', en: 'Cinema ticket — CineStar' },
    gelato: { cost: 25, emoji: '🍦', hr: 'Sladoled — Riva', en: 'Gelato — Riva promenade' },
    parking: { cost: 40, emoji: '🅿️', hr: '1h parking P+R Sukoišan', en: '1h P+R Sukoišan parking' },
    market: { cost: 35, emoji: '🛒', hr: 'Popust Pazar — 10%', en: 'Market day — 10% off' }
  };

  var LIVE_EVENTS = [
    {
      id: 'poljud',
      latlng: [43.5088, 16.4562],
      nameHr: 'Stadion Poljud',
      nameEn: 'Poljud Stadium',
      eventHr: 'NK Hajduk — derbi',
      eventEn: 'Hajduk derby night'
    },
    {
      id: 'riva',
      latlng: [43.5082, 16.4421],
      nameHr: 'Riva',
      nameEn: 'Riva waterfront',
      eventHr: 'Večernji koncert',
      eventEn: 'Evening concert'
    },
    {
      id: 'cc',
      latlng: [43.5188, 16.4695],
      nameHr: 'City Center One',
      nameEn: 'City Center One',
      eventHr: 'Shopping & event dan',
      eventEn: 'Shopping & event day'
    }
  ];

  var state = {
    points: START_POINTS,
    vouchers: [],
    myLeaveId: null,
    myOpenId: null,
    leaveTimer: null,
    leaveInterval: null,
    spots: [],
    markMode: false,
    eventCrowd: {}
  };

  var map, myMarker, spotMarkers = {}, tempMarker = null;
  var eventMarkers = {}, eventCrowdTimer = null;
  var $ = function (id) { return document.getElementById(id); };

  function t(hr, en) { return isHr ? hr : en; }

  function pinScale() {
    if (!map) return 1;
    var z = map.getZoom();
    return Math.max(0.72, Math.min(1.38, 0.52 + z * 0.055));
  }

  function scaledPinSize(base) {
    var s = Math.round(base * pinScale());
    return [s, s];
  }

  function pinAnchor(size) {
    return [Math.round(size[0] / 2), Math.round(size[1] / 2)];
  }

  function makePinIcon(html, baseSize) {
    var size = scaledPinSize(baseSize || PIN_BASE);
    return L.divIcon({
      className: 'pin-wrap map-pin-scaled',
      html: html,
      iconSize: size,
      iconAnchor: pinAnchor(size)
    });
  }

  function refreshMarkerScales() {
    Object.keys(spotMarkers).forEach(function (id) {
      var spot = state.spots.find(function (s) { return s.id === id; });
      if (!spot) return;
      var isLeaving = spot.type === 'leaving';
      var html = '<div class="' + (isLeaving ? 'pin-leaving' : 'pin-open') + '"></div>';
      spotMarkers[id].setIcon(makePinIcon(html, isLeaving ? 22 : PIN_BASE));
    });
    if (tempMarker) {
      tempMarker.setIcon(makePinIcon('<div class="pin-temp"></div>', 26));
    }
    if (myMarker) {
      var ms = scaledPinSize(16);
      myMarker.setIcon(L.divIcon({
        className: 'pin-wrap map-pin-scaled user-pin-wrap',
        html: '<div class="user-pin"></div>',
        iconSize: ms,
        iconAnchor: pinAnchor(ms)
      }));
    }
    Object.keys(eventMarkers).forEach(function (id) {
      var ev = LIVE_EVENTS.find(function (e) { return e.id === id; });
      if (!ev) return;
      var crowd = state.eventCrowd[id] || 50;
      eventMarkers[id].setIcon(makeEventIcon(ev, crowd));
    });
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        var legacy = localStorage.getItem('slobodno-misto-v1');
        if (legacy) raw = legacy;
      }
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (typeof saved.points === 'number') state.points = saved.points;
      if (Array.isArray(saved.vouchers)) state.vouchers = saved.vouchers;
      if (Array.isArray(saved.spots)) {
        state.spots = saved.spots.filter(function (s) {
          return s.expiresAt > Date.now();
        });
      }
    } catch (e) { /* ignore */ }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        points: state.points,
        spots: state.spots,
        vouchers: state.vouchers
      }));
    } catch (e) { /* ignore */ }
  }

  function showToast(msg, type) {
    var toast = $('toast');
    toast.textContent = msg;
    toast.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.classList.remove('show'); }, 3200);
  }

  function renderRewards() {
    var list = $('rewards-list');
    if (!list) return;
    list.innerHTML = '';
    Object.keys(REWARDS).forEach(function (id) {
      var r = REWARDS[id];
      var card = document.createElement('div');
      card.className = 'reward-card';
      card.innerHTML =
        '<div>' +
          '<span class="t-hr">' + r.emoji + ' ' + r.hr + ' (' + r.cost + ' Gušti)</span>' +
          '<span class="t-en">' + r.emoji + ' ' + r.en + ' (' + r.cost + ' Gušti)</span>' +
          '<span class="reward-need"></span>' +
        '</div>';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'redeem-btn';
      btn.setAttribute('data-cost', String(r.cost));
      btn.setAttribute('data-id', id);
      btn.innerHTML = '<span class="t-hr">Iskoristi</span><span class="t-en">Redeem</span>';
      btn.addEventListener('click', function () { redeemReward(id); });
      card.appendChild(btn);
      list.appendChild(card);
    });
    updatePointsUI(false);
  }

  function makeVoucherCode(rewardId) {
    var part = Math.random().toString(36).slice(2, 8).toUpperCase();
    return 'AE-' + rewardId.toUpperCase().slice(0, 4) + '-' + part;
  }

  function buildQrInto(el, text) {
    el.innerHTML = '';
    if (typeof QRCode === 'undefined') return;
    new QRCode(el, {
      text: text,
      width: 168,
      height: 168,
      colorDark: '#0a0f0e',
      colorLight: '#00D4AA',
      correctLevel: QRCode.CorrectLevel.H
    });
  }

  function redeemReward(id) {
    var r = REWARDS[id];
    if (!r) return;
    if (!spendPoints(r.cost)) {
      showToast(t('Nedovoljno bodova.', 'Not enough points.'), 'error');
      return;
    }
    var code = makeVoucherCode(id);
    var voucher = {
      id: 'v-' + Date.now(),
      rewardId: id,
      code: code,
      qrUrl: 'https://ae-split.hr/v/' + code,
      titleHr: r.emoji + ' ' + r.hr,
      titleEn: r.emoji + ' ' + r.en,
      redeemedAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
    };
    state.vouchers.unshift(voucher);
    saveState();
    renderVoucherWallet();
    showToast(
      t('Kupon dodan u novčanik! Pokaži QR kod.', 'Voucher saved to wallet! Show your QR code.'),
      'success'
    );
    openVoucherModal(voucher);
  }

  function formatVoucherExpiry(v) {
    var d = new Date(v.expiresAt);
    return t(
      'Vrijedi do ' + d.toLocaleDateString('hr-HR'),
      'Valid until ' + d.toLocaleDateString('en-GB')
    );
  }

  function renderVoucherWallet() {
    var list = $('voucher-wallet-list');
    var empty = $('voucher-empty');
    if (!list) return;

    var active = state.vouchers.filter(function (v) {
      return v.expiresAt > Date.now();
    });
    state.vouchers = active;
    list.innerHTML = '';

    if (empty) empty.hidden = active.length > 0;

    active.forEach(function (v) {
      var card = document.createElement('article');
      card.className = 'voucher-card';
      var title = t(v.titleHr, v.titleEn);
      card.innerHTML =
        '<div class="voucher-card-head">' +
          '<strong>' + title + '</strong>' +
          '<span class="voucher-code">' + v.code + '</span>' +
        '</div>' +
        '<div class="voucher-qr-mini" data-vid="' + v.id + '"></div>' +
        '<p class="voucher-expiry">' + formatVoucherExpiry(v) + '</p>';
      var mini = card.querySelector('.voucher-qr-mini');
      buildQrInto(mini, v.qrUrl);
      card.addEventListener('click', function () { openVoucherModal(v); });
      list.appendChild(card);
    });
    saveState();
  }

  function openVoucherModal(v) {
    var modal = $('voucher-qr-modal');
    if (!modal) return;
    $('voucher-qr-title').textContent = t(v.titleHr, v.titleEn);
    $('voucher-qr-code').textContent = v.code;
    $('voucher-qr-expiry').textContent = formatVoucherExpiry(v);
    buildQrInto($('voucher-qr-canvas'), v.qrUrl);
    modal.hidden = false;
  }

  function closeVoucherModal() {
    var modal = $('voucher-qr-modal');
    if (modal) modal.hidden = true;
  }

  function updatePointsUI(animate) {
    $('points-value').textContent = String(state.points);
    var pill = $('points-display');
    if (animate) {
      pill.classList.remove('pop');
      void pill.offsetWidth;
      pill.classList.add('pop');
    }
    document.querySelectorAll('.redeem-btn').forEach(function (btn) {
      var cost = parseInt(btn.getAttribute('data-cost'), 10);
      var locked = state.points < cost;
      btn.disabled = locked;
      var hint = btn.parentElement.querySelector('.reward-need');
      if (hint) {
        hint.textContent = locked
          ? t(' još ' + (cost - state.points) + ' Gušti', ' need ' + (cost - state.points) + ' more Gušti')
          : '';
      }
    });
    saveState();
  }

  function addPoints(n, reason) {
    state.points += n;
    updatePointsUI(true);
    if (reason) showToast(reason, 'success');
  }

  function spendPoints(n) {
    if (state.points < n) return false;
    state.points -= n;
    updatePointsUI(true);
    return true;
  }

  function crowdLevel(pct) {
    if (pct >= 80) return { cls: 'crowd-high', labelHr: 'jaka gužva', labelEn: 'heavy crowd' };
    if (pct >= 55) return { cls: 'crowd-mid', labelHr: 'umjerena gužva', labelEn: 'moderate crowd' };
    return { cls: 'crowd-low', labelHr: 'prolazna gužva', labelEn: 'light crowd' };
  }

  function makeEventIcon(ev, crowd) {
    var level = crowdLevel(crowd);
    var name = t(ev.nameHr, ev.nameEn);
    var html =
      '<div class="event-pin ' + level.cls + '">' +
        '<span class="event-pin-pct">' + crowd + '%</span>' +
        '<span class="event-pin-name">' + name + '</span>' +
      '</div>';
    return makePinIcon(html, 36);
  }

  function tickEventCrowd() {
    LIVE_EVENTS.forEach(function (ev) {
      var prev = state.eventCrowd[ev.id];
      if (prev == null) prev = 45 + Math.floor(Math.random() * 35);
      var delta = Math.floor(Math.random() * 11) - 4;
      var next = Math.max(28, Math.min(98, prev + delta));
      state.eventCrowd[ev.id] = next;
      if (eventMarkers[ev.id]) {
        eventMarkers[ev.id].setIcon(makeEventIcon(ev, next));
      }
    });
    updateEventLiveBar();
  }

  function getBusiestEvent() {
    var best = null;
    var max = -1;
    LIVE_EVENTS.forEach(function (ev) {
      var c = state.eventCrowd[ev.id] || 0;
      if (c > max) {
        max = c;
        best = ev;
      }
    });
    return best ? { ev: best, crowd: max } : null;
  }

  function updateEventLiveBar() {
    var bar = $('event-live');
    if (!bar) return;
    var busiest = getBusiestEvent();
    if (!busiest) {
      bar.hidden = true;
      return;
    }
    var level = crowdLevel(busiest.crowd);
    bar.hidden = false;
    bar.className = 'event-live show ' + level.cls;
    var eventName = t(busiest.ev.eventHr, busiest.ev.eventEn);
    var place = t(busiest.ev.nameHr, busiest.ev.nameEn);
    bar.innerHTML =
      '<span class="event-live-dot" aria-hidden="true"></span>' +
      '<span class="event-live-text">' +
        '<strong>' + t('LIVE gužva', 'LIVE crowd') + '</strong> · ' +
        eventName + ' @ ' + place + ' — ' +
        busiest.crowd + '% · ' + t(level.labelHr, level.labelEn) +
      '</span>';
  }

  function initEventLayer() {
    LIVE_EVENTS.forEach(function (ev) {
      state.eventCrowd[ev.id] = 50 + Math.floor(Math.random() * 30);
      var crowd = state.eventCrowd[ev.id];
      var m = L.marker(ev.latlng, {
        icon: makeEventIcon(ev, crowd),
        zIndexOffset: 400
      });
      m.on('click', function () {
        map.panTo(ev.latlng, { animate: true });
        showToast(
          t(ev.eventHr + ' @ ' + ev.nameHr + ' — ' + crowd + '% gužve',
            ev.eventEn + ' @ ' + ev.nameEn + ' — ' + crowd + '% crowd'),
          ''
        );
      });
      m.addTo(map);
      eventMarkers[ev.id] = m;
    });
    updateEventLiveBar();
    if (eventCrowdTimer) clearInterval(eventCrowdTimer);
    eventCrowdTimer = setInterval(tickEventCrowd, 4500);
  }

  function createSpotMarker(spot) {
    var isLeaving = spot.type === 'leaving';
    var html = '<div class="' + (isLeaving ? 'pin-leaving' : 'pin-open') + '"></div>';
    var m = L.marker(spot.latlng, {
      icon: makePinIcon(html, isLeaving ? 22 : PIN_BASE)
    });
    m.on('click', function () {
      if ($('panel-seek').hidden) setMode('seek');
      highlightSpot(spot.id);
    });
    m.addTo(map);
    spotMarkers[spot.id] = m;
  }

  function removeSpotMarker(id) {
    if (spotMarkers[id]) {
      map.removeLayer(spotMarkers[id]);
      delete spotMarkers[id];
    }
  }

  function syncMarkers() {
    var ids = {};
    state.spots.forEach(function (s) {
      ids[s.id] = true;
      if (!spotMarkers[s.id]) createSpotMarker(s);
    });
    Object.keys(spotMarkers).forEach(function (id) {
      if (!ids[id]) removeSpotMarker(id);
    });
    renderSpotList();
  }

  function formatDistance(spot) {
    if (!myMarker) return '—';
    var a = myMarker.getLatLng();
    var b = L.latLng(spot.latlng);
    var m = Math.round(a.distanceTo(b));
    if (m < 1000) return m + ' m';
    return (m / 1000).toFixed(1) + ' km';
  }

  function formatEta(spot) {
    var sec = Math.max(0, Math.round((spot.expiresAt - Date.now()) / 1000));
    var min = Math.ceil(sec / 60);
    return min + ' min';
  }

  function renderSpotList() {
    var list = $('spot-list');
    var noSpots = $('no-spots');
    var active = state.spots.filter(function (s) {
      return s.expiresAt > Date.now() && s.id !== state.myLeaveId;
    });
    list.innerHTML = '';
    noSpots.style.display = active.length ? 'none' : 'block';

    active.forEach(function (spot) {
      var li = document.createElement('li');
      li.className = 'spot-item' + (spot.claimedByMe ? ' claimed' : '');
      var label = spot.type === 'leaving'
        ? (isHr ? 'Odlazi za ' : 'Leaving in ') + formatEta(spot)
        : (isHr ? 'Slobodno misto' : 'Free spot');
      li.innerHTML =
        '<div><strong>' + label + '</strong>' +
        '<div class="meta">' + formatDistance(spot) + ' · ' + (spot.street || 'Split') + '</div></div>';
      var btn = document.createElement('button');
      if (spot.claimedByMe) {
        btn.textContent = t('Rezervirano ✓', 'Claimed ✓');
        btn.disabled = true;
      } else if (spot.claimed) {
        btn.textContent = t('Zauzeto', 'Taken');
        btn.disabled = true;
      } else {
        btn.textContent = t('Rezerviraj (−15)', 'Claim (−15)');
        btn.addEventListener('click', function () { claimSpot(spot.id); });
      }
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function highlightSpot(id) {
    if (spotMarkers[id]) map.panTo(spotMarkers[id].getLatLng(), { animate: true });
  }

  function setMarkMode(on) {
    state.markMode = on;
    $('map').classList.toggle('map-mark-mode', on);
    $('btn-map-mark').classList.toggle('active', on);
    $('map-hint').hidden = !on;
    if (!on && tempMarker) {
      map.removeLayer(tempMarker);
      tempMarker = null;
    }
  }

  function showTempPin(latlng) {
    if (tempMarker) map.removeLayer(tempMarker);
    tempMarker = L.marker(latlng, {
      icon: makePinIcon('<div class="pin-temp"></div>', 26)
    }).addTo(map);
  }

  function addSpotAt(latlng, type) {
    var durationMs = type === 'leaving'
      ? LEAVE_SECONDS * 1000
      : OPEN_SPOT_SECONDS * 1000;
    var spot = {
      id: 's-' + Date.now(),
      type: type === 'leaving' ? 'leaving' : 'open',
      latlng: [latlng.lat, latlng.lng],
      street: isHr ? 'Split (označeno na karti)' : 'Split (marked on map)',
      expiresAt: Date.now() + durationMs,
      claimed: false,
      claimedByMe: false
    };
    state.spots.push(spot);
    if (type === 'leaving') state.myLeaveId = spot.id;
    if (type !== 'leaving') state.myOpenId = spot.id;
    syncMarkers();
    saveState();
    return spot;
  }

  function onMapClick(e) {
    if (!state.markMode) return;
    showTempPin(e.latlng);
    var action = $('mark-action').value;
    if (action === 'open') {
      if (state.myOpenId) {
        showToast(t('Već si prijavio slobodno misto — pričekaj da istekne (5 min).', 'You already reported a free spot — wait for it to expire (5 min).'), 'error');
        setMarkMode(false);
        return;
      }
      addSpotAt(e.latlng, 'open');
      addPoints(REPORT_REWARD, t('Slobodno misto! +5 Gušti (pin 5 min).', 'Free spot! +5 Gušti (pin 5 min).'));
    } else if (action === 'leave') {
      if (state.myLeaveId) {
        showToast(t('Već si označio odlazak.', 'You already marked leaving.'), 'error');
        setMarkMode(false);
        return;
      }
      addSpotAt(e.latlng, 'leaving');
      addPoints(LEAVE_REWARD, t('Odlazak označen! +10 Gušti.', 'Leave marked! +10 Gušti.'));
      startLeaveCountdownUI();
    }
    setMarkMode(false);
  }

  function claimSpot(id) {
    var spot = state.spots.find(function (s) { return s.id === id; });
    if (!spot || spot.claimed) return;
    if (!spendPoints(CLAIM_COST)) {
      showToast(t('Nedovoljno Gušti bodova.', 'Not enough Gušti points.'), 'error');
      return;
    }
    spot.claimed = true;
    spot.claimedByMe = true;
    syncMarkers();
    highlightSpot(id);
    showToast(t('Misto rezervirano!', 'Spot claimed!'), 'success');
    saveState();
  }

  function startLeaveCountdownUI() {
    var cdEl = $('leave-countdown');
    var cancelBtn = $('btn-cancel-leave');
    var leaveBtn = $('btn-leave');
    cdEl.hidden = false;
    cancelBtn.hidden = false;
    leaveBtn.disabled = true;

    var remaining = LEAVE_SECONDS;
    function tick() {
      var min = Math.floor(remaining / 60);
      var sec = remaining % 60;
      cdEl.textContent = (isHr ? 'Odlazak za ' : 'Leaving in ') +
        min + ':' + String(sec).padStart(2, '0');
      if (remaining <= 0) finishLeave();
      remaining--;
    }
    tick();
    state.leaveInterval = setInterval(tick, 1000);
    state.leaveTimer = setTimeout(finishLeave, LEAVE_SECONDS * 1000);
  }

  function finishLeave() {
    clearInterval(state.leaveInterval);
    clearTimeout(state.leaveTimer);
    state.leaveInterval = null;
    state.leaveTimer = null;
    if (state.myLeaveId) {
      var spot = state.spots.find(function (s) { return s.id === state.myLeaveId; });
      if (spot) {
        spot.type = 'open';
        spot.expiresAt = Date.now() + OPEN_SPOT_SECONDS * 1000;
      }
      state.myLeaveId = null;
    }
    $('leave-countdown').hidden = true;
    $('btn-cancel-leave').hidden = true;
    $('btn-leave').disabled = false;
    purgeExpired();
    syncMarkers();
    showToast(t('Misto slobodno na karti (još 5 min).', 'Spot free on map (5 min left).'), 'success');
    saveState();
  }

  function cancelLeave() {
    if (state.myLeaveId) {
      state.spots = state.spots.filter(function (s) { return s.id !== state.myLeaveId; });
      removeSpotMarker(state.myLeaveId);
      state.myLeaveId = null;
    }
    clearInterval(state.leaveInterval);
    clearTimeout(state.leaveTimer);
    $('leave-countdown').hidden = true;
    $('btn-cancel-leave').hidden = true;
    $('btn-leave').disabled = false;
    setMarkMode(false);
    syncMarkers();
    showToast(t('Odlazak otkazan.', 'Leave cancelled.'), '');
    saveState();
  }

  function setMode(mode) {
    document.querySelectorAll('.mode-tab').forEach(function (tab) {
      var active = tab.getAttribute('data-mode') === mode;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $('panel-leave').hidden = mode !== 'leave';
    $('panel-seek').hidden = mode !== 'seek';
    var panelBike = $('panel-bike');
    var panelBura = $('panel-bura');
    if (panelBike) panelBike.hidden = mode !== 'bike';
    if (panelBura) panelBura.hidden = mode !== 'bura';
    if (mode === 'seek') renderSpotList();
    if (window.AeNextbike && window.AeNextbike.onModeChange) window.AeNextbike.onModeChange(mode);
  }

  function purgeExpired() {
    var before = state.spots.length;
    state.spots = state.spots.filter(function (s) {
      return s.expiresAt > Date.now();
    });
    if (state.myOpenId && !state.spots.find(function (s) { return s.id === state.myOpenId; })) {
      state.myOpenId = null;
    }
    if (state.spots.length !== before) {
      syncMarkers();
      saveState();
    }
  }

  function initMap() {
    map = L.map('map', { center: SPLIT_CENTER, zoom: 16, zoomControl: true });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OSM &copy; CARTO',
      maxZoom: 20
    }).addTo(map);

    var userSize = scaledPinSize(16);
    myMarker = L.marker(SPLIT_CENTER, {
      draggable: true,
      title: t('Tvoja pozicija', 'Your position'),
      icon: L.divIcon({
        className: 'pin-wrap map-pin-scaled user-pin-wrap',
        html: '<div class="user-pin"></div>',
        iconSize: userSize,
        iconAnchor: pinAnchor(userSize)
      })
    }).addTo(map);
    myMarker.on('dragend', function () { renderSpotList(); saveState(); });

    map.on('click', onMapClick);
    map.on('zoomend', refreshMarkerScales);

    initEventLayer();

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          var ll = [pos.coords.latitude, pos.coords.longitude];
          myMarker.setLatLng(ll);
          map.setView(ll, 17);
          renderSpotList();
        },
        function () {},
        { enableHighAccuracy: false, timeout: 8000 }
      );
    }

    function fitMap() {
      if (map) map.invalidateSize();
    }
    setTimeout(fitMap, 100);
    setTimeout(fitMap, 400);
    window.addEventListener('resize', fitMap);
  }

  function initVoucherModal() {
    var closeBtn = $('btn-voucher-qr-close');
    var backdrop = $('voucher-qr-backdrop');
    if (closeBtn) closeBtn.addEventListener('click', closeVoucherModal);
    if (backdrop) backdrop.addEventListener('click', closeVoucherModal);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeVoucherModal();
    });
  }

  function initMobilityModules() {
    var api = {
      map: map,
      addPoints: addPoints,
      showToast: showToast,
      t: t,
      setMode: setMode,
      makePinIcon: makePinIcon
    };
    if (window.AeNextbike) window.AeNextbike.init(api);
    if (window.AeBuraJugo) window.AeBuraJugo.init(api);
    var notifyBtn = $('btn-bura-notify');
    if (notifyBtn && typeof Notification !== 'undefined') {
      notifyBtn.addEventListener('click', function () {
        Notification.requestPermission().then(function (p) {
          showToast(
            p === 'granted'
              ? t('Obavijesti uključene.', 'Notifications enabled.')
              : t('Obavijesti nisu dopuštene.', 'Notifications not allowed.'),
            p === 'granted' ? 'success' : 'error'
          );
        });
      });
    }
  }

  function init() {
    initMap();
    loadState();
    renderRewards();
    renderVoucherWallet();
    syncMarkers();
    updatePointsUI(false);
    initVoucherModal();
    initMobilityModules();
    setInterval(purgeExpired, 10000);
  }

  document.querySelectorAll('.mode-tab').forEach(function (tab) {
    tab.addEventListener('click', function () { setMode(tab.getAttribute('data-mode')); });
  });

  $('btn-leave').addEventListener('click', function () {
    if (state.myLeaveId) {
      showToast(t('Već si označio odlazak.', 'You already marked leaving.'), 'error');
      return;
    }
    setMarkMode(true);
    $('mark-action').value = 'leave';
    showToast(t('Klikni na kartu gdje parkiraš.', 'Click the map where you park.'), '');
  });

  $('btn-cancel-leave').addEventListener('click', cancelLeave);

  $('btn-report').addEventListener('click', function () {
    setMarkMode(true);
    $('mark-action').value = 'open';
    showToast(t('Klikni na kartu — pin traje 5 min.', 'Click the map — pin lasts 5 min.'), '');
  });

  $('btn-map-mark').addEventListener('click', function () {
    setMarkMode(!state.markMode);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
