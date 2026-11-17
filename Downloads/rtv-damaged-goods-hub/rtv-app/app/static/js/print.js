/**
 * RtvPrint — buka dokumen cetak (berita acara RTV, surat jalan, packing
 * list) di tab baru lalu panggil window.print(). Browser menyediakan
 * "Simpan sebagai PDF" di dialog cetak, jadi tidak perlu library PDF
 * terpisah. Setiap dokumen mencantumkan No. RTV / No. Surat Jalan secara
 * jelas sebagai kode referensi untuk serah terima manual atau dicocokkan
 * dengan pemindai barcode fisik (USB/Bluetooth) di kolom pencarian gudang.
 */
var RtvPrint = (function () {
  function esc(s) { return RtvUI.escapeHtml(s == null ? "-" : s); }

  function shell(title, bodyHtml) {
    var appName = (window.RTV_APP && window.RTV_APP.name) || "RTV Hub";
    return (
      "<!DOCTYPE html><html lang='id'><head><meta charset='UTF-8'>" +
      "<title>" + esc(title) + "</title>" +
      "<style>" +
      "*{box-sizing:border-box;} body{font-family:Arial,Helvetica,sans-serif;color:#1f2d3a;padding:28px;max-width:820px;margin:0 auto;}" +
      ".hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0b6e8a;padding-bottom:12px;margin-bottom:18px;}" +
      ".hdr h1{font-size:18px;margin:0;}" +
      ".hdr .brand{font-size:13px;color:#6b7a85;}" +
      ".code{font-family:'Courier New',monospace;font-size:20px;font-weight:700;letter-spacing:1px;background:#f3f6f8;border:1.5px dashed #0b6e8a;padding:8px 14px;border-radius:6px;display:inline-block;}" +
      ".meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;font-size:13px;margin:14px 0;}" +
      ".meta-grid div b{display:inline-block;min-width:140px;color:#6b7a85;font-weight:600;}" +
      "table{width:100%;border-collapse:collapse;margin:14px 0;font-size:12.5px;}" +
      "th,td{border:1px solid #cfd8dd;padding:6px 8px;text-align:left;}" +
      "th{background:#f3f6f8;}" +
      ".right{text-align:right;}" +
      ".section-title{font-size:13.5px;font-weight:700;margin:18px 0 6px;}" +
      ".sign-row{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:50px;text-align:center;font-size:12.5px;}" +
      ".sign-row .line{margin-top:50px;border-top:1px solid #1f2d3a;padding-top:4px;}" +
      ".foto-grid{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0;}" +
      ".foto-grid img{width:110px;height:110px;object-fit:cover;border:1px solid #cfd8dd;border-radius:4px;}" +
      ".foot{margin-top:24px;font-size:11px;color:#93a2ab;}" +
      "@media print{ body{padding:0;} }" +
      "</style></head><body>" +
      "<div class='hdr'><div><h1>" + esc(title) + "</h1><div class='brand'>" + esc(appName) + "</div></div></div>" +
      bodyHtml +
      "<div class='foot'>Dicetak oleh sistem &mdash; dokumen ini sah tanpa tanda tangan basah jika disertai log audit elektronik.</div>" +
      "<script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>" +
      "</body></html>"
    );
  }

  function openWindow(html) {
    var win = window.open("", "_blank");
    if (!win) {
      RtvUI.toast("Popup diblokir browser. Izinkan popup untuk mencetak dokumen.", "error");
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  function signRow(labels) {
    return "<div class='sign-row'>" + labels.map(function (l) {
      return "<div>" + esc(l) + "<div class='line'>Tanda tangan &amp; nama jelas</div></div>";
    }).join("") + "</div>";
  }

  function rtv(rtvId) {
    RtvApi.get("/api/x/dokumen/rtv/" + rtvId)
      .then(function (d) {
        var r = d.rtv;
        var body =
          "<div class='code'>" + esc(r.no_rtv) + "</div>" +
          "<div class='section-title' style='margin-top:18px;'>Berita Acara Retur Barang Rusak</div>" +
          "<div class='meta-grid'>" +
          "<div><b>Toko Asal</b>" + esc(d.store ? d.store.nama_store : "-") + "</div>" +
          "<div><b>Supplier</b>" + esc(d.supplier ? d.supplier.nama_supplier : "-") + "</div>" +
          "<div><b>Produk</b>" + esc(r.product ? r.product.nama_produk : "-") + "</div>" +
          "<div><b>Barcode</b>" + esc(r.product ? r.product.barcode : "-") + "</div>" +
          "<div><b>Qty Diajukan</b>" + esc(r.qty_diajukan) + "</div>" +
          "<div><b>Qty Diterima</b>" + esc(r.qty_diterima) + "</div>" +
          "<div><b>Kategori Kerusakan</b>" + esc(r.kategori_kerusakan) + "</div>" +
          "<div><b>Batch</b>" + esc(r.batch) + "</div>" +
          "<div><b>Lokasi Karantina</b>" + esc(r.lokasi_karantina) + "</div>" +
          "<div><b>Status</b>" + esc(r.status) + "</div>" +
          "<div><b>Estimasi Nilai</b>" + esc(rtvFormatCurrency(d.nilai)) + "</div>" +
          "<div><b>No. Surat Jalan</b>" + esc(d.shipment ? d.shipment.no_surat_jalan : "-") + "</div>" +
          "</div>" +
          "<div class='section-title'>Alasan / Catatan</div>" +
          "<div style='font-size:13px;'>" + esc(r.alasan) + (r.catatan_selisih ? "<br><i>Catatan selisih gudang: " + esc(r.catatan_selisih) + "</i>" : "") + (r.catatan_verifikasi ? "<br><i>Catatan verifikasi: " + esc(r.catatan_verifikasi) + "</i>" : "") + "</div>" +
          signRow(["Staff Toko", "Staff Gudang", "Admin / Supervisor"]);
        openWindow(shell("Berita Acara — " + r.no_rtv, body));
      })
      .catch(rtvHandleError);
  }

  function suratJalan(shipmentId) {
    RtvApi.get("/api/x/dokumen/surat-jalan/" + shipmentId)
      .then(function (d) {
        var s = d.shipment;
        var rows = d.items.map(function (it) {
          return "<tr><td>" + esc(it.no_rtv) + "</td><td>" + esc(it.nama_produk) + "</td><td>" + esc(it.barcode) +
            "</td><td class='right'>" + esc(it.qty) + "</td><td>" + esc(it.batch) + "</td><td>" + esc(it.toko) + "</td></tr>";
        }).join("");
        var body =
          "<div class='code'>" + esc(s.no_surat_jalan) + "</div>" +
          "<div class='meta-grid' style='margin-top:18px;'>" +
          "<div><b>Supplier</b>" + esc(d.supplier ? d.supplier.nama_supplier : "-") + "</div>" +
          "<div><b>Tgl Kirim</b>" + esc(rtvFormatDate(s.tgl_kirim)) + "</div>" +
          "<div><b>Alamat Supplier</b>" + esc(d.supplier ? d.supplier.alamat : "-") + "</div>" +
          "<div><b>Total Item</b>" + esc(d.items.length) + "</div>" +
          "<div><b>Total Qty</b>" + esc(d.total_qty) + "</div>" +
          "<div><b>Total Estimasi Nilai</b>" + esc(rtvFormatCurrency(d.total_nilai)) + "</div>" +
          "</div>" +
          "<table><thead><tr><th>No. RTV</th><th>Produk</th><th>Barcode</th><th class='right'>Qty</th><th>Batch</th><th>Toko Asal</th></tr></thead><tbody>" +
          rows + "</tbody></table>" +
          signRow(["Dikirim oleh (Gudang)", "Diterima oleh (Supplier)", "Diketahui (Admin)"]);
        openWindow(shell("Surat Jalan — " + s.no_surat_jalan, body));
      })
      .catch(rtvHandleError);
  }

  function packingListGroup(group) {
    var rows = group.items.map(function (it) {
      return "<tr><td>" + esc(it.no_rtv) + "</td><td>" + esc(it.nama_produk) + "</td><td>" + esc(it.barcode) +
        "</td><td class='right'>" + esc(it.qty) + "</td><td>" + esc(it.lokasi) + "</td><td>" + esc(it.toko) + "</td></tr>";
    }).join("");
    var body =
      "<div class='section-title'>Packing List — Supplier: " + esc(group.supplier.nama) + "</div>" +
      "<div class='meta-grid'>" +
      "<div><b>Kode Supplier</b>" + esc(group.supplier.kode) + "</div>" +
      "<div><b>Total Item</b>" + esc(group.items.length) + "</div>" +
      "<div><b>Total Qty</b>" + esc(group.total_qty) + "</div>" +
      "<div><b>Estimasi Nilai</b>" + esc(rtvFormatCurrency(group.total_nilai)) + "</div>" +
      "</div>" +
      "<table><thead><tr><th>No. RTV</th><th>Produk</th><th>Barcode</th><th class='right'>Qty</th><th>Lokasi</th><th>Toko Asal</th></tr></thead><tbody>" +
      rows + "</tbody></table>";
    openWindow(shell("Packing List — " + group.supplier.nama, body + signRow(["Disiapkan oleh (Gudang)", "Diperiksa oleh (Admin)"])));
  }

  return { rtv: rtv, suratJalan: suratJalan, packingListGroup: packingListGroup };
})();