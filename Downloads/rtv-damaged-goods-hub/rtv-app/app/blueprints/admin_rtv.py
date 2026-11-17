"""
Fitur Admin/Supervisor: Verifikasi RTV (Approve/Reject), Buat Surat Jalan
ke Supplier, Tandai Transaksi Completed (input hasil klaim vendor
terstruktur: status, nilai kredit, nomor credit note).
"""
import datetime

from flask import Blueprint, g, jsonify, request

from ..db import get_db
from ..security import ApiError, record_audit, role_required
from ..utils import (
    generate_sequential_code,
    jsonable,
    require_fields,
    sanitize_str,
    to_decimal128,
    to_object_id,
)
from .extras import money, nilai_rtv, notify

bp = Blueprint("admin_rtv", __name__)

KLAIM_STATUS = ("Diajukan", "Disetujui Penuh", "Disetujui Sebagian", "Ditolak")


# ---------------------------------------------------------------------------
# Verifikasi RTV
# ---------------------------------------------------------------------------
@bp.get("/verifikasi")
@role_required("admin")
def dashboard_verifikasi():
    """Dashboard Verifikasi RTV: daftar RTV berstatus Received."""
    db = get_db()
    cursor = db.rtv_transactions.find({"status": "Received"}).sort("tgl_terima", 1).limit(500)
    items = []
    for d in cursor:
        store = db.master_store.find_one({"_id": d["store_id"]}, {"nama_store": 1, "kode_store": 1})
        d["store"] = store
        d["nilai_estimasi"] = nilai_rtv(d)
        items.append(jsonable(d))
    return jsonify({"items": items})


@bp.post("/verifikasi/<rtv_id>")
@role_required("admin")
def verifikasi_rtv(rtv_id):
    """
    Setujui RTV (Received -> Approved) atau Tolak RTV (Received -> Rejected).
    Body: {"approve": true/false, "catatan": "opsional, alasan jika ditolak"}
    Update atomik mencegah RTV yang sama diverifikasi dua kali bersamaan.
    """
    data = request.get_json(silent=True) or {}
    require_fields(data, ["approve"])
    approve = bool(data["approve"])
    catatan = sanitize_str(data.get("catatan", ""), max_len=500, field="Catatan", required=False, allow_empty=True)

    db = get_db()
    oid = to_object_id(rtv_id, field="rtv_id")
    existing = db.rtv_transactions.find_one({"_id": oid})
    if not existing:
        raise ApiError("Data RTV tidak ditemukan.", status_code=404, code="not_found")

    new_status = "Approved" if approve else "Rejected"
    now = datetime.datetime.utcnow()

    updated = db.rtv_transactions.find_one_and_update(
        {"_id": oid, "status": "Received"},
        {
            "$set": {
                "status": new_status,
                "catatan_verifikasi": catatan or None,
                "diverifikasi_oleh": {"id": g.user["_id"], "nama": g.user.get("nama")},
                "tgl_verifikasi": now,
            }
        },
        return_document=True,
    )
    if not updated:
        raise ApiError(
            "RTV sudah diverifikasi sebelumnya (status bukan Received lagi).",
            status_code=409,
            code="conflict",
        )

    record_audit(
        "rtv_transactions", oid, "verifikasi",
        before={"status": existing["status"]}, after={"status": new_status},
    )

    if approve:
        notify(
            db, "staff_toko",
            "Retur disetujui",
            "%s telah disetujui dan akan diproses ke supplier." % updated["no_rtv"],
            rtv_id=oid, store_id=updated.get("store_id"), link="toko-status", tipe="success",
        )
    else:
        notify(
            db, "staff_toko",
            "Retur ditolak",
            "%s ditolak.%s" % (updated["no_rtv"], (" Alasan: " + catatan) if catatan else ""),
            rtv_id=oid, store_id=updated.get("store_id"), link="toko-status", tipe="error",
        )

    return jsonify({"item": jsonable(updated)})


# ---------------------------------------------------------------------------
# Surat Jalan ke Supplier
# ---------------------------------------------------------------------------
@bp.get("/surat-jalan/items")
@role_required("admin")
def surat_jalan_items():
    """Item Approved (belum dikirim) + daftar supplier, untuk form Buat Surat Jalan."""
    db = get_db()
    items = list(db.rtv_transactions.find({"status": "Approved"}).sort("tgl_verifikasi", 1))
    suppliers = list(db.master_supplier.find({}).sort("nama_supplier", 1))

    # Lampirkan nama supplier dari master_product -> supplier_id untuk pengelompokan di FE
    product_ids = {it["product"]["product_id"] for it in items}
    products = {
        p["_id"]: p for p in db.master_product.find({"_id": {"$in": list(product_ids)}})
    }
    for it in items:
        prod = products.get(it["product"]["product_id"])
        it["supplier_id"] = prod["supplier_id"] if prod else None

    return jsonify({"items": jsonable(items), "suppliers": jsonable(suppliers)})


