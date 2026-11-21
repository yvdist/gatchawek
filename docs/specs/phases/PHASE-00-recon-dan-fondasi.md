# FASE 0 — Recon & Fondasi Repo

**Tujuan:** memahami apa yang *sudah ada* (bot Discord, D1, R2), lalu menyiapkan monorepo, tooling, dan kerangka kosong yang bisa build/test/deploy. Belum ada logika game.

**Baca dulu:** `00-README.md`, `02-DATA-MODEL.md` §1–2, `03-ARCHITECTURE.md` §1–2.

## Task

- [ ] **P0-T1 Recon repo & data lama.** Telusuri repo yang ada (bot, skrip, migrasi). Tulis `docs/PROJECT_STATE.md` berisi: nama tabel D1 koleksi/kepemilikan/EXP/gacha beserta kolomnya, struktur key R2 gambar kartu, apakah foto mentah masih tersimpan, daftar field kartu (rarity, grup, judul, nomor), jumlah kartu per rarity dan per grup, cara bot memberi reward. **Jangan ubah apa pun di tabel lama.**
- [ ] **P0-T2 Keputusan repo (SUDAH DIPUTUSKAN pemilik).** Game dikerjakan di **repo bot yang sama**, bot tetap di root, game di `arena/` + `packages/*`. Catat di Decision Log beserta konfirmasi bahwa file bot tidak dipindah.
- [ ] **P0-T3 Scaffold workspace.** Tambah `pnpm-workspace.yaml` (`arena`, `packages/*`) tanpa merusak bot (root tetap paket bot, perintah bot lama tetap jalan: verifikasi `pnpm test` bot hijau sebelum dan sesudah). Buat `arena/` (React + Vite + Tailwind + `@cloudflare/vite-plugin`, Worker Hono di `arena/src/server`), `packages/{engine,shared,bots}`. Samakan versi TypeScript 5.9 / ESLint 10 / Vitest / wrangler 4 dengan root; reuse konfigurasi ESLint (strict, tanpa `any`) dan project references.
- [ ] **P0-T4 Skrip `pnpm check`.** typecheck + lint + test + `validate-content` (stub dulu). Harus hijau di repo kosong.
- [ ] **P0-T5 Konfigurasi Cloudflare.** `arena/wrangler.jsonc` dengan env `staging` dan `production` (pola sama dengan bot), binding D1 **yang sama dengan bot** (staging↔staging, prod↔prod), R2 `CARDS` (read) , dan dua kelas Durable Object (`GameRoom`, `Matchmaker`) berbackend **SQLite** (cek sintaks migrasi/`exports` versi Wrangler terpasang). Workers Static Assets untuk frontend (SPA fallback). Endpoint `GET /api/health`. Halaman "Hello" bahasa Indonesia. Pasang Sentry `@sentry/cloudflare`.
- [ ] **P0-T6 DO "ping-pong".** `GameRoom` menerima WebSocket via Hibernation API dan membalas echo; ada test lokal. Ini bukti arsitektur realtime jalan sebelum fase berikutnya.
- [ ] **P0-T7 Schema Drizzle & migrasi baru.** Tambahkan tabel game (`02` §2) sebagai schema Drizzle di repo bot (file schema terpisah yang di-export bersama schema lama), generate migrasi dengan `drizzle-kit`, jalankan di D1 lokal lalu **staging**. Hanya additive. Buat fungsi query read-only `getOwnedCards(userId)` di atas tabel kepemilikan lama (lapisan `db/queries`). Verifikasi bahwa test bot tetap hijau.
- [ ] **P0-T8 CI minimal.** GitHub Actions: install, `pnpm check`. (Deploy manual dulu.)
- [ ] **P0-T9 `.env.example` & README repo.** Cara menjalankan lokal (`pnpm dev`), daftar secret, langkah deploy.
- [ ] **P0-T10 Salin task fase ke `TRACKER.md`** dan isi ringkasan temuan recon.

## 🧑 Tindakan pemilik yang mungkin dibutuhkan
`wrangler login` / ID akun Cloudflare, ID D1 & R2 staging (jika belum ada di `wrangler.jsonc` bot), konfirmasi memakai aplikasi Discord yang sama atau baru.

## Verifikasi
- `pnpm install && pnpm check` hijau dari clone bersih.
- `pnpm --filter arena dev` → `/api/health` OK; klien WS contoh bisa echo ke `GameRoom`.
- `docs/PROJECT_STATE.md` memuat skema tabel lama dengan nama kolom nyata (bukan tebakan).

## Definition of Done
Semua task tercentang, `pnpm check` hijau, `PROJECT_STATE.md` ada, tabel lama tak tersentuh (migrasi baru hanya additive, test bot tetap hijau, tidak ada file bot yang dipindah), status Fase 0 = DONE di `TRACKER.md`.
