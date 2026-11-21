# PROJECT_STATE — Fakta repo & data lama (hasil recon P0-T1)

> Ditulis dari pembacaan **kode nyata** (`src/`, `scripts/`, `migrations/`), **schema Drizzle** (`src/db/schema.ts`),
> **D1 lokal** (`.wrangler/state/.../efc41aaa….sqlite`) dan **file manifest** (`data/`). Bukan tebakan.
> Recon ini read-only: tidak ada tabel/perilaku bot yang diubah.
> Tanggal recon: 2026-11-21.

## 1. Bot yang sudah live

| Hal | Nilai |
|---|---|
| Worker | satu Worker bernama `gatchawek` (`wrangler.jsonc`), entry `src/index.ts`, `compatibility_date` 2026-11-19, flag `nodejs_compat` |
| Framework | Hono 4 + HTTP Interactions Discord (`POST /interactions`), **tanpa Gateway**; cron `*/5 * * * *` untuk ingest komunitas |
| Route publik | `GET /health`, `GET /cards/:file` (gambar kartu dari R2), `GET|HEAD /notes/:file` (PDF dari R2), `GET|HEAD /album/:token`, `GET|HEAD /kartu/:id`, panel `/admin/*` |
| ORM | Drizzle ORM 0.45 + drizzle-kit 0.31, `drizzle.config.ts` → `schema: ./src/db/schema.ts`, `out: ./migrations`, driver `d1-http` |
| Deploy | `wrangler deploy` (manual). `.github/workflows/deploy.yml` sudah ada, plus `render-remote.yml`, `d1-backup.yml`, `notify-changelog.yml`, `announce-deploy.yml` |
| Tool | Node 26, pnpm 12.21.0, TypeScript 5.9, Vitest 5, ESLint 10, wrangler 4.164.0, miniflare 4 |

Baseline sebelum Fase 0 (diukur hari ini): `pnpm typecheck` hijau, `pnpm test` = **56 file / 579 test lulus** (≈104 s).

## 2. D1

| Env | `database_name` | `database_id` | Migrasi |
|---|---|---|---|
| production | `gatchawek` | `f9acc0cf-45ff-44b3-8736-dc790370bb0a` | `migrations/` |
| staging | `gatchawek-staging` | `f2c7a563-6b23-47dc-9758-c63f844d5d6c` | `migrations/` |

Binding name: **`DB`**. Lokal: `wrangler dev` memakai `.wrangler/state/v3/d1/…`.

Migrasi yang sudah terpasang (14, additive): `0000_sad_red_wolf` → `0013_pool_hidden`.
Catatan kuota: D1 free tier **100.000 row read/hari**; hari ini hit dan seluruh SELECT remote ditolak
(`code 7500`, pesan "exceeded D1's free tier daily row read limit"). Bot sudah punya penanganan khusus
(`isD1DailyQuotaError`, halaman 503 "kuota habis") dan saklar `MAINTENANCE_UNTIL` di `wrangler.jsonc`.
Implikasi untuk arena: **jangan** query D1 per game/per render; katalog wajib di-bundle.

## 3. Tabel D1 lama (nama kolom nyata)

Tabel di bawah adalah milik bot. **Tidak boleh diubah.** Semua nama diambil dari `PRAGMA table_info` D1 lokal
dan `src/db/schema.ts`.