@bp.post("/surat-jalan")
@role_required("admin")
def buat_surat_jalan():
    """
    Buat Surat Jalan ke Supplier.
    Validasi: semua rtv_ids berstatus Approved dan produknya berasal dari
    satu supplier yang sama (sesuai class diagram RTVShipment 1 supplier).
    Update item -> Shipped to Supplier dilakukan atomik dengan update_many
    berbasis filter _id IN rtv_ids AND status=Approved; jika jumlah yang
    berubah tidak sama dengan jumlah rtv_ids, transaksi dibatalkan (rollback
    manual dengan mengembalikan status, karena MongoDB standalone tidak
    selalu mendukung multi-document transaction tanpa replica set).
    """
    data = request.get_json(silent=True) or {}
    require_fields(data, ["supplier_id", "rtv_ids"])

    db = get_db()
    supplier_id = to_object_id(data["supplier_id"], field="supplier_id")
    supplier = db.master_supplier.find_one({"_id": supplier_id})
    if not supplier:
        raise ApiError("Supplier tidak ditemukan.", status_code=404, code="not_found")

    raw_ids = data["rtv_ids"]
    if not isinstance(raw_ids, list) or not raw_ids:
        raise ApiError("rtv_ids harus berupa daftar id dan tidak boleh kosong.", code="validation_error")
    rtv_ids = [to_object_id(i, field="rtv_id") for i in raw_ids]

    items = list(db.rtv_transactions.find({"_id": {"$in": rtv_ids}}))
    if len(items) != len(rtv_ids):
        raise ApiError("Beberapa RTV tidak ditemukan.", status_code=404, code="not_found")

    if any(it["status"] != "Approved" for it in items):
        raise ApiError(
            "Semua item harus berstatus Approved sebelum dibuatkan surat jalan.",
            status_code=409,
            code="conflict",
        )

    product_ids = {it["product"]["product_id"] for it in items}
    products = {p["_id"]: p for p in db.master_product.find({"_id": {"$in": list(product_ids)}})}
    supplier_set = {products[pid]["supplier_id"] for pid in product_ids if pid in products}
    if len(supplier_set) != 1 or supplier_id not in supplier_set:
        raise ApiError(
            "Semua item pada satu surat jalan harus berasal dari supplier yang sama.",
            status_code=400,
            code="validation_error",
        )

    no_surat_jalan = generate_sequential_code(db, "surat_jalan", "SJ")
    now = datetime.datetime.utcnow()

    shipment_doc = {
        "no_surat_jalan": no_surat_jalan,
        "supplier_id": supplier_id,
        "rtv_ids": rtv_ids,
        "tgl_kirim": now,
        "dibuat_oleh": {"id": g.user["_id"], "nama": g.user.get("nama")},
        "tgl_selesai": None,
        "hasil_klaim": None,
        "klaim": None,
    }
    shipment_result = db.rtv_shipments.insert_one(shipment_doc)
    shipment_doc["_id"] = shipment_result.inserted_id

    update_result = db.rtv_transactions.update_many(
        {"_id": {"$in": rtv_ids}, "status": "Approved"},
        {"$set": {"status": "Shipped to Supplier", "shipment_id": shipment_doc["_id"]}},
    )

    if update_result.modified_count != len(rtv_ids):
        # Kompensasi: batalkan shipment yang baru dibuat supaya data tidak nyangkut.
        db.rtv_shipments.delete_one({"_id": shipment_doc["_id"]})
        db.rtv_transactions.update_many(
            {"_id": {"$in": rtv_ids}, "shipment_id": shipment_doc["_id"]},
            {"$set": {"status": "Approved", "shipment_id": None}},
        )
        raise ApiError(
            "Sebagian item sudah diproses pihak lain saat surat jalan dibuat. Silakan ulangi.",
            status_code=409,
            code="conflict",
        )

    record_audit("rtv_shipments", shipment_doc["_id"], "buat_surat_jalan", after=jsonable(shipment_doc))
    return jsonify({"shipment": jsonable(shipment_doc)}), 201


