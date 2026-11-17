/**
 * RtvUx — util UI lintas halaman yang dipakai app.js & semua views:
 *   - Mode gelap (tersimpan di localStorage, aman kalau storage diblokir)
 *   - Lonceng notifikasi (poll berkala + badge jumlah belum dibaca)
 *   - Pemilih foto bukti (ambil dari galeri/kamera HP, dikompres ke data-URL)
 *   - Pencarian tabel sisi-klien (debounce kecil)
 *   - Format ukuran umur stok (badge level: normal/perhatian/kritis)
 */
var RtvUx = (function () {
  "use strict";

  // ---------------- Storage aman (private browsing bisa menolak) ----------------
  function safeGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, val) {
    try { window.localStorage.setItem(key, val); } catch (e) { /* diabaikan */ }
  }

  // ---------------- Mode gelap ----------------
  var THEME_KEY = "rtv_theme";

  function applyTheme(theme) {
    document.body.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
  }

  function initTheme() {
    var saved = safeGet(THEME_KEY);
    if (!saved && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      saved = "dark";
    }
    applyTheme(saved || "light");
  }

  function toggleTheme() {
    var next = document.body.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
    safeSet(THEME_KEY, next);
    return next;
  }

  function currentTheme() {
    return document.body.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  // ---------------- Lonceng notifikasi ----------------
  var notifPollTimer = null;

  function buildNotifBell() {
    var badge = RtvUI.el("span", { class: "rtv-notif-badge", style: { display: "none" } }, ["0"]);
    var btn = RtvUI.el("button", { class: "rtv-icon-btn", type: "button", title: "Notifikasi", "aria-label": "Notifikasi" }, [
      RtvUI.el("i", { class: "fa-solid fa-bell" }),
      badge,
    ]);
    var panel = RtvUI.el("div", { class: "rtv-notif-panel" }, [RtvUI.pageLoading()]);
    var wrap = RtvUI.el("div", { class: "rtv-notif-wrap" }, [btn, panel]);

    var open = false;
    function setOpen(v) {
      open = v;
      wrap.classList.toggle("open", open);
      if (open) loadPanel();
    }
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      setOpen(!open);
    });
    document.addEventListener("click", function (e) {
      if (open && !wrap.contains(e.target)) setOpen(false);
    });

    function renderBadge(unread) {
      if (unread > 0) {
        badge.textContent = unread > 9 ? "9+" : String(unread);
        badge.style.display = "";
      } else {
        badge.style.display = "none";
      }
    }

    function loadPanel() {
      RtvUI.mount(panel, RtvUI.pageLoading());
      RtvApi.get("/api/x/notif")
        .then(function (data) {
          renderBadge(data.unread || 0);
          var items = data.items || [];
          if (!items.length) {
            RtvUI.mount(panel, RtvUI.el("div", { class: "rtv-notif-empty" }, ["Belum ada notifikasi."]));
            return;
          }
          var list = RtvUI.el("div", { class: "rtv-notif-list" });
          items.forEach(function (n) {
            var row = RtvUI.el("div", { class: "rtv-notif-item" + (n.baru ? " unread" : "") + (n.link ? " clickable" : "") }, [
              RtvUI.el("div", { class: "rtv-notif-item-title" }, [n.title]),
              RtvUI.el("div", { class: "rtv-notif-item-text" }, [n.text]),
              RtvUI.el("div", { class: "rtv-notif-item-time" }, [rtvFormatDateTime(n.tgl)]),
            ]);
            if (n.link) {
              row.addEventListener("click", function () {
                setOpen(false);
                RtvUI.router.navigate(n.link);
              });
            }
            list.appendChild(row);
          });
          RtvUI.mount(panel, list);
        })
        .catch(function () {
          RtvUI.mount(panel, RtvUI.el("div", { class: "rtv-notif-empty" }, ["Gagal memuat notifikasi."]));
        });
      RtvApi.post("/api/x/notif/baca").then(function () {
        // Badge dibersihkan setelah panel sempat terlihat sebentar.
      }).catch(function () {});
    }

    function pollBadge() {
      RtvApi.get("/api/x/notif")
        .then(function (data) { renderBadge(data.unread || 0); })
        .catch(function () {});
    }

    pollBadge();
    if (notifPollTimer) clearInterval(notifPollTimer);
    notifPollTimer = setInterval(pollBadge, 45000);

    return wrap;
  }

  function stopNotifPolling() {
    if (notifPollTimer) {
      clearInterval(notifPollTimer);
      notifPollTimer = null;
    }
  }

  // ---------------- Pemilih foto bukti ----------------
  var MAX_PHOTO_DIM = 1280;
  var JPEG_QUALITY = 0.72;

  function compressImageFile(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("Gagal membaca file.")); };
      reader.onload = function () {
        img.onerror = function () { reject(new Error("File bukan gambar yang valid.")); };
        img.onload = function () {
          var w = img.naturalWidth, h = img.naturalHeight;
          var scale = Math.min(1, MAX_PHOTO_DIM / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement("canvas");
          canvas.width = cw;
          canvas.height = ch;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, cw, ch);
          try {
            resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
          } catch (e) {
            reject(e);
          }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /**
   * Komponen pemilih foto. opts: { max: 3 }
   * Mengembalikan { el, getPhotos(), clear(), count() }
   */
  function photoPicker(opts) {
    opts = opts || {};
    var max = opts.max || 3;
    var photos = [];

    var grid = RtvUI.el("div", { class: "rtv-photo-grid" });
    var fileInput = RtvUI.el("input", {
      type: "file", accept: "image/*", multiple: true, style: { display: "none" },
      onchange: function () {
        var files = Array.prototype.slice.call(fileInput.files || []);
        fileInput.value = "";
        handleFiles(files);
      },
    });
    var addBtn = RtvUI.el("button", {
      type: "button", class: "rtv-photo-add",
      onclick: function () { fileInput.click(); },
    }, [RtvUI.el("i", { class: "fa-solid fa-camera" }), RtvUI.el("span", {}, ["Tambah Foto"])]);
    var errorEl = RtvUI.el("div", { class: "rtv-field-error" });

    function render() {
      RtvUI.clear(grid);
      photos.forEach(function (src, idx) {
        var thumb = RtvUI.el("div", { class: "rtv-photo-thumb" }, [
          RtvUI.el("img", { src: src, alt: "Foto bukti " + (idx + 1) }),
          RtvUI.el("button", {
            type: "button", class: "rtv-photo-remove", "aria-label": "Hapus foto",
            onclick: function () { photos.splice(idx, 1); render(); },
          }, [RtvUI.el("i", { class: "fa-solid fa-xmark" })]),
        ]);
        grid.appendChild(thumb);
      });
      if (photos.length < max) grid.appendChild(addBtn);
    }

    function handleFiles(files) {
      errorEl.textContent = "";
      var room = max - photos.length;
      if (room <= 0) {
        errorEl.textContent = "Maksimal " + max + " foto.";
        return;
      }
      files.slice(0, room).forEach(function (file) {
        if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
          errorEl.textContent = "Hanya file JPG, PNG, atau WEBP yang didukung.";
          return;
        }
        compressImageFile(file)
          .then(function (dataUrl) {
            photos.push(dataUrl);
            render();
          })
          .catch(function () {
            errorEl.textContent = "Gagal memproses salah satu foto.";
          });
      });
    }

    render();
    var wrap = RtvUI.el("div", { class: "rtv-photo-picker" }, [grid, errorEl, fileInput]);

    return {
      el: wrap,
      getPhotos: function () { return photos.slice(); },
      clear: function () { photos = []; render(); },
      count: function () { return photos.length; },
    };
  }

  // ---------------- Badge umur stok karantina ----------------
  function agingBadge(level, umurHari) {
    var map = {
      kritis: { cls: "rtv-aging-kritis", label: "Kritis" },
      perhatian: { cls: "rtv-aging-perhatian", label: "Perhatian" },
      normal: { cls: "rtv-aging-normal", label: "Normal" },
    };
    var m = map[level] || map.normal;
    return "<span class='rtv-aging-badge " + m.cls + "'>" + m.label + " · " + umurHari + " hari</span>";
  }

  // ---------------- Ekspor CSV sederhana (tanpa dependency) ----------------
  function exportCsv(filename, rows, columns) {
    if (!rows || !rows.length) {
      RtvUI.toast("Tidak ada data untuk diekspor.", "info");
      return;
    }
    function esc(v) {
      var s = v === undefined || v === null ? "" : String(v);
      if (/[",\n;]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    var header = columns.map(function (c) { return esc(c.header); }).join(";");
    var lines = rows.map(function (r) {
      return columns.map(function (c) { return esc(typeof c.value === "function" ? c.value(r) : r[c.key]); }).join(";");
    });
    var csv = "﻿" + [header].concat(lines).join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  // ---------------- Pencarian tabel sisi-klien (debounce) ----------------
  function debounce(fn, wait) {
    var t = null;
    return function () {
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(null, args); }, wait || 300);
    };
  }

  return {
    initTheme: initTheme,
    toggleTheme: toggleTheme,
    currentTheme: currentTheme,
    buildNotifBell: buildNotifBell,
    stopNotifPolling: stopNotifPolling,
    photoPicker: photoPicker,
    agingBadge: agingBadge,
    exportCsv: exportCsv,
    debounce: debounce,
  };
})();