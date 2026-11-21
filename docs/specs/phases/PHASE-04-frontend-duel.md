# FASE 4 — Frontend Inti + Duel Playable

**Tujuan:** teman-teman bisa membuka web, login Discord, membuat/join room, dan bermain Duel dengan UI yang enak di HP. Ini milestone "game benar-benar bisa dimainkan".

**Baca dulu:** `03-ARCHITECTURE.md` §9, `01-GAME-DESIGN.md` §3–4, `02-DATA-MODEL.md` §7.

## Task

- [ ] **P4-T1 Fondasi UI.** Tailwind, tema gelap bernuansa kartu (ungu/biru/cyan seperti frame kartu sekarang), font, i18n `id` (semua string di satu file), layout mobile-first portrait, `viewport-fit`, PWA manifest sederhana (bisa "Add to Home Screen").
- [ ] **P4-T2 Komponen `<Card/>`.** Render frame ala kartu sekarang (art dari R2, nama, rarity bintang, series label, nomor), ditambah lencana **Cost** (kiri atas), **ATK** (kiri bawah), **HP** (kanan bawah), nama ability + teks, ikon keyword. Varian: `hand`, `board`, `detail`, `mini`. Placeholder bila `art_key` null. Halaman galeri dev `/dev/cards` untuk melihat semua kartu.
- [ ] **P4-T3 Auth & beranda.** Tombol Login Discord, profil singkat, menu: Main Duel, Latihan vs Bot, Deck, (mode lain tampil "segera").
- [ ] **P4-T4 Lobby.** Buat room, bagikan kode/tautan (`/lobby/ABC123`), daftar pemain, pilih deck atau Blind Deck, tombol Siap, host mulai.
- [ ] **P4-T5 Klien WebSocket.** Koneksi dengan tiket, reconnect otomatis dengan backoff, indikator koneksi, `resync` bila versi tidak cocok.
- [ ] **P4-T6 Layar Duel.** Meja lawan (atas) dan meja sendiri (bawah), HP/mana, tangan, deck count, timer ring, tombol Akhiri Giliran. Interaksi tap-pilih-kartu → highlight target legal (dari `legalActions`) → tap target. Long-press untuk detail kartu. Layar Mulligan.
- [ ] **P4-T7 Animasi dari `events`.** Antrean animasi: tarik, mainkan, serang, damage angka melayang, mati, buff. Animasi bisa dipercepat/dilewati; state akhir selalu dari `view`, animasi hanya kosmetik.
- [ ] **P4-T8 Event log & emote.** Log aksi singkat, 8 emote lucu (rate-limited).
- [ ] **P4-T9 Deck builder v1.** Daftar kartu (virtualized, filter rarity/class/series/cost, cari), bangun deck 20 kartu dengan validasi Deck Budget live, simpan beberapa deck, 3 **starter deck** siap pakai. (Kepemilikan belum diwajibkan; Fase 7.)
- [ ] **P4-T10 Latihan vs Bot.** Opsi main melawan bot (`easy`/`normal`) — bot berjalan di dalam `GameRoom` yang sama.
- [ ] **P4-T11 Layar akhir.** Menang/kalah, ringkasan match, tombol "Main lagi".
- [ ] **P4-T12 Playwright smoke.** Dua konteks browser bermain satu Duel sampai selesai di staging/lokal.
- [ ] **P4-T13 Deploy + uji nyata.** Deploy Worker `arena` (staging lalu prod) yang menyajikan frontend, uji di HP sungguhan (Chrome Android + Safari iOS). Perbaiki masalah layout/touch.

## 🧑 Playtest
Ajak 2–3 teman main 5 match. Kumpulkan catatan (bingung di mana, kartu terlalu kuat, bug) ke `TRACKER.md` → Temuan.

## Verifikasi
- Lighthouse mobile: performa ≥ 80 di beranda.
- Tidak ada layout patah di lebar 360px.
- Playwright smoke lolos.
- Payload WS tidak berisi informasi tersembunyi (cek di DevTools).

## Definition of Done
Duel playable 2 pemain online di HP, deck builder + starter deck bekerja, latihan vs bot bekerja, hasil playtest dicatat, status Fase 4 = DONE.
