/**
 * Halaman Login — input username/password, cocokkan kredensial,
 * lalu redirect ke menu sesuai role. Vanilla JS, form native (Enter = submit).
 */
var RtvLogin = (function () {
  function getUi(onSuccess) {
    var errorEl = RtvUI.el("div", { class: "rtv-field-error" });
    var usernameInput = RtvUI.el("input", { type: "text", name: "username", placeholder: "contoh: staff_toko", autocomplete: "username" });
    var passwordInput = RtvUI.el("input", { type: "password", name: "password", autocomplete: "current-password" });
    var submitBtn = RtvUI.el("button", { type: "submit", class: "rtv-btn rtv-btn-primary rtv-btn-block" }, ["Masuk"]);

    var form = RtvUI.el(
      "form",
      {
        onsubmit: function (e) {
          e.preventDefault();
          doLogin();
        },
      },
      [
        RtvUI.el("div", { class: "rtv-field" }, [
          RtvUI.el("label", {}, ["Username"]),
          usernameInput,
        ]),
        RtvUI.el("div", { class: "rtv-field" }, [
          RtvUI.el("label", {}, ["Password"]),
          passwordInput,
        ]),
        errorEl,
        submitBtn,
      ]
    );

    function doLogin() {
      var username = usernameInput.value.trim();
      var password = passwordInput.value;
      errorEl.textContent = "";

      if (!username || !password) {
        errorEl.textContent = "Username dan password wajib diisi.";
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = "";
      submitBtn.appendChild(RtvUI.spinner());
      submitBtn.appendChild(document.createTextNode(" Memproses..."));

      RtvApi.post("/api/auth/login", { username: username, password: password })
        .then(function (data) {
          onSuccess(data.user);
        })
        .catch(function (err) {
          errorEl.textContent = err.message || "Login gagal.";
          submitBtn.disabled = false;
          submitBtn.textContent = "Masuk";
        });
    }

    var card = RtvUI.el("div", { class: "rtv-login-card" }, [
      RtvUI.el("div", { class: "rtv-login-logo" }, [
        RtvUI.el("div", { class: "rtv-logo-badge" }, [RtvUI.el("i", { class: "fa-solid fa-boxes-stacked" })]),
        RtvUI.el("div", {}, [
          RtvUI.el("h1", {}, ["RTV & Damaged Goods Hub"]),
          RtvUI.el("p", {}, ["Masuk untuk mengelola retur barang rusak"]),
        ]),
      ]),
            form,
    ]);

    return RtvUI.el("div", { class: "rtv-login-screen" }, [card]);
  }

  return { getUi: getUi };
})();
