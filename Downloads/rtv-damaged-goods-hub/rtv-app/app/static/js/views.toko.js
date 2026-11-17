/**
 * Views untuk role Staff Toko:
 *  - Ringkasan (dashboard lengkap 7 status + nilai bulan ini + perlu tindakan)
 *  - Ajukan Retur Barang Rusak (bisa beberapa barang sekaligus + foto bukti,
 *    dengan draft otomatis tersimpan di browser selama belum terkirim)
 *  - Lihat Status Pengajuan Toko + Batalkan (selama Pending) + Ajukan Ulang
 *    (untuk yang Rejected) + Cetak Berita Acara + Lihat Foto Bukti
 * Vanilla JS, tanpa Webix.
 */
var RtvToko = (function () {
  var DRAFT_KEY = "rtv_draft_ajukan_v1";

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

  function openFotoModal(rtvId, noRtv) {
    var body = RtvUI.el("div", {}, [RtvUI.pageLoading()]);
    RtvUI.openModal({ title: "Foto Bukti — " + (noRtv || ""), bodyNode: body });
    RtvApi.get("/api/x/rtv/" + rtvId + "/foto")
      .then(function (data) {
        var items = data.items || [];
        if (!items.length) {
          RtvUI.mount(body, RtvUI.el("div", { class: "rtv-table-empty" }, ["Tidak ada foto bukti untuk retur ini."]));
          return;
        }
        var grid = RtvUI.el("div", { class: "rtv-photo-view-grid" });
        items.forEach(function (f) {
          var img = RtvUI.el("img", { src: f.data, alt: "Foto bukti", onclick: function () { window.open(f.data, "_blank"); } });
          grid.appendChild(img);
        });
        RtvUI.mount(body, RtvUI.el("div", {}, [
          RtvUI.el("p", { class: "rtv-muted", style: { fontSize: "12.5px", marginTop: 0 } }, ["Klik foto untuk membuka ukuran penuh di tab baru."]),
          grid,
        ]));
      })
      .catch(function (err) { RtvUI.mount(body, RtvUI.el("div", { class: "rtv-field-error" }, [err.message])); });
  }

  // ======================================================================
  // Ringkasan
  // ======================================================================
  function renderRingkasan(container) {
    var kpiGrid = RtvUI.el("div", { class: "rtv-kpi-grid" }, [
      kpiCard("fa-hourglass-half", "var(--rtv-yellow)", "Pending", "0"),
      kpiCard("fa-dolly", "var(--rtv-blue)", "Diterima Gudang", "0"),
      kpiCard("fa-circle-check", "var(--rtv-green)", "Approved", "0"),
      kpiCard("fa-circle-xmark", "var(--rtv-red)", "Rejected", "0"),
      kpiCard("fa-truck", "var(--rtv-purple)", "Dikirim ke Supplier", "0"),
      kpiCard("fa-flag-checkered", "var(--rtv-teal)", "Selesai", "0"),
      kpiCard("fa-calendar-days", "var(--rtv-orange)", "Diajukan Bulan Ini", "0"),
    ]);

    var banner = RtvUI.el("div", { style: { display: "none" } });

    var tableCard = RtvUI.el("div", { class: "rtv-card" }, [
      RtvUI.el("div", { class: "rtv-card-header" }, [RtvUI.el("h3", {}, ["RTV Terbaru"])]),
      RtvUI.el("div", { id: "toko-ringkasan-table-wrap" }, [RtvUI.pageLoading()]),
    ]);

    RtvUI.mount(container, RtvUI.el("div", {}, [banner, kpiGrid, tableCard]));

    RtvApi.get("/api/dashboard/summary")
      .then(function (data) {
        var c = data.status_counts || {};
        var vals = kpiGrid.querySelectorAll(".rtv-kpi-value");
        vals[0].textContent = c.Pending || 0;
        vals[1].textContent = c.Received || 0;
        vals[2].textContent = c.Approved || 0;
        vals[3].textContent = c.Rejected || 0;
        vals[4].textContent = c["Shipped to Supplier"] || 0;
        vals[5].textContent = c.Completed || 0;
        vals[6].textContent = data.bulan_ini || 0;

        if (data.perlu_tindakan > 0) {
          RtvUI.mount(banner, RtvUI.el("div", { class: "rtv-alert-banner" }, [
            RtvUI.el("i", { class: "fa-solid fa-triangle-exclamation" }),
            RtvUI.el("span", {}, [
              data.perlu_tindakan + " retur ditolak dan bisa diajukan ulang. ",
            ]),
            RtvUI.el("button", {
              type: "button", class: "rtv-btn rtv-btn-ghost rtv-btn-sm",
              onclick: function () { RtvUI.router.navigate("toko-status"); },
            }, ["Lihat & Ajukan Ulang"]),
          ]));
          banner.style.display = "";
        }
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

  // ======================================================================
  // Ajukan Retur (multi-item + foto + draft otomatis)
  // ======================================================================
  function renderAjukan(container) {
    var produkOptions = [];
    var rows = []; // { id, wrap, productSelect, qtyInput, alasanInput }
    var rowSeq = 0;
    var errorEl = RtvUI.el("div", { class: "rtv-field-error" });
    var rowsWrap = RtvUI.el("div", { id: "toko-ajukan-rows" });
    var photoPicker = RtvUx.photoPicker({ max: 3 });
    var submitBtn = RtvUI.el("button", { type: "submit", class: "rtv-btn rtv-btn-primary" }, [
      RtvUI.el("i", { class: "fa-solid fa-paper-plane" }), " Ajukan Retur",
    ]);
    var draftBanner = RtvUI.el("div", { style: { display: "none" } });

    function saveDraft() {
      var data = rows.map(function (r) {
        return { product_id: r.productSelect.value, qty: r.qtyInput.value, alasan: r.alasanInput.value };
      });
      try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(data)); } catch (e) { /* diabaikan */ }
    }
    var saveDraftDebounced = RtvUx.debounce(saveDraft, 500);

    function clearDraft() {
      try { window.localStorage.removeItem(DRAFT_KEY); } catch (e) { /* diabaikan */ }
    }

    function makeProdukSelect() {
      var sel = RtvUI.el("select", {}, [RtvUI.el("option", { value: "" }, ["Pilih produk..."])].concat(
        produkOptions.map(function (p) { return RtvUI.el("option", { value: p._id }, [p.nama_produk + " (" + p.barcode + ")"]); })
      ));
      return sel;
    }

    function addRow(prefill) {
      var id = "row" + (rowSeq++);
      var productSelect = makeProdukSelect();
      var qtyInput = RtvUI.el("input", { type: "number", min: "1", value: String((prefill && prefill.qty) || "1") });
      var alasanInput = RtvUI.el("textarea", { rows: "2", placeholder: "Jelaskan kondisi kerusakan barang..." }, [prefill && prefill.alasan || ""]);
      if (prefill && prefill.alasan) alasanInput.value = prefill.alasan;

      [productSelect, qtyInput, alasanInput].forEach(function (inp) {
        inp.addEventListener("input", saveDraftDebounced);
        inp.addEventListener("change", saveDraftDebounced);
      });

      var removeBtn = RtvUI.el("button", {
        type: "button", class: "rtv-icon-btn rtv-item-remove", title: "Hapus barang ini",
        onclick: function () { removeRow(id); },
      }, [RtvUI.el("i", { class: "fa-solid fa-trash" })]);

      var wrap = RtvUI.el("div", { class: "rtv-item-row", "data-row-id": id }, [
        RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, ["Produk"]), productSelect]),
        RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, ["Qty"]), qtyInput]),
        RtvUI.el("div", { class: "rtv-field" }, [RtvUI.el("label", {}, ["Alasan Kerusakan"]), alasanInput]),
        removeBtn,
      ]);

      var entry = { id: id, wrap: wrap, productSelect: productSelect, qtyInput: qtyInput, alasanInput: alasanInput };
      rows.push(entry);
      rowsWrap.appendChild(wrap);
      if (prefill && prefill.product_id) productSelect.value = prefill.product_id;
      updateRemoveButtons();
      return entry;
    }

    function removeRow(id) {
      var idx = rows.findIndex(function (r) { return r.id === id; });
      if (idx === -1) return;
      rows[idx].wrap.remove();
      rows.splice(idx, 1);
      updateRemoveButtons();
      saveDraft();
    }

    function updateRemoveButtons() {
      rowsWrap.querySelectorAll(".rtv-item-remove").forEach(function (btn) {
        btn.style.visibility = rows.length > 1 ? "visible" : "hidden";
      });
    }

    var addRowBtn = RtvUI.el("button", {
      type: "button", class: "rtv-btn rtv-btn-ghost rtv-btn-sm",
      onclick: function () { addRow(); },
    }, [RtvUI.el("i", { class: "fa-solid fa-plus" }), " Tambah Barang Lain"]);

    var form = RtvUI.el(
      "form",
      {
        onsubmit: function (e) {
          e.preventDefault();
          submitAjukan();
        },
      },
      [
        rowsWrap,
        addRowBtn,
        RtvUI.el("div", { class: "rtv-field", style: { marginTop: "18px" } }, [
          RtvUI.el("label", {}, ["Foto Bukti Kerusakan (opsional, maks. 3 — berlaku untuk barang pertama)"]),
          photoPicker.el,
        ]),
        errorEl,
        RtvUI.el("div", { class: "rtv-form-actions" }, [
          submitBtn,
          RtvUI.el("button", {
            type: "button", class: "rtv-btn rtv-btn-ghost",
            onclick: function () { resetForm(); },
          }, ["Bersihkan Form"]),
        ]),
      ]
    );

    var card = RtvUI.el("div", { class: "rtv-card" }, [
      RtvUI.el("div", { class: "rtv-card-header" }, [RtvUI.el("h3", {}, ["Form Pengajuan Retur Barang Rusak"])]),
      draftBanner,
      form,
    ]);

    RtvUI.mount(container, card);

    function resetForm(skipDraftClear) {
      rowsWrap.innerHTML = "";
      rows = [];
      addRow();
      photoPicker.clear();
      errorEl.textContent = "";
      if (!skipDraftClear) clearDraft();
    }

    RtvApi.get("/api/produk")
      .then(function (data) {
        produkOptions = data.items || [];
        resetForm(true);

        var draftRaw = null;
        try { draftRaw = window.localStorage.getItem(DRAFT_KEY); } catch (e) { /* diabaikan */ }
        if (draftRaw) {
          try {
            var draftRows = JSON.parse(draftRaw);
            if (draftRows && draftRows.length && draftRows.some(function (r) { return r.product_id || r.alasan; })) {
              RtvUI.mount(draftBanner, RtvUI.el("div", { class: "rtv-alert-banner" }, [
                RtvUI.el("i", { class: "fa-solid fa-floppy-disk" }),
                RtvUI.el("span", {}, ["Ditemukan draft pengajuan yang belum terkirim."]),
                RtvUI.el("button", {
                  type: "button", class: "rtv-btn rtv-btn-primary rtv-btn-sm",
                  onclick: function () {
                    rowsWrap.innerHTML = "";
                    rows = [];
                    draftRows.forEach(function (r) { addRow({ product_id: r.product_id, qty: r.qty, alasan: r.alasan }); });
                    if (!rows.length) addRow();
                    draftBanner.style.display = "none";
                  },
                }, ["Lanjutkan Draft"]),
                RtvUI.el("button", {
                  type: "button", class: "rtv-btn rtv-btn-ghost rtv-btn-sm",
                  onclick: function () { clearDraft(); draftBanner.style.display = "none"; },
                }, ["Buang"]),
              ]));
              draftBanner.style.display = "";
            }
          } catch (e) { /* draft korup, diabaikan */ }
        }
      })
      .catch(rtvHandleError);

    function submitAjukan() {
      errorEl.textContent = "";
      var payloadItems = [];
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var productId = r.productSelect.value;
        var qty = Number(r.qtyInput.value || 0);
        var alasan = r.alasanInput.value.trim();
        if (!productId) { errorEl.textContent = "Pilih produk untuk setiap barang."; return; }
        if (!qty || qty < 1) { errorEl.textContent = "Qty harus lebih dari 0."; return; }
        if (!alasan) { errorEl.textContent = "Alasan kerusakan wajib diisi untuk setiap barang."; return; }
        payloadItems.push({ product_id: productId, qty_diajukan: qty, alasan: alasan });
      }
      if (!payloadItems.length) { errorEl.textContent = "Minimal 1 barang harus diajukan."; return; }

      var photos = photoPicker.getPhotos();
      submitBtn.disabled = true;
      var request;
      if (payloadItems.length === 1) {
        var single = payloadItems[0];
        single.foto = photos;
        request = RtvApi.post("/api/toko/retur", single).then(function (data) {
          RtvUI.toast("Retur " + data.item.no_rtv + " berhasil diajukan (status Pending).", "success");
        });
      } else {
        if (photos.length) payloadItems[0].foto = photos;
        request = RtvApi.post("/api/toko/retur", { items: payloadItems }).then(function (data) {
          RtvUI.toast((data.items || []).length + " retur berhasil diajukan sekaligus (status Pending).", "success");
        });
      }
      request
        .then(function () {
          resetForm();
        })
        .catch(function (err) { errorEl.textContent = err.message; })
        .finally(function () { submitBtn.disabled = false; });
    }
  }

  // ======================================================================
  // Lihat Status / Batalkan / Ajukan Ulang
  // ======================================================================
  var STATUS_OPTIONS = ["", "Pending", "Received", "Approved", "Rejected", "Shipped to Supplier", "Completed", "Cancelled"];

  function renderStatus(container) {
    var filterSelect = RtvUI.el("select", {}, STATUS_OPTIONS.map(function (s) {
      return RtvUI.el("option", { value: s }, [s || "Semua Status"]);
    }));
    filterSelect.addEventListener("change", function () { loadStatus(); });

    var searchInput = RtvUI.el("input", { type: "search", placeholder: "Cari no. RTV / produk..." });
    var searchBox = RtvUI.el("div", { class: "rtv-search-box" }, [RtvUI.el("i", { class: "fa-solid fa-magnifying-glass" }), searchInput]);
    var searchDebounced = RtvUx.debounce(function () { loadStatus(); }, 350);
    searchInput.addEventListener("input", searchDebounced);

    var reloadBtn = RtvUI.el("button", { type: "button", class: "rtv-btn rtv-btn-ghost rtv-btn-sm", onclick: function () { loadStatus(); } }, [
      RtvUI.el("i", { class: "fa-solid fa-rotate-right" }), " Muat Ulang",
    ]);

    var tableWrap = RtvUI.el("div", {}, [RtvUI.pageLoading()]);

    var card = RtvUI.el("div", { class: "rtv-card" }, [
      RtvUI.el("div", { class: "rtv-card-header" }, [
        RtvUI.el("h3", {}, ["Status Pengajuan Toko Saya"]),
        RtvUI.el("div", { class: "rtv-card-toolbar" }, [searchBox, filterSelect, reloadBtn]),
      ]),
      tableWrap,
    ]);

    RtvUI.mount(container, card);
    loadStatus();

    function loadStatus() {
      var status = filterSelect.value;
      var q = searchInput.value.trim();
      var params = [];
      if (status) params.push("status=" + encodeURIComponent(status));
      if (q) params.push("q=" + encodeURIComponent(q));
      var url = "/api/toko/retur" + (params.length ? "?" + params.join("&") : "");
      RtvUI.mount(tableWrap, RtvUI.pageLoading());
      RtvApi.get(url)
        .then(function (data) {
          var rows = (data.items || []).map(mapRtvRow);
          var table = RtvUI.renderTableHtml({
            columns: [
              { header: "No. RTV", render: function (r) { return RtvUI.escapeHtml(r.no_rtv); }, width: "140px" },
              { header: "Produk", render: function (r) { return RtvUI.escapeHtml(r.product_nama); } },
              { header: "Qty Ajuan", render: function (r) { return r.qty_diajukan; }, width: "85px" },
              { header: "Nilai Estimasi", render: function (r) { return rtvFormatCurrency(r.nilai_estimasi); }, width: "125px" },
              { header: "Status", render: function (r) { return rtvStatusBadge(r.status); }, width: "180px" },
              { header: "Tgl Ajuan", render: function (r) { return rtvFormatDate(r.tgl_input); }, width: "120px" },
              {
                header: "Aksi", width: "240px",
                render: function (r) {
                  var html = "<button type='button' class='rtv-link-btn' data-action='riwayat' data-id='" + r._id + "'>Riwayat</button>";
                  html += "<button type='button' class='rtv-link-btn' data-action='foto' data-id='" + r._id + "'>Foto</button>";
                  html += "<button type='button' class='rtv-link-btn' data-action='cetak' data-id='" + r._id + "'>Cetak</button>";
                  if (r.status === "Pending") {
                    html += "<button type='button' class='rtv-link-btn danger' data-action='batal' data-id='" + r._id + "'>Batalkan</button>";
                  }
                  if (r.status === "Rejected") {
                    html += "<button type='button' class='rtv-link-btn' data-action='ulang' data-id='" + r._id + "'>Ajukan Ulang</button>";
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
              if (action === "foto") openFotoModal(row._id, row.no_rtv);
              if (action === "cetak") RtvPrint.rtv(row._id);
              if (action === "ulang") confirmAjukanUlang(row);
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

    function confirmAjukanUlang(row) {
      RtvUI.confirmDialog({
        title: "Ajukan Ulang",
        text: "Buat pengajuan retur baru untuk " + row.product_nama + " (qty " + row.qty_diajukan + ") seperti sebelumnya?",
        okText: "Ya, Ajukan Ulang",
      }).then(function (ok) {
        if (!ok) return;
        RtvApi.post("/api/toko/retur/" + row._id + "/ajukan-ulang")
          .then(function (data) {
            RtvUI.toast("Retur baru " + data.item.no_rtv + " berhasil diajukan.", "success");
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