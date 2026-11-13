# RTV & Damaged Goods Hub

Aplikasi web manajemen retur barang rusak (Return to Vendor) dari toko ke
supplier/pabrik. Backend **Flask + MongoDB**, frontend **Webix** (SPA),
siap di-deploy ke **Vercel** (serverless) atau **Render** (container biasa).

Dokumen pendukung ada di folder [`docs/`](docs):
- [`SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md) — arsitektur & skema database
- [`API.md`](docs/API.md) — referensi endpoint REST

> Dokumen SRS (Software Requirements Specification) akan dibuat belakangan,
> setelah aplikasi dipastikan berjalan lancar dan semua fitur terverifikasi.

## 0. Status Verifikasi Backend

Seluruh alur backend berikut sudah diverifikasi berjalan benar secara
end-to-end (login per role, ajukan retur, sanitasi anti-XSS, terima barang,
verifikasi approve/reject, buat surat jalan dengan guard satu-supplier,
selesaikan klaim, kalkulasi dashboard, serta guard keamanan 401/403) lewat
15 unit test di `tests/test_rtv_flow.py` plus satu skenario smoke-test
penuh lintas 3 role secara berurutan — semuanya lulus. Yang **belum**
diverifikasi secara visual adalah interaksi UI Webix di browser sungguhan
(klik tombol, buka window form, dsb.) — baru lolos pengecekan sintaks JS.
Jalankan `pytest` sendiri untuk mengonfirmasi ulang di komputer Anda.

---

## 1. Fitur Utama

- Autentikasi & otorisasi berbasis role (`staff_toko`, `staff_gudang`, `admin`)
  dengan pengecekan ulang status aktif pada setiap request.
- Siklus RTV lengkap: **Ajukan → Terima → Verifikasi → Surat Jalan → Selesai
  Klaim**, dengan update status atomik anti race-condition.
- Validasi & sanitasi input di semua endpoint (anti-XSS, cek tipe data,
  cek keunikan kode/barcode/username).
- Kelola Master Data (Supplier, Produk, Toko, Shift) dan Karyawan
  (tambah/ubah/nonaktifkan/pindahkan toko).
- Dashboard & laporan (status count, estimasi kerugian finansial,
  peringatan stok karantina, rekap per supplier).
- Audit trail seluruh aksi penting (`audit_logs`).
- Index MongoDB (unique, composite, text) untuk performa query.
- Simulasi multi user / multi role lewat `scripts/seed_data.py`.

## 2. Menjalankan Secara Lokal

### 2.1 Prasyarat
- Python 3.11+
- Akun MongoDB Atlas (gratis tier cukup) **atau** MongoDB lokal

### 2.2 Instalasi
```bash
cd rtv-app
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt

cp .env.example .env
# edit .env -> isi MONGO_URI dengan connection string Anda
```

### 2.3 Seed data demo (akun multi-role)
```bash
python scripts/seed_data.py
```
Akan membuat toko, supplier, produk, shift, dan 4 akun demo:

| Username | Password | Role |
|---|---|---|
| `staff_toko` | `Toko@1234` | staff_toko (Toko Pusat Jakarta) |
| `staff_toko2` | `Toko@1234` | staff_toko (Toko Cabang Bandung) |
| `staff_gudang` | `Gudang@1234` | staff_gudang |
| `admin` | `Admin@1234` | admin |

### 2.4 Jalankan server
```bash
python wsgi.py
# atau: flask --app wsgi run --debug
```
Buka `http://localhost:5000`.

### 2.5 Simulasi multi user/role
Buka beberapa tab/browser berbeda (atau mode incognito), login dengan akun
berbeda pada masing-masing tab untuk mensimulasikan Staff Toko mengajukan
retur → Staff Gudang menerima → Admin memverifikasi & membuat surat jalan,
secara bersamaan/real-time terhadap database yang sama.

## 3. Menjalankan Unit Test
```bash
pip install -r requirements-dev.txt
pytest
```
Test memakai `mongomock` (MongoDB in-memory tiruan) sehingga tidak
memerlukan koneksi database sungguhan.

## 4. Deployment

### 4.1 MongoDB Atlas (database)
1. Buat cluster gratis di https://cloud.mongodb.com.
2. Buat database user (username/password) dan whitelist IP `0.0.0.0/0`
   (atau IP khusus Vercel/Render jika tersedia).
3. Salin *connection string* (`mongodb+srv://...`), ini adalah nilai
   `MONGO_URI`.

### 4.2 Deploy ke Vercel
1. Push project ini ke repository GitHub/GitLab/Bitbucket.
2. Di dashboard Vercel: **New Project** → import repo ini.
3. Vercel otomatis mendeteksi `vercel.json` (runtime `@vercel/python`,
   entry `api/index.py`).
4. Set **Environment Variables** di Project Settings:
   - `MONGO_URI`
   - `MONGO_DB_NAME` (opsional, default `rtv_damaged_goods`)
   - `SECRET_KEY` (random string panjang & rahasia)
   - `SESSION_COOKIE_SECURE=1`
5. Deploy. Setelah selesai, jalankan `python scripts/seed_data.py` dari
   komputer lokal (dengan `MONGO_URI` yang sama di `.env`) untuk mengisi
   data awal & akun demo ke database production.
6. Buka URL yang diberikan Vercel — aplikasi siap dipakai.

> **Catatan**: `vercel.json` sudah memetakan seluruh route (termasuk
> `/static/*`) ke `api/index.py`, karena Flask menyajikan asetnya sendiri.

### 4.3 Deploy ke Render (alternatif)
1. **New Web Service** → connect repo ini.
2. Build command: `pip install -r requirements.txt`
3. Start command: `gunicorn wsgi:app`
4. Set environment variables yang sama seperti §4.2 poin 4.
5. Deploy, lalu jalankan `scripts/seed_data.py` seperti di atas.

## 5. Struktur Project
Lihat [`docs/SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md) §7.

## 6. Keamanan
- Password di-hash dengan PBKDF2-SHA256 (`werkzeug.security`), **tidak
  pernah** disimpan plain text.
- Session cookie: `HttpOnly`, `SameSite=Lax`, `Secure` (aktif di production).
- Setiap request memverifikasi ulang akun aktif & role langsung dari
  database (bukan hanya dari isi cookie).
- Seluruh input disanitasi (escape HTML, validasi tipe & panjang) sebelum
  disimpan ke database.
- `.env` **tidak** boleh di-commit ke git (`sudah ada di .gitignore`).

## 7. Lisensi
Proyek ini dibuat untuk keperluan tugas/skripsi internal. Silakan
disesuaikan sesuai kebutuhan Anda.
