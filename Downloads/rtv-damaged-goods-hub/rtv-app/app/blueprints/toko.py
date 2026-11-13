"""
Fitur Staff Toko (lihat use_case: Ajukan Retur, Lihat Status Pengajuan,
Batalkan Pengajuan selama Pending).

Semua endpoint di sini otomatis dibatasi ke toko (store_id) milik staff
yang login -> staff tidak bisa melihat atau mengubah data toko lain.
"""
import datetime

from flask import Blueprint, g, jsonify, request

from ..db import get_db
from ..security import ApiError, record_audit, role_required
from ..utils import (
    generate_sequential_code,
    jsonable,
    require_fields,
    sanitize_str,
    to_decimal128,
    to_object_id,
    to_positive_int,
)

bp = Blueprint("toko", __name__)


def _petugas_ref(user):
    return {"id": user["_id"], "nama": user.get("nama")}


@bp.post("/retur")
@role_required("staff_toko")
def ajukan_retur():
    """Ajukan Retur Barang Rusak -> insert rtv_transactions status Pending."""
    data = request.get_json(silent=True) or {}
    require_fields(data, ["product_id", "qty_diajukan", "alasan"])

    db = get_db()

    product_id = to_object_id(data["product_id"], field="product_id")
    product = db.master_product.find_one({"_id": product_id, "aktif": True})
    if not product:
        raise ApiError("Produk tidak ditemukan atau sudah nonaktif.", status_code=404, code="not_found")

    qty = to_positive_int(data["qty_diajukan"], field="qty_diajukan")
    alasan = sanitize_str(data["alasan"], max_len=500, field="Alasan kerusakan")

    if not g.user.get("store_id"):
        raise ApiError("Akun Anda tidak terhubung ke toko manapun.", status_code=403, code="forbidden")

    no_rtv = generate_sequential_code(db, "rtv", "RTV")
    now = datetime.datetime.utcnow()

    doc = {
        "no_rtv": no_rtv,
        "store_id": g.user["store_id"],
        "product": {
            "product_id": product["_id"],
            "barcode": product.get("barcode"),
            "nama_produk": product.get("nama_produk"),
            "harga": product.get("harga"),
        },
        "qty_diajukan": qty,
        "qty_diterima": None,
        "alasan": alasan,
        "kategori_kerusakan": None,
        "batch": None,
        "tgl_kedaluwarsa": None,
        "status": "Pending",
        "shipment_id": None,
        "diajukan_oleh": _petugas_ref(g.user),
        "diterima_oleh": None,
        "diverifikasi_oleh": None,
        "tgl_input": now,
        "tgl_terima": None,
        "tgl_verifikasi": None,
    }
    result = db.rtv_transactions.insert_one(doc)
    doc["_id"] = result.inserted_id
    record_audit("rtv_transactions", doc["_id"], "ajukan_retur", after=jsonable(doc))

    return jsonify({"item": jsonable(doc)}), 201


@bp.get("/retur")
@role_required("staff_toko")
def list_retur_toko():
    """Lihat Status Pengajuan Toko -> hanya RTV milik store_id sendiri."""
    db = get_db()
    status = request.args.get("status")
    filt = {"store_id": g.user["store_id"]}
    if status:
        filt["status"] = status
    cursor = db.rtv_transactions.find(filt).sort("tgl_input", -1).limit(500)
    return jsonify({"items": [jsonable(d) for d in cursor]})


@bp.post("/retur/<rtv_id>/batalkan")
@role_required("staff_toko")
def batalkan_retur(rtv_id):
    """Batalkan Pengajuan: hanya jika status masih Pending dan milik toko sendiri.

    Update dilakukan atomik (find_one_and_update dengan filter status=Pending)
    supaya tidak terjadi race condition dengan gudang yang sedang menerima
    barang yang sama.
    """
    db = get_db()
    oid = to_object_id(rtv_id, field="rtv_id")

    existing = db.rtv_transactions.find_one({"_id": oid})
    if not existing:
        raise ApiError("Data RTV tidak ditemukan.", status_code=404, code="not_found")
    if existing["store_id"] != g.user["store_id"]:
        raise ApiError("Anda tidak berhak membatalkan RTV milik toko lain.", status_code=403, code="forbidden")

    updated = db.rtv_transactions.find_one_and_update(
        {"_id": oid, "status": "Pending"},
        {"$set": {"status": "Cancelled", "tgl_batal": datetime.datetime.utcnow()}},
        return_document=True,
    )
    if not updated:
        raise ApiError(
            "Gagal membatalkan: RTV sudah diproses oleh gudang (status bukan Pending lagi).",
            status_code=409,
            code="conflict",
        )

    record_audit("rtv_transactions", oid, "batalkan", before={"status": existing["status"]}, after={"status": "Cancelled"})
    return jsonify({"item": jsonable(updated)})
