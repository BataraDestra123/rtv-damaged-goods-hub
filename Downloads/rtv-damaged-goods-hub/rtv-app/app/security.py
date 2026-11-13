"""
Autentikasi, otorisasi, dan audit trail.

Mengimplementasikan ketentuan:
- Setiap request (selain /api/auth/login) wajib login.
- Setiap request memeriksa ulang session, role, akun aktif, dan toko
  langsung dari database (bukan hanya dari isi cookie), supaya karyawan
  yang baru dinonaktifkan atau dipindah toko langsung kehilangan akses.
"""
from functools import wraps

from bson import ObjectId
from flask import current_app, g, jsonify, session

from .db import get_db


class ApiError(Exception):
    """Exception terkontrol -> diubah jadi JSON error oleh error handler global."""

    def __init__(self, message, status_code=400, code="bad_request", extra=None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.extra = extra or {}

    def to_dict(self):
        payload = {"error": self.code, "message": self.message}
        if self.extra:
            payload["detail"] = self.extra
        return payload


def hash_password(raw_password):
    from werkzeug.security import generate_password_hash

    return generate_password_hash(raw_password, method="pbkdf2:sha256", salt_length=16)


def verify_password(raw_password, password_hash):
    from werkzeug.security import check_password_hash

    try:
        return check_password_hash(password_hash, raw_password)
    except (TypeError, ValueError):
        return False


def current_user():
    return getattr(g, "user", None)


def _load_fresh_user():
    """Ambil ulang dokumen karyawan dari DB berdasarkan session, bukan dari cookie saja."""
    user_id = session.get("user_id")
    if not user_id:
        return None
    db = get_db()
    try:
        oid = ObjectId(user_id)
    except Exception:
        return None
    doc = db.master_karyawan.find_one({"_id": oid})
    if not doc:
        return None
    if not doc.get("aktif", False):
        return None
    # Role & store harus sinkron dengan session saat ini; kalau admin memindah
    # karyawan atau mengubah role di tengah sesi, perubahan berlaku seketika.
    return doc


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = _load_fresh_user()
        if user is None:
            session.clear()
            raise ApiError(
                "Sesi tidak valid, akun nonaktif, atau belum login.",
                status_code=401,
                code="unauthorized",
            )
        g.user = user
        return view(*args, **kwargs)

    return wrapped


def role_required(*roles):
    def decorator(view):
        @wraps(view)
        @login_required
        def wrapped(*args, **kwargs):
            if g.user.get("role") not in roles:
                raise ApiError(
                    "Anda tidak memiliki hak akses untuk aksi ini.",
                    status_code=403,
                    code="forbidden",
                )
            return view(*args, **kwargs)

        return wrapped

    return decorator


def record_audit(collection, document_id, action, before=None, after=None):
    """Audit trail sederhana (fitur lanjutan #9 pada deskripsi fitur)."""
    import datetime

    db = get_db()
    user = current_user() or {}
    db.audit_logs.insert_one(
        {
            "collection": collection,
            "document_id": str(document_id),
            "action": action,
            "before": before,
            "after": after,
            "oleh": {
                "id": str(user.get("_id")) if user.get("_id") else None,
                "nama": user.get("nama"),
                "role": user.get("role"),
            },
            "tgl": datetime.datetime.utcnow(),
        }
    )
