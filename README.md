# gatchawek

Discord photocard gacha bot — Cloudflare Workers + Hono + D1 + Drizzle, HTTP Interactions (tanpa Gateway).

## Fase 0 — Fondasi

### Prasyarat manual (user)

Buat aplikasi di Discord Developer Portal; catat Application ID dan Public Key; buat bot token; undang bot ke
server dengan scope `applications.commands` dan `bot`; catat Guild ID. Jalankan `wrangler login`.

### Variabel environment

| File | Variabel | Dipakai oleh |
| --- | --- | --- |
| `.dev.vars` (gitignored, salin dari `.dev.vars.example`) | `DISCORD_PUBLIC_KEY`, `PUBLIC_BASE_URL`, `DISCORD_BOT_TOKEN` | runtime Worker (`wrangler dev` / `deploy`) |
| `.env` lokal (gitignored) | `DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN`, `GUILD_ID` | `pnpm register` |
| `.env` lokal (gitignored) | `INGEST_CHANNEL_ID`, `INGEST_GUILD_ID` | `pnpm ingest` (permalink submission; tanpa guild id jadi `channels/unknown/...`) |

Nilai Public Key, Application ID, Bot Token, Guild ID, dan ID channel/guild ingest diminta dari user sebelum verifikasi manual —
tidak pernah di-commit.

`MAINTENANCE_UNTIL` (ISO 8601, `vars` di `wrangler.jsonc`) adalah saklar maintenance yang kedaluwarsa sendiri: sebelum waktu itu
semua command Discord (termasuk `/gacha`) dan seluruh panel `/admin` dibalas tanpa membaca D1, cron ingest dilewati. Dipakai saat
kuota baca harian D1 habis; reset-nya 00:00 UTC (07:00 WIB). Setelah lewat, bot normal lagi tanpa deploy ulang.

### Perintah

| Perintah | Fungsi |
| --- | --- |
| `pnpm dev` | jalankan Worker lokal (`wrangler dev`, port 8787) |
| `pnpm register` | PUT guild commands dari `src/commands/*/definition.ts` (+ choices pool dari `data/pools.json`) |
| `pnpm typecheck` | `tsc` worker + node |
| `pnpm test` | `vitest run` |
| `pnpm lint` | `eslint .` |
| `pnpm validate` | cek manifest + warning (rarity, <3 foto); error 0 = lolos |
| `pnpm ingest` | tarik pesan baru channel inject → `data/submissions/pending/*.json` |
| `pnpm approve <messageId>` | upsert submission ke file grup kurasi (lihat Inject komunitas) |
| `pnpm seed` | build kartu + sinkronkan katalog ke D1 **lokal** |
| `pnpm seed:remote` / `pnpm seed:staging` | sama, ke D1 remote / staging (aksi produksi — hanya atas persetujuan eksplisit) |
| `pnpm deploy` | deploy ke Workers |

### Dev lokal + Interactions Endpoint

1. `pnpm dev` (port 8787).
2. `cloudflared tunnel --url http://localhost:8787` — dapatkan URL publik, mis. `https://xxx.trycloudflare.com`.
3. Di Discord Developer Portal → General Information → Interactions Endpoint URL, pasang
   `<tunnel-url>/interactions`. Portal menerima tanpa error = path verifikasi 401 benar.
4. `/ping` di server harus membalas `🏓 Pong!` yang terlihat semua member.

URL quick tunnel **berubah tiap run** dan harus dipasang ulang di portal setiap kali tunnel dibuat ulang.
Alternatif: deploy Worker staging gratis (`pnpm deploy`) — Fase 0 tanpa D1 sehingga staging tidak butuh D1
terpisah. Di Fase 1+, staging memakai D1 terpisah.

### Backup database (data sudah real)

`.github/workflows/d1-backup.yml` mengekspor D1 tiap **07:10 WIB** (00:10 UTC, tepat setelah kuota baca harian reset)
ke R2 `gatchawek-cards/backups/d1-YYYY-MM-DD.sql`, jendela simpan 30 hari. Manual kapan pun: tab Actions →
`D1 daily backup` → Run workflow. `d1 export` memakai API export D1 (bukan query biasa), jadi **tetap jalan walau
kuota baca harian habis** — sudah terbukti saat insiden 2026-11-21.

Restore: uji dulu ke database baru, jangan langsung timpa produksi.

```bash
pnpm exec wrangler d1 create gatchawek-restore
pnpm exec wrangler d1 execute gatchawek-restore --remote --file d1-2026-11-21.sql
pnpm exec wrangler d1 execute gatchawek-restore --remote --command "SELECT COUNT(*) FROM user_cards"
```

