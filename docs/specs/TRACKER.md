# TRACKER — Status Pengerjaan

> File ini di-update **oleh agent** di akhir setiap task dan setiap fase. Jangan hapus riwayat.
> Status fase: `TODO` · `IN_PROGRESS` · `BLOCKED` · `DONE`

## Ringkasan fase

| Fase | Nama | Status | Selesai pada | Catatan |
|---|---|---|---|---|
| 0 | Recon & Fondasi Repo | IN_PROGRESS | | Dikerjakan di branch `feat/phase-0-recon-fondasi`. |
| 1 | Engine Inti + Mode Duel | TODO | | |
| 2 | Konten Kartu & Balancing | TODO | | |
| 3 | Backend, Auth, Realtime | TODO | | |
| 4 | Frontend Inti + Duel Playable | TODO | | |
| 5 | Mode Rebutan Takhta (FFA) | TODO | | |
| 6 | Mode Raid Boss (Co-op) | TODO | | |
| 7 | Meta, Progres, Ranked, Reward | TODO | | |
| 8 | FINAL: Hardening & Rilis | TODO | | |

## Aturan update (untuk agent)

- Centang task `[x]` hanya setelah verifikasinya lulus (`pnpm check` hijau + verifikasi spesifik task).
- Tulis tanggal dan ringkasan 1–3 kalimat saat menyelesaikan fase.
- Ubah status fase menjadi `IN_PROGRESS` saat mulai, `DONE` hanya jika seluruh *Definition of Done* terpenuhi.
- Jika butuh tindakan pemilik, ubah status menjadi `BLOCKED` dan tulis di **Blockers**.

## Checklist task per fase

(Agent menyalin daftar task dari file fase ke sini saat memulai fase tersebut, format `- [ ] P1-T3 judul singkat`.)

### Fase 0
- [x] P0-T1 Recon repo & data lama → `docs/PROJECT_STATE.md`
- [x] P0-T2 Keputusan repo (satu repo, `games/adu-batang` + `packages/*`)
- [x] P0-T3 Scaffold workspace
- [x] P0-T4 Skrip `pnpm check`
- [x] P0-T5 Konfigurasi Cloudflare
- [x] P0-T6 DO "ping-pong"
- [ ] P0-T7 Schema Drizzle & migrasi baru — **lokal ✅** (`0014_game_tables.sql` applied, 8 tabel); **staging tertunda**: kuota baca D1 akun habis (lihat Blockers)
- [x] P0-T8 CI minimal — `.github/workflows/check.yml` (install + `pnpm check`, PR & branch non-main); deploy tetap manual
- [x] P0-T9 `.env.example` & README repo — `games/adu-batang/.dev.vars.example` + bagian "Game — Adu Batang" di `README.md` (perintah, secret, deploy staging/prod, CI)
- [ ] P0-T10 Salin task fase ke `TRACKER.md` + ringkasan temuan

### Fase 1
- [ ] (diisi agent)

### Fase 2
- [ ] (diisi agent)

### Fase 3
- [ ] (diisi agent)

### Fase 4
- [ ] (diisi agent)

### Fase 5
- [ ] (diisi agent)

### Fase 6
- [ ] (diisi agent)

### Fase 7
- [ ] (diisi agent)

### Fase 8
- [ ] (diisi agent)

## Blockers (butuh pemilik 🧑)

| Tanggal | Fase | Kebutuhan | Status |
|---|---|---|---|
| 2026-11-21 | 0 | Kuota **row read D1 free tier** akun habis sampai 00:00 UTC (07:00 WIB) — semua SELECT remote (termasuk bookkeeping migrasi) ditolak `code 7500`. Setelah reset, jalankan: `pnpm exec wrangler d1 migrations apply DB --env staging --remote` (menambah 8 tabel game ke staging; additive). Tidak perlu ubah kode. Opsi lain: upgrade plan D1 atau tunggu besok. | MENUNGGU |

## Decision Log

