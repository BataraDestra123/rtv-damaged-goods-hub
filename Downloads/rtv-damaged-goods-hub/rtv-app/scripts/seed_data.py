"""
Script seeding data awal + simulasi multi user / multi role.

Jalankan secara lokal (membaca MONGO_URI dari .env):

    python scripts/seed_data.py

Script ini aman dijalankan berulang kali (idempotent) -- data yang sudah
ada tidak akan diduplikasi, dicocokkan lewat field unik (kode/username).
"""
import os
import sys
import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from pymongo import MongoClient  # noqa: E402
from werkzeug.security import generate_password_hash  # noqa: E402

from app.db import ensure_indexes  # noqa: E402


MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017/rtv_damaged_goods")
MONGO_DB_NAME = os.environ.get("MONGO_DB_NAME", "rtv_damaged_goods")


def upsert(collection, filter_, doc):
    collection.update_one(filter_, {"$setOnInsert": doc}, upsert=True)
    return collection.find_one(filter_)


def main():
    client = MongoClient(MONGO_URI)
    db = client[MONGO_DB_NAME]

    print(f"Menghubungkan ke database: {MONGO_DB_NAME} ...")
    ensure_indexes(db)
    print("Index siap.")

    # --- Shift ---
    shift_pagi = upsert(
        db.master_shift,
        {"nama_shift": "Shift Pagi"},
        {"nama_shift": "Shift Pagi", "jam_mulai": "07:00", "jam_selesai": "15:00"},
    )
    shift_siang = upsert(
        db.master_shift,
        {"nama_shift": "Shift Siang"},
        {"nama_shift": "Shift Siang", "jam_mulai": "15:00", "jam_selesai": "23:00"},
    )

    # --- Store ---
    store_a = upsert(
        db.master_store,
        {"kode_store": "STR01"},
        {"kode_store": "STR01", "nama_store": "Toko Pusat Jakarta", "alamat": "Jl. Sudirman No. 1, Jakarta"},
    )
    store_b = upsert(
        db.master_store,
        {"kode_store": "STR02"},
        {"kode_store": "STR02", "nama_store": "Toko Cabang Bandung", "alamat": "Jl. Asia Afrika No. 10, Bandung"},
    )
    store_gudang = upsert(
        db.master_store,
        {"kode_store": "GDG01"},
        {"kode_store": "GDG01", "nama_store": "Gudang Pusat", "alamat": "Kawasan Industri Cibitung"},
    )

    # --- Supplier ---
    supplier_1 = upsert(
        db.master_supplier,
        {"kode_supplier": "SUP01"},
        {
            "kode_supplier": "SUP01",
            "nama_supplier": "PT Sumber Pangan Nusantara",
            "alamat": "Jl. Industri Raya No. 5, Tangerang",
            "kontak": "021-5550101",
        },
    )
    supplier_2 = upsert(
        db.master_supplier,
        {"kode_supplier": "SUP02"},
        {
            "kode_supplier": "SUP02",
            "nama_supplier": "CV Mitra Kemasan Jaya",
            "alamat": "Jl. Raya Serang KM 12, Cikupa",
            "kontak": "021-5550202",
        },
    )

    # --- Produk ---
    produk_list = [
        ("8991001000011", "Minyak Goreng 1L", 18500, supplier_1["_id"]),
        ("8991001000028", "Beras Premium 5kg", 65000, supplier_1["_id"]),
        ("8991001000035", "Susu UHT 1L", 17500, supplier_1["_id"]),
        ("8991002000012", "Sabun Cuci Piring 800ml", 12500, supplier_2["_id"]),
        ("8991002000029", "Tisu Facial 250 sheet", 9500, supplier_2["_id"]),
    ]
    product_ids = []
    for barcode, nama, harga, supplier_id in produk_list:
        from bson.decimal128 import Decimal128

        doc = upsert(
            db.master_product,
            {"barcode": barcode},
            {
                "barcode": barcode,
                "nama_produk": nama,
                "harga": Decimal128(str(harga)),
                "supplier_id": supplier_id,
                "aktif": True,
            },
        )
        product_ids.append(doc["_id"])

    # --- Karyawan (simulasi multi user & multi role) ---
    users = [
        {
            "nik": "T0001",
            "nama": "Siti Staff Toko",
            "username": "staff_toko",
            "password": "Toko@1234",
            "role": "staff_toko",
            "store_id": store_a["_id"],
            "shift_id": shift_pagi["_id"],
        },
        {
            "nik": "T0002",
            "nama": "Budi Staff Toko Bandung",
            "username": "staff_toko2",
            "password": "Toko@1234",
            "role": "staff_toko",
            "store_id": store_b["_id"],
            "shift_id": shift_siang["_id"],
        },
        {
            "nik": "G0001",
            "nama": "Andi Staff Gudang",
            "username": "staff_gudang",
            "password": "Gudang@1234",
            "role": "staff_gudang",
            "store_id": store_gudang["_id"],
            "shift_id": shift_pagi["_id"],
        },
        {
            "nik": "A0001",
            "nama": "Rina Admin Pusat",
            "username": "admin",
            "password": "Admin@1234",
            "role": "admin",
            "store_id": store_gudang["_id"],
            "shift_id": None,
        },
    ]
    now = datetime.datetime.utcnow()
    for u in users:
        if db.master_karyawan.find_one({"username": u["username"]}):
            continue
        db.master_karyawan.insert_one(
            {
                "nik": u["nik"],
                "nama": u["nama"],
                "username": u["username"],
                "password_hash": generate_password_hash(u["password"], method="pbkdf2:sha256", salt_length=16),
                "role": u["role"],
                "store_id": u["store_id"],
                "shift_id": u["shift_id"],
                "aktif": True,
                "tgl_nonaktif": None,
                "tgl_mulai_penempatan": now,
                "riwayat_penempatan": [],
            }
        )

    print("\nSeed selesai. Akun demo untuk simulasi multi role:")
    print("-" * 60)
    for u in users:
        print(f"  role={u['role']:<13} username={u['username']:<14} password={u['password']}")
    print("-" * 60)
    print("Silakan login lewat halaman web menggunakan salah satu akun di atas.")


if __name__ == "__main__":
    main()