| Tabel | Kolom | Migrasi |
|---|---|---|
| `pools` | `id` (TEXT PK), `name`, `emoji`, `sort_order`, `stamina_max`, `regen_interval_sec`, `reset_cooldown_sec`, `member_count`, `enabled`, `hidden` | 0000, 0013 |
| `groups` | `id` (TEXT PK), `pool_id`→`pools.id`, `name`, `badge`, `sort_order`, `member_count`, `enabled` | 0000 |
| `members` | `id` (TEXT PK), `pool_id`, `group_id`, `name`, `name_lower`, `full_name`, `photo_total`, `sort_order`, `enabled` | 0000 |
| `cards` | `id` (TEXT PK), `pool_id`, `group_id`, `member_id`, `serial` INT, `photo_no` INT, `rarity` TEXT, `image_file`, `source_page_url`, `enabled`, `holo_enabled`, `photo_label`, `render_requested_at` | 0000, 0002, 0007 |
| `users` | `id` (TEXT PK = **Discord user id**), `created_at`, `exp` | 0000, 0011 |
| `user_cards` | `user_id`, `card_id`, `quantity` INT, `holo_qty` INT, `first_obtained_at`, `last_obtained_at`; PK (`user_id`,`card_id`), index `user_cards_card_idx` | 0000, 0001, 0012 |
| `user_pool_states` | `user_id`, `pool_id`, `stamina`, `stamina_anchor_at`, `last_reset_at`, `version` (optimistic lock), `pity_wish`; PK (`user_id`,`pool_id`) | 0000, 0005 |
| `wishes` | `user_id`, `pool_id`, `card_id`, `created_at`; PK (`user_id`,`card_id`) | 0006 |
| `pulls` | `id` INT autoincrement, `user_id`, `pool_id`, `card_id`, `new_member`, `new_card`, `pulled_at`, `is_holo` | 0000 |
| `trades` | `id`, `proposer_id`, `target_id`, `offer_card_id`, `request_card_id`, `status`, `settle_token`, `channel_id`, `message_id`, `created_at`, `expires_at`, `resolved_at` | 0000 |
| `battles` | `id`, `challenger_id`, `target_id`, `challenger_card_id`, `target_card_id`, `mode` (`casual|wager`), `status`, `winner_id`, `challenger_score`, `target_score`, `challenger_crit`, `target_crit`, `settle_token`, `created_at`, `expires_at`, `resolved_at` | 0004 |
| `gives` | `id`, `mode` (`public|direct`), `giver_id`, `target_id`, `card_id`, `status`, `claimer_id`, `settle_token`, `created_at`, `expires_at`, `resolved_at` | 0008 |
| `album_tokens` | `token` (PK), `user_id`, `display_name`, `avatar_url`, `pool_id`, `settle_token`, `created_at`, `expires_at`, `used_at` | 0009 |
| `user_melt_points` | `user_id`, `pool_id`, `points`; PK (`user_id`,`pool_id`) | 0010 |
| `inject_queue` | `message_id` (PK), `channel_id`, `guild_id`, `author_id`, `submitted_at`, `message_url`, `nama`, `member_id`, `pool`, `grup`, `rarity`, `label`, `sumber`, `image_url`, `status` (`pending|approved|rejected`), `errors`, `reviewed_by`, `reviewed_at` | 0003 |

Poin penting untuk game:
- **Identitas user bot = Discord ID** (`users.id`), bukan UUID. Tabel `users` game di `02-DATA-MODEL.md` §2
  memakai `id` uuid + `discord_id` unik → **adapter wajib**, jangan menimpa/mengubah `users` lama.
- **Kepemilikan kartu** = `user_cards(user_id, card_id, quantity, holo_qty)`, bukan view. Kartu koleksi =
  baris `cards`. Belum ada view `v_owned_cards`: adapter P0-T7 dibuat sebagai query (`getOwnedCards`).
- **`cards.id`** = `<member_id>-<photo_no 2 digit>`, mis. `jomok-mix-01-01`, `prabowo-subianto-01`,
  `katak-bijak-01` (`cardIdFor` di `scripts/lib/card-inputs.ts`).
- `cards.serial` unik per pool (`cards_pool_serial_uq`), dipertahankan lewat `data/serials.lock.json`.
- Rarity enum di DB (`RARITIES`): `common`, `rare`, `super_rare`, `ultra_rare`, `holo`, `secret`.
  `holo`/`secret` ada di enum tapi **belum dipakai sebagai rarity baris**; "holo" saat ini **varian** dari
  kartu `super_rare`/`ultra_rare` yang `holo_enabled=1` dan disimpan di `user_cards.holo_qty`.
  Bobot gacha: 6270/1570/1250/875/25/10; `HOLO_CHANCE` = 8% (SR) & 25% (UR).