@bp.get("/surat-jalan")
@role_required("admin")
def list_surat_jalan():
    db = get_db()
    status = request.args.get("status")  # "Shipped to Supplier" atau "Completed"
    db_shipments = list(db.rtv_shipments.find({}).sort("tgl_kirim", -1).limit(300))
    results = []
    for s in db_shipments:
        items = list(db.rtv_transactions.find({"shipment_id": s["_id"]}))
        if status and not any(it["status"] == status for it in items):
            continue
        supplier = db.master_supplier.find_one({"_id": s["supplier_id"]}, {"nama_supplier": 1, "kode_supplier": 1})
        s["supplier"] = supplier
        s["items"] = items
        s["jumlah_item"] = len(items)
        s["status_items"] = items[0]["status"] if items else None
        s["total_nilai"] = sum(nilai_rtv(it) for it in items)
        results.append(jsonable(s))
    return jsonify({"items": results})


@bp.post("/surat-jalan/<shipment_id>/selesai")
@role_required("admin")
def selesaikan_klaim(shipment_id):
    """
    Input hasil klaim dari supplier -> Shipped to Supplier -> Completed (final).

    Body minimal (kompatibel dengan versi lama): {"hasil_klaim": "teks bebas"}
    Body lengkap (disarankan): {
        "hasil_klaim": "teks bebas / ringkasan",
        "klaim_status": salah satu dari KLAIM_STATUS,
        "nilai_kredit": angka (Rp kredit/penggantian yang disetujui supplier),
        "no_credit_note": "opsional"
    }
    """
    data = request.get_json(silent=True) or {}
    require_fields(data, ["hasil_klaim"])
    hasil_klaim = sanitize_str(data["hasil_klaim"], max_len=1000, field="Hasil klaim")

    klaim_status = data.get("klaim_status")
    if klaim_status:
        if klaim_status not in KLAIM_STATUS:
            raise ApiError(
                "klaim_status harus salah satu dari: %s." % ", ".join(KLAIM_STATUS),
                code="validation_error",
            )
    nilai_kredit = None
    if data.get("nilai_kredit") not in (None, ""):
        nilai_kredit = to_decimal128(data["nilai_kredit"], field="nilai_kredit")
    no_credit_note = sanitize_str(
        data.get("no_credit_note", ""), max_len=64, field="No. Credit Note", required=False, allow_empty=True
    )

    db = get_db()
    oid = to_object_id(shipment_id, field="shipment_id")
    shipment = db.rtv_shipments.find_one({"_id": oid})
    if not shipment:
        raise ApiError("Surat jalan tidak ditemukan.", status_code=404, code="not_found")
    if shipment.get("tgl_selesai"):
        raise ApiError("Klaim untuk surat jalan ini sudah diselesaikan sebelumnya.", status_code=409, code="conflict")

    now = datetime.datetime.utcnow()
    klaim_payload = {
        "status": klaim_status or "Disetujui Penuh",
        "nilai_kredit": nilai_kredit,
        "no_credit_note": no_credit_note or None,
        "diinput_oleh": {"id": g.user["_id"], "nama": g.user.get("nama")},
        "tgl": now,
    }
    updated_shipment = db.rtv_shipments.find_one_and_update(
        {"_id": oid, "tgl_selesai": None},
        {"$set": {"tgl_selesai": now, "hasil_klaim": hasil_klaim, "klaim": klaim_payload}},
        return_document=True,
    )
    if not updated_shipment:
        raise ApiError("Klaim sudah diselesaikan oleh pihak lain.", status_code=409, code="conflict")

    item_ids = [it["_id"] for it in db.rtv_transactions.find({"shipment_id": oid}, {"_id": 1})]
    db.rtv_transactions.update_many(
        {"shipment_id": oid, "status": "Shipped to Supplier"},
        {"$set": {"status": "Completed"}},
    )

    record_audit("rtv_shipments", oid, "selesaikan_klaim", after=jsonable(updated_shipment))

    if item_ids:
        kredit_txt = (" Kredit diterima: Rp %s." % format(money(nilai_kredit), ",.0f")) if nilai_kredit else ""
        notify(
            db, "staff_toko",
            "Klaim retur selesai",
            "Surat jalan %s selesai diproses supplier.%s" % (updated_shipment["no_surat_jalan"], kredit_txt),
            link="toko-status",
        )

    return jsonify({"shipment": jsonable(updated_shipment)})