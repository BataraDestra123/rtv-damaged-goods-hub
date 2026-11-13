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
