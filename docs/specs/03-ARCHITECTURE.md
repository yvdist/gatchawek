# 03 — Arsitektur

## 1. Struktur repo (SATU repo bersama bot Discord)

Bot yang sudah live **tetap di tempatnya** (root repo: `src/`, `scripts/`, `drizzle/`, `wrangler.jsonc`). Game ditambahkan di samping, tanpa memindahkan file bot.

```
/                         # repo bot Gatchawek yang sudah ada
├─ src/ scripts/ drizzle/ wrangler.jsonc ...   # bot (TIDAK dipindah)
├─ games/adu-batang/      # app game: satu package, satu wrangler, satu deploy
│  ├─ src/client/         # React + Vite (UI)
│  ├─ src/server/         # Worker (Hono) + Durable Objects (GameRoom, Matchmaker)
│  ├─ scripts/            # generate-stats, validate-content, export-catalog, simulate
│  ├─ content/            # cards.seed.csv, catalog.v{N}.json, balance reports
│  ├─ wrangler.jsonc      # env prod + staging, binding D1/R2/DO
│  └─ vite.config.ts, package.json, tsconfig.*
├─ packages/
│  ├─ engine/             # logika game murni (TS), TANPA dependensi Cloudflare/DOM
│  ├─ shared/             # tipe, skema zod protokol WS, konstanta, i18n id
│  └─ bots/               # bot heuristik (simulasi, latihan, pengisi kursi)
├─ pnpm-workspace.yaml    # packages: ['games/adu-batang','packages/*']  (root tetap paket bot)
└─ docs/specs/            # pack ini
```

Aturan kerja bersama:
- **Satu database D1, satu sumber migrasi.** Tabel game didefinisikan di schema Drizzle yang sama (`src/db/schema.ts` atau file schema baru yang di-import `drizzle.config` bot) dan di-migrate dengan `drizzle-kit` yang sama. `arena` meng-import schema itu (alias path atau paket `packages/db` bila lebih rapi). Alasan satu DB: kepemilikan kartu dan reward bisa ditulis dalam satu `db.batch()` atomik, dan tidak ada sinkronisasi data antar sistem.
- **Pisah deploy:** Worker bot dan Worker `adu-batang` dideploy sendiri-sendiri; perubahan di game tidak boleh membuat bot ikut ter-deploy ulang. Workflow GitHub Actions diberi path filter.
- **Staging dulu:** semua migrasi baru dijalankan di D1 staging sebelum prod. Migrasi hanya *additive* (tambah tabel/kolom), tidak pernah mengubah/menghapus tabel lama.
- **Gaya kode mengikuti bot:** lapisan `domain` murni → `db/queries` → adapter (HTTP/WS/UI), Zod v4 di perbatasan, TypeScript strict tanpa `any`. `packages/engine` adalah lapisan domain game.
- **Dependensi dibagi:** versi TypeScript/ESLint/Vitest/wrangler disamakan dengan root (catalog pnpm atau `overrides`).

## 2. Komponen Cloudflare

| Komponen | Fungsi |
|---|---|
| Worker `adu-batang` (Hono) | Satu Worker: menyajikan frontend lewat Workers Static Assets, REST (auth, deck, profil, leaderboard, reward, tiket WS), dan meng-host Durable Objects |
| Durable Object `GameRoom` | 1 DO = 1 room/match. Menyimpan state game, memvalidasi action dengan engine, broadcast view ke tiap pemain, timer via alarm |
| Durable Object `Matchmaker` | Singleton: antrean ranked & pencarian room publik |
| D1 (sama dengan bot) | Tabel lama bot + tabel game: users/decks/matches/ratings/rewards/game_cards, diakses via Drizzle |
| R2 (bucket `CARDS` yang sama) | Foto kartu (read-only dari game), aset kosmetik baru di prefix terpisah |

**Wajib** `new_sqlite_classes` (atau `exports` deklaratif versi baru Wrangler) untuk Durable Objects: Workers Free plan hanya mengizinkan DO berbackend SQLite.

## 3. GameRoom (Durable Object)

