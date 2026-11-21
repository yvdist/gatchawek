# Insiden 2026-11-21 — kuota baca D1 habis

Ringkasan singkat sebelum langkah-langkahnya:

- **Penyebab:** halaman `/admin/cards` menjumlah `user_cards` dengan `LEFT JOIN` pada `card_id` yang belum ada index-nya. D1 mengulang scan seluruh tabel untuk setiap kartu: 63 kali buka panel = 3,79 juta baris, dari batas 5 juta/hari.
- **Fix permanen (sudah live):** index `user_cards(card_id)` + migration `0012`, error kuota sekarang jadi halaman 503 yang jelas, backup harian ke R2 jam 07:10 WIB, dan dump yang benar-benar bisa direstore.
- **Status:** sisa kuota hari ini sudah habis. Bot memakai maintenance otomatis sampai **07:05 WIB** (00:05 UTC), lalu pulih sendiri.

---

## Malam ini (≈20 menit, 2 langkah kamu, sisanya saya)

**1. Kamu (5 menit)**

- Akun B → Workers & Pages: pastikan `workers.dev` subdomain aktif.
- Bikin API token akun B: scope **D1 Edit** + **Workers Scripts Edit**.
- Simpan ke `D:/projects/gatchawek-backups/account-b.env`:

```
CLOUDFLARE_API_TOKEN=...
DISCORD_PUBLIC_KEY=...      # sama dengan akun A (public key app)
DISCORD_BOT_TOKEN=...
ADMIN_PASSWORD=...          # password sementara buat /admin
ADMIN_SECRET=...            # string acak 32+ karakter
```

**2. Saya**

- `wrangler d1 create gatchawek-temp` di akun B → dapat `database_id`.
- Import dump hari ini ke D1 temp (`d1 execute --file`) → export balik → harus **2.003 baris** dan index `user_cards_card_idx` ada.
- Bikin `wrangler.temp.jsonc` (nama `gatchawek-temp`, D1 → akun B, **tanpa R2**, `PUBLIC_BASE_URL` tetap hostname A supaya gambar kartu & halaman share tetap dari A, `MAINTENANCE_UNTIL` diset ke masa lalu) → set secrets → `wrangler deploy -c wrangler.temp.jsonc`.
- Verifikasi URL B: `/health` 200, `/kartu/<id>` 200, `/admin` halaman login. **Tidak ada commit** — config temp tidak masuk repo.

**3. Kamu (2 menit)**

- Discord Developer Portal → Interactions Endpoint URL = `https://gatchawek-temp.<subdomain-B>.workers.dev/interactions` → Save. Verifikasi PING otomatis lolos.

**4. Saya + kamu**

- Saya cek `rows_read` D1 B masih kecil, lalu kamu tes 1 pull + `/koleksi` di server. Kalau keluar kartu & stamina kepotong → malam ini bot hidup.
- Saya hapus `account-b.env`. Token akun B kamu revoke nanti (bisa besok).

---

## Besok (>07:05 WIB, ≈15 menit)

**1. Saya**

- Export D1 B → dump final (otomatis diberi `PRAGMA foreign_keys=OFF;`).
- Di akun A: `wrangler d1 create gatchawek-main` → import dump → verifikasi jumlah baris + index cocok dengan B.
- `wrangler.jsonc`: `database_id` diganti ke DB baru → commit → PR → merge → deploy. Deploy ini sekaligus mencatat migration `0012` (yang tertunda) — `IF NOT EXISTS`, aman.

**2. Kamu (1 menit)**

- Discord Portal → endpoint URL **dibalikin** ke `https://gatchawek.yudistiraeka-pratama012.workers.dev/interactions`.

**3. Saya**

- Verifikasi: `/admin/cards` 200 (bukan maintenance), 1 pull, `rows_read` naik wajar.
- Hapus D1 temp + worker temp di akun B (atau biarkan 1 hari sebagai snapshot — kamu pilih).

---

## Jalur rollback (kalau ada yang gagal)

- **Gagal saat swap malam** → A masih menyajikan halaman maintenance, B belum dipakai siapa pun. Endpoint cukup tidak diubah. Tidak ada data tersentuh.
- **Gagal saat import besok** → endpoint tetap di B, bot tetap jalan; ulangi import nanti. Dump final masih ada di R2/lokal.
- **DB baru di A bermasalah** → balikkan `database_id` di `wrangler.jsonc` ke id lama (`gatchawek`), deploy. DB lama utuh berisi data sampai ~16:50 hari ini.

Satu catatan jujur: satu-satunya hal yang **tidak** bisa saya jamin adalah render gambar kartu dari panel admin malam ini — tombol render memanggil workflow GitHub yang masih menunjuk akun A, jadi render akan gagal sampai besok. Pull, koleksi, trade, battle, semua normal.

---

**Fakta pendukung yang sudah diuji hari ini:** dump produksi 830 KB berhasil diekspor **walau kuota baca habis** (`d1 export` lewat API export, bukan query biasa); dump itu sudah di-restore penuh ke D1 scratch — 2.003 baris, 16 tabel, index ikut; dan backup harian kini menyimpan dump yang bisa langsung diimpor (sebelumnya gagal `no such table: main.members` karena urutan tabel di dump).
