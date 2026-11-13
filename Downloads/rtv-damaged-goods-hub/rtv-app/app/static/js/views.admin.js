/**
 * Views untuk role Admin / Supervisor:
 *  - Dashboard ringkasan + peringatan stok
 *  - Verifikasi RTV (Approve / Reject)
 *  - Buat & kelola Surat Jalan ke Supplier, selesaikan klaim
 *  - Kelola Master Data (Supplier, Produk, Toko, Shift)
 *  - Kelola Karyawan (tambah/ubah/nonaktifkan/pindahkan)
 *  - Laporan rekap per supplier
 * Vanilla JS, tanpa Webix.
 */
var RtvAdmin = (function () {
  // ---------------- Generic form field builder ----------------
  function buildFormFields(fields) {
    var inputs = {};
    var wrapper = RtvUI.el("div", {});
    fields.forEach(function (f) {
      var input;
      if (f.type === "select") {
        input = RtvUI.el("select", { name: f.name }, (f.options || []).map(function (o) {
          return RtvUI.el("option", { value: o.id }, [o.value]);
        }));
      } else if (f.type === "textarea") {
        input = RtvUI.el("textarea", { name: f.name, rows: "4" });
      } else if (f.type === "checkbox") {
        input = RtvUI.el("input", { type: "checkbox", name: f.name });
        if (f.value) input.checked = true;
      } else {
        input = RtvUI.el("input", { type: f.type || "text", name: f.name, placeholder: f.placeholder || "" });
      }
      if (f.disabled) input.disabled = true;
      inputs[f.name] = input;

      var fieldWrap;
      if (f.type === "checkbox") {
        fieldWrap = RtvUI.el("div", { class: "rtv-field", style: { display: "flex", alignItems: "center", gap: "9px" } }, [
          input,
          RtvUI.el("label", { style: { margin: 0, textTransform: "none", fontWeight: "600", fontSize: "13px", color: "var(--rtv-text)" } }, [f.label]),
        ]);
      } else {
        fieldWrap = RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, [f.label]), input]);
      }
      wrapper.appendChild(fieldWrap);
    });

    return {
      wrapper: wrapper,
      getValues: function () {
        var out = {};
        fields.forEach(function (f) {
          var input = inputs[f.name];
          if (f.type === "checkbox") out[f.name] = !!input.checked;
          else if (f.type === "number") out[f.name] = input.value === "" ? null : Number(input.value);
          else out[f.name] = input.value;
        });
        return out;
      },
      setValues: function (values) {
        fields.forEach(function (f) {
          var input = inputs[f.name];
          if (values[f.name] === undefined || values[f.name] === null) return;
          if (f.type === "checkbox") input.checked = !!values[f.name];
          else input.value = values[f.name];
        });
      },
      setOptions: function (name, options) {
        var input = inputs[name];
        if (!input) return;
        RtvUI.clear(input);
        options.forEach(function (o) { input.appendChild(RtvUI.el("option", { value: o.id }, [o.value])); });
      },
      inputs: inputs,
    };
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

  // ======================================================================
  // Dashboard
  // ======================================================================
  function renderDashboard(container) {
    var kpiGrid = RtvUI.el("div", { class: "rtv-kpi-grid" }, [
      kpiCard("fa-hourglass-half", "var(--rtv-yellow)", "Pending", "0"),
      kpiCard("fa-magnifying-glass", "var(--rtv-blue)", "Menunggu Verifikasi", "0"),
      kpiCard("fa-circle-check", "var(--rtv-green)", "Approved", "0"),
      kpiCard("fa-truck", "var(--rtv-purple)", "Dikirim ke Supplier", "0"),
      kpiCard("fa-flag-checkered", "var(--rtv-teal)", "Completed", "0"),
    ]);

    var kerugianCard = RtvUI.el("div", { class: "rtv-kpi-card", style: { maxWidth: "360px" } }, [
      RtvUI.el("div", { class: "rtv-kpi-icon", style: { background: "var(--rtv-red)" } }, [RtvUI.el("i", { class: "fa-solid fa-sack-dollar" })]),
      RtvUI.el("div", { class: "rtv-kpi-body" }, [
        RtvUI.el("div", { class: "rtv-kpi-value" }, ["Rp 0"]),
        RtvUI.el("div", { class: "rtv-kpi-label" }, ["Estimasi Nilai Kerugian (non-Pending/Cancelled)"]),
      ]),
    ]);

    var tableWrap = RtvUI.el("div", {}, [RtvUI.pageLoading()]);
    var peringatanCard = RtvUI.el("div", { class: "rtv-card" }, [
      RtvUI.el("div", { class: "rtv-card-header" }, [RtvUI.el("h3", {}, ["Peringatan Stok Karantina (melebihi batas toleransi)"])]),
      tableWrap,
    ]);

    var trenChartWrap = RtvUI.el("div", {}, [RtvUI.pageLoading()]);
    var trenCard = RtvUI.el("div", { class: "rtv-card" }, [
      RtvUI.el("div", { class: "rtv-card-header" }, [RtvUI.el("h3", {}, ["Tren Retur (6 Bulan Terakhir)"])]),
      trenChartWrap,
    ]);

    var kategoriChartWrap = RtvUI.el("div", {}, [RtvUI.pageLoading()]);
    var kategoriCard = RtvUI.el("div", { class: "rtv-card" }, [
      RtvUI.el("div", { class: "rtv-card-header" }, [RtvUI.el("h3", {}, ["Distribusi Kategori Kerusakan"])]),
      kategoriChartWrap,
    ]);

    var chartRow = RtvUI.el("div", { class: "rtv-chart-row" }, [trenCard, kategoriCard]);

    RtvUI.mount(
      container,
      RtvUI.el("div", {}, [
        kpiGrid,
        kerugianCard,
        RtvUI.el("div", { style: { height: "18px" } }),
        chartRow,
        RtvUI.el("div", { style: { height: "18px" } }),
        peringatanCard,
      ])
    );

    var BULAN_SINGKAT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

    RtvApi.get("/api/dashboard/tren-status")
      .then(function (data) {
        var items = data.items || [];
        var byMonth = {};
        var order = [];
        items.forEach(function (row) {
          var key = row._id.year + "-" + row._id.month;
          if (!byMonth[key]) {
            byMonth[key] = { label: BULAN_SINGKAT[row._id.month - 1] + " " + row._id.year, value: 0 };
            order.push(key);
          }
          byMonth[key].value += row.jumlah;
        });
        var chartData = order.map(function (k) { return byMonth[k]; });
        if (!chartData.length) {
          RtvUI.mount(trenChartWrap, RtvUI.el("div", { class: "rtv-table-empty" }, ["Belum ada data retur 6 bulan terakhir."]));
          return;
        }
        RtvUI.mount(trenChartWrap, RtvUI.el("div", { html: RtvUI.barChart({ data: chartData, color: "var(--rtv-blue)" }) }));
      })
      .catch(rtvHandleError);

    RtvApi.get("/api/dashboard/kategori-kerusakan")
      .then(function (data) {
        var items = data.items || [];
        var chartData = items.map(function (r) { return { label: r.kategori, value: r.jumlah }; });
        var result = RtvUI.donutChart({ data: chartData, size: 160 });
        RtvUI.mount(
          kategoriChartWrap,
          RtvUI.el("div", { class: "rtv-donut-wrap" }, [
            RtvUI.el("div", { html: result.svg }),
            RtvUI.el("div", { class: "rtv-legend", html: result.legend }),
          ])
        );
      })
      .catch(rtvHandleError);

    RtvApi.get("/api/dashboard/summary")
      .then(function (data) {
        var c = data.status_counts || {};
        var vals = kpiGrid.querySelectorAll(".rtv-kpi-value");
        vals[0].textContent = c.Pending || 0;
        vals[1].textContent = c.Received || 0;
        vals[2].textContent = c.Approved || 0;
        vals[3].textContent = c["Shipped to Supplier"] || 0;
        vals[4].textContent = c.Completed || 0;
        kerugianCard.querySelector(".rtv-kpi-value").textContent = rtvFormatCurrency(data.total_kerugian_estimasi);

        var table = RtvUI.renderTableHtml({
          columns: [
            { header: "Produk", render: function (r) { return RtvUI.escapeHtml(r.nama_produk); } },
            { header: "Total Qty", render: function (r) { return r.total_qty; }, width: "140px" },
          ],
          rows: data.peringatan_stok || [],
          emptyText: "Tidak ada peringatan stok saat ini.",
        });
        RtvUI.mount(tableWrap, table);
      })
      .catch(rtvHandleError);
  }

  // ======================================================================
  // Verifikasi RTV
  // ======================================================================
  function mapRtvAdminRow(it) {
    it.product_nama = it.product ? it.product.nama_produk : "-";
    it.store_nama = it.store ? it.store.nama_store : "-";
    return it;
  }

  function renderVerifikasi(container) {
    var reloadBtn = RtvUI.el("button", { type: "button", class: "rtv-btn rtv-btn-ghost rtv-btn-sm", onclick: function () { loadVerifikasi(); } }, [
      RtvUI.el("i", { class: "fa-solid fa-rotate-right" }), " Muat Ulang",
    ]);
    var tableWrap = RtvUI.el("div", {}, [RtvUI.pageLoading()]);
    var card = RtvUI.el("div", { class: "rtv-card" }, [
      RtvUI.el("div", { class: "rtv-card-header" }, [
        RtvUI.el("h3", {}, ["Verifikasi RTV (Received → Approved/Rejected)"]),
        reloadBtn,
      ]),
      tableWrap,
    ]);
    RtvUI.mount(container, card);
    loadVerifikasi();

    function loadVerifikasi() {
      RtvUI.mount(tableWrap, RtvUI.pageLoading());
      RtvApi.get("/api/admin/verifikasi")
        .then(function (data) {
          var rows = (data.items || []).map(mapRtvAdminRow);
          var table = RtvUI.renderTableHtml({
            columns: [
              { header: "No. RTV", render: function (r) { return RtvUI.escapeHtml(r.no_rtv); }, width: "130px" },
              { header: "Toko", render: function (r) { return RtvUI.escapeHtml(r.store_nama); }, width: "150px" },
              { header: "Produk", render: function (r) { return RtvUI.escapeHtml(r.product_nama); } },
              { header: "Qty Ajuan", render: function (r) { return r.qty_diajukan; }, width: "90px" },
              { header: "Qty Terima", render: function (r) { return r.qty_diterima; }, width: "90px" },
              { header: "Kategori", render: function (r) { return RtvUI.escapeHtml(r.kategori_kerusakan); }, width: "130px" },
              { header: "Batch", render: function (r) { return RtvUI.escapeHtml(r.batch || "-"); }, width: "100px" },
              {
                header: "Aksi", width: "250px",
                render: function (r) {
                  return "<button type='button' class='rtv-link-btn' data-action='setuju' data-id='" + r._id + "'>Setujui</button>" +
                    "<button type='button' class='rtv-link-btn danger' data-action='tolak' data-id='" + r._id + "'>Tolak</button>" +
                    "<button type='button' class='rtv-link-btn' data-action='riwayat' data-id='" + r._id + "'>Riwayat</button>";
                },
              },
            ],
            rows: rows,
            emptyText: "Tidak ada RTV menunggu verifikasi.",
            onRowAction: function (action, id) {
              var row = rows.find(function (r) { return r._id === id; });
              if (!row) return;
              if (action === "setuju") verifikasi(row, true);
              if (action === "tolak") verifikasi(row, false);
              if (action === "riwayat") rtvOpenRiwayatModal(row._id, row.no_rtv);
            },
          });
          RtvUI.mount(tableWrap, table);
        })
        .catch(rtvHandleError);
    }

    function verifikasi(row, approve) {
      RtvUI.confirmDialog({
        title: approve ? "Setujui RTV" : "Tolak RTV",
        text: (approve ? "Setujui" : "Tolak") + " retur " + row.no_rtv + "?",
        okText: "Ya",
        danger: !approve,
      }).then(function (ok) {
        if (!ok) return;
        RtvApi.post("/api/admin/verifikasi/" + row._id, { approve: approve })
          .then(function () {
            RtvUI.toast("RTV " + row.no_rtv + " berhasil di" + (approve ? "setujui." : "tolak."), "success");
            loadVerifikasi();
          })
          .catch(rtvHandleError);
      });
    }
  }

  // ======================================================================
  // Surat Jalan
  // ======================================================================
  function mapShipmentRow(s) {
    s.supplier_nama = s.supplier ? s.supplier.nama_supplier : "-";
    return s;
  }

  function renderSuratJalan(container) {
    var newBtn = RtvUI.el("button", { type: "button", class: "rtv-btn rtv-btn-primary rtv-btn-sm", onclick: function () { openBuatSuratJalan(loadSuratJalan); } }, [
      RtvUI.el("i", { class: "fa-solid fa-plus" }), " Surat Jalan Baru",
    ]);
    var reloadBtn = RtvUI.el("button", { type: "button", class: "rtv-btn rtv-btn-ghost rtv-btn-sm", onclick: function () { loadSuratJalan(); } }, [
      RtvUI.el("i", { class: "fa-solid fa-rotate-right" }), " Muat Ulang",
    ]);
    var tableWrap = RtvUI.el("div", {}, [RtvUI.pageLoading()]);
    var card = RtvUI.el("div", { class: "rtv-card" }, [
      RtvUI.el("div", { class: "rtv-card-header" }, [
        RtvUI.el("h3", {}, ["Surat Jalan ke Supplier"]),
        RtvUI.el("div", { class: "rtv-card-toolbar" }, [newBtn, reloadBtn]),
      ]),
      tableWrap,
    ]);
    RtvUI.mount(container, card);
    loadSuratJalan();

    function loadSuratJalan() {
      RtvUI.mount(tableWrap, RtvUI.pageLoading());
      RtvApi.get("/api/admin/surat-jalan")
        .then(function (data) {
          var rows = (data.items || []).map(mapShipmentRow);
          var table = RtvUI.renderTableHtml({
            columns: [
              { header: "No. Surat Jalan", render: function (r) { return RtvUI.escapeHtml(r.no_surat_jalan); }, width: "160px" },
              { header: "Supplier", render: function (r) { return RtvUI.escapeHtml(r.supplier_nama); }, width: "190px" },
              { header: "Jumlah Item", render: function (r) { return r.jumlah_item; }, width: "100px" },
              { header: "Tgl Kirim", render: function (r) { return rtvFormatDate(r.tgl_kirim); }, width: "120px" },
              { header: "Status", render: function (r) { return rtvStatusBadge(r.status_items); }, width: "170px" },
              { header: "Hasil Klaim", render: function (r) { return RtvUI.escapeHtml(r.hasil_klaim || "-"); } },
              {
                header: "Aksi", width: "150px",
                render: function (r) {
                  if (r.status_items === "Shipped to Supplier") {
                    return "<button type='button' class='rtv-link-btn' data-action='selesai' data-id='" + r._id + "'>Selesaikan Klaim</button>";
                  }
                  return "";
                },
              },
            ],
            rows: rows,
            emptyText: "Belum ada surat jalan.",
            onRowAction: function (action, id) {
              if (action === "selesai") {
                var row = rows.find(function (r) { return r._id === id; });
                if (row) openSelesaikanKlaim(row, loadSuratJalan);
              }
            },
          });
          RtvUI.mount(tableWrap, table);
        })
        .catch(rtvHandleError);
    }
  }

  function openBuatSuratJalan(onDone) {
    RtvApi.get("/api/admin/surat-jalan/items")
      .then(function (data) {
        var suppliers = data.suppliers || [];
        var items = data.items || [];

        var supplierSelect = RtvUI.el("select", {}, [RtvUI.el("option", { value: "" }, ["Pilih supplier..."])].concat(
          suppliers.map(function (s) { return RtvUI.el("option", { value: s._id }, [s.nama_supplier + " (" + s.kode_supplier + ")"]); })
        ));
        var errorEl = RtvUI.el("div", { class: "rtv-field-error" });
        var tableWrap = RtvUI.el("div", {}, [RtvUI.el("p", { class: "rtv-muted", style: { fontSize: "12.5px" } }, ["Pilih supplier untuk menampilkan item RTV berstatus Approved."])]);

        var selectedIds = {};

        function renderItems(supplierId) {
          errorEl.textContent = "";
          selectedIds = {};
          var filtered = items.filter(function (it) { return it.supplier_id === supplierId; });
          if (!filtered.length) {
            RtvUI.mount(tableWrap, RtvUI.el("div", { class: "rtv-table-empty" }, ["Tidak ada item Approved untuk supplier ini."]));
            return;
          }
          var table = RtvUI.renderTableHtml({
            columns: [
              { header: "", render: function (r) { return "<input type='checkbox' data-check='" + r._id + "' />"; }, width: "40px" },
              { header: "No. RTV", render: function (r) { return RtvUI.escapeHtml(r.no_rtv); }, width: "130px" },
              { header: "Produk", render: function (r) { return RtvUI.escapeHtml(r.product.nama_produk); } },
              { header: "Qty", render: function (r) { return r.qty_diterima; }, width: "70px" },
            ],
            rows: filtered,
          });
          table.addEventListener("change", function (e) {
            var cb = e.target.closest("[data-check]");
            if (!cb) return;
            var id = cb.getAttribute("data-check");
            if (cb.checked) selectedIds[id] = true; else delete selectedIds[id];
          });
          RtvUI.mount(tableWrap, table);
        }

        supplierSelect.addEventListener("change", function () { renderItems(supplierSelect.value); });

        var body = RtvUI.el("div", {}, [
          RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, ["Pilih Supplier"]), supplierSelect]),
          tableWrap,
          errorEl,
        ]);

        var modal = RtvUI.openModal({
          title: "Buat Surat Jalan Baru",
          bodyNode: body,
          wide: true,
          footer: [
            { label: "Batal", variant: "ghost" },
            {
              label: "Buat Surat Jalan", variant: "primary", closeOnClick: false,
              onClick: function () {
                errorEl.textContent = "";
                var supplierId = supplierSelect.value;
                if (!supplierId) { errorEl.textContent = "Pilih supplier terlebih dahulu."; return false; }
                var ids = Object.keys(selectedIds);
                if (!ids.length) { errorEl.textContent = "Pilih minimal satu item RTV Approved."; return false; }

                RtvApi.post("/api/admin/surat-jalan", { supplier_id: supplierId, rtv_ids: ids })
                  .then(function (res) {
                    RtvUI.toast("Surat jalan " + res.shipment.no_surat_jalan + " berhasil dibuat.", "success");
                    modal.close();
                    if (onDone) onDone();
                  })
                  .catch(function (err) { errorEl.textContent = err.message; });
                return false;
              },
            },
          ],
        });
      })
      .catch(rtvHandleError);
  }

  function openSelesaikanKlaim(row, onDone) {
    var textarea = RtvUI.el("textarea", { rows: "4", placeholder: "Tulis hasil klaim dari pabrik/supplier..." });
    var errorEl = RtvUI.el("div", { class: "rtv-field-error" });
    var body = RtvUI.el("div", {}, [
      RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, ["Hasil Klaim dari Pabrik"]), textarea]),
      errorEl,
    ]);
    var modal = RtvUI.openModal({
      title: "Selesaikan Klaim — " + row.no_surat_jalan,
      bodyNode: body,
      footer: [
        { label: "Batal", variant: "ghost" },
        {
          label: "Simpan", variant: "primary", closeOnClick: false,
          onClick: function () {
            var val = textarea.value.trim();
            if (!val) { errorEl.textContent = "Hasil klaim wajib diisi."; return false; }
            RtvApi.post("/api/admin/surat-jalan/" + row._id + "/selesai", { hasil_klaim: val })
              .then(function () {
                RtvUI.toast("Klaim " + row.no_surat_jalan + " selesai (status Completed).", "success");
                modal.close();
                if (onDone) onDone();
              })
              .catch(function (err) { errorEl.textContent = err.message; });
            return false;
          },
        },
      ],
    });
  }

  // ======================================================================
  // Master Data (Supplier / Produk / Toko / Shift)
  // ======================================================================
  var MASTER_DEFS = {
    supplier: {
      label: "Supplier",
      columns: [
        { header: "Kode", render: function (r) { return RtvUI.escapeHtml(r.kode_supplier); }, width: "100px" },
        { header: "Nama Supplier", render: function (r) { return RtvUI.escapeHtml(r.nama_supplier); } },
        { header: "Alamat", render: function (r) { return RtvUI.escapeHtml(r.alamat); }, width: "220px" },
        { header: "Kontak", render: function (r) { return RtvUI.escapeHtml(r.kontak); }, width: "150px" },
      ],
      fields: function () {
        return [
          { name: "kode_supplier", label: "Kode Supplier" },
          { name: "nama_supplier", label: "Nama Supplier" },
          { name: "alamat", label: "Alamat" },
          { name: "kontak", label: "Kontak" },
        ];
      },
    },
    produk: {
      label: "Produk",
      columns: [
        { header: "Barcode", render: function (r) { return RtvUI.escapeHtml(r.barcode); }, width: "130px" },
        { header: "Nama Produk", render: function (r) { return RtvUI.escapeHtml(r.nama_produk); } },
        { header: "Harga", render: function (r) { return rtvFormatCurrency(r.harga); }, width: "110px" },
        { header: "Supplier", render: function (r) { return RtvUI.escapeHtml(r.supplier_nama || "-"); }, width: "160px" },
        { header: "Aktif", render: function (r) { return r.aktif ? "Ya" : "Tidak"; }, width: "70px" },
      ],
      fields: function (supplierOpts) {
        return [
          { name: "barcode", label: "Barcode" },
          { name: "nama_produk", label: "Nama Produk" },
          { name: "harga", label: "Harga (Rp)", type: "number" },
          { name: "supplier_id", label: "Supplier", type: "select", options: supplierOpts || [] },
          { name: "aktif", label: "Aktif", type: "checkbox", value: true },
        ];
      },
      needsSupplierOptions: true,
    },
    store: {
      label: "Toko",
      columns: [
        { header: "Kode", render: function (r) { return RtvUI.escapeHtml(r.kode_store); }, width: "100px" },
        { header: "Nama Toko", render: function (r) { return RtvUI.escapeHtml(r.nama_store); } },
        { header: "Alamat", render: function (r) { return RtvUI.escapeHtml(r.alamat); }, width: "260px" },
      ],
      fields: function () {
        return [
          { name: "kode_store", label: "Kode Toko" },
          { name: "nama_store", label: "Nama Toko" },
          { name: "alamat", label: "Alamat" },
        ];
      },
    },
    shift: {
      label: "Shift",
      columns: [
        { header: "Nama Shift", render: function (r) { return RtvUI.escapeHtml(r.nama_shift); } },
        { header: "Jam Mulai", render: function (r) { return RtvUI.escapeHtml(r.jam_mulai); }, width: "120px" },
        { header: "Jam Selesai", render: function (r) { return RtvUI.escapeHtml(r.jam_selesai); }, width: "120px" },
      ],
      fields: function () {
        return [
          { name: "nama_shift", label: "Nama Shift" },
          { name: "jam_mulai", label: "Jam Mulai (HH:MM)" },
          { name: "jam_selesai", label: "Jam Selesai (HH:MM)" },
        ];
      },
    },
  };

  function renderMasterData(container) {
    var entities = ["supplier", "produk", "store", "shift"];
    var tabsEl = RtvUI.el("div", { class: "rtv-tabs" });
    var panelWrap = RtvUI.el("div");
    var tabEls = {};
    var supplierOptsCache = [];

    function loadSupplierOptions() {
      return RtvApi.get("/api/master/supplier").then(function (data) {
        supplierOptsCache = (data.items || []).map(function (s) { return { id: s._id, value: s.nama_supplier }; });
        return supplierOptsCache;
      });
    }

    function buildPanel(entity) {
      var def = MASTER_DEFS[entity];
      var tableWrap = RtvUI.el("div", {}, [RtvUI.pageLoading()]);
      var addBtn = RtvUI.el("button", { type: "button", class: "rtv-btn rtv-btn-primary rtv-btn-sm" }, [RtvUI.el("i", { class: "fa-solid fa-plus" }), " Tambah Data"]);
      var reloadBtn = RtvUI.el("button", { type: "button", class: "rtv-btn rtv-btn-ghost rtv-btn-sm" }, [RtvUI.el("i", { class: "fa-solid fa-rotate-right" }), " Muat Ulang"]);

      function load() {
        RtvUI.mount(tableWrap, RtvUI.pageLoading());
        var req = entity === "produk" ? Promise.all([RtvApi.get("/api/master/produk"), loadSupplierOptions()]) : RtvApi.get("/api/master/" + entity).then(function (d) { return [d]; });
        req.then(function (results) {
          var data = results[0];
          var rows = data.items || [];
          var columns = def.columns.concat([
            {
              header: "Aksi", width: "140px",
              render: function (r) {
                return "<button type='button' class='rtv-link-btn' data-action='edit' data-id='" + r._id + "'>Ubah</button>" +
                  "<button type='button' class='rtv-link-btn danger' data-action='hapus' data-id='" + r._id + "'>Hapus</button>";
              },
            },
          ]);
          var table = RtvUI.renderTableHtml({
            columns: columns,
            rows: rows,
            emptyText: "Belum ada data " + def.label.toLowerCase() + ".",
            onRowAction: function (action, id) {
              var row = rows.find(function (r) { return r._id === id; });
              if (!row) return;
              if (action === "edit") openForm(row);
              if (action === "hapus") hapus(row);
            },
          });
          RtvUI.mount(tableWrap, table);
        }).catch(rtvHandleError);
      }

      function hapus(row) {
        RtvUI.confirmDialog({ title: "Hapus Data", text: "Hapus data ini? Tindakan tidak dapat dibatalkan.", okText: "Hapus", danger: true }).then(function (ok) {
          if (!ok) return;
          RtvApi.del("/api/master/" + entity + "/" + row._id)
            .then(function () { RtvUI.toast("Data berhasil dihapus.", "success"); load(); })
            .catch(rtvHandleError);
        });
      }

      function openForm(existing) {
        var fields = def.fields(entity === "produk" ? supplierOptsCache : undefined);
        var formBuilder = buildFormFields(fields);
        var errorEl = RtvUI.el("div", { class: "rtv-field-error" });
        var body = RtvUI.el("div", {}, [formBuilder.wrapper, errorEl]);
        if (existing) formBuilder.setValues(existing);

        var modal = RtvUI.openModal({
          title: (existing ? "Ubah" : "Tambah") + " Data " + def.label,
          bodyNode: body,
          footer: [
            { label: "Batal", variant: "ghost" },
            {
              label: "Simpan", variant: "primary", closeOnClick: false,
              onClick: function () {
                errorEl.textContent = "";
                var values = formBuilder.getValues();
                var url = "/api/master/" + entity + (existing ? "/" + existing._id : "");
                var method = existing ? "put" : "post";
                RtvApi[method](url, values)
                  .then(function () { RtvUI.toast("Data berhasil disimpan.", "success"); modal.close(); load(); })
                  .catch(function (err) { errorEl.textContent = err.message; });
                return false;
              },
            },
          ],
        });
      }

      addBtn.addEventListener("click", function () { openForm(null); });
      reloadBtn.addEventListener("click", load);

      var panel = RtvUI.el("div", {}, [
        RtvUI.el("div", { class: "rtv-card-toolbar", style: { marginBottom: "14px", justifyContent: "flex-end" } }, [addBtn, reloadBtn]),
        tableWrap,
      ]);
      return { panel: panel, load: load };
    }

    var panels = {};
    entities.forEach(function (entity, idx) {
      var def = MASTER_DEFS[entity];
      var tabEl = RtvUI.el("div", { class: "rtv-tab" + (idx === 0 ? " active" : "") }, [def.label]);
      tabEls[entity] = tabEl;
      tabEl.addEventListener("click", function () { selectTab(entity); });
      tabsEl.appendChild(tabEl);
      panels[entity] = buildPanel(entity);
    });

    function selectTab(entity) {
      Object.keys(tabEls).forEach(function (key) { tabEls[key].classList.toggle("active", key === entity); });
      RtvUI.mount(panelWrap, panels[entity].panel);
      panels[entity].load();
    }

    var card = RtvUI.el("div", { class: "rtv-card" }, [
      RtvUI.el("div", { class: "rtv-card-header" }, [RtvUI.el("h3", {}, ["Kelola Master Data"])]),
      tabsEl,
      panelWrap,
    ]);
    RtvUI.mount(container, card);
    selectTab("supplier");
  }

  // ======================================================================
  // Karyawan
  // ======================================================================
  function renderKaryawan(container) {
    var addBtn = RtvUI.el("button", { type: "button", class: "rtv-btn rtv-btn-primary rtv-btn-sm", onclick: function () { openKaryawanForm(null); } }, [
      RtvUI.el("i", { class: "fa-solid fa-user-plus" }), " Tambah Karyawan",
    ]);
    var reloadBtn = RtvUI.el("button", { type: "button", class: "rtv-btn rtv-btn-ghost rtv-btn-sm", onclick: function () { loadKaryawan(); } }, [
      RtvUI.el("i", { class: "fa-solid fa-rotate-right" }), " Muat Ulang",
    ]);
    var tableWrap = RtvUI.el("div", {}, [RtvUI.pageLoading()]);
    var card = RtvUI.el("div", { class: "rtv-card" }, [
      RtvUI.el("div", { class: "rtv-card-header" }, [
        RtvUI.el("h3", {}, ["Kelola Karyawan"]),
        RtvUI.el("div", { class: "rtv-card-toolbar" }, [addBtn, reloadBtn]),
      ]),
      tableWrap,
    ]);
    RtvUI.mount(container, card);
    loadKaryawan();

    function loadKaryawan() {
      RtvUI.mount(tableWrap, RtvUI.pageLoading());
      RtvApi.get("/api/karyawan")
        .then(function (data) {
          var rows = data.items || [];
          var table = RtvUI.renderTableHtml({
            columns: [
              { header: "NIK", render: function (r) { return RtvUI.escapeHtml(r.nik); }, width: "100px" },
              { header: "Nama", render: function (r) { return RtvUI.escapeHtml(r.nama); }, width: "170px" },
              { header: "Username", render: function (r) { return RtvUI.escapeHtml(r.username); }, width: "130px" },
              { header: "Role", render: function (r) { return RTV_ROLE_LABEL[r.role] || r.role; }, width: "140px" },
              { header: "Toko", render: function (r) { return RtvUI.escapeHtml(r.store_nama || "-"); }, width: "150px" },
              {
                header: "Status", width: "90px",
                render: function (r) { return r.aktif ? "<span style='color:var(--rtv-green);font-weight:600;'>Aktif</span>" : "<span style='color:var(--rtv-red);font-weight:600;'>Nonaktif</span>"; },
              },
              {
                header: "Aksi", width: "230px",
                render: function (r) {
                  var html = "<button type='button' class='rtv-link-btn' data-action='edit' data-id='" + r._id + "'>Ubah</button>";
                  html += "<button type='button' class='rtv-link-btn' data-action='pindah' data-id='" + r._id + "'>Pindahkan</button>";
                  html += r.aktif
                    ? "<button type='button' class='rtv-link-btn danger' data-action='nonaktifkan' data-id='" + r._id + "'>Nonaktifkan</button>"
                    : "<button type='button' class='rtv-link-btn' data-action='aktifkan' data-id='" + r._id + "'>Aktifkan</button>";
                  return html;
                },
              },
            ],
            rows: rows,
            emptyText: "Belum ada data karyawan.",
            onRowAction: function (action, id) {
              var row = rows.find(function (r) { return r._id === id; });
              if (!row) return;
              if (action === "edit") openKaryawanForm(row);
              else if (action === "pindah") openPindahForm(row, loadKaryawan);
              else if (action === "nonaktifkan" || action === "aktifkan") aksiKaryawan(row, action);
            },
          });
          RtvUI.mount(tableWrap, table);
        })
        .catch(rtvHandleError);
    }

    function aksiKaryawan(row, action) {
      var label = action === "nonaktifkan" ? "menonaktifkan" : "mengaktifkan";
      RtvUI.confirmDialog({ title: "Konfirmasi", text: "Yakin ingin " + label + " " + row.nama + "?" }).then(function (ok) {
        if (!ok) return;
        RtvApi.post("/api/karyawan/" + row._id + "/" + action)
          .then(function () { RtvUI.toast("Berhasil " + label + " karyawan.", "success"); loadKaryawan(); })
          .catch(rtvHandleError);
      });
    }

    function openKaryawanForm(existing) {
      Promise.all([RtvApi.get("/api/master/store"), RtvApi.get("/api/master/shift")]).then(function (results) {
        var storeOpts = (results[0].items || []).map(function (s) { return { id: s._id, value: s.nama_store }; });
        var shiftOpts = [{ id: "", value: "Tanpa shift" }].concat((results[1].items || []).map(function (s) { return { id: s._id, value: s.nama_shift }; }));
        var roleOpts = [
          { id: "staff_toko", value: "Staff Toko" },
          { id: "staff_gudang", value: "Staff Gudang" },
          { id: "admin", value: "Admin / Supervisor" },
        ];

        var fields = [
          { name: "nik", label: "NIK", disabled: !!existing },
          { name: "nama", label: "Nama" },
          { name: "username", label: "Username", disabled: !!existing },
          { name: "password", label: existing ? "Password (kosongkan jika tidak diubah)" : "Password", type: "password" },
          { name: "role", label: "Role", type: "select", options: roleOpts },
          { name: "store_id", label: "Toko", type: "select", options: storeOpts, disabled: !!existing },
          { name: "shift_id", label: "Shift (opsional)", type: "select", options: shiftOpts },
        ];
        var formBuilder = buildFormFields(fields);
        var errorEl = RtvUI.el("div", { class: "rtv-field-error" });
        if (existing) formBuilder.setValues(existing);

        var modal = RtvUI.openModal({
          title: existing ? "Ubah Karyawan" : "Tambah Karyawan",
          bodyNode: RtvUI.el("div", {}, [formBuilder.wrapper, errorEl]),
          footer: [
            { label: "Batal", variant: "ghost" },
            {
              label: "Simpan", variant: "primary", closeOnClick: false,
              onClick: function () {
                errorEl.textContent = "";
                var values = formBuilder.getValues();
                if (existing) {
                  var payload = { nama: values.nama, role: values.role, shift_id: values.shift_id || null };
                  if (values.password) payload.password = values.password;
                  RtvApi.put("/api/karyawan/" + existing._id, payload)
                    .then(function () { RtvUI.toast("Data karyawan diperbarui.", "success"); modal.close(); loadKaryawan(); })
                    .catch(function (err) { errorEl.textContent = err.message; });
                } else {
                  RtvApi.post("/api/karyawan", values)
                    .then(function () { RtvUI.toast("Karyawan baru berhasil ditambahkan.", "success"); modal.close(); loadKaryawan(); })
                    .catch(function (err) { errorEl.textContent = err.message; });
                }
                return false;
              },
            },
          ],
        });
      }).catch(rtvHandleError);
    }

    function openPindahForm(row, onDone) {
      RtvApi.get("/api/master/store").then(function (data) {
        var opts = (data.items || []).filter(function (s) { return s._id !== row.store_id; }).map(function (s) { return { id: s._id, value: s.nama_store }; });
        var select = RtvUI.el("select", {}, [RtvUI.el("option", { value: "" }, ["Pilih toko tujuan..."])].concat(
          opts.map(function (o) { return RtvUI.el("option", { value: o.id }, [o.value]); })
        ));
        var errorEl = RtvUI.el("div", { class: "rtv-field-error" });
        var modal = RtvUI.openModal({
          title: "Pindahkan " + row.nama,
          bodyNode: RtvUI.el("div", {}, [RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, ["Toko Tujuan"]), select]), errorEl]),
          footer: [
            { label: "Batal", variant: "ghost" },
            {
              label: "Pindahkan", variant: "primary", closeOnClick: false,
              onClick: function () {
                if (!select.value) { errorEl.textContent = "Pilih toko tujuan."; return false; }
                RtvApi.post("/api/karyawan/" + row._id + "/pindahkan", { store_id: select.value })
                  .then(function () { RtvUI.toast("Karyawan berhasil dipindahkan.", "success"); modal.close(); if (onDone) onDone(); })
                  .catch(function (err) { errorEl.textContent = err.message; });
                return false;
              },
            },
          ],
        });
      }).catch(rtvHandleError);
    }
  }

  // ======================================================================
  // Laporan
  // ======================================================================
  function renderLaporan(container) {
    var tableWrap = RtvUI.el("div", {}, [RtvUI.pageLoading()]);
    var card = RtvUI.el("div", { class: "rtv-card" }, [
      RtvUI.el("div", { class: "rtv-card-header" }, [RtvUI.el("h3", {}, ["Laporan Rekapitulasi Klaim per Supplier"])]),
      tableWrap,
    ]);
    RtvUI.mount(container, card);

    RtvApi.get("/api/dashboard/rekap-supplier")
      .then(function (data) {
        var rows = data.items || [];
        var table = RtvUI.renderTableHtml({
          columns: [
            { header: "No. Surat Jalan", render: function (r) { return RtvUI.escapeHtml(r.no_surat_jalan); }, width: "170px" },
            { header: "Supplier", render: function (r) { return RtvUI.escapeHtml(r.supplier_nama || "-"); }, width: "190px" },
            { header: "Jumlah Item", render: function (r) { return r.jumlah_item; }, width: "100px" },
            { header: "Tgl Kirim", render: function (r) { return rtvFormatDate(r.tgl_kirim); }, width: "120px" },
            { header: "Tgl Selesai", render: function (r) { return rtvFormatDate(r.tgl_selesai); }, width: "120px" },
            { header: "Hasil Klaim", render: function (r) { return RtvUI.escapeHtml(r.hasil_klaim || "-"); } },
          ],
          rows: rows,
          emptyText: "Belum ada data klaim.",
        });
        RtvUI.mount(tableWrap, table);
      })
      .catch(rtvHandleError);
  }

  return {
    renderDashboard: renderDashboard,
    renderVerifikasi: renderVerifikasi,
    renderSuratJalan: renderSuratJalan,
    renderMasterData: renderMasterData,
    renderKaryawan: renderKaryawan,
    renderLaporan: renderLaporan,
  };
})();