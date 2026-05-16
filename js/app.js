(function () {
  'use strict';

  var SPLIT_CENTER = [43.5133, 16.4827];
  var CLAIM_COST = 15;
  var LEAVE_SECONDS = 300;
  var isHr = document.documentElement.lang === 'hr';

  var state = {
    user: null,
    points: 0,
    myLeaveId: null,
    leaveTimer: null,
    leaveInterval: null,
    spots: [],
    markMode: false
  };

  var map, myMarker, spotMarkers = {}, tempMarker = null;
  var $ = function (id) { return document.getElementById(id); };

  function t(hr, en) { return isHr ? hr : en; }

  function showToast(msg, type) {
    var toast = $('toast');
    toast.textContent = msg;
    toast.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.classList.remove('show'); }, 3200);
  }

  function requireAuth() {
    if (!state.user) {
      location.href = 'login.html?next=' + encodeURIComponent('main.html');
      return false;
    }
    return true;
  }

  function updateAuthUI() {
    var bar = $('auth-bar');
    if (!bar) return;
    if (state.user) {
      $('auth-guest').hidden = true;
      $('auth-user').hidden = false;
      $('user-name').textContent = state.user.name;
      if (state.user.role === 'admin') {
        $('admin-link').hidden = false;
      }
    } else {
      $('auth-guest').hidden = false;
      $('auth-user').hidden = true;
    }
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
          ? t(' još ' + (cost - state.points) + ' Polza', ' need ' + (cost - state.points) + ' more Polza')
          : '';
      }
    });
  }

  async function refreshUser() {
    try {
      var data = await SlobodnoApi.me();
      state.user = data.user;
      state.points = data.user.points;
      updateAuthUI();
      updatePointsUI(false);
    } catch (e) {
      state.user = null;
      updateAuthUI();
    }
  }

  async function loadSpots() {
    try {
      var data = await SlobodnoApi.getSpots();
      state.spots = data.spots.map(function (s) {
        return {
          id: s.id,
          type: s.type,
          latlng: s.latlng,
          street: s.street,
          expiresAt: s.expiresAt,
          claimed: s.claimed,
          claimedByMe: s.claimedBy === (state.user && state.user.id),
          userId: s.userId
        };
      });
      syncMarkers();
      renderSpotList();
    } catch (e) {
      showToast(t('Karta nije dostupna — pokreni vercel dev.', 'Map unavailable — run vercel dev.'), 'error');
    }
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
      return s.expiresAt > Date.now() && s.id !== state.myLeaveId && s.userId !== (state.user && state.user.id);
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
    var mapEl = $('map');
    mapEl.classList.toggle('map-mark-mode', on);
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

  async function postSpotAt(latlng, type, durationSec) {
    if (!requireAuth()) return;
    try {
      var res = await SlobodnoApi.createSpot({
        lat: latlng.lat,
        lng: latlng.lng,
        type: type,
        durationSec: durationSec,
        street: isHr ? 'Split (označeno na karti)' : 'Split (marked on map)'
      });
      state.points = res.points;
      updatePointsUI(true);
      if (type === 'leaving') state.myLeaveId = res.spot.id;
      await loadSpots();
      showToast(
        t('+' + res.reward + ' Polza — misto na karti!', '+' + res.reward + ' Polza — spot on map!'),
        'success'
      );
    } catch (ex) {
      showToast(ex.message, 'error');
    }
    setMarkMode(false);
  }

  function onMapClick(e) {
    if (!state.markMode) return;
    if (!requireAuth()) return;
    showTempPin(e.latlng);
    var action = $('mark-action').value;
    if (action === 'open') {
      postSpotAt(e.latlng, 'open', 480);
    } else if (action === 'leave') {
      postSpotAt(e.latlng, 'leaving', LEAVE_SECONDS);
    }
  }

  async function claimSpot(id) {
    if (!requireAuth()) return;
    try {
      var res = await SlobodnoApi.claimSpot(id);
      state.points = res.points;
      updatePointsUI(true);
      await loadSpots();
      highlightSpot(id);
      showToast(t('Misto rezervirano!', 'Spot claimed!'), 'success');
    } catch (ex) {
      showToast(ex.message, 'error');
    }
  }

  async function startLeaveCountdown() {
    if (!requireAuth()) return;
    if (state.myLeaveId) {
      showToast(t('Već si označio odlazak.', 'You already marked leaving.'), 'error');
      return;
    }
    setMarkMode(true);
    $('mark-action').value = 'leave';
    showToast(t('Klikni na kartu gdje parkiraš.', 'Click the map where you park.'), '');
  }

  function finishLeave() {
    clearInterval(state.leaveInterval);
    clearTimeout(state.leaveTimer);
    state.leaveInterval = null;
    state.leaveTimer = null;
    state.myLeaveId = null;
    $('leave-countdown').hidden = true;
    $('btn-cancel-leave').hidden = true;
    $('btn-leave').disabled = false;
  }

  function cancelLeave() {
    finishLeave();
    setMarkMode(false);
    showToast(t('Odlazak otkazan.', 'Leave cancelled.'), '');
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
    myMarker.on('dragend', function () { renderSpotList(); });

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

    setTimeout(function () { map.invalidateSize(); }, 150);
    window.addEventListener('resize', function () { if (map) map.invalidateSize(); });
  }

  async function init() {
    initMap();
    await refreshUser();
    if (!state.user) {
      location.href = 'login.html?next=main.html';
      return;
    }
    await loadSpots();
    updatePointsUI(false);
    setInterval(loadSpots, 20000);
  }

  document.querySelectorAll('.mode-tab').forEach(function (tab) {
    tab.addEventListener('click', function () { setMode(tab.getAttribute('data-mode')); });
  });

  $('btn-leave').addEventListener('click', startLeaveCountdown);
  $('btn-cancel-leave').addEventListener('click', cancelLeave);
  $('btn-report').addEventListener('click', function () {
    if (!requireAuth()) return;
    setMarkMode(true);
    $('mark-action').value = 'open';
    showToast(t('Klikni na kartu — slobodno misto.', 'Click the map — free spot.'), '');
  });
  $('btn-map-mark').addEventListener('click', function () {
    setMarkMode(!state.markMode);
  });

  $('btn-logout').addEventListener('click', async function () {
    await SlobodnoApi.logout();
    location.href = 'login.html';
  });

  document.querySelectorAll('.redeem-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      if (!requireAuth()) return;
      var id = btn.getAttribute('data-id');
      try {
        var res = await SlobodnoApi.redeem(id);
        state.points = res.points;
        updatePointsUI(true);
        showToast(res.reward + ' ✓', 'success');
      } catch (ex) {
        showToast(ex.message, 'error');
      }
    });
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
