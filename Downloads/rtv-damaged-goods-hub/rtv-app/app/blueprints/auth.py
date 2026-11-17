"""
Autentikasi: login, logout, dan info sesi (/api/auth/*).

Mengikuti sequence diagram "Autentikasi dan otorisasi":
1. Client POST /login (username, password)
2. Cari username di master_karyawan, cocokkan hash password
3. Jika benar & akun aktif -> simpan session, kembalikan menu sesuai role
4. Jika salah / nonaktif -> tolak dengan pesan generik (tidak membocorkan
   apakah username ada atau tidak, demi keamanan)
"""
import datetime
import os

from flask import Blueprint, jsonify, request, session
from pymongo.errors import DuplicateKeyError

from ..db import get_db
from ..security import ApiError, hash_password, login_required, record_audit, verify_password
from ..utils import (
    jsonable,
    one_of,
    require_fields,
    sanitize_str,
    sanitize_username,
    to_object_id,
)

bp = Blueprint("auth", __name__)


def _serialize_session_user(doc):
    return {
        "id": str(doc["_id"]),
        "nik": doc.get("nik"),
        "nama": doc.get("nama"),
        "username": doc.get("username"),
        "role": doc.get("role"),
        "store_id": str(doc["store_id"]) if doc.get("store_id") else None,
        "shift_id": str(doc["shift_id"]) if doc.get("shift_id") else None,
    }


@bp.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    raw_username = data.get("username", "")
    raw_password = data.get("password", "")

    if not raw_username or not raw_password:
        raise ApiError("Username dan password wajib diisi.", code="validation_error")

    try:
        username = sanitize_username(raw_username)
    except ApiError:
        # Format username tidak valid -> tetap balas pesan generik gagal login
        raise ApiError("Username atau password salah, atau akun nonaktif.", status_code=401, code="invalid_credentials")

    if len(raw_password) > 256:
        raise ApiError("Password terlalu panjang.", code="validation_error")

    db = get_db()
    user = db.master_karyawan.find_one({"username": username})

    if not user or not verify_password(raw_password, user.get("password_hash", "")):
        raise ApiError(
            "Username atau password salah, atau akun nonaktif.",
            status_code=401,
            code="invalid_credentials",
        )

    if not user.get("aktif", False):
        raise ApiError(
            "Username atau password salah, atau akun nonaktif.",
            status_code=401,
            code="invalid_credentials",
        )

    session.clear()
    session.permanent = True
    session["user_id"] = str(user["_id"])

    record_audit("master_karyawan", user["_id"], "login")

    return jsonify({"user": _serialize_session_user(user)})


@bp.post("/logout")
@login_required
def logout():
    from flask import g

    record_audit("master_karyawan", g.user["_id"], "logout")
    session.clear()
    return jsonify({"ok": True})


@bp.get("/me")
@login_required
def me():
    from flask import g

    db = get_db()
    store = None
    if g.user.get("store_id"):
        store_doc = db.master_store.find_one({"_id": g.user["store_id"]})
        store = jsonable(store_doc) if store_doc else None
    user_payload = _serialize_session_user(g.user)
    user_payload["store"] = store
    return jsonify({"user": user_payload})


# ===========================================================================
# DAFTAR AKUN BARU & LUPA PASSWORD (endpoint publik, tanpa login)
# ===========================================================================

# Role yang boleh dipilih lewat pendaftaran mandiri. "admin" TIDAK boleh.
_SELF_REGISTER_ROLES = ("staff_toko", "staff_gudang")


def _auto_activate():
    # Default 0 = akun baru harus diaktifkan admin (menu Karyawan -> Aktifkan).
    # Set REGISTER_AUTO_ACTIVE=1 di environment jika akun boleh langsung aktif.
    return os.environ.get("REGISTER_AUTO_ACTIVE", "0") == "1"


def _check_password_rule(password):
    if not isinstance(password, str) or len(password) < 8:
        raise ApiError("Password minimal 8 karakter.", code="validation_error")
    if len(password) > 256:
        raise ApiError("Password terlalu panjang.", code="validation_error")