- `pools.hidden=1` menyembunyikan pool `pejabat` dari bot/admin (data tetap ada).

## 4. R2

| Env | Bucket | Binding |
|---|---|---|
| production | `gatchawek-cards` | `CARDS` |
| staging | `gatchawek-cards-staging` | `CARDS` |

Layout key (dari `scripts/lib/render-pool.ts` + route `src/index.ts`):

| Key | Isi |
|---|---|
| `<cardId>.<sha256[:8]>.webp` (root bucket) | frame kartu hasil render (nama = `renderFileName()`; hash isi file) |
| `<cardId>.<sha256[:8]>.gif` | kartu animasi (holo) |
| `notes/<slug>.pdf` | dokumen catatan (di luar domain kartu) |

- Disajikan Worker sendiri di `GET /cards/:file` dengan regex `^[a-z0-9-]+\.[0-9a-f]{8}\.(webp|gif)$` dan
  `Cache-Control: public, max-age=31536000, immutable`.
- **Nilai kolom `cards.image_file`** = nama objek R2 di atas (`<cardId>.<hash>.webp`) **atau** URL `http(s)://`
  untuk kartu yang belum dirender. Renderer (`scripts/render-r2.ts`) mengambil baris `image_file LIKE 'http%'`,
  render, upload ke R2, lalu menulis balik nama objek.
- **Foto mentah**: hanya di disk lokal `assets/raw/` (gitignored, 363 `.jpg` + 18 `.png` + cache `api-cache/`),
  **tidak** diunggah ke R2. R2 = hasil render saja. `source_page_url` menyimpan halaman sumber; `inject_queue.image_url`
  menyimpan URL gambar mentah untuk kartu yang masuk lewat antrean komunitas.
  → Untuk game, `art_key` (spec `02` §7) harus menunjuk ke **objek R2 hasil render** (`image_file`), bukan foto mentah.

## 5. Isi katalog saat ini

Sumber kebenaran konten = manifest `data/groups/<pool>/<group>.json` (`shared/manifest.schema.ts`), di-seed oleh
`pnpm seed` ke `cards`/`members`/`groups`/`pools`.

Total foto enabled di manifest: **192** kartu dari **102 members** dalam **3 grup** (`default` 12 member,
`jomok` 18 member, `kabinet-merah-putih` 72 member). D1 lokal punya 6 grup / 112 member (termasuk grup dev
`meme-klasik`, `dewan-fiktif`, `kabinet-fiktif`).

| Pool (`pools.id`) | Grup (`groups.id`) | `enabled` | Kartu enabled di manifest | Baris di D1 **lokal** (semua, enabled) |
|---|---|---|---|---|
| `meme` ("Jomok", 🐸) | `jomok` (`JOMOK`) | 1 | 108 | 108 (108) |
| `pejabat` ("Pejabat", 🏛️) | `kabinet-merah-putih` (`KABINET`) | 1 | 72 | 2 (2) |
| `ahli-ngebul` ("Ahli Ngebul", 🚬) | `default` (`NGEBUL`) | 1 | 12 | 0 (0) |
| `meme` | `meme-klasik` (`MEME`) | 0 | 0 (manifest grup tidak ada) | 6 (0) |
| `pejabat` | `dewan-fiktif` (`DEWAN`) | 0 | 0 (manifest grup tidak ada) | 6 (0) |
| `pejabat` | `kabinet-fiktif` (`KABINET`) | 0 | 0 (manifest grup tidak ada) | 9 (0) |

