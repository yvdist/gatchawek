# FASE 8 (FINAL) — Hardening, Audit Spec, dan Rilis

**Tujuan:** memastikan semuanya sesuai spec, aman, hemat free tier, nyaman di HP, terdokumentasi, lalu rilis ke tongkrongan. Fase ini **audit dan perbaikan**, bukan fitur baru (kecuali menutup celah yang ditemukan).

**Baca dulu:** seluruh pack spec, `TRACKER.md` (Temuan & utang teknis), semua Decision Log.

## Task

- [ ] **P8-T1 Audit kesesuaian spec.** Buat `docs/AUDIT.md`: tabel tiap persyaratan di `01`, `02`, `03` → status (✅ sesuai / ⚠️ menyimpang dengan alasan di Decision Log / ❌ belum) + lokasi kode/test. Perbaiki semua ❌ dan perbarui spec bila deviasi disengaja.
- [ ] **P8-T2 Audit keamanan.** Cek: validasi zod di semua pintu masuk, rate limit, kebocoran informasi tersembunyi (uji otomatis yang membandingkan payload WS lawan dengan state penuh), tiket WS satu-kali dan kedaluwarsa, cookie flags, CORS, rahasia tidak ada di repo (scan), injeksi SQL (semua query berparameter), pembatasan admin. Tulis `docs/SECURITY.md`.
- [ ] **P8-T3 Fuzz & ketahanan.** Fuzz pesan WS (JSON rusak, besar, urutan aneh), 2000 game simulasi di setiap mode tanpa exception atau state ilegal, uji chaos: putus koneksi acak, restart DO di tengah game (state pulih), alarm ganda.
- [ ] **P8-T4 Uji beban free tier.** Skrip yang mensimulasikan 30 room bersamaan (campur mode) selama 10 menit di staging; ukur request DO, pesan, durasi, lalu ekstrapolasi ke batas harian (`03` §6). Tulis `docs/CAPACITY.md` berisi perkiraan jumlah match/hari yang aman dan peringatan ambang 70% di `/admin`. Jika terlalu dekat batas: optimasi (batching broadcast, kurangi pesan, hapus room lebih cepat).
- [ ] **P8-T5 Balancing pass 2.** Jalankan ulang simulasi semua mode dengan katalog terbaru, gabungkan catatan playtest, setel kartu/boss yang bermasalah (naikkan `content_version`, review pemilik 🧑 untuk perubahan besar).
- [ ] **P8-T6 QA perangkat.** Daftar periksa di Chrome Android, Safari iOS, desktop; layar 360/390/430px; koneksi lambat (throttle 3G); background tab lalu kembali (reconnect); layar mati lalu hidup. Perbaiki bug, catat sisanya.
- [ ] **P8-T7 Polesan UX.** Tutorial singkat interaktif 1 menit (Duel dasar), tooltip keyword, teks error ramah (Bahasa Indonesia), state kosong yang lucu, loading skeleton, tombol "Lapor masalah" (membuka tautan Discord/Google Form).
- [ ] **P8-T8 Performa.** Ukuran bundle web < 400 KB gzip (selain gambar), gambar kartu thumbnail + lazy, cache header R2, Lighthouse mobile ≥ 85 di beranda dan lobby.
- [ ] **P8-T9 Dokumentasi.** `README.md` utama (deskripsi, cara jalan lokal, deploy, struktur), `docs/RUNBOOK.md` (cara rilis, rollback, menaikkan `content_version`, menambah kartu/boss baru, apa yang dilakukan bila kuota habis, cara menonaktifkan mode), `docs/CONTENT-GUIDE.md` (alur menambah kartu: seed → generator → validator → review → ekspor katalog → deploy).
- [ ] **P8-T10 Cadangan data.** Ekspor D1 terjadwal/manual (skrip `pnpm backup:d1`) dan catatan pemulihan di RUNBOOK.
- [ ] **P8-T11 Daftar periksa rilis.** `docs/LAUNCH-CHECKLIST.md`: domain/URL, secret produksi, Discord redirect URI produksi, migrasi D1 produksi, katalog final, backup, monitor kuota, rencana rollback, pengumuman ke grup (teks siap tempel).
- [ ] **P8-T12 Rilis produksi.** 🧑 Deploy produksi (agent menyiapkan perintah dan memverifikasi), smoke test produksi (satu Duel, satu FFA, satu Raid dengan bot), tag `v1.0.0`.
- [ ] **P8-T13 Retrospektif.** Perbarui `TRACKER.md`: ringkasan akhir, utang teknis, dan `docs/ROADMAP.md` berisi ide lanjutan (2v2, Discord Activity untuk main dari dalam voice channel, turnamen, musim, kartu event, mode "Quiz meme", replay).

## Verifikasi
- `docs/AUDIT.md` tanpa ❌.
- Tidak ada rahasia di riwayat git (scan).
- Uji beban memperlihatkan margin ≥ 30% dari batas harian pada beban target.
- Smoke produksi lolos untuk ketiga mode.

## Definition of Done
Semua task tercentang, audit bersih, dokumentasi lengkap, rilis `v1.0.0` berjalan di produksi, `TRACKER.md` semua fase DONE, ringkasan akhir ditulis.
