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
    # Batas body request. Foto bukti dikirim sebagai data-URL ter-kompresi
    # (maks 3 foto x ~450 KB), jadi 4 MB. Batas Vercel sendiri adalah 4,5 MB.
    MAX_CONTENT_LENGTH = 4 * 1024 * 1024

    # --- Identitas aplikasi (ubah di sini / lewat environment variable untuk ganti nama) ---
    APP_NAME = os.environ.get("APP_NAME", "SIRETUR")
    APP_SHORT_NAME = os.environ.get("APP_SHORT_NAME", "SIRETUR")
    APP_SUBTITLE = os.environ.get("APP_SUBTITLE", "Sistem Retur Barang")
    APP_TAGLINE = os.environ.get("APP_TAGLINE", "Masuk untuk mengelola retur barang rusak")
    APP_VERSION = "2.0.0"  # juga dipakai sebagai penanda cache file CSS/JS

    # --- Keamanan login ---
    LOGIN_MAX_FAILS = int(os.environ.get("LOGIN_MAX_FAILS", "5"))
    LOGIN_WINDOW_MINUTES = int(os.environ.get("LOGIN_WINDOW_MINUTES", "15"))
    LOGIN_LOCK_MINUTES = int(os.environ.get("LOGIN_LOCK_MINUTES", "15"))

    # --- Umur stok karantina (hari) ---
    AGING_WARN_DAYS = int(os.environ.get("AGING_WARN_DAYS", "14"))
    AGING_CRITICAL_DAYS = int(os.environ.get("AGING_CRITICAL_DAYS", "30"))

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