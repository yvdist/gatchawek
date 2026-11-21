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
- [ ] P0-T4 Skrip `pnpm check`
- [ ] P0-T5 Konfigurasi Cloudflare
- [ ] P0-T6 DO "ping-pong"
- [ ] P0-T7 Schema Drizzle & migrasi baru
- [ ] P0-T8 CI minimal
- [ ] P0-T9 `.env.example` & README repo
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
| | | | |

## Decision Log

| Tanggal | Fase | Keputusan | Alasan | Dampak ke spec |
|---|---|---|---|---|
| 2026-11-21 | 0 | Lokasi spec pack = `docs/specs/` (bukan `docs/`), folder game = `games/adu-batang/` (bukan `arena/`). | Spec pack disalin owner ke `docs/`, folder game sudah disiapkan bernama `games/adu-batang`; prompt fase di `PROMPTS.md` menunjuk `docs/specs/`. Salinan duplikat `games/adu-batang/game-specs/` dihapus setelah diverifikasi identik (`diff -rq` kosong) agar tidak ada dua sumber kebenaran. | Semua path `arena/` di `03-ARCHITECTURE.md` §1 dibaca sebagai `games/adu-batang/`; `docs/specs/` menjadi lokasi canonical pack. |
| 2026-11-21 | 0 | Satu repo bersama bot (keputusan owner): bot tetap di root (`src/`, `scripts/`, `migrations/`, `wrangler.jsonc`, `package.json`), game di `games/adu-batang/` + `packages/*`. **Tidak ada file bot yang dipindah atau diubah.** | Diminta spec `03` §1 dan sudah diputuskan owner sebelum fase dimulai; diverifikasi `git diff --stat HEAD~1 -- src scripts migrations wrangler.jsonc package.json shared drizzle.config.ts pnpm-workspace.yaml` kosong. | `pnpm-workspace.yaml` diubah hanya untuk menambah `packages` (root tetap paket bot); perintah bot lama tetap berlaku. |

## Temuan & utang teknis

- **Kuota baca D1** free tier (100k row read/hari) sudah pernah habis dan memblokir recon produksi hari ini (`code 7500`).
  Jumlah kartu D1 **produksi** belum terverifikasi; angka di `PROJECT_STATE.md` berasal dari manifest + lock file. Verifikasi ulang setelah 00:00 UTC.
- `pools.hidden=1` pada pool `pejabat`: perlu keputusan (Decision Log Fase 2) apakah kartu pool hidden boleh dipakai sebagai kartu game.
- Foto mentah kartu hanya ada di `assets/raw/` (gitignored, tidak di R2), jadi `art_key` game harus memakai objek R2 hasil render (`cards.image_file`).
- `users` bot memakai Discord ID sebagai PK; tabel `users` game di spec memakai uuid + `discord_id`. Adapter wajib (Fase 3/7).
