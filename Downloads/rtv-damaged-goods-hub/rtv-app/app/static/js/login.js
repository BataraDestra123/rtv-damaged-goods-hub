/**
 * Halaman Login — 3 tampilan dalam satu kartu:
 *   1. login   : username + password (Enter = submit)
 *   2. forgot  : lupa password (verifikasi username + NIK, set password baru)
 *   3. register: daftar akun baru
 * Vanilla JS, form native.
 */
var RtvLogin = (function () {
  function field(label, input) {
    return RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, [label]), input]);
  }

  function setLoading(btn, text) {
    btn.disabled = true;
    btn.innerHTML = "";
    btn.appendChild(RtvUI.spinner());
    btn.appendChild(document.createTextNode(" " + text));
  }

  function resetBtn(btn, text) {
    btn.disabled = false;
    btn.textContent = text;
  }

  function getUi(onSuccess) {
    var body = RtvUI.el("div", { class: "rtv-login-body" });

    function show(view, notice, prefillUsername) {
      RtvUI.clear(body);
      if (view === "forgot") body.appendChild(buildForgot());
      else if (view === "register") body.appendChild(buildRegister());
      else body.appendChild(buildLogin(notice, prefillUsername));
    }

    function linkBtn(text, handler) {
      return RtvUI.el("button", { type: "button", class: "rtv-login-link", onclick: handler }, [text]);
    }

    // ---------------------------------------------------------------- LOGIN
    function buildLogin(notice, prefillUsername) {
      var noticeEl = RtvUI.el("div", { class: "rtv-field-success" }, [notice || ""]);
      var errorEl = RtvUI.el("div", { class: "rtv-field-error" });
      var usernameInput = RtvUI.el("input", { type: "text", name: "username", placeholder: "contoh: staff_toko", autocomplete: "username" });
      var passwordInput = RtvUI.el("input", { type: "password", name: "password", autocomplete: "current-password" });
      var submitBtn = RtvUI.el("button", { type: "submit", class: "rtv-btn rtv-btn-primary rtv-btn-block" }, ["Masuk"]);
      if (prefillUsername) usernameInput.value = prefillUsername;

      function doLogin() {
        var username = usernameInput.value.trim();
        var password = passwordInput.value;
        errorEl.textContent = "";
        noticeEl.textContent = "";

        if (!username || !password) {
          errorEl.textContent = "Username dan password wajib diisi.";
          return;
        }

        setLoading(submitBtn, "Memproses...");
        RtvApi.post("/api/auth/login", { username: username, password: password })
          .then(function (data) {
            onSuccess(data.user);
          })
          .catch(function (err) {
            errorEl.textContent = err.message || "Login gagal.";
            resetBtn(submitBtn, "Masuk");
          });
      }

      var form = RtvUI.el(
        "form",
        {
          onsubmit: function (e) {
            e.preventDefault();
            doLogin();
          },
        },
        [
          noticeEl,
          field("Username", usernameInput),
          field("Password", passwordInput),
          errorEl,
          submitBtn,
          RtvUI.el("div", { class: "rtv-login-links" }, [
            linkBtn("Lupa password?", function () { show("forgot"); }),
          ]),
          RtvUI.el("div", { class: "rtv-login-divider" }, [RtvUI.el("span", {}, ["atau"])]),
          RtvUI.el("button", {
            type: "button",
            class: "rtv-btn rtv-btn-ghost rtv-btn-block",
            onclick: function () { show("register"); },
          }, ["Daftar akun baru"]),
        ]
      );
      return form;
    }

    // --------------------------------------------------------- LUPA PASSWORD
    function buildForgot() {
      var errorEl = RtvUI.el("div", { class: "rtv-field-error" });
      var usernameInput = RtvUI.el("input", { type: "text", autocomplete: "username", placeholder: "Username Anda" });
      var nikInput = RtvUI.el("input", { type: "text", autocomplete: "off", placeholder: "NIK terdaftar" });
      var pass1 = RtvUI.el("input", { type: "password", autocomplete: "new-password", placeholder: "Minimal 8 karakter" });
      var pass2 = RtvUI.el("input", { type: "password", autocomplete: "new-password" });
      var submitBtn = RtvUI.el("button", { type: "submit", class: "rtv-btn rtv-btn-primary rtv-btn-block" }, ["Ubah Password"]);

      function doReset() {
        errorEl.textContent = "";
        var username = usernameInput.value.trim();
        var nik = nikInput.value.trim();

        if (!username || !nik || !pass1.value || !pass2.value) {
          errorEl.textContent = "Semua kolom wajib diisi.";
          return;
        }
        if (pass1.value.length < 8) {
          errorEl.textContent = "Password baru minimal 8 karakter.";
          return;
        }
        if (pass1.value !== pass2.value) {
          errorEl.textContent = "Konfirmasi password tidak sama.";
          return;
        }

        setLoading(submitBtn, "Memproses...");
        RtvApi.post("/api/auth/reset-password", { username: username, nik: nik, new_password: pass1.value })
          .then(function (data) {
            show("login", data.message || "Password berhasil diubah.", username);
          })
          .catch(function (err) {
            errorEl.textContent = err.message || "Gagal mengubah password.";
            resetBtn(submitBtn, "Ubah Password");
          });
      }

      return RtvUI.el(
        "form",
        {
          onsubmit: function (e) {
            e.preventDefault();
            doReset();
          },
        },
        [
          RtvUI.el("h2", { class: "rtv-login-subtitle" }, ["Lupa password"]),
          RtvUI.el("p", { class: "rtv-login-desc" }, ["Masukkan username dan NIK Anda untuk membuat password baru. Jika akun admin, minta admin lain mengatur ulang lewat menu Karyawan."]),
          field("Username", usernameInput),
          field("NIK", nikInput),
          field("Password baru", pass1),
          field("Ulangi password baru", pass2),
          errorEl,
          submitBtn,
          RtvUI.el("div", { class: "rtv-login-links" }, [
            linkBtn("← Kembali ke halaman masuk", function () { show("login"); }),
          ]),
        ]
      );
    }

    // ------------------------------------------------------------- DAFTAR
    function buildRegister() {
      var errorEl = RtvUI.el("div", { class: "rtv-field-error" });
      var namaInput = RtvUI.el("input", { type: "text", autocomplete: "name", placeholder: "Nama lengkap" });
      var nikInput = RtvUI.el("input", { type: "text", autocomplete: "off", placeholder: "Huruf/angka, contoh: T0005" });
      var usernameInput = RtvUI.el("input", { type: "text", autocomplete: "username", placeholder: "3-32 karakter, tanpa spasi" });
      var pass1 = RtvUI.el("input", { type: "password", autocomplete: "new-password", placeholder: "Minimal 8 karakter" });
      var pass2 = RtvUI.el("input", { type: "password", autocomplete: "new-password" });
      var roleSelect = RtvUI.el("select", {}, [
        RtvUI.el("option", { value: "staff_toko" }, ["Staff Toko"]),
        RtvUI.el("option", { value: "staff_gudang" }, ["Staff Gudang"]),
      ]);
      var storeSelect = RtvUI.el("select", { disabled: true }, [RtvUI.el("option", { value: "" }, ["Memuat toko..."])]);
      var shiftSelect = RtvUI.el("select", { disabled: true }, [RtvUI.el("option", { value: "" }, ["Memuat shift..."])]);
      var submitBtn = RtvUI.el("button", { type: "submit", class: "rtv-btn rtv-btn-primary rtv-btn-block", disabled: true }, ["Daftar"]);

      function fillSelect(select, items, placeholder) {
        RtvUI.clear(select);
        select.appendChild(RtvUI.el("option", { value: "" }, [placeholder]));
        items.forEach(function (it) {
          var label = it.kode ? it.nama + " (" + it.kode + ")" : it.nama;
          select.appendChild(RtvUI.el("option", { value: it.id }, [label]));
        });
        select.disabled = false;
      }

      RtvApi.get("/api/auth/register-options")
        .then(function (data) {
          fillSelect(storeSelect, data.stores || [], "-- Pilih toko --");
          fillSelect(shiftSelect, data.shifts || [], "-- Tanpa shift --");
          submitBtn.disabled = false;
        })
        .catch(function () {
          errorEl.textContent = "Gagal memuat daftar toko. Muat ulang halaman lalu coba lagi.";
        });

      function doRegister() {
        errorEl.textContent = "";
        var nama = namaInput.value.trim();
        var nik = nikInput.value.trim();
        var username = usernameInput.value.trim();

        if (!nama || !nik || !username || !pass1.value || !storeSelect.value) {
          errorEl.textContent = "Nama, NIK, username, password, dan toko wajib diisi.";
          return;
        }
        if (pass1.value.length < 8) {
          errorEl.textContent = "Password minimal 8 karakter.";
          return;
        }
        if (pass1.value !== pass2.value) {
          errorEl.textContent = "Konfirmasi password tidak sama.";
          return;
        }

        setLoading(submitBtn, "Mendaftar...");
        RtvApi.post("/api/auth/register", {
          nama: nama,
          nik: nik,
          username: username,
          password: pass1.value,
          role: roleSelect.value,
          store_id: storeSelect.value,
          shift_id: shiftSelect.value || null,
        })
          .then(function (data) {
            show("login", data.message || "Pendaftaran berhasil.", username);
          })
          .catch(function (err) {
            errorEl.textContent = err.message || "Pendaftaran gagal.";
            resetBtn(submitBtn, "Daftar");
          });
      }

      return RtvUI.el(
        "form",
        {
          onsubmit: function (e) {
            e.preventDefault();
            doRegister();
          },
        },
        [
          RtvUI.el("h2", { class: "rtv-login-subtitle" }, ["Daftar akun baru"]),
          field("Nama lengkap", namaInput),
          field("NIK", nikInput),
          field("Username", usernameInput),
          field("Peran", roleSelect),
          field("Toko / lokasi", storeSelect),
          field("Shift (opsional)", shiftSelect),
          field("Password", pass1),
          field("Ulangi password", pass2),
          errorEl,
          submitBtn,
          RtvUI.el("div", { class: "rtv-login-links" }, [
            linkBtn("← Kembali ke halaman masuk", function () { show("login"); }),
          ]),
        ]
      );
    }

    // ------------------------------------------------------------- KARTU
    var card = RtvUI.el("div", { class: "rtv-login-card" }, [
      RtvUI.el("div", { class: "rtv-login-logo" }, [
        RtvUI.el("div", { class: "rtv-logo-badge" }, [RtvUI.el("i", { class: "fa-solid fa-boxes-stacked" })]),
        RtvUI.el("div", {}, [
          RtvUI.el("h1", {}, [(window.RTV_APP && window.RTV_APP.name) || "RTV & Damaged Goods Hub"]),
          RtvUI.el("p", {}, [(window.RTV_APP && window.RTV_APP.tagline) || "Masuk untuk mengelola retur barang rusak"]),
        ]),
      ]),
      body,
    ]);

    show("login");
    return RtvUI.el("div", { class: "rtv-login-screen" }, [card]);
  }

  return { getUi: getUi };
})();