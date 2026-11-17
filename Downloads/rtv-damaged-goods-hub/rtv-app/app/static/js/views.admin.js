/**
 * Views untuk role Admin / Supervisor:
 *  - Dashboard ringkasan + peringatan stok + insight lanjutan (skor vendor,
 *    perbandingan toko, tren nilai kerugian, ringkasan klaim vendor)
 *  - Verifikasi RTV (Approve / Reject dengan catatan + lihat foto + cetak)
 *  - Buat & kelola Surat Jalan ke Supplier, selesaikan klaim (status,
 *    nilai kredit, no. credit note) + cetak surat jalan
 *  - Kelola Master Data (Supplier, Produk, Toko, Shift)
 *  - Kelola Karyawan (tambah/ubah/nonaktifkan/pindahkan) + Setujui/Tolak
 *    akun hasil pendaftaran mandiri
 *  - Laporan rekap per supplier + Log Aktivitas (audit) + Ekspor data RTV
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

  function kpiCardTrend(icon, color, label, value, deltaPct, deltaIsBadWhenUp) {
    var body = [
      RtvUI.el("div", { class: "rtv-kpi-value" }, [String(value)]),
      RtvUI.el("div", { class: "rtv-kpi-label" }, [label]),
    ];
    if (deltaPct !== null && deltaPct !== undefined) {
      var up = deltaPct > 0;
      var bad = deltaIsBadWhenUp ? up : !up;
      var cls = deltaPct === 0 ? "" : bad ? "up" : "down";
      var arrow = deltaPct === 0 ? "→" : up ? "↑" : "↓";
      body.push(RtvUI.el("div", { class: "rtv-kpi-trend " + cls }, [arrow + " " + Math.abs(deltaPct) + "% vs periode sebelumnya"]));
    }
    return RtvUI.el("div", { class: "rtv-kpi-card" }, [
      RtvUI.el("div", { class: "rtv-kpi-icon", style: { background: color } }, [RtvUI.el("i", { class: "fa-solid " + icon })]),
      RtvUI.el("div", { class: "rtv-kpi-body" }, body),
    ]);
  }

  function miniTable(title, columns, rows, emptyText) {
    return RtvUI.el("div", {}, [
      RtvUI.el("div", { class: "rtv-mini-table-title" }, [title]),
      RtvUI.renderTableHtml({ columns: columns, rows: rows || [], emptyText: emptyText || "Belum ada data." }),
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
      RtvUI.el("div", { class: "rtv-card-header" }, [RtvUI.el("h3", {}, ["Tren Jumlah Retur (6 Bulan Terakhir)"])]),
      trenChartWrap,
    ]);

    var kategoriChartWrap = RtvUI.el("div", {}, [RtvUI.pageLoading()]);
    var kategoriCard = RtvUI.el("div", { class: "rtv-card" }, [
      RtvUI.el("div", { class: "rtv-card-header" }, [RtvUI.el("h3", {}, ["Distribusi Kategori Kerusakan"])]),
      kategoriChartWrap,
    ]);

    var chartRow = RtvUI.el("div", { class: "rtv-chart-row" }, [trenCard, kategoriCard]);

    // ---- Insight lanjutan (klaim vendor, skor vendor, perbandingan toko) ----
    var periodBtns = {};
    var periodSelect = RtvUI.el("div", { class: "rtv-period-select" });
    [[30, "30 Hari"], [90, "90 Hari"], [180, "6 Bulan"], [365, "1 Tahun"]].forEach(function (p) {
      var btn = RtvUI.el("button", { type: "button", onclick: function () { loadInsight(p[0]); } }, [p[1]]);
      periodBtns[p[0]] = btn;
      periodSelect.appendChild(btn);
    });

    var insightKpiGrid = RtvUI.el("div", { class: "rtv-kpi-grid" }, [RtvUI.pageLoading()]);
    var insightTrenWrap = RtvUI.el("div", {}, [RtvUI.pageLoading()]);
    var insightTrenCard = RtvUI.el("div", { class: "rtv-card" }, [
      RtvUI.el("div", { class: "rtv-card-header" }, [RtvUI.el("h3", {}, ["Tren Nilai Kerugian (Rp)"])]),
      insightTrenWrap,
    ]);
    var vendorTableWrap = RtvUI.el("div", {}, [RtvUI.pageLoading()]);
    var tokoTableWrap = RtvUI.el("div", {}, [RtvUI.pageLoading()]);

    var insightSection = RtvUI.el("div", { class: "rtv-card" }, [
      RtvUI.el("div", { class: "rtv-card-header" }, [
        RtvUI.el("h3", {}, ["Insight Lanjutan"]),
        periodSelect,
      ]),
      insightKpiGrid,
      RtvUI.el("div", { style: { height: "16px" } }),
      insightTrenCard,
      RtvUI.el("div", { style: { height: "16px" } }),
      RtvUI.el("div", { class: "rtv-grid-2", style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" } }, [
        vendorTableWrap, tokoTableWrap,
      ]),
    ]);

    RtvUI.mount(
      container,
      RtvUI.el("div", {}, [
        kpiGrid,
        kerugianCard,
        RtvUI.el("div", { style: { height: "18px" } }),
        chartRow,
        RtvUI.el("div", { style: { height: "18px" } }),
        peringatanCard,
        RtvUI.el("div", { style: { height: "18px" } }),
        insightSection,
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

    function loadInsight(days) {
      Object.keys(periodBtns).forEach(function (k) { periodBtns[k].classList.toggle("active", Number(k) === days); });
      RtvUI.mount(insightKpiGrid, RtvUI.pageLoading());
      RtvUI.mount(insightTrenWrap, RtvUI.pageLoading());
      RtvUI.mount(vendorTableWrap, RtvUI.pageLoading());
      RtvUI.mount(tokoTableWrap, RtvUI.pageLoading());

      RtvApi.get("/api/x/insight?days=" + days)
        .then(function (data) {
          var k = data.kpi;
          RtvUI.mount(insightKpiGrid, RtvUI.el("div", { class: "rtv-kpi-grid" }, [
            kpiCardTrend("fa-rotate", "var(--rtv-blue)", "Total RTV Diajukan", k.total_rtv, k.total_rtv_delta, false),
            kpiCardTrend("fa-sack-dollar", "var(--rtv-red)", "Kerugian Periode Ini", rtvFormatCurrency(k.kerugian), k.kerugian_delta, true),
            kpiCardTrend("fa-ban", "var(--rtv-orange)", "% Retur Ditolak", k.persen_ditolak + "%", null, true),
            kpiCard("fa-stopwatch", "var(--rtv-teal)", "Rata² Hari s/d Verifikasi", k.rata_hari_verifikasi + " hari"),
            kpiCard("fa-file-invoice-dollar", "var(--rtv-green)", "Klaim Kredit Diterima", rtvFormatCurrency(k.klaim_kredit_diterima)),
            kpiCard("fa-hourglass", "var(--rtv-yellow)", "Klaim Masih Menggantung", rtvFormatCurrency(k.klaim_menggantung)),
          ]));

          if (!data.tren.length || !data.tren.some(function (t) { return t.jumlah > 0; })) {
            RtvUI.mount(insightTrenWrap, RtvUI.el("div", { class: "rtv-table-empty" }, ["Belum ada data pada periode ini."]));
          } else {
            var chartData = data.tren.map(function (t) {
              var d = new Date(t.tanggal);
              return { label: d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" }), value: Math.round(t.nilai) };
            });
            RtvUI.mount(insightTrenWrap, RtvUI.el("div", { html: RtvUI.barChart({ data: chartData, color: "var(--rtv-red)", width: 760, height: 220 }) }));
          }

          RtvUI.mount(vendorTableWrap, miniTable(
            "Skor Vendor (Supplier) — diurutkan dari nilai kerugian tertinggi",
            [
              { header: "Supplier", render: function (r) { return RtvUI.escapeHtml(r.supplier); } },
              { header: "Jml RTV", render: function (r) { return r.jumlah; }, width: "70px" },
              { header: "Nilai", render: function (r) { return rtvFormatCurrency(r.nilai); }, width: "110px" },
              { header: "% Ditolak", render: function (r) { return r.persen_ditolak + "%"; }, width: "80px" },
              { header: "Produk Teratas", render: function (r) { return RtvUI.escapeHtml(r.produk_teratas); } },
            ],
            data.vendor,
            "Belum ada data vendor pada periode ini."
          ));

          RtvUI.mount(tokoTableWrap, miniTable(
            "Perbandingan Toko — diurutkan dari jumlah retur terbanyak",
            [
              { header: "Toko", render: function (r) { return RtvUI.escapeHtml(r.toko); } },
              { header: "Jml RTV", render: function (r) { return r.jumlah; }, width: "70px" },
              { header: "Nilai", render: function (r) { return rtvFormatCurrency(r.nilai); }, width: "110px" },
              { header: "Pending", render: function (r) { return r.pending; }, width: "70px" },
              { header: "% Ditolak", render: function (r) { return r.persen_ditolak + "%"; }, width: "80px" },
            ],
            data.toko,
            "Belum ada data toko pada periode ini."
          ));
        })
        .catch(rtvHandleError);
    }

    loadInsight(90);
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
        RtvUI.el("h3", {}, ["Verifikasi RTV (status Received)"]),
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
              { header: "Toko", render: function (r) { return RtvUI.escapeHtml(r.store_nama); }, width: "140px" },
              { header: "Produk", render: function (r) { return RtvUI.escapeHtml(r.product_nama); } },
              { header: "Qty Ajuan", render: function (r) { return r.qty_diajukan; }, width: "85px" },
              { header: "Qty Terima", render: function (r) { return r.qty_diterima; }, width: "85px" },
              { header: "Kategori", render: function (r) { return RtvUI.escapeHtml(r.kategori_kerusakan); }, width: "120px" },
              { header: "Nilai Est.", render: function (r) { return rtvFormatCurrency(r.nilai_estimasi); }, width: "110px" },
              {
                header: "Aksi", width: "260px",
                render: function (r) {
                  return "<button type='button' class='rtv-link-btn' data-action='setuju' data-id='" + r._id + "'>Setujui</button>" +
                    "<button type='button' class='rtv-link-btn danger' data-action='tolak' data-id='" + r._id + "'>Tolak</button>" +
                    "<button type='button' class='rtv-link-btn' data-action='foto' data-id='" + r._id + "'>Foto</button>" +
                    "<button type='button' class='rtv-link-btn' data-action='cetak' data-id='" + r._id + "'>Cetak</button>";
                },
              },
            ],
            rows: rows,
            emptyText: "Tidak ada RTV yang menunggu verifikasi.",
            onRowAction: function (action, id) {
              var row = rows.find(function (r) { return r._id === id; });
              if (!row) return;
              if (action === "setuju") verifikasi(row, true);
              if (action === "tolak") verifikasiTolak(row);
              if (action === "foto") openFotoViewModal(row._id, row.no_rtv);
              if (action === "cetak") RtvPrint.rtv(row._id);
            },
          });
          RtvUI.mount(tableWrap, table);
        })
        .catch(rtvHandleError);
    }

    function openFotoViewModal(rtvId, noRtv) {
      var body = RtvUI.el("div", {}, [RtvUI.pageLoading()]);
      RtvUI.openModal({ title: "Foto Bukti — " + (noRtv || ""), bodyNode: body });
      RtvApi.get("/api/x/rtv/" + rtvId + "/foto")
        .then(function (data) {
          var items = data.items || [];
          if (!items.length) {
            RtvUI.mount(body, RtvUI.el("div", { class: "rtv-table-empty" }, ["Belum ada foto bukti untuk retur ini."]));
            return;
          }
          var grid = RtvUI.el("div", { class: "rtv-photo-view-grid" });
          items.forEach(function (f) {
            grid.appendChild(RtvUI.el("img", { src: f.data, alt: "Foto bukti", onclick: function () { window.open(f.data, "_blank"); } }));
          });
          RtvUI.mount(body, grid);
        })
        .catch(function (err) { RtvUI.mount(body, RtvUI.el("div", { class: "rtv-field-error" }, [err.message])); });
    }

    function verifikasi(row, approve, catatan) {
      RtvUI.confirmDialog({
        title: approve ? "Setujui RTV" : "Tolak RTV",
        text: (approve ? "Setujui" : "Tolak") + " retur " + row.no_rtv + "?",
        okText: approve ? "Ya, Setujui" : "Ya, Tolak",
        danger: !approve,
      }).then(function (ok) {
        if (!ok) return;
        RtvApi.post("/api/admin/verifikasi/" + row._id, { approve: approve, catatan: catatan || "" })
          .then(function () {
            RtvUI.toast("RTV " + row.no_rtv + " berhasil " + (approve ? "disetujui" : "ditolak") + ".", "success");
            loadVerifikasi();
          })
          .catch(rtvHandleError);
      });
    }

    function verifikasiTolak(row) {
      var catatanInput = RtvUI.el("textarea", { rows: "3", placeholder: "Contoh: foto tidak jelas, kondisi tidak sesuai klaim, dsb." });
      var errorEl = RtvUI.el("div", { class: "rtv-field-error" });
      var modal = RtvUI.openModal({
        title: "Tolak Retur " + row.no_rtv,
        bodyNode: RtvUI.el("div", {}, [
          RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, ["Alasan Penolakan (opsional, akan dikirim ke toko)"]), catatanInput]),
          errorEl,
        ]),
        footer: [
          { label: "Batal", variant: "ghost" },
          {
            label: "Tolak Retur", variant: "danger", closeOnClick: false,
            onClick: function () {
              RtvApi.post("/api/admin/verifikasi/" + row._id, { approve: false, catatan: catatanInput.value.trim() })
                .then(function () {
                  RtvUI.toast("RTV " + row.no_rtv + " ditolak.", "success");
                  modal.close();
                  loadVerifikasi();
                })
                .catch(function (err) { errorEl.textContent = err.message; });
              return false;
            },
          },
        ],
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

  var KLAIM_STATUS_OPTS = [
    { id: "Diajukan", value: "Diajukan" },
    { id: "Disetujui Penuh", value: "Disetujui Penuh" },
    { id: "Disetujui Sebagian", value: "Disetujui Sebagian" },
    { id: "Ditolak", value: "Ditolak" },
  ];

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
              { header: "No. Surat Jalan", render: function (r) { return RtvUI.escapeHtml(r.no_surat_jalan); }, width: "150px" },
              { header: "Supplier", render: function (r) { return RtvUI.escapeHtml(r.supplier_nama); }, width: "170px" },
              { header: "Jml Item", render: function (r) { return r.jumlah_item; }, width: "75px" },
              { header: "Nilai", render: function (r) { return rtvFormatCurrency(r.total_nilai); }, width: "110px" },
              { header: "Tgl Kirim", render: function (r) { return rtvFormatDate(r.tgl_kirim); }, width: "110px" },
              { header: "Status", render: function (r) { return rtvStatusBadge(r.status_items); }, width: "160px" },
              { header: "Hasil Klaim", render: function (r) { return RtvUI.escapeHtml(r.hasil_klaim || "-"); } },
              {
                header: "Aksi", width: "190px",
                render: function (r) {
                  var html = "<button type='button' class='rtv-link-btn' data-action='cetak' data-id='" + r._id + "'>Cetak</button>";
                  if (r.status_items === "Shipped to Supplier") {
                    html += "<button type='button' class='rtv-link-btn' data-action='selesai' data-id='" + r._id + "'>Selesaikan Klaim</button>";
                  }
                  return html;
                },
              },
            ],
            rows: rows,
            emptyText: "Belum ada surat jalan.",
            onRowAction: function (action, id) {
              var row = rows.find(function (r) { return r._id === id; });
              if (!row) return;
              if (action === "selesai") openSelesaikanKlaim(row, loadSuratJalan);
              if (action === "cetak") RtvPrint.suratJalan(row._id);
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
        var items = data.items || [];
        var suppliers = data.suppliers || [];
        var supplierSelect = RtvUI.el("select", {}, [RtvUI.el("option", { value: "" }, ["Pilih supplier..."])].concat(
          suppliers.map(function (s) { return RtvUI.el("option", { value: s._id }, [s.nama_supplier + " (" + s.kode_supplier + ")"]); })
        ));
        var itemsWrap = RtvUI.el("div", { class: "rtv-table-empty" }, ["Pilih supplier terlebih dahulu."]);
        var errorEl = RtvUI.el("div", { class: "rtv-field-error" });

        function renderItems(supplierId) {
          if (!supplierId) {
            RtvUI.mount(itemsWrap, RtvUI.el("div", { class: "rtv-table-empty" }, ["Pilih supplier terlebih dahulu."]));
            return;
          }
          var filtered = items.filter(function (it) { return it.supplier_id === supplierId; });
          var table = RtvUI.renderTableHtml({
            columns: [
              { header: "", render: function (r) { return "<input type='checkbox' data-check='" + r._id + "' />"; }, width: "40px" },
              { header: "No. RTV", render: function (r) { return RtvUI.escapeHtml(r.no_rtv); }, width: "130px" },
              { header: "Produk", render: function (r) { return RtvUI.escapeHtml(r.product.nama_produk); } },
              { header: "Qty", render: function (r) { return r.qty_diterima; }, width: "70px" },
            ],
            rows: filtered,
            emptyText: "Tidak ada item Approved dari supplier ini.",
          });
          RtvUI.mount(itemsWrap, table);
        }

        supplierSelect.addEventListener("change", function () { renderItems(supplierSelect.value); });

        var body = RtvUI.el("div", {}, [
          RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, ["Supplier"]), supplierSelect]),
          itemsWrap,
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
                if (!supplierSelect.value) { errorEl.textContent = "Pilih supplier terlebih dahulu."; return false; }
                var checked = Array.prototype.slice.call(itemsWrap.querySelectorAll("[data-check]:checked"));
                var rtvIds = checked.map(function (el) { return el.getAttribute("data-check"); });
                if (!rtvIds.length) { errorEl.textContent = "Pilih minimal 1 item RTV."; return false; }

                RtvApi.post("/api/admin/surat-jalan", { supplier_id: supplierSelect.value, rtv_ids: rtvIds })
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
    var statusSelect = RtvUI.el("select", {}, KLAIM_STATUS_OPTS.map(function (o) { return RtvUI.el("option", { value: o.id }, [o.value]); }));
    statusSelect.value = "Disetujui Penuh";
    var nilaiInput = RtvUI.el("input", { type: "number", min: "0", step: "1", placeholder: "Nilai kredit/penggantian dari supplier (Rp)" });
    var ccnInput = RtvUI.el("input", { type: "text", placeholder: "Opsional" });
    var hasilInput = RtvUI.el("textarea", { rows: "3", placeholder: "Ringkasan hasil klaim dari supplier..." });
    var errorEl = RtvUI.el("div", { class: "rtv-field-error" });

    var body = RtvUI.el("div", {}, [
      RtvUI.el("div", { class: "rtv-form-grid" }, [
        RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, ["Status Klaim"]), statusSelect]),
        RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, ["Nilai Kredit Diterima (Rp)"]), nilaiInput]),
        RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, ["No. Credit Note"]), ccnInput]),
      ]),
      RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, ["Ringkasan Hasil Klaim"]), hasilInput]),
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
            errorEl.textContent = "";
            if (!hasilInput.value.trim()) { errorEl.textContent = "Ringkasan hasil klaim wajib diisi."; return false; }
            var payload = {
              hasil_klaim: hasilInput.value.trim(),
              klaim_status: statusSelect.value,
              no_credit_note: ccnInput.value.trim(),
            };
            if (nilaiInput.value !== "") payload.nilai_kredit = Number(nilaiInput.value);

            RtvApi.post("/api/admin/surat-jalan/" + row._id + "/selesai", payload)
              .then(function () {
                RtvUI.toast("Klaim untuk " + row.no_surat_jalan + " berhasil diselesaikan.", "success");
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
  // Master Data
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
  // Karyawan (termasuk persetujuan akun pendaftaran mandiri)
  // ======================================================================
  function renderKaryawan(container) {
    var tabsEl = RtvUI.el("div", { class: "rtv-tabs" });
    var panelWrap = RtvUI.el("div");

    var tabAktif = RtvUI.el("div", { class: "rtv-tab active" }, ["Karyawan Aktif"]);
    var tabMenunggu = RtvUI.el("div", { class: "rtv-tab" }, ["Menunggu Persetujuan"]);
    tabsEl.appendChild(tabAktif);
    tabsEl.appendChild(tabMenunggu);

    var aktifPanel = buildAktifPanel();
    var menungguPanel = buildMenungguPanel();

    function selectTab(name) {
      tabAktif.classList.toggle("active", name === "aktif");
      tabMenunggu.classList.toggle("active", name === "menunggu");
      if (name === "aktif") { RtvUI.mount(panelWrap, aktifPanel.panel); aktifPanel.load(); }
      else { RtvUI.mount(panelWrap, menungguPanel.panel); menungguPanel.load(); }
    }
    tabAktif.addEventListener("click", function () { selectTab("aktif"); });
    tabMenunggu.addEventListener("click", function () { selectTab("menunggu"); });

    var card = RtvUI.el("div", { class: "rtv-card" }, [
      RtvUI.el("div", { class: "rtv-card-header" }, [RtvUI.el("h3", {}, ["Kelola Karyawan"])]),
      tabsEl,
      panelWrap,
    ]);
    RtvUI.mount(container, card);
    selectTab("aktif");

    function refreshBadge() {
      RtvApi.get("/api/karyawan/menunggu").then(function (data) {
        var n = (data.items || []).length;
        tabMenunggu.textContent = "Menunggu Persetujuan" + (n ? " (" + n + ")" : "");
      }).catch(function () {});
    }
    refreshBadge();

    function buildAktifPanel() {
      var addBtn = RtvUI.el("button", { type: "button", class: "rtv-btn rtv-btn-primary rtv-btn-sm", onclick: function () { openKaryawanForm(null); } }, [
        RtvUI.el("i", { class: "fa-solid fa-user-plus" }), " Tambah Karyawan",
      ]);
      var reloadBtn = RtvUI.el("button", { type: "button", class: "rtv-btn rtv-btn-ghost rtv-btn-sm", onclick: function () { load(); } }, [
        RtvUI.el("i", { class: "fa-solid fa-rotate-right" }), " Muat Ulang",
      ]);
      var tableWrap = RtvUI.el("div", {}, [RtvUI.pageLoading()]);
      var panel = RtvUI.el("div", {}, [
        RtvUI.el("div", { class: "rtv-card-toolbar", style: { marginBottom: "14px", justifyContent: "flex-end" } }, [addBtn, reloadBtn]),
        tableWrap,
      ]);

      function load() {
        RtvUI.mount(tableWrap, RtvUI.pageLoading());
        RtvApi.get("/api/karyawan")
          .then(function (data) {
            var rows = data.items || [];
            var table = RtvUI.renderTableHtml({
              columns: [
                { header: "NIK", render: function (r) { return RtvUI.escapeHtml(r.nik); }, width: "100px" },
                { header: "Nama", render: function (r) { return RtvUI.escapeHtml(r.nama); }, width: "160px" },
                { header: "Username", render: function (r) { return RtvUI.escapeHtml(r.username); }, width: "120px" },
                { header: "Role", render: function (r) { return RTV_ROLE_LABEL[r.role] || r.role; }, width: "130px" },
                { header: "Toko", render: function (r) { return RtvUI.escapeHtml(r.store_nama || "-"); }, width: "140px" },
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
                else if (action === "pindah") openPindahForm(row, load);
                else if (action === "nonaktifkan" || action === "aktifkan") aksiKaryawan(row, action, load);
              },
            });
            RtvUI.mount(tableWrap, table);
          })
          .catch(rtvHandleError);
      }

      return { panel: panel, load: load };
    }

    function buildMenungguPanel() {
      var reloadBtn = RtvUI.el("button", { type: "button", class: "rtv-btn rtv-btn-ghost rtv-btn-sm", onclick: function () { load(); } }, [
        RtvUI.el("i", { class: "fa-solid fa-rotate-right" }), " Muat Ulang",
      ]);
      var tableWrap = RtvUI.el("div", {}, [RtvUI.pageLoading()]);
      var panel = RtvUI.el("div", {}, [
        RtvUI.el("div", { class: "rtv-card-toolbar", style: { marginBottom: "14px", justifyContent: "flex-end" } }, [reloadBtn]),
        RtvUI.el("p", { class: "rtv-muted", style: { fontSize: "12.5px", marginTop: 0 } }, [
          "Akun hasil pendaftaran mandiri dari halaman masuk. Setujui untuk mengaktifkan, atau tolak untuk menghapusnya.",
        ]),
        tableWrap,
      ]);

      function load() {
        RtvUI.mount(tableWrap, RtvUI.pageLoading());
        RtvApi.get("/api/karyawan/menunggu")
          .then(function (data) {
            var rows = data.items || [];
            var table = RtvUI.renderTableHtml({
              columns: [
                { header: "NIK", render: function (r) { return RtvUI.escapeHtml(r.nik); }, width: "100px" },
                { header: "Nama", render: function (r) { return RtvUI.escapeHtml(r.nama); }, width: "170px" },
                { header: "Username", render: function (r) { return RtvUI.escapeHtml(r.username); }, width: "130px" },
                { header: "Role", render: function (r) { return RTV_ROLE_LABEL[r.role] || r.role; }, width: "130px" },
                { header: "Toko", render: function (r) { return RtvUI.escapeHtml(r.store_nama || "-"); }, width: "150px" },
                { header: "Tgl Daftar", render: function (r) { return rtvFormatDate(r.tgl_mulai_penempatan); }, width: "120px" },
                {
                  header: "Aksi", width: "160px",
                  render: function (r) {
                    return "<button type='button' class='rtv-link-btn' data-action='setujui' data-id='" + r._id + "'>Setujui</button>" +
                      "<button type='button' class='rtv-link-btn danger' data-action='tolak' data-id='" + r._id + "'>Tolak</button>";
                  },
                },
              ],
              rows: rows,
              emptyText: "Tidak ada akun yang menunggu persetujuan.",
              onRowAction: function (action, id) {
                var row = rows.find(function (r) { return r._id === id; });
                if (!row) return;
                var isSetujui = action === "setujui";
                RtvUI.confirmDialog({
                  title: isSetujui ? "Setujui Pendaftaran" : "Tolak Pendaftaran",
                  text: (isSetujui ? "Setujui" : "Tolak") + " pendaftaran " + row.nama + " (" + row.username + ")?",
                  okText: isSetujui ? "Ya, Setujui" : "Ya, Tolak",
                  danger: !isSetujui,
                }).then(function (ok) {
                  if (!ok) return;
                  RtvApi.post("/api/karyawan/" + row._id + "/" + action)
                    .then(function () {
                      RtvUI.toast("Pendaftaran " + row.username + " berhasil " + (isSetujui ? "disetujui" : "ditolak") + ".", "success");
                      load();
                      refreshBadge();
                    })
                    .catch(rtvHandleError);
                });
              },
            });
            RtvUI.mount(tableWrap, table);
          })
          .catch(rtvHandleError);
      }

      return { panel: panel, load: load };
    }

    function aksiKaryawan(row, action, onDone) {
      var label = action === "nonaktifkan" ? "menonaktifkan" : "mengaktifkan";
      RtvUI.confirmDialog({ title: "Konfirmasi", text: "Yakin ingin " + label + " " + row.nama + "?" }).then(function (ok) {
        if (!ok) return;
        RtvApi.post("/api/karyawan/" + row._id + "/" + action)
          .then(function () { RtvUI.toast("Berhasil " + label + " karyawan.", "success"); if (onDone) onDone(); })
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
          { name: "email", label: "Email (opsional)", type: "email" },
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
                  var payload = { nama: values.nama, email: values.email, role: values.role, shift_id: values.shift_id || null };
                  if (values.password) payload.password = values.password;
                  RtvApi.put("/api/karyawan/" + existing._id, payload)
                    .then(function () { RtvUI.toast("Data karyawan diperbarui.", "success"); modal.close(); aktifPanel.load(); })
                    .catch(function (err) { errorEl.textContent = err.message; });
                } else {
                  RtvApi.post("/api/karyawan", values)
                    .then(function () { RtvUI.toast("Karyawan baru berhasil ditambahkan.", "success"); modal.close(); aktifPanel.load(); })
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
  // Laporan: Rekap Supplier, Log Aktivitas, Ekspor Data RTV
  // ======================================================================
  function renderLaporan(container) {
    var tabsEl = RtvUI.el("div", { class: "rtv-tabs" });
    var panelWrap = RtvUI.el("div");
    var tabs = [
      { id: "rekap", label: "Rekap Klaim per Supplier" },
      { id: "audit", label: "Log Aktivitas" },
      { id: "export", label: "Ekspor Data RTV" },
    ];
    var tabEls = {};
    var panels = { rekap: buildRekapPanel(), audit: buildAuditPanel(), export: buildExportPanel() };

    tabs.forEach(function (t, idx) {
      var el = RtvUI.el("div", { class: "rtv-tab" + (idx === 0 ? " active" : "") }, [t.label]);
      el.addEventListener("click", function () { selectTab(t.id); });
      tabEls[t.id] = el;
      tabsEl.appendChild(el);
    });

    function selectTab(id) {
      Object.keys(tabEls).forEach(function (k) { tabEls[k].classList.toggle("active", k === id); });
      RtvUI.mount(panelWrap, panels[id].panel);
      panels[id].load();
    }

    var card = RtvUI.el("div", { class: "rtv-card" }, [
      RtvUI.el("div", { class: "rtv-card-header" }, [RtvUI.el("h3", {}, ["Laporan & Log Aktivitas"])]),
      tabsEl,
      panelWrap,
    ]);
    RtvUI.mount(container, card);
    selectTab("rekap");

    function buildRekapPanel() {
      var tableWrap = RtvUI.el("div", {}, [RtvUI.pageLoading()]);
      var panel = RtvUI.el("div", {}, [tableWrap]);
      function load() {
        RtvUI.mount(tableWrap, RtvUI.pageLoading());
        RtvApi.get("/api/dashboard/rekap-supplier")
          .then(function (data) {
            var rows = data.items || [];
            var table = RtvUI.renderTableHtml({
              columns: [
                { header: "No. Surat Jalan", render: function (r) { return RtvUI.escapeHtml(r.no_surat_jalan); }, width: "160px" },
                { header: "Supplier", render: function (r) { return RtvUI.escapeHtml(r.supplier_nama || "-"); }, width: "180px" },
                { header: "Jumlah Item", render: function (r) { return r.jumlah_item; }, width: "95px" },
                { header: "Tgl Kirim", render: function (r) { return rtvFormatDate(r.tgl_kirim); }, width: "115px" },
                { header: "Tgl Selesai", render: function (r) { return rtvFormatDate(r.tgl_selesai); }, width: "115px" },
                { header: "Hasil Klaim", render: function (r) { return RtvUI.escapeHtml(r.hasil_klaim || "-"); } },
              ],
              rows: rows,
              emptyText: "Belum ada data klaim.",
            });
            RtvUI.mount(tableWrap, table);
          })
          .catch(rtvHandleError);
      }
      return { panel: panel, load: load };
    }

    function buildAuditPanel() {
      var koleksiSelect = RtvUI.el("select", {}, [
        RtvUI.el("option", { value: "" }, ["Semua koleksi"]),
        RtvUI.el("option", { value: "rtv_transactions" }, ["Transaksi RTV"]),
        RtvUI.el("option", { value: "rtv_shipments" }, ["Surat Jalan"]),
        RtvUI.el("option", { value: "master_karyawan" }, ["Karyawan"]),
      ]);
      koleksiSelect.addEventListener("change", function () { load(); });
      var reloadBtn = RtvUI.el("button", { type: "button", class: "rtv-btn rtv-btn-ghost rtv-btn-sm", onclick: function () { load(); } }, [
        RtvUI.el("i", { class: "fa-solid fa-rotate-right" }), " Muat Ulang",
      ]);
      var tableWrap = RtvUI.el("div", {}, [RtvUI.pageLoading()]);
      var panel = RtvUI.el("div", {}, [
        RtvUI.el("div", { class: "rtv-card-toolbar", style: { marginBottom: "14px" } }, [koleksiSelect, reloadBtn]),
        tableWrap,
      ]);

      function load() {
        RtvUI.mount(tableWrap, RtvUI.pageLoading());
        var url = "/api/x/audit" + (koleksiSelect.value ? "?koleksi=" + encodeURIComponent(koleksiSelect.value) : "");
        RtvApi.get(url)
          .then(function (data) {
            var table = RtvUI.renderTableHtml({
              columns: [
                { header: "Waktu", render: function (r) { return rtvFormatDateTime(r.tgl); }, width: "150px" },
                { header: "Koleksi", render: function (r) { return RtvUI.escapeHtml(r.koleksi); }, width: "140px" },
                { header: "Aksi", render: function (r) { return RtvUI.escapeHtml(r.aksi); }, width: "160px" },
                { header: "Referensi", render: function (r) { return RtvUI.escapeHtml(r.ref); }, width: "150px" },
                { header: "Oleh", render: function (r) { return RtvUI.escapeHtml(r.oleh); } },
              ],
              rows: data.items || [],
              emptyText: "Belum ada log aktivitas.",
            });
            RtvUI.mount(tableWrap, table);
          })
          .catch(rtvHandleError);
      }
      return { panel: panel, load: load };
    }

    function buildExportPanel() {
      var dariInput = RtvUI.el("input", { type: "date" });
      var sampaiInput = RtvUI.el("input", { type: "date" });
      var statusSelect = RtvUI.el("select", {}, ["", "Pending", "Received", "Approved", "Rejected", "Shipped to Supplier", "Completed", "Cancelled"].map(function (s) {
        return RtvUI.el("option", { value: s }, [s || "Semua Status"]);
      }));
      var previewWrap = RtvUI.el("div", {}, [RtvUI.el("div", { class: "rtv-table-empty" }, ["Klik \"Tampilkan\" untuk melihat pratinjau data."])]);
      var exportBtn = RtvUI.el("button", { type: "button", class: "rtv-btn rtv-btn-primary rtv-btn-sm" }, [
        RtvUI.el("i", { class: "fa-solid fa-file-csv" }), " Ekspor ke CSV",
      ]);
      var previewBtn = RtvUI.el("button", { type: "button", class: "rtv-btn rtv-btn-ghost rtv-btn-sm" }, ["Tampilkan"]);

      var panel = RtvUI.el("div", {}, [
        RtvUI.el("div", { class: "rtv-form-grid" }, [
          RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, ["Dari Tanggal"]), dariInput]),
          RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, ["Sampai Tanggal"]), sampaiInput]),
          RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, ["Status"]), statusSelect]),
        ]),
        RtvUI.el("div", { class: "rtv-form-actions" }, [previewBtn, exportBtn]),
        previewWrap,
      ]);

      var lastRows = [];
      var COLS = [
        { header: "No. RTV", key: "no_rtv" },
        { header: "Toko", key: "toko" },
        { header: "Supplier", key: "supplier" },
        { header: "Barcode", key: "barcode" },
        { header: "Produk", key: "produk" },
        { header: "Qty Diajukan", key: "qty_diajukan" },
        { header: "Qty Diterima", key: "qty_diterima" },
        { header: "Harga", key: "harga" },
        { header: "Nilai", key: "nilai" },
        { header: "Status", key: "status" },
        { header: "Kategori", key: "kategori" },
        { header: "Batch", key: "batch" },
        { header: "No. Surat Jalan", key: "surat_jalan" },
        { header: "Tgl Diajukan", key: "tgl_input" },
      ];

      function fetchRows() {
        var params = [];
        if (dariInput.value) params.push("dari=" + dariInput.value);
        if (sampaiInput.value) params.push("sampai=" + sampaiInput.value);
        if (statusSelect.value) params.push("status=" + encodeURIComponent(statusSelect.value));
        return RtvApi.get("/api/x/rtv-export" + (params.length ? "?" + params.join("&") : "")).then(function (data) {
          lastRows = data.items || [];
          return lastRows;
        });
      }

      previewBtn.addEventListener("click", function () {
        RtvUI.mount(previewWrap, RtvUI.pageLoading());
        fetchRows().then(function (rows) {
          var table = RtvUI.renderTableHtml({
            columns: [
              { header: "No. RTV", render: function (r) { return RtvUI.escapeHtml(r.no_rtv); }, width: "130px" },
              { header: "Toko", render: function (r) { return RtvUI.escapeHtml(r.toko); }, width: "130px" },
              { header: "Produk", render: function (r) { return RtvUI.escapeHtml(r.produk); } },
              { header: "Status", render: function (r) { return rtvStatusBadge(r.status); }, width: "150px" },
              { header: "Nilai", render: function (r) { return rtvFormatCurrency(r.nilai); }, width: "120px" },
            ],
            rows: rows.slice(0, 50),
            emptyText: "Tidak ada data untuk filter ini.",
          });
          RtvUI.mount(previewWrap, RtvUI.el("div", {}, [
            RtvUI.el("p", { class: "rtv-muted", style: { fontSize: "12.5px" } }, [
              "Menampilkan " + Math.min(rows.length, 50) + " dari " + rows.length + " baris. Gunakan \"Ekspor ke CSV\" untuk mengunduh semuanya.",
            ]),
            table,
          ]));
        }).catch(rtvHandleError);
      });

      exportBtn.addEventListener("click", function () {
        fetchRows().then(function (rows) {
          RtvUx.exportCsv("data-rtv.csv", rows, COLS);
        }).catch(rtvHandleError);
      });

      return { panel: panel, load: function () {} };
    }
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