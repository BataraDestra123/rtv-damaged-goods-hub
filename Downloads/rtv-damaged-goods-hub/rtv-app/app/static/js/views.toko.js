/**
 * Views untuk role Staff Toko:
 *  - Ringkasan (dashboard kecil)
 *  - Ajukan Retur Barang Rusak
 *  - Lihat Status Pengajuan Toko + Batalkan (selama Pending)
 * Vanilla JS, tanpa Webix.
 */
var RtvToko = (function () {
  function mapRtvRow(it) {
    it.product_nama = it.product ? it.product.nama_produk : "-";
    return it;
  }

  function kpiCard(icon, color, label, value) {
    return RtvUI.el("div", { class: "rtv-kpi-card" }, [
      RtvUI.el("div", { class: "rtv-kpi-icon", style: { background: color } }, [RtvUI.el("i", { class: "fa-solid " + icon })]),
      RtvUI.el("div", { class: "rtv-kpi-body" }, [
        RtvUI.el("div", { class: "rtv-kpi-value" }, [String(value)]),
        RtvUI.el("div", { class: "rtv-kpi-label" }, [label]),
      ]),
    ]);
  }

  // ---------------- Ringkasan ----------------
  function renderRingkasan(container) {
    var kpiGrid = RtvUI.el("div", { class: "rtv-kpi-grid" }, [
      kpiCard("fa-hourglass-half", "var(--rtv-yellow)", "Pending", "0"),
      kpiCard("fa-dolly", "var(--rtv-blue)", "Received", "0"),
      kpiCard("fa-circle-check", "var(--rtv-green)", "Approved", "0"),
      kpiCard("fa-circle-xmark", "var(--rtv-red)", "Rejected", "0"),
    ]);

    var tableCard = RtvUI.el("div", { class: "rtv-card" }, [
      RtvUI.el("div", { class: "rtv-card-header" }, [RtvUI.el("h3", {}, ["RTV Terbaru"])]),
      RtvUI.el("div", { id: "toko-ringkasan-table-wrap" }, [RtvUI.pageLoading()]),
    ]);

    RtvUI.mount(container, RtvUI.el("div", {}, [kpiGrid, tableCard]));

    RtvApi.get("/api/dashboard/summary")
      .then(function (data) {
        var c = data.status_counts || {};
        var vals = kpiGrid.querySelectorAll(".rtv-kpi-value");
        vals[0].textContent = c.Pending || 0;
        vals[1].textContent = c.Received || 0;
        vals[2].textContent = c.Approved || 0;
        vals[3].textContent = c.Rejected || 0;
      })
      .catch(rtvHandleError);

    RtvApi.get("/api/toko/retur")
      .then(function (data) {
        var rows = (data.items || []).slice(0, 20).map(mapRtvRow);
        var table = RtvUI.renderTableHtml({
          columns: [
            { header: "No. RTV", render: function (r) { return RtvUI.escapeHtml(r.no_rtv); }, width: "150px" },
            { header: "Produk", render: function (r) { return RtvUI.escapeHtml(r.product_nama); } },
            { header: "Qty", render: function (r) { return r.qty_diajukan; }, width: "70px" },
            { header: "Status", render: function (r) { return rtvStatusBadge(r.status); }, width: "180px" },
            { header: "Tanggal", render: function (r) { return rtvFormatDate(r.tgl_input); }, width: "150px" },
          ],
          rows: rows,
          emptyText: "Belum ada pengajuan retur.",
        });
        RtvUI.mount(document.getElementById("toko-ringkasan-table-wrap"), table);
      })
      .catch(rtvHandleError);
  }

  // ---------------- Ajukan Retur ----------------
  function renderAjukan(container) {
    var produkSelect = RtvUI.el("select", { name: "product_id" }, [RtvUI.el("option", { value: "" }, ["Memuat produk..."])]);
    var qtyInput = RtvUI.el("input", { type: "number", name: "qty_diajukan", min: "1", value: "1" });
    var alasanInput = RtvUI.el("textarea", { name: "alasan", rows: "4", placeholder: "Jelaskan kondisi kerusakan barang..." });
    var errorEl = RtvUI.el("div", { class: "rtv-field-error" });
    var submitBtn = RtvUI.el("button", { type: "submit", class: "rtv-btn rtv-btn-primary" }, [RtvUI.el("i", { class: "fa-solid fa-paper-plane" }), " Ajukan Retur"]);

    var form = RtvUI.el(
      "form",
      {
        onsubmit: function (e) {
          e.preventDefault();
          submitAjukan();
        },
      },
      [
        RtvUI.el("div", { class: "rtv-form-grid" }, [
          RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, ["Produk"]), produkSelect]),
          RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, ["Qty Diajukan"]), qtyInput]),
        ]),
        RtvUI.el("div", { class: "rtv-field", style: { marginTop: "16px" } }, [RtvUI.el("label", {}, ["Alasan Kerusakan"]), alasanInput]),
        errorEl,
        RtvUI.el("div", { class: "rtv-form-actions" }, [
          submitBtn,
          RtvUI.el("button", {
            type: "button", class: "rtv-btn rtv-btn-ghost",
            onclick: function () { form.reset(); errorEl.textContent = ""; },
          }, ["Bersihkan Form"]),
        ]),
      ]
    );

    var card = RtvUI.el("div", { class: "rtv-card" }, [
      RtvUI.el("div", { class: "rtv-card-header" }, [RtvUI.el("h3", {}, ["Form Pengajuan Retur Barang Rusak"])]),
      form,
    ]);

    RtvUI.mount(container, card);

    RtvApi.get("/api/produk")
      .then(function (data) {
        RtvUI.clear(produkSelect);
        produkSelect.appendChild(RtvUI.el("option", { value: "" }, ["Pilih produk..."]));
        (data.items || []).forEach(function (p) {
          produkSelect.appendChild(RtvUI.el("option", { value: p._id }, [p.nama_produk + " (" + p.barcode + ")"]));
        });
      })
      .catch(rtvHandleError);

    function submitAjukan() {
      errorEl.textContent = "";
      var productId = produkSelect.value;
      var qty = Number(qtyInput.value || 0);
      var alasan = alasanInput.value.trim();

      if (!productId) { errorEl.textContent = "Pilih produk terlebih dahulu."; return; }
      if (!qty || qty < 1) { errorEl.textContent = "Qty diajukan harus lebih dari 0."; return; }
      if (!alasan) { errorEl.textContent = "Alasan kerusakan wajib diisi."; return; }

      submitBtn.disabled = true;
      RtvApi.post("/api/toko/retur", { product_id: productId, qty_diajukan: qty, alasan: alasan })
        .then(function (data) {
          RtvUI.toast("Retur " + data.item.no_rtv + " berhasil diajukan (status Pending).", "success");
          form.reset();
          qtyInput.value = "1";
        })
        .catch(function (err) {
          errorEl.textContent = err.message;
        })
        .finally(function () { submitBtn.disabled = false; });
    }
  }

  // ---------------- Lihat Status / Batalkan ----------------
  var STATUS_OPTIONS = ["", "Pending", "Received", "Approved", "Rejected", "Shipped to Supplier", "Completed", "Cancelled"];

  function renderStatus(container) {
    var filterSelect = RtvUI.el("select", {}, STATUS_OPTIONS.map(function (s) {
      return RtvUI.el("option", { value: s }, [s || "Semua Status"]);
    }));
    filterSelect.addEventListener("change", function () { loadStatus(); });

    var reloadBtn = RtvUI.el("button", { type: "button", class: "rtv-btn rtv-btn-ghost rtv-btn-sm", onclick: function () { loadStatus(); } }, [
      RtvUI.el("i", { class: "fa-solid fa-rotate-right" }), " Muat Ulang",
    ]);

    var tableWrap = RtvUI.el("div", {}, [RtvUI.pageLoading()]);

    var card = RtvUI.el("div", { class: "rtv-card" }, [
      RtvUI.el("div", { class: "rtv-card-header" }, [
        RtvUI.el("h3", {}, ["Status Pengajuan Toko Saya"]),
        RtvUI.el("div", { class: "rtv-card-toolbar" }, [filterSelect, reloadBtn]),
      ]),
      tableWrap,
    ]);

    RtvUI.mount(container, card);
    loadStatus();

    function loadStatus() {
      var status = filterSelect.value;
      var url = "/api/toko/retur" + (status ? "?status=" + encodeURIComponent(status) : "");
      RtvUI.mount(tableWrap, RtvUI.pageLoading());
      RtvApi.get(url)
        .then(function (data) {
          var rows = (data.items || []).map(mapRtvRow);
          var table = RtvUI.renderTableHtml({
            columns: [
              { header: "No. RTV", render: function (r) { return RtvUI.escapeHtml(r.no_rtv); }, width: "140px" },
              { header: "Produk", render: function (r) { return RtvUI.escapeHtml(r.product_nama); } },
              { header: "Qty Ajuan", render: function (r) { return r.qty_diajukan; }, width: "90px" },
              { header: "Qty Terima", render: function (r) { return r.qty_diterima == null ? "-" : r.qty_diterima; }, width: "90px" },
              { header: "Status", render: function (r) { return rtvStatusBadge(r.status); }, width: "180px" },
              { header: "Tgl Ajuan", render: function (r) { return rtvFormatDate(r.tgl_input); }, width: "130px" },
              {
                header: "Aksi", width: "190px",
                render: function (r) {
                  var html = "<button type='button' class='rtv-link-btn' data-action='riwayat' data-id='" + r._id + "'>Riwayat</button>";
                  if (r.status === "Pending") {
                    html += "<button type='button' class='rtv-link-btn danger' data-action='batal' data-id='" + r._id + "'>Batalkan</button>";
                  }
                  return html;
                },
              },
            ],
            rows: rows,
            emptyText: "Tidak ada data untuk filter ini.",
            onRowAction: function (action, id) {
              var row = rows.find(function (r) { return r._id === id; });
              if (!row) return;
              if (action === "batal") confirmBatalkan(row);
              if (action === "riwayat") rtvOpenRiwayatModal(row._id, row.no_rtv);
            },
          });
          RtvUI.mount(tableWrap, table);
        })
        .catch(rtvHandleError);
    }

    function confirmBatalkan(row) {
      RtvUI.confirmDialog({
        title: "Batalkan Pengajuan",
        text: "Batalkan retur " + row.no_rtv + "? Tindakan ini tidak dapat dibatalkan.",
        okText: "Ya, Batalkan",
        danger: true,
      }).then(function (ok) {
        if (!ok) return;
        RtvApi.post("/api/toko/retur/" + row._id + "/batalkan")
          .then(function () {
            RtvUI.toast("Pengajuan berhasil dibatalkan.", "success");
            loadStatus();
          })
          .catch(rtvHandleError);
      });
    }
  }

  return {
    renderRingkasan: renderRingkasan,
    renderAjukan: renderAjukan,
    renderStatus: renderStatus,
  };
})();