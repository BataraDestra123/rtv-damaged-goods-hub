"""
Dashboard & Laporan RTV: ringkasan nilai kerugian finansial, distribusi
status, filter per periode, dan rekap klaim per supplier.
Diakses oleh Admin (penuh) dan Staff (ringkasan terbatas ke toko sendiri).
"""
import datetime

from flask import Blueprint, g, jsonify, request

from ..db import get_db
from ..security import login_required, role_required
from ..utils import jsonable, parse_date

bp = Blueprint("dashboard", __name__)


def _decimal_total(pipeline_result, field="total"):
    if not pipeline_result:
        return 0.0
    val = pipeline_result[0].get(field)
    if val is None:
        return 0.0
    try:
        return float(val.to_decimal()) if hasattr(val, "to_decimal") else float(val)
    except Exception:
        return 0.0


@bp.get("/summary")
@login_required
def summary():
    """
    Ringkasan untuk admin: total per status, estimasi kerugian finansial
    (qty_diterima x harga snapshot untuk status != Pending/Cancelled),
    dan peringatan stok karantina.
    Untuk staff_toko, otomatis difilter ke store_id miliknya sendiri.
    """
    db = get_db()
    match_filter = {}
    if g.user.get("role") == "staff_toko":
        match_filter["store_id"] = g.user["store_id"]

    status_pipeline = [
        {"$match": match_filter} if match_filter else {"$match": {}},
        {"$group": {"_id": "$status", "jumlah": {"$sum": 1}}},
    ]
    status_counts = {r["_id"]: r["jumlah"] for r in db.rtv_transactions.aggregate(status_pipeline)}

    kerugian_pipeline = [
        {"$match": {**match_filter, "status": {"$nin": ["Pending", "Cancelled"]}}},
        {
            "$project": {
                "nilai": {
                    "$multiply": [
                        {"$ifNull": ["$qty_diterima", "$qty_diajukan"]},
                        {"$ifNull": ["$product.harga", 0]},
                    ]
                }
            }
        },
        {"$group": {"_id": None, "total": {"$sum": "$nilai"}}},
    ]
    total_kerugian = _decimal_total(list(db.rtv_transactions.aggregate(kerugian_pipeline)))

    from flask import current_app

    threshold = current_app.config["STOK_RUSAK_WARNING_THRESHOLD"]
    stok_pipeline = [
        {"$match": {**match_filter, "status": "Received"}},
        {"$group": {"_id": "$product.product_id", "nama_produk": {"$first": "$product.nama_produk"}, "total_qty": {"$sum": "$qty_diterima"}}},
        {"$match": {"total_qty": {"$gte": threshold}}},
        {"$sort": {"total_qty": -1}},
        {"$limit": 10},
    ]
    peringatan = list(db.rtv_transactions.aggregate(stok_pipeline))

    all_status = (
        "Pending", "Received", "Approved", "Rejected",
        "Shipped to Supplier", "Completed", "Cancelled",
    )
    return jsonify(
        {
            "status_counts": {s: status_counts.get(s, 0) for s in all_status},
            "total_kerugian_estimasi": total_kerugian,
            "peringatan_stok": jsonable(peringatan),
            "threshold": threshold,
        }
    )


@bp.get("/rekap-supplier")
@role_required("admin")
def rekap_per_supplier():
    """Laporan rekapitulasi klaim per supplier, dengan filter tanggal opsional."""
    db = get_db()
    tgl_dari = parse_date(request.args.get("dari"), required=False)
    tgl_sampai = parse_date(request.args.get("sampai"), required=False)

    match = {}
    if tgl_dari or tgl_sampai:
        rng = {}
        if tgl_dari:
            rng["$gte"] = tgl_dari
        if tgl_sampai:
            rng["$lte"] = tgl_sampai
        match["tgl_kirim"] = rng

    pipeline = [
        {"$match": match},
        {
            "$lookup": {
                "from": "master_supplier",
                "localField": "supplier_id",
                "foreignField": "_id",
                "as": "supplier",
            }
        },
        {"$unwind": {"path": "$supplier", "preserveNullAndEmptyArrays": True}},
        {
            "$project": {
                "no_surat_jalan": 1,
                "tgl_kirim": 1,
                "tgl_selesai": 1,
                "hasil_klaim": 1,
                "supplier_nama": "$supplier.nama_supplier",
                "jumlah_item": {"$size": "$rtv_ids"},
            }
        },
        {"$sort": {"tgl_kirim": -1}},
    ]
    rows = list(db.rtv_shipments.aggregate(pipeline))
    return jsonify({"items": jsonable(rows)})


@bp.get("/tren-status")
@role_required("admin")
def tren_status():
    """Grafik status retur per periode (per bulan, 6 bulan terakhir)."""
    db = get_db()
    since = datetime.datetime.utcnow() - datetime.timedelta(days=180)
    pipeline = [
        {"$match": {"tgl_input": {"$gte": since}}},
        {
            "$group": {
                "_id": {
                    "year": {"$year": "$tgl_input"},
                    "month": {"$month": "$tgl_input"},
                    "status": "$status",
                },
                "jumlah": {"$sum": 1},
            }
        },
        {"$sort": {"_id.year": 1, "_id.month": 1}},
    ]
    rows = list(db.rtv_transactions.aggregate(pipeline))
    return jsonify({"items": jsonable(rows)})
