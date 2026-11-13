"""
Fitur Staff Gudang: Lihat Daftar Retur Pending, Terima dan Periksa Barang,
Lihat Stok Barang Rusak (dihitung dari RTV status Received).
"""
import datetime

from flask import Blueprint, g, jsonify, request

from ..db import get_db
from ..security import ApiError, record_audit, role_required
from ..utils import (
    jsonable,
    parse_date,
    require_fields,
    sanitize_str,
    to_object_id,
    to_positive_int,
)

bp = Blueprint("gudang", __name__)

KATEGORI_KERUSAKAN = (
    "Fisik Rusak",
    "Kedaluwarsa",
    "Kemasan Cacat",
    "Salah Kirim",
    "Lainnya",
)


@bp.get("/retur")
@role_required("staff_gudang")
def list_retur_pending():
    """Tampilkan daftar rtv_transactions berstatus Pending dari semua toko."""
    db = get_db()
    status = request.args.get("status", "Pending")
    filt = {"status": status} if status else {}
    cursor = db.rtv_transactions.find(filt).sort("tgl_input", 1).limit(500)
    items = []
    for d in cursor:
        store = db.master_store.find_one({"_id": d["store_id"]}, {"nama_store": 1, "kode_store": 1})
        d["store"] = store
        items.append(jsonable(d))
    return jsonify({"items": items})


@bp.post("/retur/<rtv_id>/terima")
@role_required("staff_gudang")
def terima_barang(rtv_id):
    """
    Terima dan Periksa Barang -> update Pending ke Received secara atomik.
    Field yang dicatat: qty_diterima, kategori_kerusakan, batch,
    tgl_kedaluwarsa, shift (melalui shift_id milik staff gudang).
    """
    data = request.get_json(silent=True) or {}
    require_fields(data, ["qty_diterima", "kategori_kerusakan"])

    db = get_db()
    oid = to_object_id(rtv_id, field="rtv_id")

    existing = db.rtv_transactions.find_one({"_id": oid})
    if not existing:
        raise ApiError("Data RTV tidak ditemukan.", status_code=404, code="not_found")

    qty_diterima = to_positive_int(data["qty_diterima"], field="qty_diterima")
    kategori = data["kategori_kerusakan"]
    if kategori not in KATEGORI_KERUSAKAN:
        raise ApiError(
            f"kategori_kerusakan harus salah satu dari: {', '.join(KATEGORI_KERUSAKAN)}.",
            code="validation_error",
        )
    batch = sanitize_str(data.get("batch", ""), max_len=64, field="Batch", required=False, allow_empty=True)
    tgl_kedaluwarsa = parse_date(data.get("tgl_kedaluwarsa"), field="tgl_kedaluwarsa", required=False)

    now = datetime.datetime.utcnow()
    update_fields = {
        "qty_diterima": qty_diterima,
        "kategori_kerusakan": kategori,
        "batch": batch or None,
        "tgl_kedaluwarsa": tgl_kedaluwarsa,
        "status": "Received",
        "diterima_oleh": {"id": g.user["_id"], "nama": g.user.get("nama")},
        "tgl_terima": now,
        "shift_id": g.user.get("shift_id"),
    }

    updated = db.rtv_transactions.find_one_and_update(
        {"_id": oid, "status": "Pending"},
        {"$set": update_fields},
        return_document=True,
    )
    if not updated:
        raise ApiError(
            "RTV sudah diproses pihak lain (status bukan Pending lagi). Daftar akan dimuat ulang.",
            status_code=409,
            code="conflict",
        )

    record_audit(
        "rtv_transactions",
        oid,
        "terima_barang",
        before={"status": existing["status"]},
        after=jsonable(updated),
    )
    return jsonify({"item": jsonable(updated)})


@bp.get("/stok")
@role_required("staff_gudang", "admin")
def lihat_stok_rusak():
    """Stok barang rusak di karantina = agregat RTV status Received per produk."""
    db = get_db()
    pipeline = [
        {"$match": {"status": "Received"}},
        {
            "$group": {
                "_id": "$product.product_id",
                "nama_produk": {"$first": "$product.nama_produk"},
                "barcode": {"$first": "$product.barcode"},
                "total_qty": {"$sum": "$qty_diterima"},
                "jumlah_transaksi": {"$sum": 1},
            }
        },
        {"$sort": {"total_qty": -1}},
    ]
    rows = list(db.rtv_transactions.aggregate(pipeline))
    from flask import current_app

    threshold = current_app.config["STOK_RUSAK_WARNING_THRESHOLD"]
    for r in rows:
        r["warning"] = r["total_qty"] >= threshold
    return jsonify({"items": jsonable(rows), "threshold": threshold})
