"""
Kelola Karyawan - khusus Admin (lihat use case: Kelola Karyawan, dengan
extend Nonaktifkan Karyawan dan Pindahkan Karyawan ke Toko Lain).
"""
import datetime

from flask import Blueprint, g, jsonify, request

from ..db import get_db
from ..security import ApiError, hash_password, record_audit, role_required
from ..utils import (
    jsonable,
    require_fields,
    sanitize_str,
    sanitize_username,
    to_object_id,
    one_of,
)
from ..config import Config

bp = Blueprint("karyawan", __name__)


def _validate_nik(value):
    value = sanitize_str(value, max_len=32, field="NIK")
    if not value.isalnum():
        raise ApiError("NIK hanya boleh huruf dan angka.", code="validation_error")
    return value


@bp.get("")
@role_required("admin")
def list_karyawan():
    db = get_db()
    cursor = db.master_karyawan.find({}).sort("nama", 1)
    stores = {s["_id"]: s for s in db.master_store.find({})}
    shifts = {s["_id"]: s for s in db.master_shift.find({})}
    items = []
    for d in cursor:
        d.pop("password_hash", None)
        store = stores.get(d.get("store_id"))
        shift = shifts.get(d.get("shift_id"))
        d["store_nama"] = store["nama_store"] if store else None
        d["shift_nama"] = shift["nama_shift"] if shift else None
        items.append(jsonable(d))
    return jsonify({"items": items})


@bp.post("")
@role_required("admin")
def create_karyawan():
    data = request.get_json(silent=True) or {}
    require_fields(data, ["nik", "nama", "username", "password", "role", "store_id"])
    db = get_db()

    nik = _validate_nik(data["nik"])
    if db.master_karyawan.find_one({"nik": nik}):
        raise ApiError("NIK sudah terdaftar.", status_code=409, code="conflict")

    username = sanitize_username(data["username"])
    if db.master_karyawan.find_one({"username": username}):
        raise ApiError("Username sudah dipakai.", status_code=409, code="conflict")

    password = data["password"]
    if not isinstance(password, str) or len(password) < 8:
        raise ApiError("Password minimal 8 karakter.", code="validation_error")

    role = one_of(data["role"], Config.ROLES, field="role")
    store_id = to_object_id(data["store_id"], field="store_id")
    if not db.master_store.find_one({"_id": store_id}):
        raise ApiError("Toko tidak ditemukan.", status_code=404, code="not_found")

    shift_id = None
    if data.get("shift_id"):
        shift_id = to_object_id(data["shift_id"], field="shift_id")
        if not db.master_shift.find_one({"_id": shift_id}):
            raise ApiError("Shift tidak ditemukan.", status_code=404, code="not_found")

    now = datetime.datetime.utcnow()
    doc = {
        "nik": nik,
        "nama": sanitize_str(data["nama"], max_len=150, field="Nama"),
        "username": username,
        "password_hash": hash_password(password),
        "role": role,
        "store_id": store_id,
        "shift_id": shift_id,
        "aktif": True,
        "tgl_nonaktif": None,
        "tgl_mulai_penempatan": now,
        "riwayat_penempatan": [],
    }
    result = db.master_karyawan.insert_one(doc)
    doc["_id"] = result.inserted_id
    safe_doc = {k: v for k, v in doc.items() if k != "password_hash"}
    record_audit("master_karyawan", doc["_id"], "tambah", after=jsonable(safe_doc))
    return jsonify({"item": jsonable(safe_doc)}), 201


@bp.put("/<item_id>")
@role_required("admin")
def update_karyawan(item_id):
    data = request.get_json(silent=True) or {}
    db = get_db()
    oid = to_object_id(item_id, field="id")
    existing = db.master_karyawan.find_one({"_id": oid})
    if not existing:
        raise ApiError("Karyawan tidak ditemukan.", status_code=404, code="not_found")

    updates = {}
    if "nama" in data:
        updates["nama"] = sanitize_str(data["nama"], max_len=150, field="Nama")
    if "role" in data:
        updates["role"] = one_of(data["role"], Config.ROLES, field="role")
    if "shift_id" in data:
        if data["shift_id"]:
            shift_id = to_object_id(data["shift_id"], field="shift_id")
            if not db.master_shift.find_one({"_id": shift_id}):
                raise ApiError("Shift tidak ditemukan.", status_code=404, code="not_found")
            updates["shift_id"] = shift_id
        else:
            updates["shift_id"] = None
    if "password" in data and data["password"]:
        if len(data["password"]) < 8:
            raise ApiError("Password minimal 8 karakter.", code="validation_error")
        updates["password_hash"] = hash_password(data["password"])

    if not updates:
        raise ApiError("Tidak ada field yang diubah.", code="validation_error")

    db.master_karyawan.update_one({"_id": oid}, {"$set": updates})
    updated = db.master_karyawan.find_one({"_id": oid})
    safe_before = {k: v for k, v in existing.items() if k != "password_hash"}
    safe_after = {k: v for k, v in updated.items() if k != "password_hash"}
    record_audit("master_karyawan", oid, "ubah", before=jsonable(safe_before), after=jsonable(safe_after))
    return jsonify({"item": jsonable(safe_after)})


