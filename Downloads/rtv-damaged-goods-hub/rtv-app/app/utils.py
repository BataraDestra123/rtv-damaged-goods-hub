"""
Helper validasi, sanitasi input, dan serialisasi dokumen MongoDB ke JSON.

Semua fungsi di sini sengaja tidak bergantung pada library eksternal
tambahan (selain pymongo/bson) supaya mudah di-deploy di Vercel tanpa
dependency ekstra.
"""
import datetime
import html
import re
import unicodedata

from bson import ObjectId
from bson.decimal128 import Decimal128

from .security import ApiError

_WS_RE = re.compile(r"\s+")
_USERNAME_RE = re.compile(r"^[a-zA-Z0-9_.\-]{3,32}$")
_KODE_RE = re.compile(r"^[A-Za-z0-9_\-]{2,20}$")
_BARCODE_RE = re.compile(r"^[A-Za-z0-9\-]{4,32}$")


# ---------------------------------------------------------------------------
# Sanitasi
# ---------------------------------------------------------------------------
def sanitize_str(value, max_len=255, field="field", required=True, allow_empty=False):
    """Trim, normalisasi whitespace, hilangkan karakter kontrol, escape HTML."""
    if value is None:
        value = ""
    if not isinstance(value, str):
        value = str(value)
    # Hilangkan karakter kontrol non-printable (mis. null byte, ANSI)
    value = "".join(ch for ch in value if unicodedata.category(ch)[0] != "C" or ch in "\n\t")
    value = _WS_RE.sub(" ", value).strip()
    if required and not allow_empty and value == "":
        raise ApiError(f"{field} wajib diisi.", code="validation_error")
    if len(value) > max_len:
        raise ApiError(f"{field} maksimal {max_len} karakter.", code="validation_error")
    # Escape agar aman ditampilkan sebagai HTML di frontend (anti-XSS)
    return html.escape(value, quote=True)


def unescape_for_display(value):
    """Kebalikan dari html.escape, dipakai saat menulis ke field non-HTML (mis. cetak dokumen)."""
    return html.unescape(value) if isinstance(value, str) else value


def sanitize_username(value):
    value = sanitize_str(value, max_len=32, field="Username")
    if not _USERNAME_RE.match(value):
        raise ApiError(
            "Username hanya boleh huruf, angka, titik, underscore, dan tanda hubung (3-32 karakter).",
            code="validation_error",
        )
    return value.lower()


def sanitize_kode(value, field="Kode"):
    value = sanitize_str(value, max_len=20, field=field)
    if not _KODE_RE.match(value):
        raise ApiError(f"{field} hanya boleh huruf, angka, underscore, dan tanda hubung.", code="validation_error")
    return value.upper()


def sanitize_barcode(value):
    value = sanitize_str(value, max_len=32, field="Barcode")
    if not _BARCODE_RE.match(value):
        raise ApiError("Barcode tidak valid (huruf, angka, tanda hubung, 4-32 karakter).", code="validation_error")
    return value


# ---------------------------------------------------------------------------
# Validasi tipe data
# ---------------------------------------------------------------------------
def require_fields(data, fields):
    if not isinstance(data, dict):
        raise ApiError("Body request harus berupa JSON object.", code="validation_error")
    missing = [f for f in fields if data.get(f) in (None, "")]
    if missing:
        raise ApiError(
            f"Field wajib belum diisi: {', '.join(missing)}.",
            code="validation_error",
            extra={"missing": missing},
        )


def to_positive_int(value, field="qty", allow_zero=False):
    try:
        f_value = float(value)
        i_value = int(value)
    except (TypeError, ValueError):
        raise ApiError(f"{field} harus berupa angka bulat.", code="validation_error")
    if f_value != i_value:
        raise ApiError(f"{field} harus berupa angka bulat (tanpa desimal).", code="validation_error")
    if allow_zero and i_value < 0:
        raise ApiError(f"{field} tidak boleh negatif.", code="validation_error")
    if not allow_zero and i_value <= 0:
        raise ApiError(f"{field} harus lebih besar dari 0.", code="validation_error")
    return i_value


def to_decimal128(value, field="harga"):
    try:
        d = float(value)
    except (TypeError, ValueError):
        raise ApiError(f"{field} harus berupa angka.", code="validation_error")
    if d < 0:
        raise ApiError(f"{field} tidak boleh negatif.", code="validation_error")
    return Decimal128(str(round(d, 2)))


def to_object_id(value, field="id"):
    if isinstance(value, ObjectId):
        return value
    try:
        return ObjectId(str(value))
    except Exception:
        raise ApiError(f"{field} tidak valid.", code="validation_error")


def parse_date(value, field="tanggal", required=True):
    if value in (None, ""):
        if required:
            raise ApiError(f"{field} wajib diisi.", code="validation_error")
        return None
    if isinstance(value, datetime.datetime):
        return value
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            return datetime.datetime.strptime(str(value)[:26], fmt)
        except ValueError:
            continue
    # fallback ISO parse
    try:
        return datetime.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        raise ApiError(f"{field} format tanggal tidak valid (gunakan YYYY-MM-DD).", code="validation_error")


def one_of(value, choices, field="value"):
    if value not in choices:
        raise ApiError(
            f"{field} harus salah satu dari: {', '.join(choices)}.", code="validation_error"
        )
    return value


# ---------------------------------------------------------------------------
# Serialisasi dokumen Mongo -> JSON
# ---------------------------------------------------------------------------
def jsonable(doc):
    """Konversi rekursif dokumen MongoDB (dict/list) menjadi struktur JSON-safe."""
    if doc is None:
        return None
    if isinstance(doc, ObjectId):
        return str(doc)
    if isinstance(doc, Decimal128):
        return float(doc.to_decimal())
    if isinstance(doc, datetime.datetime):
        return doc.replace(tzinfo=doc.tzinfo or datetime.timezone.utc).isoformat()
    if isinstance(doc, datetime.date):
        return doc.isoformat()
    if isinstance(doc, dict):
        return {k: jsonable(v) for k, v in doc.items()}
    if isinstance(doc, (list, tuple)):
        return [jsonable(v) for v in doc]
    return doc


def generate_sequential_code(db, counter_name, prefix, width=6):
    """
    Generator kode berurutan (no_rtv, no_surat_jalan) menggunakan collection
    counters + findAndModify sehingga aman dari race condition multi-user.
    Format: PREFIX-YYYYMM-000001
    """
    period = datetime.datetime.utcnow().strftime("%Y%m")
    key = f"{counter_name}:{period}"
    result = db.counters.find_one_and_update(
        {"_id": key},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    seq = result["seq"] if result else 1
    return f"{prefix}-{period}-{str(seq).zfill(width)}"
