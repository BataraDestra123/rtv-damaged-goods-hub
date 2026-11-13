# API Reference — Sistem RTV & Damaged Goods Hub

Base URL: `/api`. Semua endpoint (kecuali `/auth/login` dan `/health`)
memerlukan session login (cookie) dan mengembalikan `401` jika tidak valid,
atau `403` jika role tidak sesuai.

Format error standar:
```json
{ "error": "validation_error", "message": "Pesan untuk pengguna.", "detail": {} }
```

---

## Auth
| Method | Endpoint | Role | Keterangan |
|---|---|---|---|
| POST | `/auth/login` | - | `{username, password}` → set cookie sesi |
| POST | `/auth/logout` | semua | Hapus sesi |
| GET | `/auth/me` | semua | Info user yang sedang login |

## Umum (read-only, semua role)
| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/produk?q=` | Daftar produk aktif (untuk dropdown) |
| GET | `/supplier` | Daftar supplier |
| GET | `/store` | Daftar toko |
| GET | `/shift` | Daftar shift |

## Staff Toko (`role=staff_toko`)
| Method | Endpoint | Body | Keterangan |
|---|---|---|---|
| POST | `/toko/retur` | `{product_id, qty_diajukan, alasan}` | Ajukan retur baru (status Pending) |
| GET | `/toko/retur?status=` | - | Daftar RTV milik toko sendiri |
| POST | `/toko/retur/<id>/batalkan` | - | Batalkan RTV (hanya saat Pending) |

## Staff Gudang (`role=staff_gudang`)
| Method | Endpoint | Body | Keterangan |
|---|---|---|---|
| GET | `/gudang/retur?status=Pending` | - | Daftar RTV pending dari semua toko |
| POST | `/gudang/retur/<id>/terima` | `{qty_diterima, kategori_kerusakan, batch?, tgl_kedaluwarsa?}` | Terima barang, status → Received |
| GET | `/gudang/stok` | - | Agregat stok barang rusak per produk |

## Admin (`role=admin`)
| Method | Endpoint | Body | Keterangan |
|---|---|---|---|
| GET | `/admin/verifikasi` | - | Daftar RTV status Received |
| POST | `/admin/verifikasi/<id>` | `{approve: true|false}` | Approve/Reject |
| GET | `/admin/surat-jalan/items` | - | Item Approved + daftar supplier |
| POST | `/admin/surat-jalan` | `{supplier_id, rtv_ids: []}` | Buat surat jalan baru |
| GET | `/admin/surat-jalan?status=` | - | Daftar surat jalan |
| POST | `/admin/surat-jalan/<id>/selesai` | `{hasil_klaim}` | Selesaikan klaim (status → Completed) |

### Master Data (`role=admin`)
| Method | Endpoint |
|---|---|
| GET/POST | `/master/supplier` |
| PUT/DELETE | `/master/supplier/<id>` |
| GET/POST | `/master/produk` |
| PUT/DELETE | `/master/produk/<id>` |
| GET/POST | `/master/store` |
| PUT/DELETE | `/master/store/<id>` |
| GET/POST | `/master/shift` |
| PUT/DELETE | `/master/shift/<id>` |

### Karyawan (`role=admin`)
| Method | Endpoint | Body |
|---|---|---|
| GET | `/karyawan` | - |
| POST | `/karyawan` | `{nik, nama, username, password, role, store_id, shift_id?}` |
| PUT | `/karyawan/<id>` | `{nama?, role?, shift_id?, password?}` |
| POST | `/karyawan/<id>/nonaktifkan` | - |
| POST | `/karyawan/<id>/aktifkan` | - |
| POST | `/karyawan/<id>/pindahkan` | `{store_id}` |

### Dashboard & Laporan
| Method | Endpoint | Role |
|---|---|---|
| GET | `/dashboard/summary` | semua (otomatis difilter store untuk staff_toko) |
| GET | `/dashboard/rekap-supplier?dari=&sampai=` | admin |
| GET | `/dashboard/tren-status` | admin |

## Misc
| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/health` | Status aplikasi & koneksi database |
