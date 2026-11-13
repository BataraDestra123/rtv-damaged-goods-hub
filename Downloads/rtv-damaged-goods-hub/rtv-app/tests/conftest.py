"""
Konfigurasi pytest: menyuntikkan mongomock sebagai pengganti MongoDB asli
supaya test berjalan cepat tanpa koneksi database sungguhan.

Catatan: fixture ini mem-patch `app.db.get_client` agar mengembalikan
`mongomock.MongoClient()`, dan mengisi data master minimal (1 toko, 1
toko kedua, 1 gudang, 1 supplier, 2 produk) + 1 akun per role, supaya
setiap test bisa langsung login dan menjalankan skenario end-to-end.
"""
import datetime
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import mongomock
import pytest
from bson.decimal128 import Decimal128
from werkzeug.security import generate_password_hash

from app import create_app
from app import db as db_module


@pytest.fixture()
def mongo_client(monkeypatch):
    client = mongomock.MongoClient()
    monkeypatch.setattr(db_module, "_client", client)
    monkeypatch.setattr(db_module, "get_client", lambda: client)
    return client


@pytest.fixture()
def app(mongo_client):
    flask_app = create_app()
    flask_app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
    return flask_app


@pytest.fixture()
def seed(app, mongo_client):
    db = mongo_client[app.config["MONGO_DB_NAME"]]

    store_a = db.master_store.insert_one(
        {"kode_store": "STR01", "nama_store": "Toko A", "alamat": "Jl. A"}
    ).inserted_id
    store_b = db.master_store.insert_one(
        {"kode_store": "STR02", "nama_store": "Toko B", "alamat": "Jl. B"}
    ).inserted_id
    store_gudang = db.master_store.insert_one(
        {"kode_store": "GDG01", "nama_store": "Gudang", "alamat": "Jl. G"}
    ).inserted_id

    supplier = db.master_supplier.insert_one(
        {"kode_supplier": "SUP01", "nama_supplier": "Supplier A", "alamat": "Jl S", "kontak": "08123"}
    ).inserted_id
    supplier2 = db.master_supplier.insert_one(
        {"kode_supplier": "SUP02", "nama_supplier": "Supplier B", "alamat": "Jl S2", "kontak": "08124"}
    ).inserted_id

    produk = db.master_product.insert_one(
        {
            "barcode": "1234567890",
            "nama_produk": "Produk Uji",
            "harga": Decimal128("10000"),
            "supplier_id": supplier,
            "aktif": True,
        }
    ).inserted_id
    produk2 = db.master_product.insert_one(
        {
            "barcode": "1234567891",
            "nama_produk": "Produk Uji 2 (Supplier Lain)",
            "harga": Decimal128("5000"),
            "supplier_id": supplier2,
            "aktif": True,
        }
    ).inserted_id

    now = datetime.datetime.utcnow()

    def make_user(nik, username, password, role, store_id):
        uid = db.master_karyawan.insert_one(
            {
                "nik": nik,
                "nama": f"User {username}",
                "username": username,
                "password_hash": generate_password_hash(password, method="pbkdf2:sha256"),
                "role": role,
                "store_id": store_id,
                "shift_id": None,
                "aktif": True,
                "tgl_nonaktif": None,
                "tgl_mulai_penempatan": now,
                "riwayat_penempatan": [],
            }
        ).inserted_id
        return uid

    toko_user = make_user("T001", "toko1", "Password1", "staff_toko", store_a)
    toko_user_b = make_user("T002", "toko2", "Password1", "staff_toko", store_b)
    gudang_user = make_user("G001", "gudang1", "Password1", "staff_gudang", store_gudang)
    admin_user = make_user("A001", "admin1", "Password1", "admin", store_gudang)
    nonaktif_user = make_user("T003", "nonaktif1", "Password1", "staff_toko", store_a)
    db.master_karyawan.update_one({"_id": nonaktif_user}, {"$set": {"aktif": False}})

    return {
        "db": db,
        "store_a": store_a,
        "store_b": store_b,
        "store_gudang": store_gudang,
        "supplier": supplier,
        "supplier2": supplier2,
        "produk": produk,
        "produk2": produk2,
        "toko_user": toko_user,
        "toko_user_b": toko_user_b,
        "gudang_user": gudang_user,
        "admin_user": admin_user,
        "nonaktif_user": nonaktif_user,
    }


@pytest.fixture()
def client(app):
    return app.test_client()


def login(client, username, password="Password1"):
    return client.post("/api/auth/login", json={"username": username, "password": password})
