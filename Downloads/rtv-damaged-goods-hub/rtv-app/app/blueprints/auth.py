"""
Autentikasi: login, logout, dan info sesi (/api/auth/*).

Mengikuti sequence diagram "Autentikasi dan otorisasi":
1. Client POST /login (username, password)
2. Cari username di master_karyawan, cocokkan hash password
3. Jika benar & akun aktif -> simpan session, kembalikan menu sesuai role
4. Jika salah / nonaktif -> tolak dengan pesan generik (tidak membocorkan
   apakah username ada atau tidak, demi keamanan)
"""
from flask import Blueprint, jsonify, request, session

from ..db import get_db
from ..security import ApiError, login_required, record_audit, verify_password
from ..utils import jsonable, sanitize_username

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