Dump-nya SQLite murni, jadi bisa diimpor juga ke SQLite/Turso kalau D1 sedang tidak bisa dipakai — tapi itu
salinan beku: pemakaian baru di sana tidak otomatis balik ke D1. D1 Time Travel aktif otomatis (Free: 7 hari,
Paid: 30 hari) untuk "undo" beberapa jam terakhir: `pnpm exec wrangler d1 time-travel info gatchawek`.

## Menambah grup baru

### Grup baru

1. Isi manifest grup baru di `data/groups/<pool>/<grup>.json` sesuai `shared/manifest.schema.ts` (boleh minta subagent/Gemini mengisinya).
2. `pnpm validate` — pastikan manifest valid (error 0; warning <3 foto / rarity boleh ada).
3. `pnpm fetch-images` — unduh foto kartu; bila ada yang gagal, kirim `data/reports/fetch-report.json` balik untuk diperbaiki.
4. `pnpm seed` — build kartu + sinkronkan katalog ke D1 **lokal**, verifikasi via `/gacha` lokal atau query D1 lokal. (`seed` sudah termasuk build kartu; `pnpm build:cards` terpisah hanya untuk kebutuhan khusus.)
5. `pnpm seed:remote` (atau `:staging`) — sinkronkan ke D1 produksi/staging. Aksi produksi — hanya atas persetujuan eksplisit.
6. `pnpm register` — daftarkan ulang guild commands bila ada command/definition baru (definisi dari `src/commands/*/definition.ts`).
7. `pnpm deploy` — deploy Worker.

### Inject komunitas (channel Discord)

Template pesan (pin di channel) — pool dan grup pilihan tetap:

```text
[nama] Nama Lengkap
[pool] pejabat
[grup] kabinet-merah-putih
[rarity] rare
```

`[pool]` wajib `pejabat` atau `meme`; `[grup]` wajib `kabinet-merah-putih` (untuk
pool `pejabat`) atau `jomok` (untuk pool `meme`). `[rarity]` salah satu dari
`common`, `rare`, `super_rare`, `ultra_rare`. `[label]` (maks 60 char) dan
`[sumber]` opsional. Hapus semua teks placeholder sebelum posting.

1. Buat channel khusus (mis. `#inject-kartu`); pastikan bot punya **View Channel** +
   **Read Message History** di channel itu. Isi `.env`: `INGEST_CHANNEL_ID=<id channel>`, `INGEST_GUILD_ID=<id server>`.
2. Kontributor posting satu pesan per kartu sesuai template + tepat 1 lampiran gambar (ukuran bebas; gambar kecil hanya jadi warning upscale, bukan penolakan).
3. `pnpm run ingest` — tarik pesan baru, tulis `data/submissions/pending/*.json` (pesan lama tanpa template/gambar masuk `rejected/` — normal).
   Setiap pesan invalid BARU langsung dibalas bot dengan me-reply pesan itu: alasan spesifik + template yang benar. Sekali per pesan (tidak spam walau ingest di-run ulang; `--no-reply` untuk mematikan).
4. Review pending, lalu `pnpm run approve <messageId> [--pool pejabat] [--skip-fetch]` —
   pool diambil dari submission (`--pool` hanya override yang harus cocok),
   unduh gambar, upsert langsung ke
   file grup kurasi (`data/groups/pejabat/kabinet-merah-putih.json` atau
   `data/groups/meme/jomok.json`) dengan `photoNo` lanjutan.
   Satu foto per pesan sudah cukup: tidak ada syarat minimal foto. Member dengan
   < 3 foto hanya memicu warning di `pnpm validate` (bukan error) sampai foto
   tambahan masuk.
   Bila unduhan gagal (http/decode/timeout): taruh file manual di `assets/raw/<cardId>.<ext>`, ulangi dengan `--skip-fetch`.
5. Lanjut pipeline biasa: `pnpm validate && pnpm seed` (verifikasi lokal) → `pnpm seed:remote` (produksi, atas persetujuan eksplisit) → `pnpm deploy`. `pnpm register` hanya bila ada command baru/berubah.

### Takedown grup

1. Set `"enabled": false` (atau hapus entri grup) di manifest.
2. `pnpm seed` — verifikasi lokal (kartu hilang dari katalog lokal).
3. `pnpm seed:remote` — terapkan ke produksi (atas persetujuan eksplisit), lalu `pnpm deploy`.

Kartu milik user tetap tersimpan di DB tetapi tersembunyi dan tidak bisa ditukar.
