(function () {
  'use strict';

  var SPLIT_CENTER = [43.5133, 16.4827];
  var CLAIM_COST = 15;
  var LEAVE_REWARD = 10;
  var REPORT_REWARD = 5;
  var LEAVE_SECONDS = 300;
  var OPEN_SPOT_SECONDS = 300;
  var START_POINTS = 8;
  var STORAGE_KEY = 'slobodno-misto-v1';
  var isHr = document.documentElement.lang === 'hr';

  var state = {
    points: START_POINTS,
    myLeaveId: null,
    myOpenId: null,
    leaveTimer: null,
    leaveInterval: null,
    spots: [],
    markMode: false
  };

  var map, myMarker, spotMarkers = {}, tempMarker = null;
  var $ = function (id) { return document.getElementById(id); };

  function t(hr, en) { return isHr ? hr : en; }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (typeof saved.points === 'number') state.points = saved.points;
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
        spots: state.spots
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

  function createSpotMarker(spot) {
    var isLeaving = spot.type === 'leaving';
    var html = '<div class="' + (isLeaving ? 'pin-leaving' : 'pin-open') + '"></div>';
    var m = L.marker(spot.latlng, {
      icon: L.divIcon({
        className: 'pin-wrap',
        html: html,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      })
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
      icon: L.divIcon({
        className: 'pin-wrap',
        html: '<div class="pin-temp"></div>',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      })
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
    if (mode === 'seek') renderSpotList();
  }

  function purgeExpired() {
    var before = state.spots.length;
    state.spots = state.spots.filter(function (s) {
      return s.expiresAt > Date.now();
    });
    // Clear myOpenId if that spot has expired
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

    myMarker = L.marker(SPLIT_CENTER, {
      draggable: true,
      title: t('Tvoja pozicija', 'Your position')
    }).addTo(map);
    myMarker.on('dragend', function () { renderSpotList(); saveState(); });

    map.on('click', onMapClick);

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

  function init() {
    initMap();
    loadState();
    syncMarkers();
    updatePointsUI(false);
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

  document.querySelectorAll('.redeem-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var cost = parseInt(btn.getAttribute('data-cost'), 10);
      var id = btn.getAttribute('data-id');
      if (!spendPoints(cost)) {
        showToast(t('Nedovoljno bodova.', 'Not enough points.'), 'error');
        return;
      }
      var msg = id === 'coffee'
        ? t('Kava iskorištena! Pokaži app u kafiću.', 'Coffee redeemed! Show the app at the café.')
        : t('Promet karta dodana u novčanik.', 'Bus pass added to wallet.');
      showToast(msg, 'success');
    });
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();