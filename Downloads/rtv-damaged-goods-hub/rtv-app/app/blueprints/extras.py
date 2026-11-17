"""
Fitur tambahan RTV Hub (semua endpoint di bawah /api/x/*):

- Foto bukti kerusakan (disimpan di MongoDB sebagai data-URL ter-kompresi)
- Notifikasi dalam aplikasi (lonceng di topbar)
- Data untuk dokumen cetak: berita acara RTV, surat jalan, packing list
- Antrian & umur stok karantina (gudang)
- Insight admin: KPI, tren, skor vendor, perbandingan toko, klaim vendor
- Ekspor data RTV, log aktivitas (audit)
- Pembatas percobaan login (throttle) yang aman untuk serverless

Semua perhitungan agregat dilakukan di Python di atas find() biasa supaya
sederhana, mudah diuji, dan tidak bergantung pada fitur agregasi tertentu.
"""
import base64
import binascii
import datetime
import re

from flask import Blueprint, current_app, g, jsonify, request

from ..db import get_db
from ..security import ApiError, login_required, role_required
from ..utils import jsonable, parse_date, to_object_id

bp = Blueprint("extras", __name__)

_EPOCH = datetime.datetime(1970, 1, 1)
STATUS_DECIDED = ("Approved", "Rejected", "Shipped to Supplier", "Completed")
STATUS_NON_LOSS = ("Pending", "Cancelled")


# ---------------------------------------------------------------------------
# Utilitas umum
# ---------------------------------------------------------------------------
_indexes_ready = False


def ensure_extra_indexes(db):
    """Index untuk koleksi baru; dibuat sekali per proses, gagal pun tidak mengganggu."""
    global _indexes_ready
    if _indexes_ready:
        return
    try:
        db.rtv_foto.create_index("rtv_ids", name="ix_foto_rtv")
        db.notifications.create_index("tgl", name="ix_notif_tgl")
        db.login_attempts.create_index("exp", expireAfterSeconds=0, name="ttl_login_attempts")
        _indexes_ready = True
    except Exception:  # pragma: no cover - index hanya optimasi
        current_app.logger.warning("Gagal membuat index tambahan (diabaikan).", exc_info=True)


def now_utc():
    return datetime.datetime.utcnow()


def money(value):
    """Decimal128 / angka / None -> float."""
    if value is None:
        return 0.0
    if hasattr(value, "to_decimal"):
        try:
            return float(value.to_decimal())
        except Exception:
            return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def nilai_rtv(doc):
    """Nilai kerugian satu RTV: qty (diterima, atau diajukan) x harga snapshot."""
    qty = doc.get("qty_diterima") or doc.get("qty_diajukan") or 0
    harga = money((doc.get("product") or {}).get("harga"))
    return float(qty) * harga


def _naive(dt):
    if isinstance(dt, datetime.datetime) and dt.tzinfo is not None:
        return dt.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    return dt


def _days_between(a, b):
    a, b = _naive(a), _naive(b)
    if not isinstance(a, datetime.datetime) or not isinstance(b, datetime.datetime):
        return None
    return max((b - a).total_seconds() / 86400.0, 0.0)


def client_ip():
    fwd = request.headers.get("X-Forwarded-For", "")
    if fwd:
        return fwd.split(",")[0].strip()[:64] or "?"
    return (request.remote_addr or "?")[:64]


def app_info():
    cfg = current_app.config
    return {
        "name": cfg.get("APP_NAME"),
        "short_name": cfg.get("APP_SHORT_NAME"),
        "subtitle": cfg.get("APP_SUBTITLE"),
        "version": cfg.get("APP_VERSION"),
    }


