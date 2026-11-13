"""
Konfigurasi aplikasi RTV & Damaged Goods Hub.

Semua nilai sensitif dibaca dari environment variable supaya aman untuk
di-deploy ke Vercel (lihat README.md bagian Deployment).
"""
import os


class Config:
    # --- MongoDB ---
    MONGO_URI = os.environ.get(
        "MONGO_URI", "mongodb://localhost:27017/rtv_damaged_goods"
    )
    MONGO_DB_NAME = os.environ.get("MONGO_DB_NAME", "rtv_damaged_goods")

    # --- Flask / Session ---
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-key-change-me")
    SESSION_COOKIE_NAME = "rtv_session"
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    # Vercel selalu HTTPS di production -> cookie secure aktif otomatis.
    SESSION_COOKIE_SECURE = os.environ.get("SESSION_COOKIE_SECURE", "1") == "1"
    PERMANENT_SESSION_LIFETIME = 60 * 60 * 8  # 8 jam

    # --- Aplikasi ---
    JSON_SORT_KEYS = False
    MAX_CONTENT_LENGTH = 2 * 1024 * 1024  # 2 MB, batas ukuran body request

    # --- Batas toleransi stok karantina (fitur peringatan) ---
    STOK_RUSAK_WARNING_THRESHOLD = int(
        os.environ.get("STOK_RUSAK_WARNING_THRESHOLD", "50")
    )

    # --- Role & status yang valid (single source of truth) ---
    ROLES = ("staff_toko", "staff_gudang", "admin")
    STATUS_FLOW = (
        "Pending",
        "Received",
        "Approved",
        "Rejected",
        "Shipped to Supplier",
        "Completed",
        "Cancelled",
    )


def get_config():
    return Config
