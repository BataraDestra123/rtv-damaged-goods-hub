/**
 * Views untuk role Staff Gudang:
 *  - Retur Pending: antrian kerja harian + pencarian cepat No. RTV (kompatibel
 *    dengan pemindai barcode USB/Bluetooth yang mengetik + Enter) + Terima
 *    & Periksa Barang (qty, kategori, batch, lokasi karantina, selisih+foto)
 *  - Stok & Umur Karantina: rincian stok Received dengan umur hari & level
 *    peringatan (normal/perhatian/kritis)
 *  - Packing List: daftar barang Approved siap dikemas, dikelompokkan per
 *    supplier, dengan tombol cetak
 * Vanilla JS, tanpa Webix.
 */
var RtvGudang = (function () {
  var KATEGORI = ["Fisik Rusak", "Kedaluwarsa", "Kemasan Cacat", "Salah Kirim", "Lainnya"];

  function mapRow(it) {
    it.product_nama = it.product ? it.product.nama_produk : "-";
    it.store_nama = it.store ? it.store.nama_store : "-";
    return it;
  }

  function antrianCards(wrap) {
    RtvApi.get("/api/x/antrian")
      .then(function (a) {
        RtvUI.mount(wrap, RtvUI.el("div", { class: "rtv-kpi-grid" }, [
          antrianCard("fa-inbox", "var(--rtv-yellow)", "Menunggu Diterima", a.pending),
          antrianCard("fa-magnifying-glass", "var(--rtv-blue)", "Menunggu Verifikasi Admin", a.menunggu_verifikasi),
          antrianCard("fa-box-open", "var(--rtv-purple)", "Siap Dikemas (Approved)", a.siap_kirim),
          antrianCard("fa-triangle-exclamation", "var(--rtv-red)", "Stok Karantina Kritis", a.kritis),
        ]));
      })
      .catch(function () { RtvUI.mount(wrap, RtvUI.el("div", {})); });
  }

  function antrianCard(icon, color, label, value) {
    return RtvUI.el("div", { class: "rtv-kpi-card compact" }, [
      RtvUI.el("div", { class: "rtv-kpi-icon", style: { background: color } }, [RtvUI.el("i", { class: "fa-solid " + icon })]),
      RtvUI.el("div", { class: "rtv-kpi-body" }, [
        RtvUI.el("div", { class: "rtv-kpi-value" }, [String(value || 0)]),
        RtvUI.el("div", { class: "rtv-kpi-label" }, [label]),
      ]),
    ]);
  }

  // ---------------- Retur Pending ----------------
  function renderPending(container) {
    var antrianWrap = RtvUI.el("div", {}, [RtvUI.pageLoading()]);

    var scanInput = RtvUI.el("input", {
      type: "text", placeholder: "Pindai atau ketik No. RTV lalu Enter...", autocomplete: "off",
    });
    var scanBox = RtvUI.el("div", { class: "rtv-search-box", style: { maxWidth: "320px" } }, [
      RtvUI.el("i", { class: "fa-solid fa-barcode" }), scanInput,
    ]);
    scanInput.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      var q = scanInput.value.trim();
      if (!q) return;
      RtvApi.get("/api/x/cari-rtv?q=" + encodeURIComponent(q))
        .then(function (data) {
          scanInput.value = "";
          RtvUI.toast("Ditemukan: " + data.item.no_rtv + " — status " + data.item.status, "success");
          loadPending();
        })
        .catch(function (err) {
          scanInput.select();
          rtvHandleError(err);
        });
    });

    var reloadBtn = RtvUI.el("button", { type: "button", class: "rtv-btn rtv-btn-ghost rtv-btn-sm", onclick: function () { loadPending(); antrianCards(antrianWrap); } }, [
      RtvUI.el("i", { class: "fa-solid fa-rotate-right" }), " Muat Ulang",
    ]);
    var tableWrap = RtvUI.el("div", {}, [RtvUI.pageLoading()]);

    var card = RtvUI.el("div", { class: "rtv-card" }, [
      RtvUI.el("div", { class: "rtv-card-header" }, [
        RtvUI.el("h3", {}, ["Daftar Retur Pending (semua toko)"]),
        RtvUI.el("div", { class: "rtv-card-toolbar" }, [scanBox, reloadBtn]),
      ]),
      tableWrap,
    ]);
    RtvUI.mount(container, RtvUI.el("div", {}, [antrianWrap, RtvUI.el("div", { style: { height: "18px" } }), card]));
    antrianCards(antrianWrap);
    loadPending();

    function loadPending() {
      RtvUI.mount(tableWrap, RtvUI.pageLoading());
      RtvApi.get("/api/gudang/retur?status=Pending")
        .then(function (data) {
          var rows = (data.items || []).map(mapRow);
          var table = RtvUI.renderTableHtml({
            columns: [
              { header: "No. RTV", render: function (r) { return RtvUI.escapeHtml(r.no_rtv); }, width: "140px" },
              { header: "Toko Asal", render: function (r) { return RtvUI.escapeHtml(r.store_nama); }, width: "150px" },
              { header: "Produk", render: function (r) { return RtvUI.escapeHtml(r.product_nama); } },
              { header: "Qty Diajukan", render: function (r) { return r.qty_diajukan; }, width: "95px" },
              { header: "Alasan", render: function (r) { return RtvUI.escapeHtml(r.alasan); }, width: "200px" },
              { header: "Tgl Ajuan", render: function (r) { return rtvFormatDate(r.tgl_input); }, width: "120px" },
              {
                header: "Aksi", width: "190px",
                render: function (r) {
                  return "<button type='button' class='rtv-link-btn' data-action='terima' data-id='" + r._id + "'>Terima</button>" +
                    "<button type='button' class='rtv-link-btn' data-action='foto' data-id='" + r._id + "'>Foto</button>" +
                    "<button type='button' class='rtv-link-btn' data-action='riwayat' data-id='" + r._id + "'>Riwayat</button>";
                },
              },
            ],
            rows: rows,
            emptyText: "Tidak ada retur pending saat ini.",
            onRowAction: function (action, id) {
              var row = rows.find(function (r) { return r._id === id; });
              if (!row) return;
              if (action === "terima") openTerimaModal(row, function () { loadPending(); antrianCards(antrianWrap); });
              if (action === "riwayat") rtvOpenRiwayatModal(row._id, row.no_rtv);
              if (action === "foto") openFotoViewModal(row._id, row.no_rtv);
            },
          });
          RtvUI.mount(tableWrap, table);
        })
        .catch(rtvHandleError);
    }
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

  function openTerimaModal(row, onDone) {
    var qtyInput = RtvUI.el("input", { type: "number", min: "1", value: String(row.qty_diajukan) });
    var kategoriSelect = RtvUI.el("select", {}, [RtvUI.el("option", { value: "" }, ["Pilih kategori..."])].concat(
      KATEGORI.map(function (k) { return RtvUI.el("option", { value: k }, [k]); })
    ));
    var batchInput = RtvUI.el("input", { type: "text", placeholder: "Opsional" });
    var lokasiInput = RtvUI.el("input", { type: "text", placeholder: "Misal: Rak A1 / Zona Karantina 2" });
    var tglInput = RtvUI.el("input", { type: "date" });
    var catatanWrap = RtvUI.el("div", { class: "rtv-field", style: { display: "none" } });
    var catatanInput = RtvUI.el("textarea", { rows: "2", placeholder: "Jelaskan sebab selisih qty..." });
    RtvUI.mount(catatanWrap, RtvUI.el("div", {}, [RtvUI.el("label", {}, ["Catatan Selisih Qty (wajib jika qty diterima ≠ diajukan)"]), catatanInput]));

    var photoPicker = RtvUx.photoPicker({ max: 3 });
    var photoHint = RtvUI.el("div", { class: "rtv-muted", style: { fontSize: "12px", marginTop: "4px" } }, [
      "Foto bukti wajib jika qty diterima berbeda dari qty diajukan.",
    ]);
    var errorEl = RtvUI.el("div", { class: "rtv-field-error" });

    function checkSelisih() {
      var diff = Number(qtyInput.value || 0) !== row.qty_diajukan;
      catatanWrap.style.display = diff ? "" : "none";
    }
    qtyInput.addEventListener("input", checkSelisih);
    checkSelisih();

    var body = RtvUI.el("div", {}, [
      RtvUI.el("p", { class: "rtv-muted", style: { marginTop: 0, fontSize: "13px" } }, [
        "Produk: ", RtvUI.el("strong", {}, [row.product_nama]), " — Qty diajukan: ", RtvUI.el("strong", {}, [String(row.qty_diajukan)]),
      ]),
      RtvUI.el("div", { class: "rtv-form-grid" }, [
        RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, ["Qty Diterima (fisik)"]), qtyInput]),
        RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, ["Kategori Kerusakan"]), kategoriSelect]),
        RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, ["Batch (opsional)"]), batchInput]),
        RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, ["Lokasi Karantina (opsional)"]), lokasiInput]),
        RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, ["Tanggal Kedaluwarsa (opsional)"]), tglInput]),
      ]),
      catatanWrap,
      RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, ["Foto Bukti Kondisi Barang"]), photoPicker.el, photoHint]),
      errorEl,
    ]);

    var modal = RtvUI.openModal({
      title: "Terima & Periksa Barang — " + row.no_rtv,
      bodyNode: body,
      wide: true,
      footer: [
        { label: "Batal", variant: "ghost" },
        {
          label: "Simpan Penerimaan", variant: "primary", closeOnClick: false,
          onClick: function () {
            errorEl.textContent = "";
            var qty = Number(qtyInput.value || 0);
            if (!qty || qty < 1) { errorEl.textContent = "Qty diterima harus lebih dari 0."; return false; }
            if (!kategoriSelect.value) { errorEl.textContent = "Kategori kerusakan wajib dipilih."; return false; }

            var payload = {
              qty_diterima: qty,
              kategori_kerusakan: kategoriSelect.value,
              batch: batchInput.value || "",
              lokasi_karantina: lokasiInput.value || "",
              foto: photoPicker.getPhotos(),
            };
            if (tglInput.value) payload.tgl_kedaluwarsa = tglInput.value;
            if (qty !== row.qty_diajukan) payload.catatan_selisih = catatanInput.value.trim();

            RtvApi.post("/api/gudang/retur/" + row._id + "/terima", payload)
              .then(function () {
                RtvUI.toast(row.no_rtv + " diterima, status menjadi Received.", "success");
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

  // ---------------- Stok & Umur Karantina ----------------
  function renderStok(container) {
    var reloadBtn = RtvUI.el("button", { type: "button", class: "rtv-btn rtv-btn-ghost rtv-btn-sm", onclick: function () { loadStok(); } }, [
      RtvUI.el("i", { class: "fa-solid fa-rotate-right" }), " Muat Ulang",
    ]);
    var exportBtn = RtvUI.el("button", { type: "button", class: "rtv-btn rtv-btn-ghost rtv-btn-sm" }, [
      RtvUI.el("i", { class: "fa-solid fa-file-csv" }), " Ekspor CSV",
    ]);
    var summaryWrap = RtvUI.el("div", {}, [RtvUI.pageLoading()]);
    var tableWrap = RtvUI.el("div", {}, [RtvUI.pageLoading()]);

    var card = RtvUI.el("div", { class: "rtv-card" }, [
      RtvUI.el("div", { class: "rtv-card-header" }, [
        RtvUI.el("h3", {}, ["Stok Barang Rusak di Karantina"]),
        RtvUI.el("div", { class: "rtv-card-toolbar" }, [exportBtn, reloadBtn]),
      ]),
      tableWrap,
    ]);
    RtvUI.mount(container, RtvUI.el("div", {}, [summaryWrap, RtvUI.el("div", { style: { height: "18px" } }), card]));
    loadStok();

    var lastRows = [];
    exportBtn.addEventListener("click", function () {
      RtvUx.exportCsv("stok-karantina.csv", lastRows, [
        { header: "No. RTV", key: "no_rtv" },
        { header: "Produk", key: "nama_produk" },
        { header: "Barcode", key: "barcode" },
        { header: "Qty", key: "qty" },
        { header: "Batch", key: "batch" },
        { header: "Lokasi", key: "lokasi" },
        { header: "Toko", key: "toko" },
        { header: "Umur (hari)", key: "umur_hari" },
        { header: "Level", key: "level" },
      ]);
    });

    function loadStok() {
      RtvUI.mount(tableWrap, RtvUI.pageLoading());
      RtvApi.get("/api/x/stok-aging")
        .then(function (data) {
          lastRows = data.items || [];
          var s = data.summary || {};
          RtvUI.mount(summaryWrap, RtvUI.el("div", { class: "rtv-kpi-grid" }, [
            antrianCard("fa-boxes-stacked", "var(--rtv-blue)", "Total Qty Karantina", s.total_qty || 0),
            antrianCard("fa-clipboard-list", "var(--rtv-teal)", "Jumlah RTV", s.jumlah_rtv || 0),
            antrianCard("fa-triangle-exclamation", "var(--rtv-red)", "Kritis (≥ " + (s.batas_kritis || 30) + " hari)", s.kritis || 0),
            antrianCard("fa-clock", "var(--rtv-yellow)", "Perhatian (≥ " + (s.batas_perhatian || 14) + " hari)", s.perhatian || 0),
          ]));

          var table = RtvUI.renderTableHtml({
            columns: [
              { header: "No. RTV", render: function (r) { return RtvUI.escapeHtml(r.no_rtv); }, width: "130px" },
              { header: "Produk", render: function (r) { return RtvUI.escapeHtml(r.nama_produk); } },
              { header: "Qty", render: function (r) { return r.qty; }, width: "60px" },
              { header: "Batch", render: function (r) { return RtvUI.escapeHtml(r.batch || "-"); }, width: "90px" },
              { header: "Lokasi", render: function (r) { return RtvUI.escapeHtml(r.lokasi || "-"); }, width: "120px" },
              { header: "Toko", render: function (r) { return RtvUI.escapeHtml(r.toko); }, width: "130px" },
              { header: "Umur", render: function (r) { return RtvUx.agingBadge(r.level, r.umur_hari); }, width: "140px" },
            ],
            rows: lastRows,
            emptyText: "Belum ada stok barang rusak di karantina.",
          });
          RtvUI.mount(tableWrap, table);
        })
        .catch(rtvHandleError);
    }
  }

  // ---------------- Packing List ----------------
  function renderPackingList(container) {
    var reloadBtn = RtvUI.el("button", { type: "button", class: "rtv-btn rtv-btn-ghost rtv-btn-sm", onclick: function () { load(); } }, [
      RtvUI.el("i", { class: "fa-solid fa-rotate-right" }), " Muat Ulang",
    ]);
    var wrap = RtvUI.el("div", {}, [RtvUI.pageLoading()]);
    var card = RtvUI.el("div", { class: "rtv-card" }, [
      RtvUI.el("div", { class: "rtv-card-header" }, [
        RtvUI.el("h3", {}, ["Packing List — Siap Dikemas per Supplier"]),
        reloadBtn,
      ]),
      wrap,
    ]);
    RtvUI.mount(container, card);
    load();

    function load() {
      RtvUI.mount(wrap, RtvUI.pageLoading());
      RtvApi.get("/api/x/packing-list")
        .then(function (data) {
          var groups = data.items || [];
          if (!groups.length) {
            RtvUI.mount(wrap, RtvUI.el("div", { class: "rtv-table-empty" }, ["Belum ada barang berstatus Approved yang siap dikemas."]));
            return;
          }
          var out = RtvUI.el("div", {});
          groups.forEach(function (g) {
            var printBtn = RtvUI.el("button", {
              type: "button", class: "rtv-btn rtv-btn-ghost rtv-btn-sm",
              onclick: function () { RtvPrint.packingListGroup(g); },
            }, [RtvUI.el("i", { class: "fa-solid fa-print" }), " Cetak"]);

            var table = RtvUI.renderTableHtml({
              columns: [
                { header: "No. RTV", render: function (r) { return RtvUI.escapeHtml(r.no_rtv); }, width: "130px" },
                { header: "Produk", render: function (r) { return RtvUI.escapeHtml(r.nama_produk); } },
                { header: "Qty", render: function (r) { return r.qty; }, width: "60px" },
                { header: "Lokasi", render: function (r) { return RtvUI.escapeHtml(r.lokasi || "-"); }, width: "120px" },
                { header: "Toko", render: function (r) { return RtvUI.escapeHtml(r.toko); }, width: "130px" },
                { header: "Nilai", render: function (r) { return rtvFormatCurrency(r.nilai); }, width: "120px" },
              ],
              rows: g.items,
              emptyText: "-",
            });

            out.appendChild(RtvUI.el("div", { class: "rtv-card", style: { marginBottom: "16px" } }, [
              RtvUI.el("div", { class: "rtv-card-header" }, [
                RtvUI.el("h3", {}, [g.supplier.nama + " (" + g.items.length + " item, total qty " + g.total_qty + ")"]),
                printBtn,
              ]),
              table,
            ]));
          });
          RtvUI.mount(wrap, out);
        })
        .catch(rtvHandleError);
    }
  }

  return { renderPending: renderPending, renderStok: renderStok, renderPackingList: renderPackingList };
})();