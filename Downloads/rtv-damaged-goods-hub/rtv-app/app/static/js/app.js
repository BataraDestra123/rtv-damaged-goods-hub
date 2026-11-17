/**
 * Shell utama aplikasi: login gate, topbar (notifikasi + mode gelap),
 * sidebar menu per role, dan konten yang berpindah lewat hash router.
 * Vanilla JS, tanpa Webix. Dipasang ke <div id="app-root">.
 */
var RtvApp = (function () {
  var currentUser = null;
  var contentEl = null;
  var navItemEls = {};
  var pageTitleEl = null;
  var themeBtnIconEl = null;

  var MENU_BY_ROLE = {
    staff_toko: [
      { id: "toko-ringkasan", label: "Ringkasan", icon: "fa-gauge-high", render: function (c) { return RtvToko.renderRingkasan(c); } },
      { id: "toko-ajukan", label: "Ajukan Retur", icon: "fa-square-plus", render: function (c) { return RtvToko.renderAjukan(c); } },
      { id: "toko-status", label: "Status Pengajuan", icon: "fa-list-check", render: function (c) { return RtvToko.renderStatus(c); } },
    ],
    staff_gudang: [
      { id: "gudang-pending", label: "Retur Pending", icon: "fa-inbox", render: function (c) { return RtvGudang.renderPending(c); } },
      { id: "gudang-stok", label: "Stok & Umur Karantina", icon: "fa-warehouse", render: function (c) { return RtvGudang.renderStok(c); } },
      { id: "gudang-packing", label: "Packing List", icon: "fa-box-open", render: function (c) { return RtvGudang.renderPackingList(c); } },
    ],
    admin: [
      { id: "admin-dashboard", label: "Dashboard", icon: "fa-gauge-high", render: function (c) { return RtvAdmin.renderDashboard(c); } },
      { id: "admin-verifikasi", label: "Verifikasi RTV", icon: "fa-check-double", render: function (c) { return RtvAdmin.renderVerifikasi(c); } },
      { id: "admin-surat-jalan", label: "Surat Jalan", icon: "fa-truck", render: function (c) { return RtvAdmin.renderSuratJalan(c); } },
      { id: "admin-master", label: "Master Data", icon: "fa-database", render: function (c) { return RtvAdmin.renderMasterData(c); } },
      { id: "admin-karyawan", label: "Karyawan", icon: "fa-users", render: function (c) { return RtvAdmin.renderKaryawan(c); } },
      { id: "admin-laporan", label: "Laporan & Log", icon: "fa-chart-column", render: function (c) { return RtvAdmin.renderLaporan(c); } },
    ],
  };

  function initials(name) {
    var parts = String(name || "?").trim().split(/\s+/);
    var a = (parts[0] || "?")[0] || "?";
    var b = parts.length > 1 ? (parts[parts.length - 1][0] || "") : "";
    return (a + b).toUpperCase();
  }

  function showLogin() {
    currentUser = null;
    RtvUx.stopNotifPolling();
    var root = document.getElementById("app-root");
    RtvUI.mount(root, RtvLogin.getUi(onLoginSuccess));
  }

  function onLoginSuccess(user) {
    currentUser = user;
    renderShell();
  }

  function setActiveNav(id) {
    Object.keys(navItemEls).forEach(function (key) {
      navItemEls[key].classList.toggle("active", key === id);
    });
  }

  function closeSidebarMobile() {
    var sidebar = document.getElementById("rtv-sidebar");
    var backdrop = document.getElementById("rtv-sidebar-backdrop");
    if (sidebar) sidebar.classList.remove("open");
    if (backdrop) backdrop.classList.remove("open");
  }

  function appName() { return (window.RTV_APP && window.RTV_APP.name) || "RTV & Damaged Goods Hub"; }
  function appShortName() { return (window.RTV_APP && window.RTV_APP.shortName) || "RTV Hub"; }
  function appSubtitle() { return (window.RTV_APP && window.RTV_APP.subtitle) || "Damaged Goods"; }

  function renderShell() {
    var role = currentUser.role;
    var menu = MENU_BY_ROLE[role] || [];
    navItemEls = {};

    // ---- Sidebar ----
    var navSection = RtvUI.el("div", { class: "rtv-nav" });
    menu.forEach(function (item) {
      var navEl = RtvUI.el(
        "div",
        {
          class: "rtv-nav-item",
          onclick: function () {
            RtvUI.router.navigate(item.id);
            closeSidebarMobile();
          },
        },
        [RtvUI.el("i", { class: "fa-solid " + item.icon }), RtvUI.el("span", {}, [item.label])]
      );
      navItemEls[item.id] = navEl;
      navSection.appendChild(navEl);
    });

    var sidebar = RtvUI.el("aside", { class: "rtv-sidebar", id: "rtv-sidebar" }, [
      RtvUI.el("div", { class: "rtv-sidebar-brand" }, [
        RtvUI.el("div", { class: "rtv-logo-badge" }, [RtvUI.el("i", { class: "fa-solid fa-boxes-stacked" })]),
        RtvUI.el("div", {}, [
          RtvUI.el("strong", {}, [appShortName()]),
          RtvUI.el("span", {}, [appSubtitle()]),
        ]),
      ]),
      navSection,
      RtvUI.el("div", { class: "rtv-sidebar-footer" }, [appName(), RtvUI.el("br"), "v2.0 — " + new Date().getFullYear()]),
    ]);

    var backdrop = RtvUI.el("div", {
      class: "rtv-sidebar-backdrop", id: "rtv-sidebar-backdrop",
      onclick: closeSidebarMobile,
    });

    // ---- Topbar ----
    pageTitleEl = RtvUI.el("h1", { class: "rtv-page-title" }, [menu.length ? menu[0].label : ""]);

    themeBtnIconEl = RtvUI.el("i", { class: "fa-solid " + (RtvUx.currentTheme() === "dark" ? "fa-sun" : "fa-moon") });
    var themeBtn = RtvUI.el("button", {
      class: "rtv-icon-btn", type: "button", title: "Ganti tampilan terang/gelap",
      onclick: function () {
        var next = RtvUx.toggleTheme();
        themeBtnIconEl.className = "fa-solid " + (next === "dark" ? "fa-sun" : "fa-moon");
      },
    }, [themeBtnIconEl]);

    var topbarRightChildren = [
      themeBtn,
      RtvUx.buildNotifBell(),
      RtvUI.el("div", { class: "rtv-user-chip" }, [
        RtvUI.el("div", { class: "rtv-user-avatar" }, [initials(currentUser.nama)]),
        RtvUI.el("div", { class: "rtv-user-meta" }, [
          RtvUI.el("strong", {}, [currentUser.nama]),
          RtvUI.el("span", {}, [RTV_ROLE_LABEL[currentUser.role] || currentUser.role]),
        ]),
      ]),
      RtvUI.el("button", {
        class: "rtv-icon-btn", type: "button", title: "Keluar", onclick: doLogout,
      }, [RtvUI.el("i", { class: "fa-solid fa-right-from-bracket" })]),
    ];

    var topbar = RtvUI.el("header", { class: "rtv-topbar" }, [
      RtvUI.el("div", { class: "rtv-topbar-left" }, [
        RtvUI.el("button", {
          class: "rtv-hamburger", type: "button", "aria-label": "Menu",
          onclick: function () {
            document.getElementById("rtv-sidebar").classList.toggle("open");
            document.getElementById("rtv-sidebar-backdrop").classList.toggle("open");
          },
        }, [RtvUI.el("i", { class: "fa-solid fa-bars" })]),
        pageTitleEl,
      ]),
      RtvUI.el("div", { class: "rtv-topbar-right" }, topbarRightChildren),
    ]);

    contentEl = RtvUI.el("div", { class: "rtv-content", id: "rtv-content" });

    var main = RtvUI.el("div", { class: "rtv-main" }, [topbar, contentEl]);
    var shell = RtvUI.el("div", { class: "rtv-shell" }, [sidebar, backdrop, main]);

    RtvUI.mount(document.getElementById("app-root"), shell);

    // ---- Router wiring ----
    menu.forEach(function (item) {
      RtvUI.router.register(item.id, function () {
        setActiveNav(item.id);
        pageTitleEl.textContent = item.label;
        RtvUI.mount(contentEl, RtvUI.pageLoading());
        try {
          item.render(contentEl);
        } catch (e) {
          console.error(e);
          RtvUI.toast("Gagal memuat halaman.", "error");
        }
      });
    });
    if (menu.length) RtvUI.router.setDefault(menu[0].id);

    if (!RtvApp._routerInited) {
      RtvUI.router.init();
      RtvApp._routerInited = true;
    }
    RtvUI.router.dispatch();
  }

  function doLogout() {
    RtvUI.confirmDialog({ title: "Keluar", text: "Yakin ingin keluar dari aplikasi?", okText: "Ya, Keluar" }).then(function (ok) {
      if (!ok) return;
      RtvApi.post("/api/auth/logout").finally(function () {
        window.location.hash = "";
        showLogin();
      });
    });
  }

  function bootstrap() {
    RtvUx.initTheme();
    RtvApi.get("/api/auth/me")
      .then(function (data) {
        currentUser = data.user;
        renderShell();
      })
      .catch(function () {
        showLogin();
      });
  }

  return { showLogin: showLogin, bootstrap: bootstrap, _routerInited: false };
})();

document.addEventListener("DOMContentLoaded", function () {
  RtvApp.bootstrap();
});