- **WebSocket Hibernation API** (`ctx.acceptWebSocket`, `webSocketMessage`, `webSocketClose`). Jangan `ws.accept()` gaya lama: itu menagih durasi selama koneksi hidup.
- **State**: satu baris JSON di SQLite DO (`state`), ditulis setelah setiap action yang valid. Saat DO bangun dari hibernasi, state dimuat ulang dari SQLite. Ukuran state ≤ ~64 KB.
- **Pemrosesan serial**: DO memproses pesan satu per satu, jadi tidak perlu lock. Di Raid, aksi simultan tetap diserialisasi.
- **Timer**: `ctx.storage.setAlarm(deadline)`. Handler `alarm()` melakukan auto `end_turn`, mengganti pemain AFK dengan bot, atau menutup room idle.
- **Identitas**: klien meminta *tiket* ke `POST /api/rooms/:code/ticket` (JWT pendek, 60 dtk, berisi userId+roomCode+seat). WS handshake membawa tiket; DO memverifikasi tanpa memanggil D1.
- **Akhir match**: DO menulis hasil ke D1 **sekali** (match, match_players, ratings, rewards) lewat batch, lalu menjadwalkan alarm penghapusan state.
- **Reconnect**: simpan `seat` ↔ `userId`. Koneksi baru dengan tiket valid menggantikan koneksi lama dan menerima `snapshot` penuh.

## 4. Protokol WebSocket (zod di `packages/shared`)

Semua pesan JSON `{ t: string, ... }`.

**Klien → Server**

| t | Payload | Catatan |
|---|---|---|
| `join` | `{ deckId? , blind?: boolean }` | Setelah handshake |
| `ready` | `{ ready: boolean }` | Lobby |
| `mulligan` | `{ keep: string[] }` | instance id yang dipertahankan |
| `action` | `{ seq: number, action: Action }` | `seq` naik per klien, untuk dedup dan urutan |
| `emote` | `{ id: string }` | Rate-limit 1 per 2 dtk |
| `resync` | `{}` | Minta snapshot |
| `leave` | `{}` | |

`Action` = `play_creature{handId,slot,target?}` · `cast_spell{handId,target?}` · `attack{attackerId,target}` · `end_turn` · `surrender` · `raid_ready`.

**Server → Klien**

| t | Payload |
|---|---|
| `snapshot` | `{ view: PlayerView, version: number }` |
| `events` | `{ events: GameEvent[], view: PlayerView, version }` — events dipakai untuk animasi, view untuk state akhir |
| `error` | `{ code, message, seq? }` — kode: `ILLEGAL_ACTION`, `NOT_YOUR_TURN`, `RATE_LIMITED`, `STALE`, … |
| `lobby` | `{ seats, host, settings }` |
| `timer` | `{ deadline: epochMs, seat }` |
| `ended` | `{ result, rewards }` |

Klien menganggap server sebagai kebenaran; tidak ada prediksi lokal di MVP (turn-based, latensi aman).

### PlayerView (filter informasi tersembunyi)
Berisi: tangan sendiri lengkap; untuk lawan hanya `handCount`, `deckCount`, meja (publik), HP, mana, status. Instance id creature lawan boleh dikirim; isi deck/tangan lawan **tidak pernah** dikirim.

## 5. Engine (API publik `packages/engine`)

```ts
createGame(config: GameConfig, catalog: Catalog, seed: string): GameState
applyAction(state: GameState, playerSeat: number, action: Action): { state: GameState; events: GameEvent[] } // throws EngineError
viewFor(state: GameState, seat: number): PlayerView
legalActions(state: GameState, seat: number): Action[]     // dipakai bot & UI untuk highlight target
runTimeout(state: GameState): { state; events }            // auto end_turn dsb
```
- `GameConfig.mode` ∈ `duel | ffa | raid`; aturan per mode berupa *rule module* yang dipasang ke core (turn order, target legal, kondisi menang, Takhta, boss phase).
- State dapat di-JSON-kan penuh. RNG: mulberry32 dengan `rngState` di dalam state.
- Setiap `GameEvent` bertipe diskriminatif (`card_drawn`, `creature_played`, `damage_dealt`, `creature_died`, `turn_started`, `crown_changed`, `boss_intent`, …) agar UI bisa menganimasikan.

## 6. Budget free tier (cek ulang di dashboard sebelum rilis)

Ketentuan yang berlaku saat spec ini ditulis (per dokumentasi Cloudflare):

