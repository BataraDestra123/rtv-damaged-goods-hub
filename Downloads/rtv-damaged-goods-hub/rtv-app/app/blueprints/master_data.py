"""
Kelola Master Data (Supplier, Produk, Toko, Shift) - khusus Admin.
Tambah / Ubah / Hapus, dengan validasi kode unik dan guard penghapusan
jika data masih dipakai oleh transaksi lain.
"""
from flask import Blueprint, g, jsonify, request

from ..db import get_db
from ..security import ApiError, record_audit, role_required
from ..utils import (
    jsonable,
    require_fields,
    sanitize_barcode,
    sanitize_kode,
    sanitize_str,
    to_decimal128,
    to_object_id,
)

bp = Blueprint("master_data", __name__)


# ---------------------------------------------------------------------------
# Supplier
# ---------------------------------------------------------------------------
@bp.get("/supplier")
@role_required("admin")
def list_supplier():
    db = get_db()
    cursor = db.master_supplier.find({}).sort("nama_supplier", 1)
    return jsonify({"items": [jsonable(d) for d in cursor]})


@bp.post("/supplier")
@role_required("admin")
def create_supplier():
    data = request.get_json(silent=True) or {}
    require_fields(data, ["kode_supplier", "nama_supplier", "alamat", "kontak"])
    db = get_db()

    kode = sanitize_kode(data["kode_supplier"], field="Kode supplier")
    if db.master_supplier.find_one({"kode_supplier": kode}):
        raise ApiError("Kode supplier sudah dipakai.", status_code=409, code="conflict")

    doc = {
        "kode_supplier": kode,
        "nama_supplier": sanitize_str(data["nama_supplier"], max_len=150, field="Nama supplier"),
        "alamat": sanitize_str(data["alamat"], max_len=300, field="Alamat"),
        "kontak": sanitize_str(data["kontak"], max_len=100, field="Kontak"),
    }
    result = db.master_supplier.insert_one(doc)
    doc["_id"] = result.inserted_id
    record_audit("master_supplier", doc["_id"], "tambah", after=jsonable(doc))
    return jsonify({"item": jsonable(doc)}), 201


@bp.put("/supplier/<item_id>")
@role_required("admin")
def update_supplier(item_id):
    data = request.get_json(silent=True) or {}
    db = get_db()
    oid = to_object_id(item_id, field="id")
    existing = db.master_supplier.find_one({"_id": oid})
    if not existing:
        raise ApiError("Supplier tidak ditemukan.", status_code=404, code="not_found")

    updates = {}
    if "kode_supplier" in data:
        kode = sanitize_kode(data["kode_supplier"], field="Kode supplier")
        dup = db.master_supplier.find_one({"kode_supplier": kode, "_id": {"$ne": oid}})
        if dup:
            raise ApiError("Kode supplier sudah dipakai.", status_code=409, code="conflict")
        updates["kode_supplier"] = kode
    if "nama_supplier" in data:
        updates["nama_supplier"] = sanitize_str(data["nama_supplier"], max_len=150, field="Nama supplier")
    if "alamat" in data:
        updates["alamat"] = sanitize_str(data["alamat"], max_len=300, field="Alamat")
    if "kontak" in data:
        updates["kontak"] = sanitize_str(data["kontak"], max_len=100, field="Kontak")

    if not updates:
        raise ApiError("Tidak ada field yang diubah.", code="validation_error")

    db.master_supplier.update_one({"_id": oid}, {"$set": updates})
    updated = db.master_supplier.find_one({"_id": oid})
    record_audit("master_supplier", oid, "ubah", before=jsonable(existing), after=jsonable(updated))
    return jsonify({"item": jsonable(updated)})


@bp.delete("/supplier/<item_id>")
@role_required("admin")
def delete_supplier(item_id):
    db = get_db()
    oid = to_object_id(item_id, field="id")
    if db.master_product.find_one({"supplier_id": oid}):
        raise ApiError(
            "Supplier tidak bisa dihapus karena masih dipakai oleh produk.",
            status_code=409,
            code="in_use",
        )
    if db.rtv_shipments.find_one({"supplier_id": oid}):
        raise ApiError(
            "Supplier tidak bisa dihapus karena memiliki riwayat surat jalan.",
            status_code=409,
            code="in_use",
        )
    result = db.master_supplier.delete_one({"_id": oid})
    if result.deleted_count == 0:
        raise ApiError("Supplier tidak ditemukan.", status_code=404, code="not_found")
    record_audit("master_supplier", oid, "hapus")
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Produk
# ---------------------------------------------------------------------------
@bp.get("/produk")
@role_required("admin")
def list_produk_admin():
    db = get_db()
    cursor = db.master_product.find({}).sort("nama_produk", 1)
    items = []
    suppliers = {s["_id"]: s for s in db.master_supplier.find({})}
    for d in cursor:
        supplier = suppliers.get(d.get("supplier_id"))
        d["supplier_nama"] = supplier["nama_supplier"] if supplier else None
        items.append(jsonable(d))
    return jsonify({"items": items})


