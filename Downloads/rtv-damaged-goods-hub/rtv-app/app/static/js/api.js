/**
 * Wrapper kecil di atas fetch() untuk memanggil REST API Flask.
 * Semua request menyertakan cookie session (credentials: "same-origin").
 */
var RtvApi = (function () {
  function request(method, url, body) {
    var options = {
      method: method,
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
    };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    return fetch(url, options)
      .then(function (res) {
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            if (!res.ok) {
              var err = new Error(data.message || "Terjadi kesalahan.");
              err.status = res.status;
              err.code = data.error;
              err.detail = data.detail;
              throw err;
            }
            return data;
          });
      });
  }

  return {
    get: function (url) {
      return request("GET", url);
    },
    post: function (url, body) {
      return request("POST", url, body || {});
    },
    put: function (url, body) {
      return request("PUT", url, body || {});
    },
    del: function (url) {
      return request("DELETE", url);
    },
  };
})();

function rtvHandleError(err) {
  var msg = (err && err.message) || "Terjadi kesalahan tak terduga.";
  RtvUI.toast(msg, "error", 5000);
  if (err && err.status === 401) {
    setTimeout(function () {
      if (window.RtvApp) window.RtvApp.showLogin();
    }, 400);
  }
}