- Durable Objects di Workers Free: **100.000 request/hari** dan **13.000 GB-s durasi/hari**, reset 00:00 UTC. Jika terlampaui, operasi DO gagal sampai reset.
- Pesan WebSocket **masuk** ditagih rasio **20:1** terhadap request. Pesan **keluar** gratis.
- DO yang idle dan eligible hibernasi tidak ditagih durasi.
- Worker (bot dan arena, akun yang sama berbagi kuota Workers) juga punya kuota request harian sendiri: pantau.

Estimasi kasar: satu duel ≈ 120 pesan masuk ≈ 6 request-ekuivalen + koneksi + 1 batch D1. Ratusan match per hari masih jauh di bawah batas.

**Kebiasaan hemat (wajib):**
1. Katalog di-bundle, bukan di-fetch/di-query per game.
2. Tidak ada heartbeat aplikasi; andalkan ping protokol (gratis) dan alarm.
3. Emote dan chat dibatasi rate-limit.
4. Gambar R2 disajikan dengan `Cache-Control: immutable` + versi di nama file.
5. Satu tulis D1 per akhir match; leaderboard di-cache 60 dtk di Worker (Cache API).
6. Room kosong atau idle > 10 menit dihapus lewat alarm.
7. Tambahkan counter sederhana (`/api/admin/usage`) agar pemilik bisa memantau mendekati batas.

## 7. Auth

- Discord OAuth2 (scope `identify`), Worker menukar code, membuat/ambil `users`, set cookie sesi `HttpOnly; Secure; SameSite=Lax` (JWT HS256, 7 hari).
- Rahasia di Wrangler secrets (lokal `.dev.vars`): `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `JWT_SECRET`. Boleh memakai aplikasi Discord yang sama dengan bot (tambahkan redirect URI OAuth), atau aplikasi baru.
- Sentry: `@sentry/cloudflare` di Worker `adu-batang` (DSN terpisah atau project sama dengan tag `service=adu-batang`).
- Tamu (opsional): hanya boleh Latihan vs Bot, tanpa rating dan reward.

## 8. Keamanan & anti-curang

- Semua keputusan di server; klien tidak dipercaya.
- Validasi setiap pesan dengan zod; ukuran pesan maks 4 KB.
- Rate limit per koneksi (token bucket di memori DO): 10 pesan/dtk burst, 3/dtk rata-rata.
- Deck divalidasi server (aturan 3.4 di `01`, kepemilikan sesuai fase 7) saat `join`.
- Jangan log isi tangan/deck di log produksi.
- CORS ketat ke origin arena (frontend dan API satu origin, jadi CORS nyaris tidak diperlukan); CSRF aman karena WS memakai tiket dan REST mutasi memakai SameSite + header kustom.

## 9. Frontend

- Rute: `/` (beranda), `/lobby/:code`, `/play/:code`, `/decks`, `/profile`, `/leaderboard`, `/raid`.
- State: Zustand store `game` yang di-update hanya oleh pesan server; antrean animasi dari `events`.
- Interaksi: pilih kartu di tangan → highlight target legal (dari `legalActions`) → tap target. Tombol "Akhiri Giliran" besar. Long-press kartu = detail.
- Komponen kunci: `<Card/>` (render frame, art, badge cost/ATK/HP, rarity bintang, series, nama ability), `<Board/>`, `<Hand/>`, `<PlayerBadge/>`, `<TimerRing/>`, `<EventLog/>`, `<EmotePicker/>`.
- Performa: virtualisasi daftar kartu di deck builder (300+ kartu), gambar lazy + ukuran thumbnail.
- Aksesibilitas dasar: kontras teks pada kartu, label ARIA untuk aksi utama, ukuran tap ≥ 44px.

## 10. Observabilitas & testing

- `packages/engine`: Vitest, cakupan tinggi; property test (fast-check) untuk invarian: jumlah kartu konservatif, HP tidak NaN, tidak ada state ilegal setelah N aksi acak.
- Simulasi bot vs bot (`pnpm sim`) menghasilkan laporan win-rate per kartu/series/class.
- Test DO dengan `vitest-pool-workers` atau Miniflare.
- Playwright smoke: dua browser konteks main satu duel sampai selesai.
- `pnpm check` = typecheck + lint + test + validate-content; wajib hijau sebelum menandai task selesai.