# ---------------------------------------------------------------------------
# Throttle percobaan login / reset password
# ---------------------------------------------------------------------------
def throttle_check(db, key):
    """Lempar 429 jika key sedang terkunci."""
    ensure_extra_indexes(db)
    doc = db.login_attempts.find_one({"_id": key})
    if doc and doc.get("locked_until") and doc["locked_until"] > now_utc():
        mins = max(1, int((doc["locked_until"] - now_utc()).total_seconds() // 60) + 1)
        raise ApiError(
            "Terlalu banyak percobaan gagal. Coba lagi dalam %d menit." % mins,
            status_code=429,
            code="too_many_attempts",
        )


def throttle_fail(db, key):
    cfg = current_app.config
    max_fail = cfg.get("LOGIN_MAX_FAILS", 5)
    window = datetime.timedelta(minutes=cfg.get("LOGIN_WINDOW_MINUTES", 15))
    lock = datetime.timedelta(minutes=cfg.get("LOGIN_LOCK_MINUTES", 15))
    now = now_utc()
    doc = db.login_attempts.find_one({"_id": key})
    if not doc or not doc.get("first") or doc["first"] < now - window:
        count, first = 1, now
    else:
        count, first = doc.get("count", 0) + 1, doc["first"]
    locked_until = now + lock if count >= max_fail else None
    db.login_attempts.update_one(
        {"_id": key},
        {"$set": {"count": count, "first": first, "locked_until": locked_until, "exp": now + datetime.timedelta(days=1)}},
        upsert=True,
    )


def throttle_clear(db, key):
    db.login_attempts.delete_one({"_id": key})


# ---------------------------------------------------------------------------
# Foto bukti
# ---------------------------------------------------------------------------
MAX_FOTO = 3
MAX_FOTO_BYTES = 450 * 1024
_DATA_URL_RE = re.compile(r"^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$")
_MAGIC = {"jpeg": b"\xff\xd8\xff", "png": b"\x89PNG", "webp": b"RIFF"}


def parse_photos(raw):
    """Validasi daftar foto (data-URL). Mengembalikan list string yang aman disimpan."""
    if raw in (None, "", []):
        return []
    if not isinstance(raw, list):
        raise ApiError("Foto harus berupa daftar.", code="validation_error")
    if len(raw) > MAX_FOTO:
        raise ApiError("Maksimal %d foto per pengajuan." % MAX_FOTO, code="validation_error")
    out = []
    for item in raw:
        if not isinstance(item, str):
            raise ApiError("Format foto tidak valid.", code="validation_error")
        m = _DATA_URL_RE.match(item)
        if not m:
            raise ApiError("Format foto tidak valid (hanya JPG, PNG, atau WEBP).", code="validation_error")
        try:
            binary = base64.b64decode(m.group(2), validate=True)
        except (binascii.Error, ValueError):
            raise ApiError("Data foto rusak.", code="validation_error")
        if len(binary) > MAX_FOTO_BYTES:
            raise ApiError("Ukuran foto terlalu besar (maksimal 450 KB per foto).", code="validation_error")
        if not binary.startswith(_MAGIC[m.group(1)]):
            raise ApiError("Isi file bukan gambar yang valid.", code="validation_error")
        out.append(item)
    return out


def save_photos(db, rtv_ids, photos, tahap, user):
    if not photos:
        return
    ensure_extra_indexes(db)
    now = now_utc()
    for data in photos:
        db.rtv_foto.insert_one(
            {
                "rtv_ids": list(rtv_ids),
                "tahap": tahap,
                "data": data,
                "tgl": now,
                "oleh": {"id": user["_id"], "nama": user.get("nama")},
            }
        )


def _get_rtv_for_user(db, rtv_id):
    oid = to_object_id(rtv_id, field="rtv_id")
    trx = db.rtv_transactions.find_one({"_id": oid})
    if not trx:
        raise ApiError("Data RTV tidak ditemukan.", status_code=404, code="not_found")
    if g.user.get("role") == "staff_toko" and trx.get("store_id") != g.user.get("store_id"):
        raise ApiError("Anda tidak berhak melihat RTV ini.", status_code=403, code="forbidden")
    return trx


@bp.get("/rtv/<rtv_id>/foto")
@login_required
def foto_rtv(rtv_id):
    db = get_db()
    trx = _get_rtv_for_user(db, rtv_id)
    cursor = db.rtv_foto.find({"rtv_ids": trx["_id"]}).sort("tgl", 1).limit(12)
    items = [
        {
            "id": str(d["_id"]),
            "tahap": d.get("tahap"),
            "data": d.get("data"),
            "tgl": jsonable(d.get("tgl")),
            "oleh": (d.get("oleh") or {}).get("nama"),
        }
        for d in cursor
    ]
    return jsonify({"items": items})


# ---------------------------------------------------------------------------
# Notifikasi
# ---------------------------------------------------------------------------
def notify(db, role, title, text, rtv_id=None, store_id=None, link=None, tipe="info"):
    """Catat notifikasi untuk satu role (dan opsional satu toko). Tidak pernah melempar error."""
    try:
        ensure_extra_indexes(db)
        db.notifications.insert_one(
            {
                "role": role,
                "store_id": store_id,
                "title": title,
                "text": text,
                "rtv_id": rtv_id,
                "link": link,
                "tipe": tipe,
                "tgl": now_utc(),
            }
        )
    except Exception:  # pragma: no cover
        current_app.logger.warning("Gagal mencatat notifikasi (diabaikan).", exc_info=True)


def _notif_filter(user):
    flt = {"role": user.get("role"), "tgl": {"$gte": now_utc() - datetime.timedelta(days=30)}}
    if user.get("role") == "staff_toko":
        flt["store_id"] = user.get("store_id")
    return flt


@bp.get("/notif")
@login_required
def list_notif():
    db = get_db()
    user = g.user
    seen = _naive(user.get("notif_seen_at")) or _naive(user.get("tgl_mulai_penempatan")) or _EPOCH
    flt = _notif_filter(user)
    rows = list(db.notifications.find(flt).sort("tgl", -1).limit(30))
    items = []
    unread = 0
    for r in rows:
        is_new = _naive(r["tgl"]) > seen
        unread += 1 if is_new else 0
        items.append(
            {
                "id": str(r["_id"]),
                "title": r.get("title"),
                "text": r.get("text"),
                "link": r.get("link"),
                "tipe": r.get("tipe"),
                "tgl": jsonable(r.get("tgl")),
                "baru": is_new,
            }
        )
    return jsonify({"items": items, "unread": unread})


@bp.post("/notif/baca")
@login_required
def baca_notif():
    db = get_db()
    db.master_karyawan.update_one({"_id": g.user["_id"]}, {"$set": {"notif_seen_at": now_utc()}})
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Peta produk -> supplier (dipakai beberapa laporan)
# ---------------------------------------------------------------------------
def _product_supplier_maps(db):
    prod = {p["_id"]: p for p in db.master_product.find({}, {"supplier_id": 1, "nama_produk": 1, "barcode": 1})}
    sup = {s["_id"]: s for s in db.master_supplier.find({})}
    return prod, sup


def _supplier_of(doc, prod_map):
    pid = (doc.get("product") or {}).get("product_id")
    p = prod_map.get(pid)
    return p.get("supplier_id") if p else None


# ---------------------------------------------------------------------------
# Dokumen cetak
# ---------------------------------------------------------------------------
@bp.get("/dokumen/rtv/<rtv_id>")
@login_required
def dokumen_rtv(rtv_id):
    """Data berita acara retur untuk satu RTV."""
    db = get_db()
    trx = _get_rtv_for_user(db, rtv_id)
    prod_map, sup_map = _product_supplier_maps(db)
    store = db.master_store.find_one({"_id": trx.get("store_id")})
    supplier = sup_map.get(_supplier_of(trx, prod_map))
    shipment = db.rtv_shipments.find_one({"_id": trx["shipment_id"]}) if trx.get("shipment_id") else None
    riwayat = []
    for log in db.audit_logs.find(
        {"collection": "rtv_transactions", "document_id": str(trx["_id"])}, {"action": 1, "oleh": 1, "tgl": 1, "after": 1}
    ).sort("tgl", 1):
        riwayat.append(
            {
                "action": log.get("action"),
                "oleh": (log.get("oleh") or {}).get("nama"),
                "tgl": jsonable(log.get("tgl")),
                "status": (log.get("after") or {}).get("status") if isinstance(log.get("after"), dict) else None,
            }
        )
    return jsonify(
        {
            "app": app_info(),
            "rtv": jsonable(trx),
            "nilai": nilai_rtv(trx),
            "store": jsonable(store),
            "supplier": jsonable(supplier),
            "shipment": jsonable(shipment),
            "riwayat": riwayat,
            "dicetak_oleh": g.user.get("nama"),
            "dicetak_pada": jsonable(now_utc()),
        }
    )


@bp.get("/dokumen/surat-jalan/<shipment_id>")
@role_required("admin", "staff_gudang")
def dokumen_surat_jalan(shipment_id):
    db = get_db()
    oid = to_object_id(shipment_id, field="shipment_id")
    shp = db.rtv_shipments.find_one({"_id": oid})
    if not shp:
        raise ApiError("Surat jalan tidak ditemukan.", status_code=404, code="not_found")
    supplier = db.master_supplier.find_one({"_id": shp.get("supplier_id")})
    stores = {s["_id"]: s for s in db.master_store.find({})}
    items = []
    total_qty = 0
    total_nilai = 0.0
    for it in db.rtv_transactions.find({"shipment_id": oid}).sort("no_rtv", 1):
        qty = it.get("qty_diterima") or it.get("qty_diajukan") or 0
        total_qty += qty
        total_nilai += nilai_rtv(it)
        items.append(
            {
                "no_rtv": it.get("no_rtv"),
                "barcode": (it.get("product") or {}).get("barcode"),
                "nama_produk": (it.get("product") or {}).get("nama_produk"),
                "qty": qty,
                "harga": money((it.get("product") or {}).get("harga")),
                "batch": it.get("batch"),
                "kategori": it.get("kategori_kerusakan"),
                "toko": (stores.get(it.get("store_id")) or {}).get("nama_store"),
            }
        )
    return jsonify(
        {
            "app": app_info(),
            "shipment": jsonable(shp),
            "supplier": jsonable(supplier),
            "items": items,
            "total_qty": total_qty,
            "total_nilai": total_nilai,
            "dicetak_oleh": g.user.get("nama"),
            "dicetak_pada": jsonable(now_utc()),
        }
    )


@bp.get("/packing-list")
@role_required("staff_gudang", "admin")
def packing_list():
    """RTV berstatus Approved (siap dikemas) dikelompokkan per supplier."""
    db = get_db()
    prod_map, sup_map = _product_supplier_maps(db)
    stores = {s["_id"]: s for s in db.master_store.find({})}
    groups = {}
    for it in db.rtv_transactions.find({"status": "Approved"}).sort("tgl_verifikasi", 1).limit(1000):
        sid = _supplier_of(it, prod_map)
        grp = groups.setdefault(str(sid), {"supplier_id": sid, "items": []})
        grp["items"].append(
            {
                "_id": str(it["_id"]),
                "no_rtv": it.get("no_rtv"),
                "barcode": (it.get("product") or {}).get("barcode"),
                "nama_produk": (it.get("product") or {}).get("nama_produk"),
                "qty": it.get("qty_diterima") or it.get("qty_diajukan") or 0,
                "batch": it.get("batch"),
                "kategori": it.get("kategori_kerusakan"),
                "lokasi": it.get("lokasi_karantina"),
                "toko": (stores.get(it.get("store_id")) or {}).get("nama_store"),
                "nilai": nilai_rtv(it),
            }
        )
    result = []
    for grp in groups.values():
        sup = sup_map.get(grp["supplier_id"]) or {}
        result.append(
            {
                "supplier": {
                    "id": str(grp["supplier_id"]) if grp["supplier_id"] else None,
                    "nama": sup.get("nama_supplier") or "Tanpa supplier",
                    "kode": sup.get("kode_supplier"),
                    "alamat": sup.get("alamat"),
                    "kontak": sup.get("kontak"),
                },
                "items": grp["items"],
                "total_qty": sum(i["qty"] for i in grp["items"]),
                "total_nilai": sum(i["nilai"] for i in grp["items"]),
            }
        )
    result.sort(key=lambda r: r["supplier"]["nama"] or "")
    return jsonify({"app": app_info(), "items": result, "dicetak_oleh": g.user.get("nama"), "dicetak_pada": jsonable(now_utc())})


# ---------------------------------------------------------------------------
# Gudang: antrian & umur stok karantina, pencarian cepat (scan)
# ---------------------------------------------------------------------------
@bp.get("/antrian")
@role_required("staff_gudang", "admin")
def antrian():
    db = get_db()
    crit_days = current_app.config.get("AGING_CRITICAL_DAYS", 30)
    crit_before = now_utc() - datetime.timedelta(days=crit_days)
    return jsonify(
        {
            "pending": db.rtv_transactions.count_documents({"status": "Pending"}),
            "menunggu_verifikasi": db.rtv_transactions.count_documents({"status": "Received"}),
            "siap_kirim": db.rtv_transactions.count_documents({"status": "Approved"}),
            "kritis": db.rtv_transactions.count_documents({"status": "Received", "tgl_terima": {"$lt": crit_before}}),
        }
    )


@bp.get("/stok-aging")
@role_required("staff_gudang", "admin")
def stok_aging():
    """Rincian stok karantina (RTV Received) lengkap dengan umur dalam hari."""
    db = get_db()
    cfg = current_app.config
    warn, crit = cfg.get("AGING_WARN_DAYS", 14), cfg.get("AGING_CRITICAL_DAYS", 30)
    stores = {s["_id"]: s for s in db.master_store.find({})}
    now = now_utc()
    rows = []
    for it in db.rtv_transactions.find({"status": "Received"}).limit(1000):
        umur = _days_between(it.get("tgl_terima"), now)
        umur_int = int(umur) if umur is not None else 0
        level = "kritis" if umur_int >= crit else "perhatian" if umur_int >= warn else "normal"
        rows.append(
            {
                "_id": str(it["_id"]),
                "no_rtv": it.get("no_rtv"),
                "nama_produk": (it.get("product") or {}).get("nama_produk"),
                "barcode": (it.get("product") or {}).get("barcode"),
                "qty": it.get("qty_diterima") or 0,
                "batch": it.get("batch"),
                "kategori": it.get("kategori_kerusakan"),
                "lokasi": it.get("lokasi_karantina"),
                "toko": (stores.get(it.get("store_id")) or {}).get("nama_store"),
                "tgl_terima": jsonable(it.get("tgl_terima")),
                "tgl_kedaluwarsa": jsonable(it.get("tgl_kedaluwarsa")),
                "umur_hari": umur_int,
                "level": level,
            }
        )
    rows.sort(key=lambda r: r["umur_hari"], reverse=True)
    summary = {
        "total_qty": sum(r["qty"] for r in rows),
        "jumlah_rtv": len(rows),
        "kritis": sum(1 for r in rows if r["level"] == "kritis"),
        "perhatian": sum(1 for r in rows if r["level"] == "perhatian"),
        "rata_umur": round(sum(r["umur_hari"] for r in rows) / len(rows), 1) if rows else 0,
        "batas_perhatian": warn,
        "batas_kritis": crit,
    }
    return jsonify({"items": rows, "summary": summary})


@bp.get("/cari-rtv")
@role_required("staff_gudang", "admin")
def cari_rtv():
    """Cari satu RTV berdasarkan nomor (dipakai hasil scan barcode)."""
    q = (request.args.get("q") or "").strip().upper()[:40]
    if not q:
        raise ApiError("Nomor RTV wajib diisi.", code="validation_error")
    db = get_db()
    trx = db.rtv_transactions.find_one({"no_rtv": q})
    if not trx:
        raise ApiError("RTV %s tidak ditemukan." % q, status_code=404, code="not_found")
    store = db.master_store.find_one({"_id": trx.get("store_id")}, {"nama_store": 1})
    return jsonify(
        {
            "item": {
                "_id": str(trx["_id"]),
                "no_rtv": trx.get("no_rtv"),
                "status": trx.get("status"),
                "produk": (trx.get("product") or {}).get("nama_produk"),
                "toko": (store or {}).get("nama_store"),
            }
        }
    )


# ---------------------------------------------------------------------------
# Admin: insight (KPI, tren, skor vendor, perbandingan toko, klaim)
# ---------------------------------------------------------------------------
def _month_add(year, month, delta):
    idx = year * 12 + (month - 1) + delta
    return idx // 12, idx % 12 + 1


def _bucket_keys(since, until, weekly):
    """Daftar kunci bucket (tanggal awal) dari since..until."""
    keys = []
    if weekly:
        cur = (since - datetime.timedelta(days=since.weekday())).date()
        end = until.date()
        while cur <= end:
            keys.append(cur)
            cur += datetime.timedelta(days=7)
    else:
        y, m = since.year, since.month
        while (y, m) <= (until.year, until.month):
            keys.append(datetime.date(y, m, 1))
            y, m = _month_add(y, m, 1)
    return keys


def _bucket_of(dt, weekly):
    dt = _naive(dt)
    if weekly:
        return (dt - datetime.timedelta(days=dt.weekday())).date()
    return datetime.date(dt.year, dt.month, 1)


def _pct_delta(cur, prev):
    if not prev:
        return None
    return round((cur - prev) * 100.0 / prev, 1)


@bp.get("/insight")
@role_required("admin")
def insight():
    db = get_db()
    try:
        days = int(request.args.get("days", 90))
    except ValueError:
        days = 90
    if days not in (30, 90, 180, 365):
        days = 90

    now = now_utc()
    since = now - datetime.timedelta(days=days)
    prev_since = since - datetime.timedelta(days=days)

    docs = list(
        db.rtv_transactions.find(
            {"tgl_input": {"$gte": prev_since}},
            {
                "status": 1, "tgl_input": 1, "tgl_verifikasi": 1, "qty_diajukan": 1, "qty_diterima": 1,
                "product": 1, "store_id": 1, "kategori_kerusakan": 1,
            },
        ).limit(20000)
    )
    cur = [d for d in docs if _naive(d["tgl_input"]) >= since]
    prev = [d for d in docs if _naive(d["tgl_input"]) < since]

    def loss(rows):
        return sum(nilai_rtv(d) for d in rows if d.get("status") not in STATUS_NON_LOSS)

    decided = [d for d in cur if d.get("status") in STATUS_DECIDED]
    rejected = [d for d in decided if d.get("status") == "Rejected"]
    prev_decided = [d for d in prev if d.get("status") in STATUS_DECIDED]
    prev_rejected = [d for d in prev_decided if d.get("status") == "Rejected"]
    rate = round(len(rejected) * 100.0 / len(decided), 1) if decided else 0.0
    prev_rate = round(len(prev_rejected) * 100.0 / len(prev_decided), 1) if prev_decided else 0.0

    lead = [x for x in (_days_between(d.get("tgl_input"), d.get("tgl_verifikasi")) for d in decided if d.get("tgl_verifikasi")) if x is not None]
    avg_verif = round(sum(lead) / len(lead), 1) if lead else 0.0

    # ---- klaim vendor ----
    shipments = list(db.rtv_shipments.find({"tgl_kirim": {"$gte": since}}).limit(2000))
    ship_ids = [s["_id"] for s in shipments]
    ship_value = {sid: 0.0 for sid in ship_ids}
    if ship_ids:
        for it in db.rtv_transactions.find({"shipment_id": {"$in": ship_ids}}):
            ship_value[it["shipment_id"]] = ship_value.get(it["shipment_id"], 0.0) + nilai_rtv(it)
    klaim_selesai = [s for s in shipments if s.get("tgl_selesai")]
    nilai_selesai = sum(ship_value.get(s["_id"], 0.0) for s in klaim_selesai)
    kredit = sum(money((s.get("klaim") or {}).get("nilai_kredit")) for s in klaim_selesai)
    menggantung = sum(ship_value.get(s["_id"], 0.0) for s in shipments if not s.get("tgl_selesai"))
    lama_klaim = [x for x in (_days_between(s.get("tgl_kirim"), s.get("tgl_selesai")) for s in klaim_selesai) if x is not None]
    klaim_status = {}
    for s in klaim_selesai:
        st = (s.get("klaim") or {}).get("status") or "Tidak dicatat"
        klaim_status[st] = klaim_status.get(st, 0) + 1

    # ---- tren ----
    weekly = days <= 90
    keys = _bucket_keys(since, now, weekly)
    counts = {k: 0 for k in keys}
    values = {k: 0.0 for k in keys}
    for d in cur:
        k = _bucket_of(d["tgl_input"], weekly)
        if k in counts:
            counts[k] += 1
            if d.get("status") not in STATUS_NON_LOSS:
                values[k] += nilai_rtv(d)
    tren = [{"tanggal": k.isoformat(), "jumlah": counts[k], "nilai": round(values[k], 2)} for k in keys]

    # ---- skor vendor & produk teratas ----
    prod_map, sup_map = _product_supplier_maps(db)
    vendor = {}
    produk_hit = {}
    for d in cur:
        sid = _supplier_of(d, prod_map)
        v = vendor.setdefault(sid, {"jumlah": 0, "qty": 0, "nilai": 0.0, "ditolak": 0, "produk": {}})
        v["jumlah"] += 1
        v["qty"] += d.get("qty_diterima") or d.get("qty_diajukan") or 0
        if d.get("status") not in STATUS_NON_LOSS:
            v["nilai"] += nilai_rtv(d)
        if d.get("status") == "Rejected":
            v["ditolak"] += 1
        pname = (d.get("product") or {}).get("nama_produk") or "-"
        v["produk"][pname] = v["produk"].get(pname, 0) + 1
        produk_hit[pname] = produk_hit.get(pname, 0) + 1
    vendor_rows = []
    for sid, v in vendor.items():
        sup = sup_map.get(sid) or {}
        top = max(v["produk"].items(), key=lambda kv: kv[1])[0] if v["produk"] else "-"
        vendor_rows.append(
            {
                "supplier": sup.get("nama_supplier") or "Tanpa supplier",
                "kode": sup.get("kode_supplier"),
                "jumlah": v["jumlah"],
                "qty": v["qty"],
                "nilai": round(v["nilai"], 2),
                "persen_ditolak": round(v["ditolak"] * 100.0 / v["jumlah"], 1) if v["jumlah"] else 0.0,
                "produk_teratas": top,
            }
        )
    vendor_rows.sort(key=lambda r: (r["nilai"], r["jumlah"]), reverse=True)
    produk_rows = sorted(({"produk": k, "jumlah": n} for k, n in produk_hit.items()), key=lambda r: r["jumlah"], reverse=True)[:5]

    # ---- perbandingan toko ----
    stores = {s["_id"]: s for s in db.master_store.find({})}
    toko = {}
    for d in cur:
        t = toko.setdefault(d.get("store_id"), {"jumlah": 0, "qty": 0, "nilai": 0.0, "ditolak": 0, "putus": 0, "pending": 0})
        t["jumlah"] += 1
        t["qty"] += d.get("qty_diterima") or d.get("qty_diajukan") or 0
        if d.get("status") not in STATUS_NON_LOSS:
            t["nilai"] += nilai_rtv(d)
        if d.get("status") == "Rejected":
            t["ditolak"] += 1
        if d.get("status") in STATUS_DECIDED:
            t["putus"] += 1
        if d.get("status") == "Pending":
            t["pending"] += 1
    toko_rows = []
    for sid, t in toko.items():
        st = stores.get(sid) or {}
        toko_rows.append(
            {
                "toko": st.get("nama_store") or "-",
                "kode": st.get("kode_store"),
                "jumlah": t["jumlah"],
                "qty": t["qty"],
                "nilai": round(t["nilai"], 2),
                "pending": t["pending"],
                "persen_ditolak": round(t["ditolak"] * 100.0 / t["putus"], 1) if t["putus"] else 0.0,
            }
        )
    toko_rows.sort(key=lambda r: (r["jumlah"], r["nilai"]), reverse=True)

    crit_days = current_app.config.get("AGING_CRITICAL_DAYS", 30)
    return jsonify(
        {
            "days": days,
            "granularity": "week" if weekly else "month",
            "kpi": {
                "total_rtv": len(cur),
                "total_rtv_prev": len(prev),
                "total_rtv_delta": _pct_delta(len(cur), len(prev)),
                "kerugian": round(loss(cur), 2),
                "kerugian_prev": round(loss(prev), 2),
                "kerugian_delta": _pct_delta(loss(cur), loss(prev)),
                "persen_ditolak": rate,
                "persen_ditolak_prev": prev_rate,
                "rata_hari_verifikasi": avg_verif,
                "rata_hari_klaim": round(sum(lama_klaim) / len(lama_klaim), 1) if lama_klaim else 0.0,
                "klaim_nilai_selesai": round(nilai_selesai, 2),
                "klaim_kredit_diterima": round(kredit, 2),
                "klaim_persen_kembali": round(kredit * 100.0 / nilai_selesai, 1) if nilai_selesai else 0.0,
                "klaim_menggantung": round(menggantung, 2),
                "klaim_status": klaim_status,
            },
            "tren": tren,
            "vendor": vendor_rows[:15],
            "produk_teratas": produk_rows,
            "toko": toko_rows[:15],
            "akun_menunggu": db.master_karyawan.count_documents({"menunggu_persetujuan": True}),
            "stok_kritis": db.rtv_transactions.count_documents(
                {"status": "Received", "tgl_terima": {"$lt": now - datetime.timedelta(days=crit_days)}}
            ),
        }
    )


# ---------------------------------------------------------------------------
# Admin: ekspor semua RTV & log aktivitas
# ---------------------------------------------------------------------------
@bp.get("/rtv-export")
@role_required("admin")
def rtv_export():
    db = get_db()
    flt = {}
    tgl_dari = parse_date(request.args.get("dari"), required=False)
    tgl_sampai = parse_date(request.args.get("sampai"), required=False)
    if tgl_dari or tgl_sampai:
        rng = {}
        if tgl_dari:
            rng["$gte"] = tgl_dari
        if tgl_sampai:
            rng["$lt"] = tgl_sampai + datetime.timedelta(days=1)
        flt["tgl_input"] = rng
    status = request.args.get("status")
    if status:
        flt["status"] = status

    prod_map, sup_map = _product_supplier_maps(db)
    stores = {s["_id"]: s for s in db.master_store.find({})}
    shipments = {s["_id"]: s for s in db.rtv_shipments.find({}, {"no_surat_jalan": 1})}
    rows = []
    for d in db.rtv_transactions.find(flt).sort("tgl_input", -1).limit(5000):
        sup = sup_map.get(_supplier_of(d, prod_map)) or {}
        rows.append(
            {
                "no_rtv": d.get("no_rtv"),
                "toko": (stores.get(d.get("store_id")) or {}).get("nama_store"),
                "supplier": sup.get("nama_supplier"),
                "barcode": (d.get("product") or {}).get("barcode"),
                "produk": (d.get("product") or {}).get("nama_produk"),
                "qty_diajukan": d.get("qty_diajukan"),
                "qty_diterima": d.get("qty_diterima"),
                "harga": money((d.get("product") or {}).get("harga")),
                "nilai": nilai_rtv(d) if d.get("status") not in STATUS_NON_LOSS else 0,
                "status": d.get("status"),
                "kategori": d.get("kategori_kerusakan"),
                "batch": d.get("batch"),
                "lokasi": d.get("lokasi_karantina"),
                "alasan": d.get("alasan"),
                "surat_jalan": (shipments.get(d.get("shipment_id")) or {}).get("no_surat_jalan"),
                "tgl_input": jsonable(d.get("tgl_input")),
                "tgl_terima": jsonable(d.get("tgl_terima")),
                "tgl_verifikasi": jsonable(d.get("tgl_verifikasi")),
            }
        )
    return jsonify({"items": rows})


@bp.get("/audit")
@role_required("admin")
def audit_list():
    db = get_db()
    try:
        limit = min(max(int(request.args.get("limit", 200)), 1), 500)
    except ValueError:
        limit = 200
    flt = {}
    koleksi = request.args.get("koleksi")
    if koleksi in ("rtv_transactions", "rtv_shipments", "master_karyawan"):
        flt["collection"] = koleksi
    aksi = (request.args.get("aksi") or "").strip()
    if aksi:
        flt["action"] = aksi[:40]
    rows = list(db.audit_logs.find(flt, {"before": 0, "after": 0}).sort("tgl", -1).limit(limit))

    def ids_of(col):
        out = []
        for r in rows:
            if r.get("collection") == col:
                try:
                    out.append(to_object_id(r.get("document_id")))
                except ApiError:
                    pass
        return out

    rtv = {d["_id"]: d.get("no_rtv") for d in db.rtv_transactions.find({"_id": {"$in": ids_of("rtv_transactions")}}, {"no_rtv": 1})}
    shp = {d["_id"]: d.get("no_surat_jalan") for d in db.rtv_shipments.find({"_id": {"$in": ids_of("rtv_shipments")}}, {"no_surat_jalan": 1})}
    kar = {d["_id"]: d.get("username") for d in db.master_karyawan.find({"_id": {"$in": ids_of("master_karyawan")}}, {"username": 1})}
    items = []
    for r in rows:
        ref = r.get("document_id")
        try:
            oid = to_object_id(ref)
            ref = {"rtv_transactions": rtv, "rtv_shipments": shp, "master_karyawan": kar}.get(r.get("collection"), {}).get(oid) or ref
        except ApiError:
            pass
        items.append(
            {
                "tgl": jsonable(r.get("tgl")),
                "koleksi": r.get("collection"),
                "aksi": r.get("action"),
                "ref": ref,
                "oleh": (r.get("oleh") or {}).get("nama") or "Sistem",
                "role": (r.get("oleh") or {}).get("role"),
            }
        )
    return jsonify({"items": items})