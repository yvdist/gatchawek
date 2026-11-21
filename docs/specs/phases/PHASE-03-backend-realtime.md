# FASE 3 — Backend, Auth, Realtime

**Tujuan:** dua klien (script/Playwright) bisa login, bikin/join room lewat kode, lalu memainkan satu Duel penuh lewat WebSocket dengan state di Durable Object. Belum ada UI cantik.

**Baca dulu:** `03-ARCHITECTURE.md` §2–8, `01-GAME-DESIGN.md` §3.2.

## Task

- [ ] **P3-T1 Auth Discord.** `/api/auth/login` → redirect OAuth, `/api/auth/callback` → buat/ambil `users`, cookie sesi JWT. `/api/me`, `/api/auth/logout`. Mode dev: login palsu lewat env `DEV_AUTH=1` agar test mudah. 🧑 butuh kredensial Discord untuk uji nyata.
- [ ] **P3-T2 Rute REST dasar.** `POST /api/rooms` (buat room, kode 6 karakter tanpa huruf ambigu), `GET /api/rooms/:code`, `POST /api/rooms/:code/ticket`, `GET /api/decks`, `POST/PUT/DELETE /api/decks` (validasi Deck Budget di server memakai fungsi dari `shared`), `GET /api/catalog/version`.
- [ ] **P3-T3 Protokol.** Skema zod semua pesan `03` §4 di `packages/shared`, ukuran maks 4 KB, tipe dipakai bersama klien/server.
- [ ] **P3-T4 `GameRoom` DO.** Lobby (kursi, host, ready, pilih deck/blind), mulai game, `mulligan`, `action` → `applyAction`, broadcast `events+view` per pemain, penyimpanan state SQLite tiap action, restore setelah hibernasi, timer via alarm (`runTimeout`), AFK 3x → bot pengganti, `surrender`, `leave`.
- [ ] **P3-T5 Reconnect.** Koneksi baru menggantikan yang lama, menerima `snapshot`, pemain tidak kehilangan giliran; uji dengan memutus paksa socket.
- [ ] **P3-T6 Rate limit & validasi.** Token bucket per koneksi, `seq` dedup, kode error konsisten.
- [ ] **P3-T7 Akhir match.** Tulis `matches`, `match_players` ke D1 satu batch; Elo untuk format ranked (stub rating fungsi di `shared`, dipakai ulang Fase 7); buat `rewards` EXP dasar.
- [ ] **P3-T8 Blind Deck generator.** Fungsi di engine/shared: 20 kartu acak yang lolos Deck Budget, seimbang class (min 6 creature), seed dari room.
- [ ] **P3-T9 Matchmaker DO (versi sederhana).** Antrean ranked Duel, pasangkan 2 pemain, buat room dan kirim kode. Cukup FIFO dulu.
- [ ] **P3-T10 Klien uji (script).** `scripts/ws-client` yang memainkan satu Duel penuh bot-vs-bot lewat WebSocket sungguhan (dua koneksi) sampai selesai.
- [ ] **P3-T11 Test DO.** Dengan `vitest-pool-workers`/Miniflare: alur lobby → game → selesai; reconnect; timer alarm; hibernasi (restore state).
- [ ] **P3-T12 Penghitung penggunaan.** Counter sederhana request/pesan harian di DO/KV yang bisa dilihat di `/api/admin/usage` (dilindungi).
- [ ] **P3-T13 Deploy staging.** Deploy ke Cloudflare (workers.dev) dan jalankan `ws-client` terhadap staging. 🧑 mungkin perlu login wrangler.

## Verifikasi
- `pnpm check` hijau; test DO lolos.
- `scripts/ws-client` menyelesaikan satu duel di lokal dan staging.
- Pesan hasil `viewFor` lawan di jaringan tidak memuat tangan/deck lawan (periksa payload mentah di test).

## Definition of Done
Alur server lengkap untuk Duel berjalan end-to-end, penyimpanan hasil ke D1 benar, tidak ada polling, DO memakai Hibernation API, status Fase 3 = DONE.
