# 00 — README: Spec Pack "Gatchawek Arena" (nama kerja)

> Web card game multiplayer dari kartu meme tongkrongan. 1 engine, 3 mode:
> **Duel 1v1**, **Rebutan Takhta (FFA 3–6 pemain)**, **Raid Boss (Co-op 2–6 pemain)**.
> Deploy 100% di Cloudflare free tier. Dikerjakan oleh AI agent per fase.

## 1. Cara pakai pack ini

1. Taruh semua file ini di repo pada folder `docs/specs/` (pertahankan struktur `phases/`).
2. Agent **wajib** baca file ini + `TRACKER.md` di awal setiap sesi.
3. Jalankan prompt dari `PROMPTS.md` (Fase 0 → ulangi prompt Fase-N sampai semua DONE → Fase Final).
4. Satu sesi agent = satu fase. Progress disimpan di `TRACKER.md`, jadi sesi bisa dilanjutkan kapan saja.

## 2. Peta dokumen

| File | Isi |
|---|---|
| `01-GAME-DESIGN.md` | Aturan main semua mode, keyword, kondisi menang, edge case |
| `02-DATA-MODEL.md` | Skema D1, stat konstan per kartu, budget stat, efek (DSL), format katalog |
| `03-ARCHITECTURE.md` | Stack, struktur repo, Durable Objects, protokol WebSocket, budget free tier, keamanan |
| `TRACKER.md` | Status fase, checklist task, blocker, decision log (agent yang update) |
| `phases/PHASE-00…08` | Task, deliverable, verifikasi, Definition of Done per fase |
| `PROMPTS.md` | Prompt siap pakai: Fase 0, Fase-N (berulang), Fase Final |

## 3. Aturan emas (berlaku di semua fase)

1. **Engine murni & deterministik.** `packages/engine` tidak boleh import apa pun dari Cloudflare/DOM/IO. Semua keacakan lewat RNG ber-seed yang disimpan di state.
2. **Server authoritative.** Klien hanya kirim *niat* (action); server (Durable Object) memvalidasi dengan engine yang sama, lalu kirim *view* yang sudah difilter (tangan/deck lawan tidak pernah dikirim).
3. **Stat kartu konstan.** Tidak ada randomisasi stat. Satu kartu = satu stat tetap, disimpan di `game_cards` dan dibekukan per `content_version`.
4. **Free-tier friendly.** Tidak ada polling. WebSocket + Hibernation API. Katalog kartu di-bundle (bukan baca D1 tiap game). Detail di `03`.
5. **Mobile-first, portrait.** Mayoritas teman main lewat HP. UI tap-to-select → tap-target (drag & drop hanya bonus).
6. **UI berbahasa Indonesia**, semua string di satu file i18n. Identifier kode berbahasa Inggris.
7. **Kecil dan jalan dulu.** Tiap fase harus menghasilkan sesuatu yang bisa dijalankan dan dites, bukan setengah jadi.
8. **Jangan ubah tabel koleksi gacha yang sudah ada** (bot Discord masih memakainya). Hanya tambah tabel baru atau view, lewat alur Drizzle yang sama dengan bot.
9. Setiap perubahan aturan/skema yang menyimpang dari spec → catat di *Decision Log* `TRACKER.md` beserta alasannya.

## 4. Stack ringkas

**Satu repo dengan bot Discord yang sudah live.** Bot tetap di root dan tidak dipindah. Game ditambahkan sebagai folder `games/adu-batang/` (app React + Worker) dan `packages/*` (engine, shared, bots).

Sama dengan bot: TypeScript 5.9 strict tanpa `any` · pnpm · Hono · D1 + **Drizzle ORM + drizzle-kit** (database yang sama) · R2 bucket `CARDS` · Zod v4 di perbatasan · Vitest + miniflare · ESLint 10 · Sentry (`@sentry/cloudflare`) · wrangler 4 · env prod + staging.

Baru untuk game: React + Vite + Tailwind + Zustand + Framer Motion (frontend, disajikan lewat Workers Static Assets, satu Worker `adu-batang`) · Durable Objects SQLite-backed (room game) · Playwright (smoke e2e).

**Konvensi path:** di semua file spec, `arena/` berarti `games/adu-batang/`; `content/` berarti `games/adu-batang/content/` dan `scripts/` berarti `games/adu-batang/scripts/` (skrip offline game). `scripts/` di root repo milik pipeline render bot dan tidak disentuh.

## 5. Tugas yang hanya bisa dikerjakan pemilik (🧑)

Agent akan berhenti dan meminta ini lewat bagian *Blockers* di `TRACKER.md`:

- 🧑 Membuat Discord OAuth application (client id/secret, redirect URI).
- 🧑 Menyediakan ID/binding Cloudflare (D1, R2 bucket, akun) atau menjalankan `wrangler login`.
- 🧑 Review & approve CSV/JSON stat kartu (Fase 2) — ini **gate manusia** karena menyangkut kelucuan dan keadilan.
- 🧑 Mencari gambar untuk kartu spell/token/boss (placeholder emoji dipakai dulu).
- 🧑 Memutuskan nama final game dan nama 5 tingkat rarity (jika belum konsisten dengan bot).

## 6. Glosarium

| Istilah | Arti |
|---|---|
| Kartu koleksi | Kartu gacha yang sudah ada (tabel koleksi bot) |
| Kartu game (`game_card`) | Kartu dengan stat konstan untuk game ini; bisa menaut ke kartu koleksi lewat `source_card_id` |
| Creature | Kartu karakter yang ditaruh di meja (punya ATK/HP) |
| Spell | Kartu aksi sekali pakai (api, sapu, nasi padang…) |
| Token | Creature/spell yang hanya dihasilkan efek, tidak ada di deck |
| Series | Kelompok sinergi (mis. Aura, Alik, Abang) |
| Class | Peran mekanik: Penyerang, Tameng, Pendukung, Tukang Tipu, Absurd |
| Takhta | Mahkota di mode FFA, dipegang pemain dengan HP tertinggi |
| Intent | Aksi boss berikutnya yang ditampilkan ke pemain (mode Raid) |
| View | State game yang sudah difilter untuk satu pemain |
