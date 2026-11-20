# gatchawek

Discord photocard gacha bot — Cloudflare Workers + Hono + D1 + Drizzle, HTTP Interactions (tanpa Gateway).

## Fase 0 — Fondasi

### Prasyarat manual (user)

Buat aplikasi di Discord Developer Portal; catat Application ID dan Public Key; buat bot token; undang bot ke
server dengan scope `applications.commands` dan `bot`; catat Guild ID. Jalankan `wrangler login`.

### Variabel environment

| File | Variabel | Dipakai oleh |
| --- | --- | --- |
| `.dev.vars` (gitignored, salin dari `.dev.vars.example`) | `DISCORD_PUBLIC_KEY` | runtime Worker (`wrangler dev` / `deploy`) |
| `.env` lokal (gitignored) | `DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN`, `GUILD_ID` | `pnpm register` |

Nilai Public Key, Application ID, Bot Token, dan Guild ID diminta dari user sebelum verifikasi manual —
tidak pernah di-commit.

### Perintah

| Perintah | Fungsi |
| --- | --- |
| `pnpm dev` | jalankan Worker lokal (`wrangler dev`, port 8787) |
| `pnpm register` | PUT guild commands dari `src/commands/*/definition.ts` (+ choices pool dari `data/pools.json`) |
| `pnpm typecheck` | `tsc` worker + node |
| `pnpm test` | `vitest run` |
| `pnpm lint` | `eslint .` |
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

## Menambah grup baru

### Grup baru

1. Isi manifest grup baru di `data/groups/<pool>/<grup>.json` (minta Gemini mengisinya sesuai `shared/manifest.schema.ts`).
2. `pnpm validate` — pastikan manifest valid.
3. `pnpm fetch-images` — unduh foto kartu; bila ada yang gagal, kirim `data/reports/fetch-report.json` balik ke Gemini untuk diperbaiki.
4. `pnpm build:cards` — bangun aset kartu statis.
5. `pnpm seed` — sinkronkan katalog ke D1.
6. `pnpm register` — daftarkan ulang guild commands (definisi dari `src/commands/*/definition.ts`).
7. `pnpm deploy` — deploy Worker.

### Inject komunitas (channel Discord)

1. Buat channel khusus (mis. `#inject-kartu`); pastikan bot punya **View Channel** +
   **Read Message History** di channel itu. Isi `.env`: `INGEST_CHANNEL_ID=<id channel>`.
2. Kontributor posting satu pesan per kartu sesuai template (`[nama]`, `[grup]`, `[rarity]`
   wajib; `[label]`, `[sumber]` opsional) + tepat 1 lampiran gambar.
3. `pnpm run ingest` — tarik pesan baru, tulis `data/submissions/pending/*.json`.
4. Review pending, lalu `pnpm run approve <messageId> [--pool pejabat] [--skip-fetch]` —
   unduh gambar (gate 500×700 sama seperti `fetch-images`), upsert ke
   `data/groups/<pool>/komunitas-*.json` (`allowSinglePhoto: true`).
   Bila unduhan gagal: taruh file manual di `assets/raw/<cardId>.<ext>`, ulangi dengan `--skip-fetch`.
5. Lanjut pipeline biasa: `pnpm validate && pnpm fetch-images && pnpm seed && pnpm register && pnpm deploy`.

### Takedown grup

1. Set `"enabled": false` (atau hapus entri grup) di manifest.
2. `pnpm seed` — sinkronkan katalog ke D1.
3. `pnpm build:cards` — bangun ulang aset kartu.
4. `pnpm deploy` — deploy Worker.

Kartu milik user tetap tersimpan di DB tetapi tersembunyi dan tidak bisa ditukar.