| Tanggal | Fase | Keputusan | Alasan | Dampak ke spec |
|---|---|---|---|---|
| 2026-11-21 | 0 | Lokasi spec pack = `docs/specs/` (bukan `docs/`), folder game = `games/adu-batang/` (bukan `arena/`). | Spec pack disalin owner ke `docs/`, folder game sudah disiapkan bernama `games/adu-batang`; prompt fase di `PROMPTS.md` menunjuk `docs/specs/`. Salinan duplikat `games/adu-batang/game-specs/` dihapus setelah diverifikasi identik (`diff -rq` kosong) agar tidak ada dua sumber kebenaran. | Semua path `arena/` di `03-ARCHITECTURE.md` §1 dibaca sebagai `games/adu-batang/`; `docs/specs/` menjadi lokasi canonical pack. |
| 2026-11-21 | 0 | Identitas game memakai tabel baru `game_profiles` (PK `user_id` → `users.id`), **bukan** tabel `users` baru seperti spec `02` §2. | `users` sudah ada di bot dengan PK = Discord id dan tabel lama tidak boleh diubah; membuat `users` kedua butuh sinkronisasi identitas yang tidak perlu. | `02-DATA-MODEL.md` §2 diperbarui; semua `user_id` game menunjuk `users.id`. |
| 2026-11-21 | 0 | Migrasi game ditulis sebagai `migrations/0014_game_tables.sql`, dan metadata Drizzle (`migrations/meta`) dirapikan: journal 0005–0013 direkonstruksi, snapshot 0013 (bot saja) + 0014 (lengkap) ditambahkan. | Journal/meta di repo hanya sampai 0004 padahal SQL 0005–0013 sudah ada, sehingga `drizzle-kit generate` membuat `0005_*` yang menabrak nomor lama dan mencoba membuat ulang tabel yang sudah ada. Setelah perbaikan, `drizzle-kit generate` melaporkan tidak ada perubahan schema. | Tidak ada SQL lama yang diubah; `drizzle.config.ts` sekarang memuat `schema.ts` + `schema-game.ts`. |
| 2026-11-21 | 0 | Kolom enum (`kind`, `class`, `status`, `mode`, `kind` reward) dijaga TypeScript + Zod; hanya `rarity`/`cost` yang memakai `CHECK` SQL. | Mengikuti pola schema bot (`text(..., { enum })` tanpa CHECK); CHECK non-numerik tidak bisa ditambah belakangan tanpa recreate tabel. | Sedikit menyimpang dari SQL referensi `02` §2; validasi runtime tetap dilakukan di perbatasan. |
| 2026-11-21 | 0 | Satu repo bersama bot (keputusan owner): bot tetap di root (`src/`, `scripts/`, `migrations/`, `wrangler.jsonc`, `package.json`), game di `games/adu-batang/` + `packages/*`. **Tidak ada file bot yang dipindah atau diubah.** | Diminta spec `03` §1 dan sudah diputuskan owner sebelum fase dimulai; diverifikasi `git diff --stat HEAD~1 -- src scripts migrations wrangler.jsonc package.json shared drizzle.config.ts pnpm-workspace.yaml` kosong. | `pnpm-workspace.yaml` diubah hanya untuk menambah `packages` (root tetap paket bot); perintah bot lama tetap berlaku. |

## Temuan & utang teknis

- **Kuota baca D1** free tier (100k row read/hari) sudah pernah habis dan memblokir recon produksi hari ini (`code 7500`).
  Jumlah kartu D1 **produksi** belum terverifikasi; angka di `PROJECT_STATE.md` berasal dari manifest + lock file. Verifikasi ulang setelah 00:00 UTC.
- `pools.hidden=1` pada pool `pejabat`: perlu keputusan (Decision Log Fase 2) apakah kartu pool hidden boleh dipakai sebagai kartu game.
- Foto mentah kartu hanya ada di `assets/raw/` (gitignored, tidak di R2), jadi `art_key` game harus memakai objek R2 hasil render (`cards.image_file`).
- `users` bot memakai Discord ID sebagai PK; identitas game ada di `game_profiles` (lihat Decision Log) — adapter Fase 3/7 memakai `users.id` langsung.
- **Migrasi staging belum dijalankan** (kuota D1 habis hari ini); lokal sudah. Lihat Blockers.
- Bundle Worker game 602 KiB (159 KiB gzip) karena `@sentry/cloudflare`; batas Workers free 3 MiB — masih longgar, pantau tiap fase.
- `migrations/meta` bot sempat tertinggal (0005–0013 tanpa snapshot); sudah direkonstruksi Fase 0. Jangan menulis SQL migrasi manual lagi.
- `getOwnedCards` sengaja tidak join `cards`/`pools` (hemat query baca); penyaringan pool hidden/disabled dilakukan pemanggil saat menyusun deck.
