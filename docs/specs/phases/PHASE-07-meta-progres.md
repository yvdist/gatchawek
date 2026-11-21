# FASE 7 — Meta, Progres, Ranked, Reward

**Tujuan:** menghubungkan game dengan gacha (kepemilikan, reward), menambah alasan untuk kembali main (rating, quest, riwayat), dan melengkapi mode bonus.

**Baca dulu:** `02-DATA-MODEL.md` §2 (rewards, ratings), `01-GAME-DESIGN.md` §3.4 dan §7, `PROJECT_STATE.md`.

## Task

- [ ] **P7-T1 Kepemilikan kartu.** Deck builder dan validasi server hanya mengizinkan kartu yang dimiliki (via `v_owned_cards`), maks `min(2, salinan dimiliki)`. Spell dan token tersedia untuk semua. Tambahkan **toggle room**: `ownership_required` (default ON di Ranked, OFF di Santai/Blind) agar tamu atau teman baru tetap bisa ikut. Starter deck tetap tersedia bagi pemain baru.
- [ ] **P7-T2 Kartu belum dimiliki.** Di deck builder tampilkan kartu terkunci (siluet + cara mendapatkan: gacha di Discord), tidak disembunyikan, supaya memicu keinginan mengoleksi.
- [ ] **P7-T3 Ranked Duel.** Elo K=32 start 1000 dengan Matchmaker (rentang rating melebar seiring waktu tunggu), musim (`season`) sederhana, halaman `/leaderboard` (top 50, di-cache 60 dtk), badge tier (mis. Kroco → Sepuh).
- [ ] **P7-T4 Jembatan reward ke bot Discord.** `rewards` dibaca bot: EXP otomatis ditambahkan ke EXP gacha, tiket gacha dipakai untuk `/gacha`, salinan kartu masuk koleksi. Implementasi di sisi bot **dengan perubahan minimal dan terisolasi** (atau endpoint klaim di web jika mengubah bot terlalu berisiko). Idempoten, ada log. 🧑 persetujuan pemilik karena menyentuh bot.
- [ ] **P7-T5 Quest harian.** 3 quest acak sederhana (main 1 match, menang 1 duel, pakai 5 spell, selesaikan 1 raid) → reward kecil (tiket). Reset 00:00 WIB. Disimpan di D1 (tabel baru, migrasi 0005).
- [ ] **P7-T6 Riwayat match.** Daftar 20 match terakhir (mode, hasil, perubahan rating), detail ringkas. Tidak menyimpan replay penuh di MVP (hemat D1).
- [ ] **P7-T7 Blind Pick Cepat.** Best-of-3 dengan Blind Deck seimbang, antrean cepat; menyelaraskan nama dan nuansa dengan "Blind Pick" di bot.
- [ ] **P7-T8 Profil.** Statistik per mode, kartu favorit (paling sering dimainkan), koleksi (jumlah/total), rating.
- [ ] **P7-T9 Kosmetik ringan.** Card back dan emote tambahan sebagai reward/pilihan (data statis di katalog kosmetik, tanpa pay).
- [ ] **P7-T10 Bagikan.** Tombol bagikan hasil match/boss ke WhatsApp (kartu OG image statis atau teks + tautan), mengikuti kebiasaan "Share ke WA" di bot.
- [ ] **P7-T11 Admin ringan 🧑.** Halaman `/admin` (dilindungi daftar Discord ID admin): lihat penggunaan free tier, nonaktifkan kartu (`retired`) tanpa deploy ulang memerlukan katalog baru — cukup tandai untuk rilis berikutnya, atur pengumuman.
- [ ] **P7-T12 Pengumuman Discord (opsional).** Webhook Discord: hasil raid, juara musim. Opsional dan tidak boleh memblokir alur game bila gagal.
- [ ] **P7-T13 Test.** Elo (properti: jumlah rating konservatif), kepemilikan (tidak bisa curang dengan deck tak dimiliki), idempotensi reward, reset quest zona waktu WIB.

## Verifikasi
- Pemain tanpa kartu tertentu tidak bisa membawa kartu itu ke Ranked (test server).
- Reward dari match muncul di bot tanpa duplikasi setelah 3x percobaan klaim.
- Leaderboard dan profil tidak memanggil D1 berlebihan (cache bekerja).

## Definition of Done
Ranked jalan, kepemilikan terhubung ke gacha, reward bolak-balik dengan bot aman dan idempoten, quest dan riwayat bekerja, mode bonus aktif, status Fase 7 = DONE.
