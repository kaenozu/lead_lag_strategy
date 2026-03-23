'use strict';

(function initApiClient(globalObj) {
  async function getJson(url, options = {}) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  async function postJson(url, body, options = {}) {
    return getJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      body: JSON.stringify(body),
      ...options
    });
  }

  globalObj.apiClient = {
    getJson,
    postJson
  };
})(window);

