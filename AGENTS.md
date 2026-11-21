# Project Rules & Architecture Guidelines

## 1. Source of Truth
- Source of truth is the code plus `Guide_Tambah_Data_Kartu_Cepat.md` (card-data guide). The old `docs/Spec_*` Phase 1–5 spec is retired; do not treat it as binding.
- Work incrementally per task; do not widen scope before the active task's acceptance criteria pass.

## 2. Extensibility & Data-Driven Design
- Bot ini dirancang untuk menampung banyak kategori kartu (`pools`) yang dapat terus bertambah di masa depan tanpa mengubah kode aplikasi.
- Dilarang melakukan hardcode nama/ID pool di dalam logika bisnis, handler command, maupun custom ID komponen tombol.
- Gunakan mekanisme Discord Command Autocomplete (query dinamis ke tabel `pools` / `sub_groups`) untuk opsi pemilihan pool agar ekspansi kategori baru di masa depan tidak memerlukan registrasi ulang slash command.

## 3. Strict Layering & TypeScript Rules
- Dilarang menggunakan tipe `any` atau `@ts-ignore`.
- Pertahankan pemisahan layer secara ketat:
  - `src/domain/`: Fungsi murni (kalkulasi stamina, RNG rarity, validasi trade). Dilarang mengimpor modul database atau Hono di layer ini.
  - `src/db/queries/`: Seluruh query Drizzle ORM dan operasi `db.batch()`.
  - `src/discord/`: Adapter HTTP interactions, builder embed, dan parsing payload.
- Seluruh mutasi state kritis (tarik kartu, reset kuota, settlement trade) wajib bersifat atomik menggunakan `db.batch()` dengan optimistic locking (`version` atau `settle_token`).

## 4. Verification Before Finishing a Task
Sebelum melakukan commit dan menyatakan satu fase selesai, wajib jalankan dan pastikan lulus:
1. `npm run typecheck` (atau `tsc --noEmit`)
2. `npm test` (unit & integration test)
3. `npm run lint`

- **Mulai Tugas (Branching):** Sebelum menulis atau mengubah kode apa pun, wajib pastikan berada di `main`, jalankan `git pull origin main`, lalu buat dan pindah ke branch baru dengan format `<tipe>/<deskripsi-singkat>` (contoh: `feat/dismantle-melt-points`). Dilarang bekerja atau commit langsung ke branch `main`.
- **Selesai Tugas (PR & Merge via `gh`):** Setelah push, JANGAN berhenti di branch — selalu selesaikan sampai merge agar tidak ada PR menggantung yang harus dibuat manual:
  1. `gh pr create --title "<commit-subject>" --body "<ringkasan AC + hasil verifikasi>"` (atau `gh pr create --fill` bila commit message sudah lengkap).
  2. Tunggu CI/checks bila ada (`gh pr checks --watch`), pastikan hijau sebelum merge.
  3. `gh pr merge --squash --delete-branch` (squash = satu commit per fase, konsisten dengan aturan satu-commit-per-fase).
  4. Kembali ke `main` dan sinkron: `git checkout main && git pull origin main`, lalu verifikasi `git status` bersih.
- **Keamanan Secret:** Pastikan file `.dev.vars`, `.env`, dan kredensial rahasia lainnya masuk ke dalam `.gitignore` dan tidak pernah ikut ter-commit.

## 6. Changelog Channel Language (English-only) & PR-Body Hygiene
- Semua pesan yang diposting ke channel Discord `#bot-changelog` wajib berbahasa Inggris (judul, isi, footer, label link) agar terlihat profesional.
- Berlaku untuk `.github/workflows/notify-changelog.yml` dan `.github/workflows/announce-deploy.yml`; jangan masukkan nama repo ke teks pesan (URL commit dibungkus link markdown `view commit`).
- **PR-body hygiene (semua agent: OMP, Antigravity, Gemini, Claude, dsb.):** notifikasi changelog otomatis mengambil ringkasan + highlight dari body PR via `gh pr view`. Agar hasilnya bagus, setiap PR body WAJIB memuat:
  1. Paragraf pertama = ringkasan English 1-3 kalimat (jadi field 📌 Summary).
  2. Daftar bullet `-` = poin perubahan penting English (jadi field ✨ Highlights, maks 4 diambil).
  3. Bahasa Inggris; tanpa nama repo di teks.
- Jika PR di-merge tanpa body yang layak, workflow otomatis fallback ke daftar commit polos.