@bp.post("/<item_id>/nonaktifkan")
@role_required("admin")
def nonaktifkan_karyawan(item_id):
    """Set aktif=false, isi tgl_nonaktif; karyawan tidak bisa login lagi."""
    db = get_db()
    oid = to_object_id(item_id, field="id")
    existing = db.master_karyawan.find_one({"_id": oid})
    if not existing:
        raise ApiError("Karyawan tidak ditemukan.", status_code=404, code="not_found")
    if existing["_id"] == g.user["_id"]:
        raise ApiError("Anda tidak bisa menonaktifkan akun Anda sendiri.", status_code=400, code="validation_error")

    now = datetime.datetime.utcnow()
    db.master_karyawan.update_one({"_id": oid}, {"$set": {"aktif": False, "tgl_nonaktif": now}})
    updated = db.master_karyawan.find_one({"_id": oid})
    safe_after = {k: v for k, v in updated.items() if k != "password_hash"}
    record_audit("master_karyawan", oid, "nonaktifkan", after=jsonable(safe_after))
    return jsonify({"item": jsonable(safe_after)})


@bp.post("/<item_id>/aktifkan")
@role_required("admin")
def aktifkan_karyawan(item_id):
    """Mengaktifkan kembali karyawan yang sebelumnya dinonaktifkan."""
    db = get_db()
    oid = to_object_id(item_id, field="id")
    existing = db.master_karyawan.find_one({"_id": oid})
    if not existing:
        raise ApiError("Karyawan tidak ditemukan.", status_code=404, code="not_found")

    db.master_karyawan.update_one({"_id": oid}, {"$set": {"aktif": True, "tgl_nonaktif": None}})
    updated = db.master_karyawan.find_one({"_id": oid})
    safe_after = {k: v for k, v in updated.items() if k != "password_hash"}
    record_audit("master_karyawan", oid, "aktifkan", after=jsonable(safe_after))
    return jsonify({"item": jsonable(safe_after)})


@bp.post("/<item_id>/pindahkan")
@role_required("admin")
def pindahkan_karyawan(item_id):
    """
    Pindahkan Karyawan ke Toko Lain: ubah store_id, simpan toko lama ke
    riwayat_penempatan (tgl_mulai, tgl_selesai).
    """
    data = request.get_json(silent=True) or {}
    require_fields(data, ["store_id"])

    db = get_db()
    oid = to_object_id(item_id, field="id")
    existing = db.master_karyawan.find_one({"_id": oid})
    if not existing:
        raise ApiError("Karyawan tidak ditemukan.", status_code=404, code="not_found")

    new_store_id = to_object_id(data["store_id"], field="store_id")
    if not db.master_store.find_one({"_id": new_store_id}):
        raise ApiError("Toko tujuan tidak ditemukan.", status_code=404, code="not_found")

    if existing.get("store_id") == new_store_id:
        raise ApiError("Karyawan sudah ditempatkan di toko tersebut.", code="validation_error")

    now = datetime.datetime.utcnow()
    riwayat_entry = {
        "store_id": existing.get("store_id"),
        "tgl_mulai": existing.get("tgl_mulai_penempatan", existing.get("_id").generation_time if existing.get("_id") else now),
        "tgl_selesai": now,
    }

    db.master_karyawan.update_one(
        {"_id": oid},
        {
            "$set": {"store_id": new_store_id, "tgl_mulai_penempatan": now},
            "$push": {"riwayat_penempatan": riwayat_entry},
        },
    )
    updated = db.master_karyawan.find_one({"_id": oid})
    safe_after = {k: v for k, v in updated.items() if k != "password_hash"}
    record_audit("master_karyawan", oid, "pindahkan", before={"store_id": existing.get("store_id")}, after=jsonable(safe_after))
    return jsonify({"item": jsonable(safe_after)})
