/**
 * Helper format tampilan: mata uang, tanggal, badge status.
 */
function rtvFormatCurrency(value) {
  var n = Number(value || 0);
  return "Rp " + n.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

function rtvFormatDate(value) {
  if (!value) return "-";
  var d = new Date(value);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function rtvFormatDateTime(value) {
  if (!value) return "-";
  var d = new Date(value);
  if (isNaN(d.getTime())) return "-";
  return (
    d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) +
    " " +
    d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
  );
}

var RTV_ROLE_LABEL = {
  staff_toko: "Staff Toko",
  staff_gudang: "Staff Gudang",
  admin: "Admin / Supervisor",
};

function rtvStatusBadge(status) {
  var cls = "rtv-badge rtv-badge-" + String(status || "").replace(/\s+/g, "");
  return '<span class="' + cls + '">' + RtvUI.escapeHtml(status || "-") + "</span>";
}

/**
 * Fitur Riwayat/Log Aktivitas (Audit Trail) + Timeline Status.
 * Dipakai bersama oleh views.toko.js, views.gudang.js, dan views.admin.js.
 */
var RTV_AUDIT_ACTION_LABEL = {
  ajukan_retur: { label: "Retur diajukan oleh toko", icon: "fa-square-plus", color: "var(--rtv-blue)" },
  batalkan: { label: "Pengajuan dibatalkan", icon: "fa-ban", color: "var(--rtv-red)" },
  terima_barang: { label: "Barang diterima gudang", icon: "fa-dolly", color: "var(--rtv-teal)" },
  verifikasi: { label: "Diverifikasi admin", icon: "fa-check-double", color: "var(--rtv-green)" },
  buat_surat_jalan: { label: "Dimasukkan ke surat jalan", icon: "fa-truck", color: "var(--rtv-purple)" },
  selesaikan_klaim: { label: "Klaim dari supplier selesai", icon: "fa-flag-checkered", color: "var(--rtv-teal)" },
};

function rtvAuditLabel(action, afterStatus) {
  var def = RTV_AUDIT_ACTION_LABEL[action] || { label: action, icon: "fa-circle", color: "var(--rtv-text-faint)" };
  var label = def.label;
  if (action === "verifikasi" && afterStatus) {
    label = afterStatus === "Approved" ? "Disetujui oleh admin" : "Ditolak oleh admin";
  }
  return { label: label, icon: def.icon, color: def.color };
}

function rtvOpenRiwayatModal(rtvId, noRtv) {
  var bodyWrap = RtvUI.el("div", {}, [RtvUI.pageLoading()]);
  RtvUI.openModal({
    title: "Riwayat Aktivitas \u2014 " + (noRtv || ""),
    bodyNode: bodyWrap,
    wide: true,
  });

  RtvApi.get("/api/rtv/" + rtvId + "/riwayat")
    .then(function (data) {
      var items = data.items || [];
      if (!items.length) {
        RtvUI.mount(bodyWrap, RtvUI.el("div", { class: "rtv-table-empty" }, ["Belum ada riwayat aktivitas."]));
        return;
      }
      var list = RtvUI.el("div", { class: "rtv-timeline" });
      items.forEach(function (log) {
        var afterStatus = log.after && log.after.status;
        var info = rtvAuditLabel(log.action, afterStatus);
        var namaOleh = log.oleh && log.oleh.nama ? log.oleh.nama : "Sistem";
        list.appendChild(
          RtvUI.el("div", { class: "rtv-timeline-item" }, [
            RtvUI.el("div", { class: "rtv-timeline-dot", style: { background: info.color } }, [
              RtvUI.el("i", { class: "fa-solid " + info.icon }),
            ]),
            RtvUI.el("div", { class: "rtv-timeline-body" }, [
              RtvUI.el("div", { class: "rtv-timeline-title" }, [info.label]),
              RtvUI.el("div", { class: "rtv-timeline-meta" }, [namaOleh + " \u00b7 " + rtvFormatDateTime(log.tgl)]),
            ]),
          ])
        );
      });
      RtvUI.mount(bodyWrap, list);
    })
    .catch(function (err) {
      RtvUI.mount(bodyWrap, RtvUI.el("div", { class: "rtv-field-error" }, [err.message]));
    });
}