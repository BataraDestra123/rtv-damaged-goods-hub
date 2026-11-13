/**
 * Views untuk role Staff Gudang:
 *  - Daftar Retur Pending + Terima dan Periksa Barang
 *  - Lihat Stok Barang Rusak (agregat dari status Received)
 * Vanilla JS, tanpa Webix.
 */
var RtvGudang = (function () {
  var KATEGORI = ["Fisik Rusak", "Kedaluwarsa", "Kemasan Cacat", "Salah Kirim", "Lainnya"];

  function mapRow(it) {
    it.product_nama = it.product ? it.product.nama_produk : "-";
    it.store_nama = it.store ? it.store.nama_store : "-";
    return it;
  }

  // ---------------- Retur Pending ----------------
  function renderPending(container) {
    var reloadBtn = RtvUI.el("button", { type: "button", class: "rtv-btn rtv-btn-ghost rtv-btn-sm", onclick: function () { loadPending(); } }, [
      RtvUI.el("i", { class: "fa-solid fa-rotate-right" }), " Muat Ulang",
    ]);
    var tableWrap = RtvUI.el("div", {}, [RtvUI.pageLoading()]);

    var card = RtvUI.el("div", { class: "rtv-card" }, [
      RtvUI.el("div", { class: "rtv-card-header" }, [
        RtvUI.el("h3", {}, ["Daftar Retur Pending (semua toko)"]),
        reloadBtn,
      ]),
      tableWrap,
    ]);
    RtvUI.mount(container, card);
    loadPending();

    function loadPending() {
      RtvUI.mount(tableWrap, RtvUI.pageLoading());
      RtvApi.get("/api/gudang/retur?status=Pending")
        .then(function (data) {
          var rows = (data.items || []).map(mapRow);
          var table = RtvUI.renderTableHtml({
            columns: [
              { header: "No. RTV", render: function (r) { return RtvUI.escapeHtml(r.no_rtv); }, width: "140px" },
              { header: "Toko Asal", render: function (r) { return RtvUI.escapeHtml(r.store_nama); }, width: "160px" },
              { header: "Produk", render: function (r) { return RtvUI.escapeHtml(r.product_nama); } },
              { header: "Qty Diajukan", render: function (r) { return r.qty_diajukan; }, width: "100px" },
              { header: "Alasan", render: function (r) { return RtvUI.escapeHtml(r.alasan); }, width: "220px" },
              { header: "Tgl Ajuan", render: function (r) { return rtvFormatDate(r.tgl_input); }, width: "130px" },
              {
                header: "Aksi", width: "100px",
                render: function (r) { return "<button type='button' class='rtv-link-btn' data-action='terima' data-id='" + r._id + "'>Terima</button>"; },
              },
            ],
            rows: rows,
            emptyText: "Tidak ada retur pending saat ini.",
            onRowAction: function (action, id) {
              if (action === "terima") {
                var row = rows.find(function (r) { return r._id === id; });
                if (row) openTerimaModal(row, loadPending);
              }
            },
          });
          RtvUI.mount(tableWrap, table);
        })
        .catch(rtvHandleError);
    }
  }

  function openTerimaModal(row, onDone) {
    var qtyInput = RtvUI.el("input", { type: "number", min: "1", value: String(row.qty_diajukan) });
    var kategoriSelect = RtvUI.el("select", {}, [RtvUI.el("option", { value: "" }, ["Pilih kategori..."])].concat(
      KATEGORI.map(function (k) { return RtvUI.el("option", { value: k }, [k]); })
    ));
    var batchInput = RtvUI.el("input", { type: "text", placeholder: "Opsional" });
    var tglInput = RtvUI.el("input", { type: "date" });
    var errorEl = RtvUI.el("div", { class: "rtv-field-error" });

    var body = RtvUI.el("div", {}, [
      RtvUI.el("p", { class: "rtv-muted", style: { marginTop: 0, fontSize: "13px" } }, [
        "Produk: ", RtvUI.el("strong", {}, [row.product_nama]), " — Qty diajukan: ", RtvUI.el("strong", {}, [String(row.qty_diajukan)]),
      ]),
      RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, ["Qty Diterima (fisik)"]), qtyInput]),
      RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, ["Kategori Kerusakan"]), kategoriSelect]),
      RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, ["Batch (opsional)"]), batchInput]),
      RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, ["Tanggal Kedaluwarsa (opsional)"]), tglInput]),
      errorEl,
    ]);

    var modal = RtvUI.openModal({
      title: "Terima & Periksa Barang — " + row.no_rtv,
      bodyNode: body,
      footer: [
        { label: "Batal", variant: "ghost" },
        {
          label: "Simpan Penerimaan", variant: "primary", closeOnClick: false,
          onClick: function () {
            errorEl.textContent = "";
            var qty = Number(qtyInput.value || 0);
            if (!qty || qty < 1) { errorEl.textContent = "Qty diterima harus lebih dari 0."; return false; }
            if (!kategoriSelect.value) { errorEl.textContent = "Kategori kerusakan wajib dipilih."; return false; }

            var payload = { qty_diterima: qty, kategori_kerusakan: kategoriSelect.value, batch: batchInput.value || "" };
            if (tglInput.value) payload.tgl_kedaluwarsa = tglInput.value;

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

  // ---------------- Stok Barang Rusak ----------------
  function renderStok(container) {
    var reloadBtn = RtvUI.el("button", { type: "button", class: "rtv-btn rtv-btn-ghost rtv-btn-sm", onclick: function () { loadStok(); } }, [
      RtvUI.el("i", { class: "fa-solid fa-rotate-right" }), " Muat Ulang",
    ]);
    var tableWrap = RtvUI.el("div", {}, [RtvUI.pageLoading()]);

    var card = RtvUI.el("div", { class: "rtv-card" }, [
      RtvUI.el("div", { class: "rtv-card-header" }, [
        RtvUI.el("h3", {}, ["Stok Barang Rusak (Status Received)"]),
        reloadBtn,
      ]),
      tableWrap,
    ]);
    RtvUI.mount(container, card);
    loadStok();

    function loadStok() {
      RtvUI.mount(tableWrap, RtvUI.pageLoading());
      RtvApi.get("/api/gudang/stok")
        .then(function (data) {
          var rows = data.items || [];
          var table = RtvUI.renderTableHtml({
            columns: [
              { header: "Produk", render: function (r) { return RtvUI.escapeHtml(r.nama_produk); } },
              { header: "Barcode", render: function (r) { return RtvUI.escapeHtml(r.barcode); }, width: "150px" },
              { header: "Total Qty Rusak", render: function (r) { return r.total_qty; }, width: "140px" },
              { header: "Jumlah RTV", render: function (r) { return r.jumlah_transaksi; }, width: "120px" },
              {
                header: "Peringatan", width: "160px",
                render: function (r) {
                  return r.warning
                    ? "<span style='color:var(--rtv-red);font-weight:600;'><i class='fa-solid fa-triangle-exclamation'></i> Melebihi batas</span>"
                    : "<span class='rtv-muted'>Normal</span>";
                },
              },
            ],
            rows: rows,
            emptyText: "Belum ada stok barang rusak.",
          });
          RtvUI.mount(tableWrap, table);
        })
        .catch(rtvHandleError);
    }
  }

  return { renderPending: renderPending, renderStok: renderStok };
})();
