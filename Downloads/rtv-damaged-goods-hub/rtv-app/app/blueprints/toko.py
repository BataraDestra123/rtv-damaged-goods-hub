"""
Fitur Staff Toko (lihat use_case: Ajukan Retur, Lihat Status Pengajuan,
Batalkan Pengajuan selama Pending), ditambah:
  - Lampiran foto bukti kerusakan saat mengajukan retur
  - Ajukan beberapa barang sekaligus dalam satu kali kirim ("items": [...])
  - Ajukan ulang retur yang ditolak (data terisi otomatis dari yang lama)
  - Notifikasi ke gudang saat ada pengajuan baru

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
    to_object_id,
    to_positive_int,
)
from .extras import nilai_rtv, notify, parse_photos, save_photos

bp = Blueprint("toko", __name__)

MAX_ITEMS_PER_BATCH = 20


def _petugas_ref(user):
    return {"id": user["_id"], "nama": user.get("nama")}


def _build_rtv_doc(db, product_id_raw, qty_raw, alasan_raw):
    product_id = to_object_id(product_id_raw, field="product_id")
    product = db.master_product.find_one({"_id": product_id, "aktif": True})
    if not product:
        raise ApiError("Produk tidak ditemukan atau sudah nonaktif.", status_code=404, code="not_found")

    qty = to_positive_int(qty_raw, field="qty_diajukan")
    alasan = sanitize_str(alasan_raw, max_len=500, field="Alasan kerusakan")

    if not g.user.get("store_id"):
        raise ApiError("Akun Anda tidak terhubung ke toko manapun.", status_code=403, code="forbidden")

    no_rtv = generate_sequential_code(db, "rtv", "RTV")
    now = datetime.datetime.utcnow()

    return {
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
        "lokasi_karantina": None,
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


@bp.post("/retur")
@role_required("staff_toko")
def ajukan_retur():
    """
    Ajukan Retur Barang Rusak -> insert rtv_transactions status Pending.

    Mendukung dua bentuk body:
      - Satu barang (seperti sebelumnya): {product_id, qty_diajukan, alasan, foto?}
      - Banyak barang sekaligus: {items: [{product_id, qty_diajukan, alasan, foto?}, ...]}
    """
    data = request.get_json(silent=True) or {}
    db = get_db()

    if isinstance(data.get("items"), list):
        raw_items = data["items"]
        if not raw_items:
            raise ApiError("Minimal 1 barang harus diajukan.", code="validation_error")
        if len(raw_items) > MAX_ITEMS_PER_BATCH:
            raise ApiError("Maksimal %d barang per pengajuan." % MAX_ITEMS_PER_BATCH, code="validation_error")

        docs = []
        for idx, raw in enumerate(raw_items):
            if not isinstance(raw, dict):
                raise ApiError("Item ke-%d tidak valid." % (idx + 1), code="validation_error")
            require_fields(raw, ["product_id", "qty_diajukan", "alasan"])
            doc = _build_rtv_doc(db, raw["product_id"], raw["qty_diajukan"], raw["alasan"])
            doc["_foto_raw"] = parse_photos(raw.get("foto"))
            docs.append(doc)

        created = []
        for doc in docs:
            foto = doc.pop("_foto_raw")
            result = db.rtv_transactions.insert_one(doc)
            doc["_id"] = result.inserted_id
            save_photos(db, [doc["_id"]], foto, "pengajuan", g.user)
            record_audit("rtv_transactions", doc["_id"], "ajukan_retur", after=jsonable(doc))
            created.append(doc)

        notify(
            db, "staff_gudang",
            "Pengajuan retur baru",
            "%d retur baru menunggu diterima dari toko." % len(created),
            link="gudang-pending",
        )
        return jsonify({"items": [jsonable(d) for d in created]}), 201

    require_fields(data, ["product_id", "qty_diajukan", "alasan"])
    foto = parse_photos(data.get("foto"))
    doc = _build_rtv_doc(db, data["product_id"], data["qty_diajukan"], data["alasan"])
    result = db.rtv_transactions.insert_one(doc)
    doc["_id"] = result.inserted_id
    save_photos(db, [doc["_id"]], foto, "pengajuan", g.user)
    record_audit("rtv_transactions", doc["_id"], "ajukan_retur", after=jsonable(doc))

    notify(
        db, "staff_gudang",
        "Pengajuan retur baru",
        "Retur %s menunggu diterima." % doc["no_rtv"],
        rtv_id=doc["_id"], link="gudang-pending",
    )

    return jsonify({"item": jsonable(doc)}), 201


@bp.post("/retur/<rtv_id>/ajukan-ulang")
@role_required("staff_toko")
def ajukan_ulang(rtv_id):
    """Ajukan Ulang: buat RTV baru dari RTV yang ditolak, data terisi otomatis."""
    db = get_db()
    oid = to_object_id(rtv_id, field="rtv_id")
    existing = db.rtv_transactions.find_one({"_id": oid})
    if not existing:
        raise ApiError("Data RTV tidak ditemukan.", status_code=404, code="not_found")
    if existing["store_id"] != g.user["store_id"]:
        raise ApiError("Anda tidak berhak mengajukan ulang RTV milik toko lain.", status_code=403, code="forbidden")
    if existing["status"] != "Rejected":
        raise ApiError("Hanya retur berstatus Rejected yang bisa diajukan ulang.", code="validation_error")

    data = request.get_json(silent=True) or {}
    qty = data.get("qty_diajukan", existing["qty_diajukan"])
    alasan = data.get("alasan", existing["alasan"])
    doc = _build_rtv_doc(db, existing["product"]["product_id"], qty, alasan)
    result = db.rtv_transactions.insert_one(doc)
    doc["_id"] = result.inserted_id
    record_audit(
        "rtv_transactions", doc["_id"], "ajukan_retur",
        before={"ajukan_ulang_dari": existing["no_rtv"]}, after=jsonable(doc),
    )
    return jsonify({"item": jsonable(doc)}), 201


@bp.get("/retur")
@role_required("staff_toko")
def list_retur_toko():
    """Lihat Status Pengajuan Toko -> hanya RTV milik store_id sendiri."""
    db = get_db()
    status = request.args.get("status")
    q = (request.args.get("q") or "").strip()
    filt = {"store_id": g.user["store_id"]}
    if status:
        filt["status"] = status
    cursor = db.rtv_transactions.find(filt).sort("tgl_input", -1).limit(500)
    items = []
    for d in cursor:
        if q:
            hay = " ".join(
                str(x or "") for x in (d.get("no_rtv"), (d.get("product") or {}).get("nama_produk"), d.get("alasan"))
            ).lower()
            if q.lower() not in hay:
                continue
        d["nilai_estimasi"] = nilai_rtv(d) if d.get("status") != "Cancelled" else 0
        items.append(jsonable(d))
    return jsonify({"items": items})


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