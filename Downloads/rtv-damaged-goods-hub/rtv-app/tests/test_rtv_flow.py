"""
Unit test alur end-to-end RTV menggunakan mongomock.
Jalankan dengan: pytest
"""
from tests.conftest import login


def test_login_success_and_me(client, seed):
    res = login(client, "toko1")
    assert res.status_code == 200
    assert res.get_json()["user"]["role"] == "staff_toko"

    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.get_json()["user"]["username"] == "toko1"


def test_login_wrong_password(client, seed):
    res = login(client, "toko1", password="salah")
    assert res.status_code == 401


def test_login_inactive_account_rejected(client, seed):
    res = login(client, "nonaktif1")
    assert res.status_code == 401


def test_unauthenticated_request_rejected(client, seed):
    res = client.get("/api/toko/retur")
    assert res.status_code == 401


def test_staff_toko_cannot_access_admin_endpoint(client, seed):
    login(client, "toko1")
    res = client.get("/api/admin/verifikasi")
    assert res.status_code == 403


def test_ajukan_retur_creates_pending(client, seed):
    login(client, "toko1")
    res = client.post(
        "/api/toko/retur",
        json={"product_id": str(seed["produk"]), "qty_diajukan": 5, "alasan": "Kemasan sobek"},
    )
    assert res.status_code == 201
    item = res.get_json()["item"]
    assert item["status"] == "Pending"
    assert item["no_rtv"].startswith("RTV-")
    assert item["qty_diajukan"] == 5


def test_ajukan_retur_invalid_qty_rejected(client, seed):
    login(client, "toko1")
    res = client.post(
        "/api/toko/retur",
        json={"product_id": str(seed["produk"]), "qty_diajukan": -3, "alasan": "x"},
    )
    assert res.status_code == 400


def test_staff_toko_only_sees_own_store(client, seed):
    login(client, "toko1")
    client.post("/api/toko/retur", json={"product_id": str(seed["produk"]), "qty_diajukan": 2, "alasan": "rusak"})
    client.post("/api/auth/logout")

    login(client, "toko2")
    res = client.get("/api/toko/retur")
    assert res.status_code == 200
    assert res.get_json()["items"] == []


def test_batalkan_pending_success(client, seed):
    login(client, "toko1")
    created = client.post(
        "/api/toko/retur", json={"product_id": str(seed["produk"]), "qty_diajukan": 2, "alasan": "rusak"}
    ).get_json()["item"]

    res = client.post(f"/api/toko/retur/{created['_id']}/batalkan")
    assert res.status_code == 200
    assert res.get_json()["item"]["status"] == "Cancelled"


def test_batalkan_fails_after_received(client, seed):
    created = _ajukan_dan_terima(client, seed)
    res = client.post(f"/api/toko/retur/{created['_id']}/batalkan")
    assert res.status_code in (403, 409)  # bisa 403 krn toko lain / 409 krn status bukan pending


def _login_as(client, username):
    client.post("/api/auth/logout")
    login(client, username)


def _ajukan_dan_terima(client, seed):
    _login_as(client, "toko1")
    created = client.post(
        "/api/toko/retur", json={"product_id": str(seed["produk"]), "qty_diajukan": 4, "alasan": "rusak fisik"}
    ).get_json()["item"]

    _login_as(client, "gudang1")
    terima = client.post(
        f"/api/gudang/retur/{created['_id']}/terima",
        json={"qty_diterima": 4, "kategori_kerusakan": "Fisik Rusak", "batch": "B01"},
    )
    assert terima.status_code == 200
    assert terima.get_json()["item"]["status"] == "Received"
    return terima.get_json()["item"]


def test_full_rtv_lifecycle_to_completed(client, seed):
    received = _ajukan_dan_terima(client, seed)

    _login_as(client, "admin1")
    approve = client.post(f"/api/admin/verifikasi/{received['_id']}", json={"approve": True})
    assert approve.status_code == 200
    assert approve.get_json()["item"]["status"] == "Approved"

    sj = client.post(
        "/api/admin/surat-jalan",
        json={"supplier_id": str(seed["supplier"]), "rtv_ids": [received["_id"]]},
    )
    assert sj.status_code == 201
    shipment = sj.get_json()["shipment"]
    assert shipment["no_surat_jalan"].startswith("SJ-")

    check = client.get(f"/api/toko/retur")  # sanity: still reachable as staff after role switch below
    # switch back to admin explicitly (session may have changed role context)
    _login_as(client, "admin1")

    selesai = client.post(
        f"/api/admin/surat-jalan/{shipment['_id']}/selesai", json={"hasil_klaim": "Diganti barang baru oleh supplier"}
    )
    assert selesai.status_code == 200
    assert selesai.get_json()["shipment"]["hasil_klaim"]

    daftar = client.get("/api/admin/surat-jalan")
    assert daftar.status_code == 200
    rows = daftar.get_json()["items"]
    assert any(r["_id"] == shipment["_id"] and r["jumlah_item"] == 1 for r in rows)


def test_surat_jalan_rejects_mixed_supplier(client, seed):
    _login_as(client, "toko1")
    r1 = client.post(
        "/api/toko/retur", json={"product_id": str(seed["produk"]), "qty_diajukan": 1, "alasan": "a"}
    ).get_json()["item"]
    r2 = client.post(
        "/api/toko/retur", json={"product_id": str(seed["produk2"]), "qty_diajukan": 1, "alasan": "b"}
    ).get_json()["item"]

    _login_as(client, "gudang1")
    for r in (r1, r2):
        client.post(
            f"/api/gudang/retur/{r['_id']}/terima",
            json={"qty_diterima": 1, "kategori_kerusakan": "Fisik Rusak"},
        )

    _login_as(client, "admin1")
    for r in (r1, r2):
        client.post(f"/api/admin/verifikasi/{r['_id']}", json={"approve": True})

    # r1 -> supplier A, r2 -> supplier B. Membuat surat jalan dengan supplier A tapi
    # menyertakan rtv dari supplier B harus ditolak.
    res = client.post(
        "/api/admin/surat-jalan",
        json={"supplier_id": str(seed["supplier"]), "rtv_ids": [r1["_id"], r2["_id"]]},
    )
    assert res.status_code == 400


def test_reject_rtv_is_final(client, seed):
    received = _ajukan_dan_terima(client, seed)
    _login_as(client, "admin1")
    res = client.post(f"/api/admin/verifikasi/{received['_id']}", json={"approve": False})
    assert res.status_code == 200
    assert res.get_json()["item"]["status"] == "Rejected"

    # verifikasi ulang harus gagal (sudah final / bukan Received lagi)
    res2 = client.post(f"/api/admin/verifikasi/{received['_id']}", json={"approve": True})
    assert res2.status_code == 409


def test_master_data_delete_guard(client, seed):
    _login_as(client, "admin1")
    res = client.delete(f"/api/master/supplier/{seed['supplier']}")
    assert res.status_code == 409  # masih dipakai oleh produk


def test_karyawan_nonaktifkan_blocks_login(client, seed):
    _login_as(client, "admin1")
    res = client.post(f"/api/karyawan/{seed['toko_user']}/nonaktifkan")
    assert res.status_code == 200

    client.post("/api/auth/logout")
    res2 = login(client, "toko1")
    assert res2.status_code == 401
