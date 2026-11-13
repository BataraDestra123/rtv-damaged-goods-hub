"""
Koneksi MongoDB terpusat.

Di lingkungan serverless (Vercel), fungsi dapat dipanggil ulang pada
container yang sama (warm start). Kita cache instance MongoClient secara
modul-level supaya tidak membuka koneksi baru di setiap request, namun
tetap aman dibuat ulang jika container benar-benar baru (cold start).
"""
from pymongo import MongoClient, ASCENDING, DESCENDING
from pymongo.errors import ConnectionFailure
from flask import current_app, g

_client = None


def get_client():
    global _client
    if _client is None:
        uri = current_app.config["MONGO_URI"]
        _client = MongoClient(
            uri,
            serverSelectionTimeoutMS=8000,
            connectTimeoutMS=8000,
            maxPoolSize=10,
        )
    return _client


def get_db():
    """Mengembalikan handle database MongoDB untuk request saat ini."""
    if "db" not in g:
        client = get_client()
        g.db = client[current_app.config["MONGO_DB_NAME"]]
    return g.db


def ping():
    try:
        get_client().admin.command("ping")
        return True
    except ConnectionFailure:
        return False


def ensure_indexes(db):
    """
    Membuat index yang dibutuhkan (dipanggil sekali saat startup / seeding).
    Mencakup index unik, composite, dan text index sesuai kebutuhan opsional
    pada ketentuan tugas (indexing di MongoDB).
    """
    # master_karyawan
    db.master_karyawan.create_index("username", unique=True, name="ux_username")
    db.master_karyawan.create_index("nik", unique=True, name="ux_nik")
    db.master_karyawan.create_index(
        [("store_id", ASCENDING), ("role", ASCENDING)], name="ix_store_role"
    )

    # master_store
    db.master_store.create_index("kode_store", unique=True, name="ux_kode_store")

    # master_supplier
    db.master_supplier.create_index(
        "kode_supplier", unique=True, name="ux_kode_supplier"
    )

    # master_product
    db.master_product.create_index("barcode", unique=True, name="ux_barcode")
    db.master_product.create_index(
        [("nama_produk", "text")], name="tx_nama_produk"
    )
    db.master_product.create_index("supplier_id", name="ix_supplier_id")

    # master_shift
    db.master_shift.create_index("nama_shift", unique=True, name="ux_nama_shift")

    # rtv_transactions
    db.rtv_transactions.create_index("no_rtv", unique=True, name="ux_no_rtv")
    db.rtv_transactions.create_index(
        [("status", ASCENDING), ("store_id", ASCENDING)], name="ix_status_store"
    )
    db.rtv_transactions.create_index(
        [("store_id", ASCENDING), ("tgl_input", DESCENDING)], name="ix_store_tgl"
    )
    db.rtv_transactions.create_index("shipment_id", name="ix_shipment_id")
    db.rtv_transactions.create_index(
        [("product.product_id", ASCENDING)], name="ix_product_id"
    )

    # rtv_shipments
    db.rtv_shipments.create_index(
        "no_surat_jalan", unique=True, name="ux_no_surat_jalan"
    )
    db.rtv_shipments.create_index("supplier_id", name="ix_shp_supplier_id")

    # audit_logs
    db.audit_logs.create_index(
        [("collection", ASCENDING), ("document_id", ASCENDING)], name="ix_audit_doc"
    )
    db.audit_logs.create_index([("tgl", DESCENDING)], name="ix_audit_tgl")