@bp.get("/register-options")
def register_options():
    """Daftar toko & shift untuk dropdown form pendaftaran."""
    db = get_db()
    stores = [
        {"id": str(s["_id"]), "nama": s.get("nama_store"), "kode": s.get("kode_store")}
        for s in db.master_store.find({}).sort("nama_store", 1)
    ]
    shifts = [
        {"id": str(s["_id"]), "nama": s.get("nama_shift")}
        for s in db.master_shift.find({}).sort("nama_shift", 1)
    ]
    return jsonify({"stores": stores, "shifts": shifts, "auto_active": _auto_activate()})


@bp.post("/register")
def register():
    data = request.get_json(silent=True) or {}
    require_fields(data, ["nama", "nik", "username", "password", "role", "store_id"])
    db = get_db()

    nik = sanitize_str(data["nik"], max_len=32, field="NIK")
    if not nik.isalnum():
        raise ApiError("NIK hanya boleh huruf dan angka.", code="validation_error")
    if db.master_karyawan.find_one({"nik": nik}):
        raise ApiError("NIK sudah terdaftar.", status_code=409, code="conflict")

    username = sanitize_username(data["username"])
    if db.master_karyawan.find_one({"username": username}):
        raise ApiError("Username sudah dipakai.", status_code=409, code="conflict")

    _check_password_rule(data["password"])
    role = one_of(data["role"], _SELF_REGISTER_ROLES, field="role")

    store_id = to_object_id(data["store_id"], field="store_id")
    if not db.master_store.find_one({"_id": store_id}):
        raise ApiError("Toko tidak ditemukan.", status_code=404, code="not_found")

    shift_id = None
    if data.get("shift_id"):
        shift_id = to_object_id(data["shift_id"], field="shift_id")
        if not db.master_shift.find_one({"_id": shift_id}):
            raise ApiError("Shift tidak ditemukan.", status_code=404, code="not_found")

    aktif = _auto_activate()
    doc = {
        "nik": nik,
        "nama": sanitize_str(data["nama"], max_len=150, field="Nama"),
        "username": username,
        "password_hash": hash_password(data["password"]),
        "role": role,
        "store_id": store_id,
        "shift_id": shift_id,
        "aktif": aktif,
        "tgl_nonaktif": None if aktif else datetime.datetime.utcnow(),
        "tgl_mulai_penempatan": datetime.datetime.utcnow(),
        "riwayat_penempatan": [],
    }
    try:
        result = db.master_karyawan.insert_one(doc)
    except DuplicateKeyError:
        raise ApiError("NIK atau username sudah terdaftar.", status_code=409, code="conflict")

    safe_doc = {k: v for k, v in doc.items() if k != "password_hash"}
    safe_doc["_id"] = result.inserted_id
    record_audit("master_karyawan", result.inserted_id, "daftar_mandiri", after=jsonable(safe_doc))

    if aktif:
        message = "Pendaftaran berhasil. Silakan masuk dengan akun Anda."
    else:
        message = "Pendaftaran berhasil. Akun Anda menunggu persetujuan admin sebelum bisa dipakai masuk."
    return jsonify({"ok": True, "aktif": aktif, "message": message}), 201


@bp.post("/reset-password")
def reset_password():
    """
    Lupa password tanpa email: verifikasi username + NIK, lalu set password baru.
    Akun admin tidak bisa direset lewat sini (reset oleh admin lain di menu Karyawan).
    Pesan gagal dibuat generik supaya tidak membocorkan data akun.
    """
    data = request.get_json(silent=True) or {}
    require_fields(data, ["username", "nik", "new_password"])
    generic_fail = ApiError(
        "Username dan NIK tidak cocok, atau akun tidak bisa direset mandiri.",
        status_code=400,
        code="reset_failed",
    )

    _check_password_rule(data["new_password"])

    try:
        username = sanitize_username(data["username"])
        nik = sanitize_str(data["nik"], max_len=32, field="NIK")
    except ApiError:
        raise generic_fail

    db = get_db()
    user = db.master_karyawan.find_one({"username": username, "nik": nik})
    if not user or not user.get("aktif", False) or user.get("role") == "admin":
        raise generic_fail

    db.master_karyawan.update_one(
        {"_id": user["_id"]},
        {"$set": {"password_hash": hash_password(data["new_password"])}},
    )
    record_audit("master_karyawan", user["_id"], "reset_password_mandiri")
    return jsonify({"ok": True, "message": "Password berhasil diubah. Silakan masuk dengan password baru."})