Pool `pejabat` punya `pools.hidden=1` (disembunyikan dari bot/admin, data tetap ada). Grup `meme-klasik`,
`dewan-fiktif`, `kabinet-fiktif` hanya ada di D1 **lokal** (sisa data dev), tidak ada di manifest.

Rarity (manifest, enabled, total 192):

| Rarity | Jumlah |
|---|---|
| `common` | 40 |
| `rare` | 42 |
| `super_rare` | 76 |
| `ultra_rare` | 34 |
| `holo` / `secret` | 0 baris (hanya enum; varian holo) |

Catatan: `data/serials.lock.json` memuat **192** id kartu (108 `jomok-mix-*`, 72 nama pejabat, 12 ahli-ngebul)
dengan counter serial per pool (`meme` 114, `pejabat` 322, `ahli-ngebul` 12).

D1 **lokal** (dev, bukan produksi) saat ini berisi 131 baris `cards` / 112 `members` / 6 `groups` / 3 `pools`,
110 enabled, semua `image_file` berupa nama objek R2 (0 remote). Distribusi lokal 36/38/18/18 — data dev,
boleh berbeda dari manifest.

**Jumlah kartu di D1 produksi belum terverifikasi** karena kuota baca harian habis (lihat §2). Verifikasi ulang
setelah 00:00 UTC:
`pnpm exec wrangler d1 execute DB --remote --command "select rarity, count(*) from cards where enabled=1 group by rarity"`.

## 6. Cara bot memberi reward

Semua mutasi atomik via `db.batch()` + optimistic locking (`user_pool_states.version`, `settle_token`).

| Jalur | Efek |
|---|---|
| `/gacha` (`src/db/queries/gacha.ts`) | 1 pull = 1 stamina (default `stamina_max` 10, regen 1500 s). Batch: kurangi stamina (guard `version`), `INSERT pulls`, upsert `user_cards` (`quantity+1`, atau `holo_qty+1` bila roll holo), `users.exp += RARITY_EXP[rarity]` |
| EXP / level (`src/domain/level.ts`) | `common 10 · rare 25 · super_rare 50 · ultra_rare 100 · holo 200 · secret 400`; naik level butuh `100 × L` |
| `/wish` + `pity_wish` | wish aktif per pool, counter `user_pool_states.pity_wish`, row `wishes` dihapus saat kena |
| `/dismantle` → `user_melt_points.points` | poin per rarity (`MELT_POINTS_BY_RARITY`); `/redeem` 100 poin = 1 stamina |
| `/trade`, `/give`, `/give-to` | transfer salinan kartu antar user lewat `settle_token` (idempoten) |
| `/battle` (`casual`/`wager`) | casual 0 EXP; wager memberi EXP sebesar rarity kartu lawan yang menang |
| `/reset` | reset stamina per pool bila cooldown (`reset_cooldown_sec` 10800) lewat |

Tidak ada sistem reward terpisah (tiket/hadiah harian). Untuk arena, "reward game" (spec `02` §2 `rewards`)
adalah tabel **baru**; sumber daya lama yang bisa dipakai ulang: salinan kartu (`user_cards`), EXP (`users.exp`),
poin melt, stamina.

## 7. Implikasi untuk Fase 0 / arena

1. Tambah schema game sebagai file Drizzle baru, di-export bersama `src/db/schema.ts`, migrasi additive `0014+`.
2. Adapter kepemilikan: query read-only di `src/db/queries/` (mis. `getOwnedCards(userId)`), join
   `user_cards` × `cards` × `pools.hidden`/`enabled`, **tanpa** view SQL dan tanpa menulis tabel lama.
3. Game card menaut ke kartu koleksi lewat `game_cards.source_card_id = cards.id` (format `<member>-<nn>`).
4. `art_key` = `cards.image_file` (objek R2 hasil render) + URL `/cards/<image_file>`; foto mentah tidak tersedia di R2.
5. Kuota D1 baca adalah risiko nyata (sudah pernah habis): katalog di-bundle, satu tulis D1 per akhir match.