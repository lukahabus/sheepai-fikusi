(function (global) {
  'use strict';

  async function request(path, options) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options && options.headers) },
      ...options
    });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      const err = new Error(data.error || res.statusText);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  global.SlobodnoApi = {
    me: function () { return request('/api/auth/me'); },
    login: function (email, password) {
      return request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
    },
    register: function (email, password, name) {
      return request('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name })
      });
    },
    logout: function () {
      return request('/api/auth/logout', { method: 'POST' });
    },
    getSpots: function () { return request('/api/spots'); },
    createSpot: function (payload) {
      return request('/api/spots', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    },
    claimSpot: function (id) {
      return request('/api/spots/' + encodeURIComponent(id), { method: 'POST' });
    },
    redeem: function (rewardId) {
      return request('/api/redeem', {
        method: 'POST',
        body: JSON.stringify({ rewardId })
      });
    },
    adminUsers: function () { return request('/api/admin/users'); },
    adminSetPoints: function (userId, points) {
      return request('/api/admin/users', {
        method: 'PATCH',
        body: JSON.stringify({ userId, points })
      });
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
