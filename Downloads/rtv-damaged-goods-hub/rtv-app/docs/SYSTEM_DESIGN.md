# System Design Document
## Sistem RTV & Damaged Goods Hub

---

## 1. Arsitektur

```
┌─────────────────────────┐        HTTPS/JSON        ┌───────────────────────────┐
│   Browser (Webix SPA)   │ ────────────────────────▶ │  Flask App (api/index.py) │
│  app/templates/index.html│ ◀──────────────────────── │  app/blueprints/*.py      │
└─────────────────────────┘                            └──────────────┬────────────┘
                                                                        │ pymongo
                                                                        ▼
                                                         ┌───────────────────────────┐
                                                         │   MongoDB Atlas (cloud)   │
                                                         │   db: rtv_damaged_goods   │
                                                         └───────────────────────────┘
```

- **Frontend**: Single Page Application berbasis **Webix** (via CDN), disajikan
  oleh Flask sebagai template statis (`templates/index.html`) + aset statis
  (`static/js/*.js`, `static/css/app.css`). Semua komunikasi dengan backend
  memakai `fetch()` ke endpoint `/api/*` dengan format JSON.
- **Backend**: **Flask** application factory (`app/__init__.py`), dipecah
  menjadi blueprint per domain fitur. Autentikasi berbasis session cookie
  (signed, disimpan di sisi client — cocok untuk lingkungan serverless yang
  stateless).
- **Database**: **MongoDB** (Atlas direkomendasikan untuk production). Koneksi
  di-cache per-proses (`app/db.py`) agar efisien pada cold start serverless.
- **Deployment**: `vercel.json` mengarahkan seluruh route ke
  `api/index.py` (Python serverless function). Alternatif: `wsgi.py` +
  `gunicorn` untuk Render/VM biasa.

## 2. Keamanan & Otorisasi

1. **Autentikasi**: `POST /api/auth/login` memeriksa `username` di
   `master_karyawan`, mencocokkan hash password (`werkzeug.security`,
   PBKDF2-SHA256), lalu menyimpan `user_id` di session cookie
   (HttpOnly, SameSite=Lax, Secure di production).
2. **Otorisasi berjenjang**: dekorator `login_required` (app/security.py)
   memuat ulang dokumen karyawan dari DB di **setiap request** — bukan hanya
   percaya isi cookie — sehingga perubahan `aktif`, `role`, atau `store_id`
   oleh admin langsung berlaku. Dekorator `role_required(*roles)` membangun
   di atasnya untuk membatasi endpoint per role.
3. **Scoping toko**: endpoint Staff Toko selalu memfilter berdasarkan
   `g.user["store_id"]` dari sesi (bukan dari parameter request), mencegah
   staff mengakses data toko lain lewat manipulasi payload.
4. **Audit trail**: fungsi `record_audit()` menulis setiap aksi penting
   (login, ajukan retur, verifikasi, dsb.) ke koleksi `audit_logs`.
5. **Validasi & sanitasi** terpusat di `app/utils.py`: trim & escape HTML
   semua string, validasi qty (bilangan bulat positif), harga (angka >= 0,
   disimpan `Decimal128`), format kode/barcode/username, serta validasi
   `ObjectId` sebelum query ke MongoDB.

## 3. Skema Database (MongoDB)

### 3.1 `master_karyawan`
```jsonc
{
  "_id": ObjectId,
  "nik": "T0001",                 // unique
  "nama": "Siti Staff Toko",
  "username": "staff_toko",       // unique
  "password_hash": "pbkdf2:sha256:...",
  "role": "staff_toko | staff_gudang | admin",
  "store_id": ObjectId,
  "shift_id": ObjectId | null,
  "aktif": true,
  "tgl_nonaktif": null | ISODate,
  "tgl_mulai_penempatan": ISODate,
  "riwayat_penempatan": [
    { "store_id": ObjectId, "tgl_mulai": ISODate, "tgl_selesai": ISODate }
  ]
}
```

### 3.2 `master_store`
```jsonc
{ "_id": ObjectId, "kode_store": "STR01", "nama_store": "...", "alamat": "..." }
```

### 3.3 `master_supplier`
```jsonc
{ "_id": ObjectId, "kode_supplier": "SUP01", "nama_supplier": "...", "alamat": "...", "kontak": "..." }
```

### 3.4 `master_product`
```jsonc
{
  "_id": ObjectId, "barcode": "8991...", "nama_produk": "...",
  "harga": Decimal128, "supplier_id": ObjectId, "aktif": true
}
```

### 3.5 `master_shift`
```jsonc
{ "_id": ObjectId, "nama_shift": "Shift Pagi", "jam_mulai": "07:00", "jam_selesai": "15:00" }
```

