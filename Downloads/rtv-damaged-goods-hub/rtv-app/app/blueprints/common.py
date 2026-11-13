"""
Endpoint read-only yang dipakai lintas role (dropdown produk, supplier, dsb).
"""
from flask import Blueprint, g, jsonify, request

from ..db import get_db
from ..security import ApiError, login_required
from ..utils import jsonable, to_object_id

bp = Blueprint("common", __name__)


@bp.get("/produk")
@login_required
def list_produk():
    db = get_db()
    q = (request.args.get("q") or "").strip()
    filt = {"aktif": True}
    if q:
        filt["$or"] = [
            {"nama_produk": {"$regex": q, "$options": "i"}},
            {"barcode": {"$regex": q, "$options": "i"}},
        ]
    cursor = db.master_product.find(filt).sort("nama_produk", 1).limit(200)
    return jsonify({"items": [jsonable(d) for d in cursor]})


@bp.get("/supplier")
@login_required
def list_supplier():
    db = get_db()
    cursor = db.master_supplier.find({}).sort("nama_supplier", 1)
    return jsonify({"items": [jsonable(d) for d in cursor]})


@bp.get("/store")
@login_required
def list_store():
    db = get_db()
    cursor = db.master_store.find({}).sort("nama_store", 1)
    return jsonify({"items": [jsonable(d) for d in cursor]})


@bp.get("/shift")
@login_required
def list_shift():
    db = get_db()
    cursor = db.master_shift.find({}).sort("nama_shift", 1)
    return jsonify({"items": [jsonable(d) for d in cursor]})


@bp.get("/rtv/<rtv_id>/riwayat")
@login_required
def riwayat_rtv(rtv_id):
    """Riwayat/log aktivitas (audit trail) untuk satu transaksi RTV.

    Dipakai oleh fitur "Timeline Status" di sisi Toko, Gudang, dan Admin.
    Memakai data yang sudah lama dicatat lewat record_audit() di tiap
    blueprint (ajukan_retur, batalkan, terima_barang, verifikasi, dst),
    jadi tidak perlu menambah logika pencatatan baru -- cukup dibaca ulang.
    """
    db = get_db()
    oid = to_object_id(rtv_id, field="rtv_id")

    trx = db.rtv_transactions.find_one({"_id": oid})
    if not trx:
        raise ApiError("Data RTV tidak ditemukan.", status_code=404, code="not_found")

    # Staff toko hanya boleh melihat riwayat RTV milik tokonya sendiri.
    if g.user.get("role") == "staff_toko" and trx.get("store_id") != g.user.get("store_id"):
        raise ApiError("Anda tidak berhak melihat riwayat RTV ini.", status_code=403, code="forbidden")

    cursor = db.audit_logs.find(
        {"collection": "rtv_transactions", "document_id": str(oid)}
    ).sort("tgl", 1)
    return jsonify({"items": [jsonable(d) for d in cursor]})