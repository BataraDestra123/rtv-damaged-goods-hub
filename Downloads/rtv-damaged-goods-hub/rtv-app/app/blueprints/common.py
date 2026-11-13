"""
Endpoint read-only yang dipakai lintas role (dropdown produk, supplier, dsb).
"""
from flask import Blueprint, jsonify, request

from ..db import get_db
from ..security import login_required
from ..utils import jsonable

bp = Blueprint("common", __name__)


@bp.get("/produk")
@login_required
def list_produk():
    db = get_db()
    q = (request.args.get("q") or "").strip()
    filt = {"aktif": True}
    if q:
        filt["$or"] = [
            {"nama_produk": {"$regex": q, "$options": "i"}},
            {"barcode": {"$regex": q, "$options": "i"}},
        ]
    cursor = db.master_product.find(filt).sort("nama_produk", 1).limit(200)
    return jsonify({"items": [jsonable(d) for d in cursor]})


@bp.get("/supplier")
@login_required
def list_supplier():
    db = get_db()
    cursor = db.master_supplier.find({}).sort("nama_supplier", 1)
    return jsonify({"items": [jsonable(d) for d in cursor]})


@bp.get("/store")
@login_required
def list_store():
    db = get_db()
    cursor = db.master_store.find({}).sort("nama_store", 1)
    return jsonify({"items": [jsonable(d) for d in cursor]})


@bp.get("/shift")
@login_required
def list_shift():
    db = get_db()
    cursor = db.master_shift.find({}).sort("nama_shift", 1)
    return jsonify({"items": [jsonable(d) for d in cursor]})