@bp.post("/produk")
@role_required("admin")
def create_produk():
    data = request.get_json(silent=True) or {}
    require_fields(data, ["barcode", "nama_produk", "harga", "supplier_id"])
    db = get_db()

    barcode = sanitize_barcode(data["barcode"])
    if db.master_product.find_one({"barcode": barcode}):
        raise ApiError("Barcode sudah dipakai produk lain.", status_code=409, code="conflict")

    supplier_id = to_object_id(data["supplier_id"], field="supplier_id")
    if not db.master_supplier.find_one({"_id": supplier_id}):
        raise ApiError("Supplier tidak ditemukan.", status_code=404, code="not_found")

    doc = {
        "barcode": barcode,
        "nama_produk": sanitize_str(data["nama_produk"], max_len=200, field="Nama produk"),
        "harga": to_decimal128(data["harga"], field="Harga"),
        "supplier_id": supplier_id,
        "aktif": True,
    }
    result = db.master_product.insert_one(doc)
    doc["_id"] = result.inserted_id
    record_audit("master_product", doc["_id"], "tambah", after=jsonable(doc))
    return jsonify({"item": jsonable(doc)}), 201


@bp.put("/produk/<item_id>")
@role_required("admin")
def update_produk(item_id):
    data = request.get_json(silent=True) or {}
    db = get_db()
    oid = to_object_id(item_id, field="id")
    existing = db.master_product.find_one({"_id": oid})
    if not existing:
        raise ApiError("Produk tidak ditemukan.", status_code=404, code="not_found")

    updates = {}
    if "barcode" in data:
        barcode = sanitize_barcode(data["barcode"])
        if db.master_product.find_one({"barcode": barcode, "_id": {"$ne": oid}}):
            raise ApiError("Barcode sudah dipakai produk lain.", status_code=409, code="conflict")
        updates["barcode"] = barcode
    if "nama_produk" in data:
        updates["nama_produk"] = sanitize_str(data["nama_produk"], max_len=200, field="Nama produk")
    if "harga" in data:
        updates["harga"] = to_decimal128(data["harga"], field="Harga")
    if "supplier_id" in data:
        supplier_id = to_object_id(data["supplier_id"], field="supplier_id")
        if not db.master_supplier.find_one({"_id": supplier_id}):
            raise ApiError("Supplier tidak ditemukan.", status_code=404, code="not_found")
        updates["supplier_id"] = supplier_id
    if "aktif" in data:
        updates["aktif"] = bool(data["aktif"])

    if not updates:
        raise ApiError("Tidak ada field yang diubah.", code="validation_error")

    db.master_product.update_one({"_id": oid}, {"$set": updates})
    updated = db.master_product.find_one({"_id": oid})
    record_audit("master_product", oid, "ubah", before=jsonable(existing), after=jsonable(updated))
    return jsonify({"item": jsonable(updated)})


@bp.delete("/produk/<item_id>")
@role_required("admin")
def delete_produk(item_id):
    db = get_db()
    oid = to_object_id(item_id, field="id")
    if db.rtv_transactions.find_one({"product.product_id": oid}):
        raise ApiError(
            "Produk tidak bisa dihapus karena memiliki riwayat transaksi RTV. "
            "Nonaktifkan produk ini sebagai gantinya.",
            status_code=409,
            code="in_use",
        )
    result = db.master_product.delete_one({"_id": oid})
    if result.deleted_count == 0:
        raise ApiError("Produk tidak ditemukan.", status_code=404, code="not_found")
    record_audit("master_product", oid, "hapus")
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Toko / Store
# ---------------------------------------------------------------------------
@bp.get("/store")
@role_required("admin")
def list_store_admin():
    db = get_db()
    cursor = db.master_store.find({}).sort("nama_store", 1)
    return jsonify({"items": [jsonable(d) for d in cursor]})


@bp.post("/store")
@role_required("admin")
def create_store():
    data = request.get_json(silent=True) or {}
    require_fields(data, ["kode_store", "nama_store", "alamat"])
    db = get_db()

    kode = sanitize_kode(data["kode_store"], field="Kode toko")
    if db.master_store.find_one({"kode_store": kode}):
        raise ApiError("Kode toko sudah dipakai.", status_code=409, code="conflict")

    doc = {
        "kode_store": kode,
        "nama_store": sanitize_str(data["nama_store"], max_len=150, field="Nama toko"),
        "alamat": sanitize_str(data["alamat"], max_len=300, field="Alamat"),
    }
    result = db.master_store.insert_one(doc)
    doc["_id"] = result.inserted_id
    record_audit("master_store", doc["_id"], "tambah", after=jsonable(doc))
    return jsonify({"item": jsonable(doc)}), 201


