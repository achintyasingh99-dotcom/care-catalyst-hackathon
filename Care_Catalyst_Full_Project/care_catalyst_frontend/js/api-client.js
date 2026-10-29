/* Care Catalyst API client. Uses same-origin HttpOnly session cookies. */
(function (global) {
  "use strict";
  var COLLECTIONS = { patients: true, assessments: true, entries: true, followups: true };

  function request(path, options) {
    options = options || {};
    var headers = Object.assign({ Accept: "application/json" }, options.headers || {});
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    return fetch(path, {
      method: options.method || "GET",
      headers: headers,
      credentials: "same-origin",
      cache: "no-store",
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    }).then(function (response) {
      return response.text().then(function (text) {
        var payload = {};
        if (text) {
          try { payload = JSON.parse(text); }
          catch (error) { throw new Error("The server returned an unreadable response."); }
        }
        if (!response.ok) throw new Error(payload.error || ("Request failed (" + response.status + ")."));
        return payload;
      });
    });
  }

  var api = {
    health: function () { return request("/api/health"); },
    me: function () { return request("/api/me"); },
    register: function (username, password) {
      return request("/api/register", { method: "POST", body: { username: username, password: password } });
    },
    login: function (username, password) {
      return request("/api/login", { method: "POST", body: { username: username, password: password } });
    },
    logout: function () { return request("/api/logout", { method: "POST", body: {} }); },
    list: function (collection) {
      if (!COLLECTIONS[collection]) return Promise.reject(new Error("Unknown record collection."));
      return request("/api/" + collection).then(function (result) { return result.items || []; });
    },
    get: function (collection, recordId) {
      if (!COLLECTIONS[collection] || !recordId) return Promise.reject(new Error("A valid collection and record ID are required."));
      return request("/api/" + collection + "/" + encodeURIComponent(recordId)).then(function (result) { return result.item; });
    },
    save: function (collection, record) {
      if (!COLLECTIONS[collection]) return Promise.reject(new Error("Unknown record collection."));
      if (!record || typeof record !== "object") return Promise.reject(new Error("A record is required."));
      return request("/api/" + collection, { method: "POST", body: record }).then(function (result) { return result.item; });
    },
    remove: function (collection, recordId) {
      if (!COLLECTIONS[collection] || !recordId) return Promise.reject(new Error("A valid collection and record ID are required."));
      return request("/api/" + collection + "/" + encodeURIComponent(recordId), { method: "DELETE" });
    },
    requireSession: function (redirectTo) {
      return api.me().catch(function (error) {
        if (error && /sign in/i.test(error.message || "")) {
          var target = redirectTo || "auth.html";
          if (window.location.pathname.split("/").pop() !== target) window.location.href = target;
        }
        throw error;
      });
    }
  };
  global.CareCatalystAPI = api;
})(window);