### 3.6 `rtv_transactions` (dokumen transaksi utama)
```jsonc
{
  "_id": ObjectId,
  "no_rtv": "RTV-202611-000001",      // unique, auto-generate
  "store_id": ObjectId,
  "product": {                         // snapshot saat diajukan (embedded)
    "product_id": ObjectId, "barcode": "...", "nama_produk": "...", "harga": Decimal128
  },
  "qty_diajukan": 10,
  "qty_diterima": 9 | null,
  "alasan": "...",
  "kategori_kerusakan": "Fisik Rusak" | null,
  "batch": "BATCH-01" | null,
  "tgl_kedaluwarsa": ISODate | null,
  "status": "Pending|Received|Approved|Rejected|Shipped to Supplier|Completed|Cancelled",
  "shipment_id": ObjectId | null,
  "diajukan_oleh": { "id": ObjectId, "nama": "..." },
  "diterima_oleh": { "id": ObjectId, "nama": "..." } | null,
  "diverifikasi_oleh": { "id": ObjectId, "nama": "..." } | null,
  "tgl_input": ISODate, "tgl_terima": ISODate | null, "tgl_verifikasi": ISODate | null
}
```

### 3.7 `rtv_shipments` (surat jalan ke supplier)
```jsonc
{
  "_id": ObjectId, "no_surat_jalan": "SJ-202611-000001",
  "supplier_id": ObjectId, "rtv_ids": [ObjectId, ...],
  "tgl_kirim": ISODate, "dibuat_oleh": { "id": ObjectId, "nama": "..." },
  "tgl_selesai": ISODate | null, "hasil_klaim": "..." | null
}
```

### 3.8 `audit_logs`
```jsonc
{
  "_id": ObjectId, "collection": "rtv_transactions", "document_id": "...",
  "action": "ajukan_retur", "before": {...}|null, "after": {...}|null,
  "oleh": { "id": "...", "nama": "...", "role": "..." }, "tgl": ISODate
}
```

### 3.9 `counters` (helper no_rtv/no_surat_jalan sequential)
```jsonc
{ "_id": "rtv:202611", "seq": 42 }
```

## 4. Index MongoDB (`app/db.py:ensure_indexes`)
| Koleksi | Index | Tipe |
|---|---|---|
| master_karyawan | username | unique |
| master_karyawan | nik | unique |
| master_karyawan | store_id + role | composite |
| master_store | kode_store | unique |
| master_supplier | kode_supplier | unique |
| master_product | barcode | unique |
| master_product | nama_produk | text |
| master_product | supplier_id | single |
| master_shift | nama_shift | unique |
| rtv_transactions | no_rtv | unique |
| rtv_transactions | status + store_id | composite |
| rtv_transactions | store_id + tgl_input | composite |
| rtv_transactions | shipment_id | single |
| rtv_transactions | product.product_id | single |
| rtv_shipments | no_surat_jalan | unique |
| rtv_shipments | supplier_id | single |
| audit_logs | collection + document_id | composite |
| audit_logs | tgl | single (descending) |

## 5. Konkurensi & Konsistensi Status
MongoDB standalone tidak menjamin transaksi multi-dokumen tanpa replica set,
sehingga setiap transisi status memakai pola **atomic single-document update**
(`find_one_and_update` dengan filter status lama) dan, untuk operasi
multi-dokumen (Buat Surat Jalan), memakai **compensating action** (rollback
manual) apabila jumlah dokumen yang berhasil diubah tidak sama dengan jumlah
yang diminta. Lihat `app/blueprints/admin_rtv.py:buat_surat_jalan`.

## 6. Peta Endpoint API
Lihat `docs/API.md` untuk referensi lengkap seluruh endpoint REST.

## 7. Struktur Direktori
```
rtv-app/
├── api/index.py            # entry point Vercel (WSGI)
├── wsgi.py                 # entry point lokal/Render
├── app/
│   ├── __init__.py         # application factory
│   ├── config.py           # konfigurasi dari environment variable
│   ├── db.py               # koneksi MongoDB + index
│   ├── security.py         # auth decorators, audit trail
│   ├── utils.py            # validasi, sanitasi, serialisasi
│   ├── blueprints/
│   │   ├── auth.py
│   │   ├── toko.py
│   │   ├── gudang.py
│   │   ├── admin_rtv.py
│   │   ├── master_data.py
│   │   ├── karyawan.py
│   │   ├── dashboard.py
│   │   └── common.py
│   ├── templates/index.html
│   └── static/{css,js}/...
├── scripts/seed_data.py
├── tests/test_rtv_flow.py
├── docs/{SYSTEM_DESIGN.md, API.md}
├── requirements.txt / requirements-dev.txt
├── vercel.json
└── README.md
```