@bp.put("/store/<item_id>")
@role_required("admin")
def update_store(item_id):
    data = request.get_json(silent=True) or {}
    db = get_db()
    oid = to_object_id(item_id, field="id")
    existing = db.master_store.find_one({"_id": oid})
    if not existing:
        raise ApiError("Toko tidak ditemukan.", status_code=404, code="not_found")

    updates = {}
    if "kode_store" in data:
        kode = sanitize_kode(data["kode_store"], field="Kode toko")
        if db.master_store.find_one({"kode_store": kode, "_id": {"$ne": oid}}):
            raise ApiError("Kode toko sudah dipakai.", status_code=409, code="conflict")
        updates["kode_store"] = kode
    if "nama_store" in data:
        updates["nama_store"] = sanitize_str(data["nama_store"], max_len=150, field="Nama toko")
    if "alamat" in data:
        updates["alamat"] = sanitize_str(data["alamat"], max_len=300, field="Alamat")

    if not updates:
        raise ApiError("Tidak ada field yang diubah.", code="validation_error")

    db.master_store.update_one({"_id": oid}, {"$set": updates})
    updated = db.master_store.find_one({"_id": oid})
    record_audit("master_store", oid, "ubah", before=jsonable(existing), after=jsonable(updated))
    return jsonify({"item": jsonable(updated)})


@bp.delete("/store/<item_id>")
@role_required("admin")
def delete_store(item_id):
    db = get_db()
    oid = to_object_id(item_id, field="id")
    if db.master_karyawan.find_one({"store_id": oid}):
        raise ApiError("Toko tidak bisa dihapus karena masih memiliki karyawan.", status_code=409, code="in_use")
    if db.rtv_transactions.find_one({"store_id": oid}):
        raise ApiError("Toko tidak bisa dihapus karena memiliki riwayat transaksi RTV.", status_code=409, code="in_use")
    result = db.master_store.delete_one({"_id": oid})
    if result.deleted_count == 0:
        raise ApiError("Toko tidak ditemukan.", status_code=404, code="not_found")
    record_audit("master_store", oid, "hapus")
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Shift
# ---------------------------------------------------------------------------
@bp.get("/shift")
@role_required("admin")
def list_shift_admin():
    db = get_db()
    cursor = db.master_shift.find({}).sort("nama_shift", 1)
    return jsonify({"items": [jsonable(d) for d in cursor]})


@bp.post("/shift")
@role_required("admin")
def create_shift():
    data = request.get_json(silent=True) or {}
    require_fields(data, ["nama_shift", "jam_mulai", "jam_selesai"])
    db = get_db()

    nama = sanitize_str(data["nama_shift"], max_len=50, field="Nama shift")
    if db.master_shift.find_one({"nama_shift": nama}):
        raise ApiError("Nama shift sudah dipakai.", status_code=409, code="conflict")

    doc = {
        "nama_shift": nama,
        "jam_mulai": sanitize_str(data["jam_mulai"], max_len=5, field="Jam mulai"),
        "jam_selesai": sanitize_str(data["jam_selesai"], max_len=5, field="Jam selesai"),
    }
    result = db.master_shift.insert_one(doc)
    doc["_id"] = result.inserted_id
    record_audit("master_shift", doc["_id"], "tambah", after=jsonable(doc))
    return jsonify({"item": jsonable(doc)}), 201


@bp.put("/shift/<item_id>")
@role_required("admin")
def update_shift(item_id):
    data = request.get_json(silent=True) or {}
    db = get_db()
    oid = to_object_id(item_id, field="id")
    existing = db.master_shift.find_one({"_id": oid})
    if not existing:
        raise ApiError("Shift tidak ditemukan.", status_code=404, code="not_found")

    updates = {}
    if "nama_shift" in data:
        nama = sanitize_str(data["nama_shift"], max_len=50, field="Nama shift")
        if db.master_shift.find_one({"nama_shift": nama, "_id": {"$ne": oid}}):
            raise ApiError("Nama shift sudah dipakai.", status_code=409, code="conflict")
        updates["nama_shift"] = nama
    if "jam_mulai" in data:
        updates["jam_mulai"] = sanitize_str(data["jam_mulai"], max_len=5, field="Jam mulai")
    if "jam_selesai" in data:
        updates["jam_selesai"] = sanitize_str(data["jam_selesai"], max_len=5, field="Jam selesai")

    if not updates:
        raise ApiError("Tidak ada field yang diubah.", code="validation_error")

    db.master_shift.update_one({"_id": oid}, {"$set": updates})
    updated = db.master_shift.find_one({"_id": oid})
    record_audit("master_shift", oid, "ubah", before=jsonable(existing), after=jsonable(updated))
    return jsonify({"item": jsonable(updated)})


@bp.delete("/shift/<item_id>")
@role_required("admin")
def delete_shift(item_id):
    db = get_db()
    oid = to_object_id(item_id, field="id")
    if db.master_karyawan.find_one({"shift_id": oid}):
        raise ApiError("Shift tidak bisa dihapus karena masih dipakai karyawan.", status_code=409, code="in_use")
    result = db.master_shift.delete_one({"_id": oid})
    if result.deleted_count == 0:
        raise ApiError("Shift tidak ditemukan.", status_code=404, code="not_found")
    record_audit("master_shift", oid, "hapus")
    return jsonify({"ok": True})
