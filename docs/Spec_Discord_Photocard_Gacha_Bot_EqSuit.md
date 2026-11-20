# Spec: Discord Photocard Gacha Bot

*Versi 1.0 · 19 Nov 2026 · Cloudflare Workers + Hono + D1 + Drizzle · HTTP Interactions (tanpa Gateway)*

## 0. Cara memakai dokumen

- Dokumen ini menggantikan brief awal bila ada konflik.
- Setiap fase adalah satu unit kerja untuk agent harness. Kerjakan berurutan; fase berikutnya baru dimulai setelah acceptance criteria (AC) fase sebelumnya lulus.
- Waktu selalu Unix detik (integer). ID Discord selalu string.
- Poin bertanda **VERIFIKASI** harus dicek agent terhadap versi library yang terpasang sebelum dikodekan.

## 1. Keputusan terkunci

| Topik | Keputusan | Alasan |
| --- | --- | --- |
| Hierarki | Pool → Group → Member → Card (satu foto) | Sesuai referensi: `Koleksi MEOVV: 3/5`, `Foto 11/13`, `No. 160`. |
| Unit progres | Jumlah **member unik** yang dimiliki user, dihitung live dari inventaris | Duplikat foto tetap tersimpan dan bisa ditukar, tapi tidak menambah progres. Jika kartu terakhir sebuah member ditukar keluar, progres turun. |
| Label kartu | `✨ Kartu baru!` = member baru. `🆕 Foto baru!` = foto baru dari member yang sudah dimiliki. `🔁 Duplikat ×N` = foto yang sama | Dua label tambahan murah dan informatif. |
| Penyimpanan gambar | **Workers Static Assets**, bukan R2 | R2 meminta payment method saat pertama diaktifkan, melanggar syarat Rp0 tanpa kartu. Static Assets gratis, request ke aset tidak dihitung kuota, batas free plan 20.000 file dan 25 MiB per file. |
| Transaksi | `db.batch()` + statement berpenjaga + kolom `version` (optimistic) | D1 tidak mendukung interactive transaction. |
| RNG | `crypto.getRandomValues`; tanpa pity di v1 | Pity bisa ditambah lewat migrasi additive. |
| Command scope | Guild command untuk satu server, `contexts: [0]` | Update instan, tidak muncul di DM. |
| Struktur repo | Satu package, bukan monorepo multi-package | Worker dan script Node cukup berbagi schema Zod; dua tsconfig. |
| Anti-abuse | Tidak ada di v1 (keputusan sadar) | Server tertutup sekitar 10 orang. |
| Status bot | Terlihat offline di daftar member | Normal; tanpa Gateway bot tidak punya presence. |
| Sumber gambar | Foto dari internet, `sourcePageUrl` wajib, takedown per kartu | Server privat, tidak dipublikasikan. |

## 2. Model domain

- **Pool**: kumpulan grup dengan stamina sendiri (contoh: Pejabat, Meme).
- **Group**: seri (contoh: Kabinet Merah Putih). Punya badge singkat untuk pill di bingkai.
- **Member**: tokoh/karakter. Satuan progres koleksi.
- **Card**: satu foto milik member. Punya `rarity`, `photoNo` (urutan foto member, `Foto 11/13`) dan `serial` (nomor di bingkai `No. 160`, unik per pool, tidak pernah dipakai ulang).
- **Stamina**: kuota tarik per user per pool.

| key | Bintang | Label | Bobot default | Warna embed |
| --- | --- | --- | --- | --- |
| `common` | ★ | Common | 60 | `#9CA3AF` |
| `rare` | ★★ | Rare | 28 | `#A855F7` |
| `super_rare` | ★★★ | Super Rare | 9 | `#F59E0B` |
| `ultra_rare` | ★★★★ | Ultra Rare | 3 | `#EC4899` |

Konstanta ini hidup di `src/domain/rarity.ts` (satu sumber kebenaran, dipakai juga oleh scripts dan `/help`).

## 3. Struktur proyek

```
photocard-bot/
├─ AGENTS.md                      # aturan agent (3.1)
├─ wrangler.jsonc                 # D1 binding, assets, vars
├─ drizzle.config.ts
├─ migrations/                    # hasil drizzle-kit generate
├─ data/
│  ├─ pools.json                  # manual: stamina, cooldown
│  ├─ groups/<pool>/<group>.json  # diisi Gemini (bagian 4)
│  └─ serials.lock.json           # card_id → serial, di-commit
├─ scripts/                       # Node only
│  ├─ validate-manifest.ts
│  ├─ fetch-images.ts
│  ├─ build-cards.ts              # frame generator
│  ├─ seed.ts                     # manifest → seed.sql (upsert)
│  ├─ register-commands.ts
│  └─ fonts/                      # 1 font berlisensi OFL
├─ assets/raw/                    # gitignored, cache gambar mentah
├─ public/cards/                  # gitignored, output bingkai (Static Assets)
├─ shared/manifest.schema.ts      # Zod, dipakai Worker & scripts
├─ src/                           # Worker only
│  ├─ index.ts                    # Hono app, POST /interactions
│  ├─ env.ts
│  ├─ discord/                    # verify, respond, rest, components
│  ├─ commands/<nama>/{definition.ts,handler.ts}
│  ├─ domain/                     # fungsi murni: stamina, gacha, rarity, progress
│  ├─ db/{schema.ts,client.ts,queries/}
│  └─ ui/                         # builder embed dan komponen
└─ docs/specs/                    # spec fase
```

### 3.1 Aturan layer (masuk `AGENTS.md`)

- `domain/` tidak boleh mengimpor `db/`, `discord/`, atau Hono. Input dan output murni agar mudah di-unit-test.
- Semua SQL hanya di `db/queries/`. Handler tidak menulis query.
- Handler merakit: parse → query → domain → ui → response.
- `scripts/` hanya boleh mengimpor `shared/` dan `src/domain/rarity.ts`.
- Tanpa `any`. Payload Discord bertipe dari `discord-api-types`.
- Satu commit per fase; `pnpm typecheck && pnpm test` harus hijau.
- Dua tsconfig: `tsconfig.worker.json` (types workers) dan `tsconfig.node.json`.

## 4. Kontrak manifest

### 4.1 `data/pools.json` (diisi manual)

```json
[{ "id": "pejabat", "name": "Pejabat", "emoji": "🏛️", "staminaMax": 10, "regenIntervalSec": 1500, "resetCooldownSec": 10800 }]
```

### 4.2 `data/groups/<pool>/<group>.json` (diisi Gemini)

```json
{
  "schemaVersion": 1,
  "pool": "pejabat",
  "group": { "id": "kabinet-merah-putih", "name": "Kabinet Merah Putih", "badge": "KABINET" },
  "members": [
    {
      "id": "nama-tokoh",
      "name": "Nama",
      "fullName": "Nama Lengkap",
      "photos": [
        {
          "photoNo": 1,
          "rarity": "common",
          "imageUrl": "https://upload.wikimedia.org/.../foto.jpg",
          "sourcePageUrl": "https://commons.wikimedia.org/wiki/File:foto.jpg",
          "license": "CC BY-SA 4.0",
          "author": "Nama Fotografer",
          "focus": { "x": 0.5, "y": 0.35 }
        }
      ]
    }
  ]
}
```

Aturan validasi (Zod di `shared/manifest.schema.ts`):

- `id` slug `a-z0-9-`, maksimal 30 karakter; `member.id` unik global. Card id = `<member.id>-<NN>` (dua digit).
- `photoNo` mulai 1, berurutan tanpa celah. `photoTotal` member = jumlah foto.
- `rarity` salah satu dari empat key. Minimal 3 foto per member (disarankan 5 sampai 13).
- `imageUrl` https langsung ke file gambar. `sourcePageUrl` wajib. `license` dan `author` boleh `null`. `focus` opsional (default x 0.5, y 0.35).
- `badge` huruf besar, maksimal 8 karakter.
- `enabled` opsional, default true. `false` = takedown.
- Distribusi rarity per grup yang jauh dari 50/30/15/5 hanya **peringatan**, bukan error.

### 4.2.1 Inject komunitas (`community-inject`)

Teman-teman bisa inject kartu manual lewat channel Discord khusus: satu pesan = satu kartu,
lampiran gambar pesan = foto kartu. Template pesan (pool + grup pilihan tetap):

```text
[nama] Aynid Morbulet
[pool] pejabat
[grup] kabinet-merah-putih
[rarity] rare
[label] opsional, maks 60 char
[sumber] https://commons.wikimedia.org/wiki/File:...
```

- `nama`/`pool`/`grup`/`rarity` wajib (key case-insensitive); `pool` harus `pejabat`
  atau `meme`; `grup` harus `kabinet-merah-putih` untuk pool `pejabat`, `jomok`
  untuk pool `meme` (pemetaan tunggal di `POOL_GROUPS`, `scripts/lib/submissions.ts`).
  `rarity` salah satu dari empat key.
- `sumber` opsional; default permalink pesan `https://discord.com/channels/<guild>/<channel>/<message>`.
- Wajib tepat 1 lampiran gambar; selain itu submission invalid dengan alasan jelas.
- Alur operator: `pnpm run ingest` (poll REST `GET /channels/{id}/messages`, tulis
  `data/submissions/pending/*.json`, cursor di `data/ingest-state.json`) →
  review → `pnpm run approve <messageId> [--pool <pool>] [--skip-fetch]` (upsert
  langsung ke file grup kurasi `data/groups/<pool>/<grup>.json` dengan `photoNo`
  lanjutan) → pipeline lama (`validate` → `fetch-images` →
  `seed` → `register` → `deploy`).
- Pool diambil dari submission; `--pool` hanya override operator yang harus cocok
  dengan pool submission bila keduanya ada. File target yang hilang bersifat
  error keras (grup repo berubah → perbarui `POOL_GROUPS`); `approve` tidak pernah
  membuat file grup baru.
- Grup kurasi tetap wajib ≥3 foto per member: `approve` menolak submission yang
  membuat member berakhir di bawah 3 foto (tidak ada lagi file `komunitas-*.json`
  dengan `allowSinglePhoto`; pengecualian itu sudah dihapus bersama grup fiktif).
  Tanpa migrasi D1, tanpa perubahan Worker.

### 4.3 Serial

Seed memberi kartu baru `serial = max(serial pool) + 1` dan mencatatnya di `data/serials.lock.json`. Serial tidak pernah diubah atau dipakai ulang, meski kartu di-takedown.

## 5. Skema database (Drizzle, SQLite/D1)

Semua tabel di `src/db/schema.ts`. Sintaks index (argumen ketiga berbentuk array) mengikuti drizzle-orm terbaru: **VERIFIKASI** versi terpasang.

```ts
import { sqliteTable, text, integer, primaryKey, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const flag = (n: string) => integer(n, { mode: 'boolean' }).notNull().default(true);
const RARITIES = ['common', 'rare', 'super_rare', 'ultra_rare'] as const;

export const pools = sqliteTable('pools', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  emoji: text('emoji').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  staminaMax: integer('stamina_max').notNull().default(10),
  regenIntervalSec: integer('regen_interval_sec').notNull().default(1500),
  resetCooldownSec: integer('reset_cooldown_sec').notNull().default(10800),
  memberCount: integer('member_count').notNull().default(0), // denormalisasi, dihitung seed
  enabled: flag('enabled'),
});

export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(),
  poolId: text('pool_id').notNull().references(() => pools.id),
  name: text('name').notNull(),
  badge: text('badge').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  memberCount: integer('member_count').notNull().default(0),
  enabled: flag('enabled'),
}, (t) => [index('groups_pool_idx').on(t.poolId, t.sortOrder)]);

export const members = sqliteTable('members', {
  id: text('id').primaryKey(),
  poolId: text('pool_id').notNull().references(() => pools.id),   // denormalisasi
  groupId: text('group_id').notNull().references(() => groups.id),
  name: text('name').notNull(),
  nameLower: text('name_lower').notNull(),                         // untuk autocomplete
  fullName: text('full_name'),
  photoTotal: integer('photo_total').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  enabled: flag('enabled'),
}, (t) => [
  index('members_group_idx').on(t.groupId, t.sortOrder),
  index('members_pool_name_idx').on(t.poolId, t.nameLower),
]);

export const cards = sqliteTable('cards', {
  id: text('id').primaryKey(),                                      // `${memberId}-${NN}`
  poolId: text('pool_id').notNull().references(() => pools.id),
  groupId: text('group_id').notNull().references(() => groups.id),
  memberId: text('member_id').notNull().references(() => members.id),
  serial: integer('serial').notNull(),
  photoNo: integer('photo_no').notNull(),
  rarity: text('rarity', { enum: RARITIES }).notNull(),
  imageFile: text('image_file').notNull(),                         // `<id>.<hash8>.webp`
  sourcePageUrl: text('source_page_url'),
  enabled: flag('enabled'),
}, (t) => [
  uniqueIndex('cards_pool_serial_uq').on(t.poolId, t.serial),
  uniqueIndex('cards_member_photo_uq').on(t.memberId, t.photoNo),
  index('cards_gacha_idx').on(t.poolId, t.enabled, t.rarity),
  index('cards_group_idx').on(t.groupId),
]);

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),                                      // Discord snowflake
  createdAt: integer('created_at').notNull(),
});

export const userPoolStates = sqliteTable('user_pool_states', {
  userId: text('user_id').notNull().references(() => users.id),
  poolId: text('pool_id').notNull().references(() => pools.id),
  stamina: integer('stamina').notNull(),
  staminaAnchorAt: integer('stamina_anchor_at').notNull(),
  lastResetAt: integer('last_reset_at'),                           // null = belum pernah reset
  version: integer('version').notNull().default(0),                // optimistic lock
}, (t) => [primaryKey({ columns: [t.userId, t.poolId] })]);

export const userCards = sqliteTable('user_cards', {
  userId: text('user_id').notNull().references(() => users.id),
  cardId: text('card_id').notNull().references(() => cards.id),
  quantity: integer('quantity').notNull(),
  firstObtainedAt: integer('first_obtained_at').notNull(),
  lastObtainedAt: integer('last_obtained_at').notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.cardId] }),
  check('user_cards_qty_nonneg', sql`${t.quantity} >= 0`),
]);

export const trades = sqliteTable('trades', {
  id: text('id').primaryKey(),                                      // crypto.randomUUID()
  proposerId: text('proposer_id').notNull().references(() => users.id),
  targetId: text('target_id').notNull().references(() => users.id),
  offerCardId: text('offer_card_id').notNull().references(() => cards.id),
  requestCardId: text('request_card_id').notNull().references(() => cards.id),
  status: text('status', { enum: ['pending', 'accepted', 'declined', 'cancelled', 'failed'] }).notNull(),
  settleToken: text('settle_token'),
  channelId: text('channel_id'),
  messageId: text('message_id'),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  resolvedAt: integer('resolved_at'),
}, (t) => [
  index('trades_proposer_idx').on(t.proposerId, t.status),
  index('trades_target_idx').on(t.targetId, t.status),
]);

export const pulls = sqliteTable('pulls', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  poolId: text('pool_id').notNull(),
  cardId: text('card_id').notNull(),
  newMember: integer('new_member', { mode: 'boolean' }).notNull(),
  newCard: integer('new_card', { mode: 'boolean' }).notNull(),
  pulledAt: integer('pulled_at').notNull(),
}, (t) => [index('pulls_user_idx').on(t.userId, t.pulledAt)]);
```

Catatan indexing:

- `cards_gacha_idx` melayani pemilihan kandidat gacha per pool dan rarity.
- Primary key `user_cards (user_id, card_id)` sudah cukup untuk inventaris, cek kepemilikan, dan autocomplete trade.
- `members_pool_name_idx` untuk autocomplete prefix (`name_lower LIKE 'ann%'`).
- Progres dihitung live: `SELECT COUNT(DISTINCT c.member_id) FROM user_cards uc JOIN cards c ON c.id = uc.card_id WHERE uc.user_id = ?1 AND c.group_id = ?2 AND c.enabled = 1`. Penyebut diambil dari `groups.member_count` dan `pools.member_count` (dihitung saat seed).
- D1 menerapkan foreign key. Urutan seed: pools → groups → members → cards.

## 6. Tech spec

### 6.1 Verifikasi signature Discord di Hono

```ts
import { verifyKey } from 'discord-interactions';
import { InteractionType, InteractionResponseType, type APIInteraction } from 'discord-api-types/v10';

app.post('/interactions', async (c) => {
  const signature = c.req.header('X-Signature-Ed25519');
  const timestamp = c.req.header('X-Signature-Timestamp');
  const body = await c.req.text();   // body MENTAH; jangan c.req.json() sebelum verifikasi
  if (!signature || !timestamp) return c.text('Bad request signature', 401);
  const ok = await verifyKey(body, signature, timestamp, c.env.DISCORD_PUBLIC_KEY);
  if (!ok) return c.text('Bad request signature', 401);
  const interaction = JSON.parse(body) as APIInteraction;
  if (interaction.type === InteractionType.Ping) {
    return c.json({ type: InteractionResponseType.Pong });
  }
  return dispatch(interaction, c);
});
```

- Respons 401 untuk signature salah **wajib**: Discord sengaja mengirim request tidak valid saat kamu menyimpan Interactions Endpoint URL.
- `DISCORD_PUBLIC_KEY` lewat `wrangler secret put`; jangan di-commit, jangan log body.
- Opsional: tolak jika selisih timestamp dengan waktu sekarang lebih dari 300 detik.
- **VERIFIKASI**: tanda tangan `verifyKey` (v4 mengembalikan Promise) dan pastikan jalan di runtime Workers. Free plan hanya punya **10 ms CPU per request**. Jika verifikasi memicu `exceededCpu`, ganti dengan `crypto.subtle` Ed25519 langsung.

### 6.2 Routing dan pola respons

- Registry command: `Map<string, Handler>` berdasarkan nama. Komponen dirutekan lewat `custom_id` berformat `<ns>:<aksi>:<arg>...` (maksimal 100 karakter; `ns` ∈ `gacha`, `koleksi`, `trade`).
- Batas 3 detik. Aturan seragam: handler yang menyentuh D1 lebih dari sekali membalas **deferred** (type 5, atau type 6 untuk komponen) lalu menyelesaikan kerja di `c.executionCtx.waitUntil(...)` dengan `PATCH https://discord.com/api/v10/webhooks/{APP_ID}/{interaction.token}/messages/@original`. Token berlaku 15 menit.
- Langsung (tanpa deferred): `/ping`, `/help`, dan **autocomplete** (type 8, maksimal 1 query, maksimal 25 pilihan, wajib < 3 detik).
- Komponen milik user tertentu: `custom_id` memuat `ownerId`; jika klik bukan pemilik, balas ephemeral (`flags: 64`).
- Semua balasan yang mem-mention user memakai `allowed_mentions: { parse: [] }`.
- Gambar: `${PUBLIC_BASE_URL}/cards/${imageFile}` dilayani Static Assets (nama file memuat hash, cache immutable).
- Anggaran per interaksi: maksimal sekitar 8 query D1 (batch dihitung satu round trip), jauh di bawah batas 50 subrequest.

### 6.3 Lazy stamina (tanpa cron)

State tersimpan: `stamina` (nilai saat `anchorAt`) dan `anchorAt`. Baris belum ada = penuh.

```ts
export interface StaminaState { stamina: number; anchorAt: number }

export function normalize(s: StaminaState, max: number, interval: number, now: number): StaminaState {
  if (s.stamina >= max) return { stamina: max, anchorAt: now };
  const gained = Math.max(0, Math.floor((now - s.anchorAt) / interval));
  const stamina = Math.min(max, s.stamina + gained);
  if (stamina >= max) return { stamina: max, anchorAt: now };
  return { stamina, anchorAt: s.anchorAt + gained * interval };
}

export function consume(s: StaminaState, max: number, interval: number, now: number): StaminaState | null {
  const n = normalize(s, max, interval, now);
  if (n.stamina < 1) return null;
  return { stamina: n.stamina - 1, anchorAt: n.anchorAt };
}

// untuk tampilan: gunakan state hasil normalize()
export const nextTickAt = (n: StaminaState, max: number, interval: number) =>
  n.stamina >= max ? null : n.anchorAt + interval;
export const fullAt = (n: StaminaState, max: number, interval: number) =>
  n.stamina >= max ? null : n.anchorAt + (n.stamina_missing(max)) * interval; // = anchorAt + (max - stamina) * interval
```

(`fullAt` = `anchorAt + (max - stamina) * interval`; tulis tanpa helper khayalan.) Sisa waktu menuju tick berikutnya terjaga karena `anchorAt` hanya maju sebanyak tick utuh yang sudah dikreditkan. Saat stamina penuh lalu dipakai, `anchorAt = now`, sehingga timer regenerasi mulai dari saat itu. Tampilan memakai timestamp relatif Discord: `<t:${nextTickAt}:R>` (Worker tidak menghitung durasi sendiri).

**Perubahan konfigurasi pool**: `stamina` yang melebihi `staminaMax` baru otomatis terpotong oleh `normalize`.

### 6.4 Reset berpendingin

```ts
export const resetReadyAt = (lastResetAt: number | null, cooldown: number) =>
  lastResetAt === null ? 0 : lastResetAt + cooldown;
// boleh reset jika: now >= resetReadyAt(...) DAN stamina ternormalisasi < max
// efek: { stamina: max, anchorAt: now, lastResetAt: now }
```

Jika kuota masih penuh, tolak tanpa menghabiskan cooldown. Jika belum siap, tampilkan `<t:${readyAt}:R>`.

### 6.5 Alur `/gacha` dan penulisan aman

1. Satu batch: `INSERT OR IGNORE` ke `users` dan `user_pool_states` (stamina = max, anchor = now, version = 0), lalu `SELECT` state dan konfigurasi pool.
2. `consume()` murni. Jika `null`, balas ephemeral dengan `<t:next:R>`.
3. Pilih rarity berdasar bobot, **hanya dari rarity yang punya minimal satu kartu `enabled` di pool**. RNG: `crypto.getRandomValues(new Uint32Array(1))[0] / 2**32`. Lalu pilih kartu seragam dalam rarity itu.
4. Baca kepemilikan sebelum tulis: apakah kartu sudah dimiliki, dan apakah member sudah dimiliki (`EXISTS` via join `cards`). Hasilnya menentukan label.
5. Satu `db.batch()`:
   - (a) CAS state: `UPDATE user_pool_states SET stamina = ?1, stamina_anchor_at = ?2, version = version + 1 WHERE user_id = ?3 AND pool_id = ?4 AND version = ?5`
   - (b) upsert inventaris, **hanya jika (a) berhasil**:

```sql
INSERT INTO user_cards (user_id, card_id, quantity, first_obtained_at, last_obtained_at)
SELECT ?1, ?2, 1, ?3, ?3
WHERE EXISTS (SELECT 1 FROM user_pool_states WHERE user_id = ?1 AND pool_id = ?4 AND version = ?5 + 1)
ON CONFLICT (user_id, card_id) DO UPDATE SET quantity = quantity + 1, last_obtained_at = excluded.last_obtained_at;
```

- (c) `INSERT INTO pulls ...` dengan guard `WHERE EXISTS` yang sama.
- (d) `SELECT` progres grup dan pool untuk embed.

6. Jika `meta.changes` dari (a) bukan 1 (klik ganda atau race), ulangi dari langkah 1 maksimal 2 kali, lalu balas "coba lagi".

Klausa `WHERE` pada `INSERT ... SELECT` wajib ada agar tidak terkena ambiguitas parsing SQLite pada `ON CONFLICT`.

**Embed** (mengikuti referensi): judul `🎴 {member} ({grup})`; deskripsi `<@user> dapet photocard {pool} {★} **{Label}**!`, baris `{grup} · {fullName} · 📸 Foto {photoNo}/{photoTotal}`, baris label (`✨ Kartu baru!` / `🆕 Foto baru!` / `🔁 Duplikat ×N`), baris `📚 Koleksi {grup}: **x/y**`; image = URL bingkai; `color` = warna rarity; footer `Sisa tarik: n/max`. Tombol `🎲 Tarik Lagi` dengan `custom_id = gacha:again:<poolId>:<ownerId>`; hasilnya pesan baru, bukan edit.

### 6.6 `/trade` dan transaksi atomik

**Buat tawaran**: validasi bukan diri sendiri dan bukan bot, `offer != request`, proposer memiliki `offer`, target memiliki `request`, kedua kartu `enabled`, proposer punya maksimal 3 tawaran `pending` yang belum kedaluwarsa. Simpan baris `trades` (`expires_at = now + 86400`), kirim pesan dengan tombol `trade:accept:<id>`, `trade:decline:<id>` (hanya target) dan `trade:cancel:<id>` (hanya proposer). Kartu **tidak dikunci**; validasi final terjadi saat accept. Kedaluwarsa dicek lazy saat klik, tanpa cron.

**Autocomplete**: `offer` menampilkan kartu milik pemanggil; `request` menampilkan kartu milik `user` target (jika opsi `user` sudah terisi, Discord ikut mengirimnya). Label: `Anna (MEOVV) · Foto 11 · ★★` (maksimal 100 karakter), value = card id.

```sql
SELECT c.id, m.name, g.name AS group_name, c.photo_no, c.rarity
FROM user_cards uc JOIN cards c ON c.id = uc.card_id
JOIN members m ON m.id = c.member_id JOIN groups g ON g.id = c.group_id
WHERE uc.user_id = ?1 AND uc.quantity >= 1 AND c.enabled = 1 AND m.name_lower LIKE ?2
ORDER BY m.name_lower, c.photo_no LIMIT 25;
```

**Accept** (klik target, deferred update). Baca baris `trades` lebih dulu (kolom pihak dan kartu tidak pernah di-update). Buat `tok = crypto.randomUUID()`. Definisikan `G = EXISTS (SELECT 1 FROM trades WHERE id = ?id AND settle_token = ?tok)`. Satu `db.batch()` berurutan:

1. Klaim: `UPDATE trades SET status = 'accepted', resolved_at = ?now, settle_token = ?tok WHERE id = ?id AND status = 'pending' AND expires_at > ?now AND EXISTS (proposer memiliki offer, quantity >= 1) AND EXISTS (target memiliki request, quantity >= 1)`
2. `UPDATE user_cards SET quantity = quantity - 1 WHERE user_id = ?A AND card_id = ?offer AND G`
3. `UPDATE user_cards SET quantity = quantity - 1 WHERE user_id = ?B AND card_id = ?request AND G`
4. `DELETE FROM user_cards WHERE quantity = 0 AND ((user_id = ?A AND card_id = ?offer) OR (user_id = ?B AND card_id = ?request)) AND G`
5. Upsert B menerima `offer` dan A menerima `request`, memakai pola `INSERT ... SELECT ... WHERE G ON CONFLICT DO UPDATE SET quantity = quantity + 1` seperti 6.5(b).

Setelah batch, baca `settle_token`. Jika sama dengan `tok` → sukses. Jika tidak, tentukan alasan: status bukan `pending` (sudah diproses), `expires_at` lewat, atau kepemilikan berubah (tandai `failed` dengan `UPDATE ... WHERE status = 'pending'`). Batch D1 berjalan sebagai satu transaksi berurutan; constraint `CHECK (quantity >= 0)` menjadi jaring pengaman tambahan karena pelanggarannya membatalkan seluruh batch.

**Decline / cancel**: `UPDATE trades SET status = ?, resolved_at = ?now WHERE id = ?id AND status = 'pending'`, setelah memeriksa pelaku (target untuk decline, proposer untuk cancel). Pesan diperbarui (type 7/PATCH) tanpa tombol.

**VERIFIKASI**: apakah `db.run(sql...)` dapat dimasukkan ke `db.batch()` pada versi drizzle terpasang. Jika tidak, pakai D1 mentah: `env.DB.batch([env.DB.prepare(...).bind(...)])` di dalam `db/queries/`.

## 7. Fase

### Fase 0 — Fondasi

**Prasyarat manual (user)**: buat aplikasi di Discord Developer Portal; catat Application ID dan Public Key; buat bot token; undang bot ke server dengan scope `applications.commands` dan `bot`; catat Guild ID. Buat akun Cloudflare, jalankan `wrangler login`.

**Deliverable**: init pnpm + TypeScript strict + Hono + wrangler; `POST /interactions` dengan 6.1; `GET /health`; command `/ping`; `scripts/register-commands.ts` (PUT guild commands, definisi diambil dari `src/commands/*/definition.ts` dan `data/pools.json` untuk choices pool); `AGENTS.md`; script `dev`, `deploy`, `typecheck`, `test`; unit test verifikasi dengan keypair Ed25519 buatan sendiri (valid, header hilang, body diubah).

**AC**:

- Request tanpa/dengan signature salah mendapat 401.
- Discord menerima Interactions Endpoint URL (workers.dev) tanpa error.
- `/ping` membalas di server.
- 20 interaksi manual berturut-turut tanpa `exceededCpu` di metrik Workers.
- Catatan di README: dev lokal memakai `wrangler dev` + `cloudflared tunnel --url http://localhost:8787` (URL quick tunnel berubah tiap run dan harus dipasang ulang di portal); alternatifnya deploy Worker staging gratis dengan D1 terpisah.

### Fase 1 — Data, skema, pipeline gambar

**Deliverable**:

- `src/db/schema.ts` (bagian 5), migrasi lewat `drizzle-kit generate`, diterapkan dengan `wrangler d1 migrations apply` (local dan remote).
- `shared/manifest.schema.ts` dan `scripts/validate-manifest.ts` (error dan peringatan, rangkuman per grup).
- `scripts/fetch-images.ts`: unduh `imageUrl` ke `assets/raw/` dengan konkurensi 4, timeout, User-Agent jelas; validasi `content-type` gambar dan ukuran minimal 500×700 px; tulis `data/reports/fetch-report.json` berisi URL yang gagal agar bisa dikirim balik ke Gemini. Link rusak adalah kasus normal, bukan crash.
- `scripts/build-cards.ts` (frame generator, lihat di bawah).
- `scripts/seed.ts`: manifest → `seed.sql` dengan upsert idempoten, menghitung `member_count`/`photo_total`, menetapkan serial (4.3), mematikan (`enabled = 0`) kartu yang hilang dari manifest, lalu `wrangler d1 execute DB --file seed.sql`.
  (Fase 1 selesai: dataset awal memakai grup fiktif sementara; grup fiktif tersebut sudah dihapus — dataset kini hanya berisi grup kurasi `pejabat/kabinet-merah-putih` dan `meme/jomok`.)

**Spesifikasi bingkai** (`@napi-rs/canvas`, font OFL terdaftar lewat `GlobalFonts`): kanvas 600×900, sudut membulat radius 36, border 8 px bergradien menurut rarity (common abu-perak, rare merah muda→ungu→cyan seperti referensi, super\_rare emas, ultra\_rare pelangi). Foto di-*cover crop* ke 2:3 dengan titik `focus`. Pill kiri atas = `group.badge`; pill kanan atas = bintang; gradasi hitam di 35% bawah; nama 56 px tebal; `fullName` 22 px; label rarity 20 px berwarna rarity; `No. {serial}` kanan bawah. Output WebP kualitas 85 bernama `<cardId>.<hash8>.webp` di `public/cards/`. **VERIFIKASI** bahwa Discord merender WebP beralpha pada embed; jika tidak, ganti PNG.

**AC**:

- Manifest rusak (rarity salah, `photoNo` bolong, slug ganda) gagal validasi dengan pesan jelas.
- `seed` dijalankan dua kali menghasilkan jumlah baris sama dan serial tidak berubah.
- Menghapus satu foto dari manifest lalu seed membuat kartu itu `enabled = 0` dan berkas gambarnya tidak ada di `public/cards/` setelah build.
- Setiap gambar bingkai berukuran 600×900 dan di bawah 150 KB.
- `assets/raw/` dan `public/cards/` ada di `.gitignore`; `data/` dan `serials.lock.json` di-commit.

### Fase 2 — `/gacha`

**Deliverable**: `domain/stamina.ts` dan `domain/gacha.ts` (murni, 6.3 dan 6.5); `db/queries/gacha.ts`; `commands/gacha`; `ui/gachaEmbed.ts`; tombol `Tarik Lagi`. Opsi `pool` berupa `choices` statis dari `pools.json`.

**AC**:

- Unit test stamina: regenerasi parsial, dipakai saat penuh (anchor = now), kuota melewati max terpotong, jam mundur tidak menghasilkan stamina negatif.
- Simulasi 100.000 tarikan: proporsi rarity dalam ±1 poin persentase dari bobot; rarity tanpa kartu tidak pernah terpilih dan bobotnya dinormalisasi ulang.
- Tes konkurensi (vitest-pool-workers atau Miniflare): 5 tarikan paralel dengan stamina 1 → tepat 1 sukses; `user_cards` bertambah tepat 1.
- Label `✨`, `🆕`, `🔁` benar pada tiga skenario; progres `x/y` benar.
- Stamina 0 membalas ephemeral dengan `<t:...:R>`.
- Tombol `Tarik Lagi` oleh non-pemilik mendapat ephemeral penolakan.

### Fase 3 — `/status`, `/reset`, `/koleksi`

**`/status`** (publik, seperti referensi): per pool tampil `🎲 Sisa tarik (/gacha pool:X): n/max, nambah lagi <t:...:R>`, `🔄 Reset: bisa lagi <t:...:R>` atau `siap dipakai`, `📚 Koleksi: x/y member`. Satu batch D1 untuk seluruh pool.

**`/reset pool`**: 6.4, memakai CAS `version` yang sama dengan gacha.

**`/koleksi [pool] [grup] [publik]`**: default ephemeral. Satu embed per halaman berisi maksimal 8 member milik user, format `**Anna** — 3/13 foto: #3 #5 #11×2`. Footer `Koleksi MEOVV: 3/5 member`. Tombol Prev/Next dengan `custom_id = koleksi:p:<ownerId>:<poolId>:<groupId|*>:<page>`; tombol dinonaktifkan di ujung halaman. Query: `GROUP BY m.id ... LIMIT 8 OFFSET ?`, dengan `GROUP_CONCAT(c.photo_no || ':' || uc.quantity)`. Autocomplete `grup` bergantung pada `pool` yang terpilih.

**AC**: reset ditolak saat cooldown aktif atau stamina penuh; reset sukses mengisi penuh dan mencatat `last_reset_at`; pagination tidak menampilkan kartu `enabled = 0`; semua command membalas deferred dan selesai di bawah 3 detik lokal untuk inventaris 500 baris.

### Fase 4 — `/trade`

**Deliverable**: `domain/trade.ts` (validasi murni), `db/queries/trade.ts` (6.6), `commands/trade`, handler komponen `trade:*`, autocomplete.

**AC**:

- Alur normal: kedua kartu bertukar, kuantitas dan progres benar untuk kedua user, termasuk kasus penerima sudah punya kartu itu (kuantitas bertambah) dan pengirim melepas kartu terakhir (baris terhapus).
- Klik ganda Terima: hanya satu yang berhasil, tidak ada duplikasi kartu.
- Kartu ditawarkan sudah dipakai/ditukar sebelum accept → tawaran `failed`, tidak ada perubahan inventaris.
- Tawaran kedaluwarsa ditolak; klik oleh user selain target/proposer ditolak ephemeral.
- Tes kegagalan di tengah batch (paksa pelanggaran `CHECK`) → tidak ada perubahan parsial.
- Batas 3 tawaran pending per proposer ditegakkan; trade ke diri sendiri/bot ditolak.

### Fase 5 — `/help` dan penyempurnaan

**Deliverable**: `/help` dinamis (cara main, daftar command, tabel rate dari `domain/rarity.ts`, daftar pool dan grup dari DB). Pesan error ramah saat kuota harian D1 habis. Opsional, spec terpisah jika dipilih: `/kartu` (lihat satu kartu), burn/dismantle duplikat (butuh tabel `fragments`), pity per pool.

**AC**: `/help` tidak memuat nilai yang di-hardcode selain teks bantuan; `pnpm typecheck && pnpm test` hijau; README berisi alur kerja penambahan grup baru (Gemini → validate → fetch → build → seed → deploy).

## 8. Anggaran free tier (diverifikasi Nov 2026)

- Workers Free: 100.000 request/hari (interaksi, autocomplete, komponen), 10 ms CPU per request, 50 subrequest per request. Request ke Static Assets gratis dan tidak dihitung.
- Static Assets: maksimal 20.000 file dan 25 MiB per file. Perkiraan 400 kartu × 100 KB ≈ 40 MB.
- D1 Free: 5 juta row read/hari, sekitar 100 ribu row write/hari, 5 GB. Satu tarikan menulis sekitar 3 row (state, inventaris, log) ditambah entri index. Untuk 10 orang, penggunaan tetap jauh di bawah batas.
- Bila kuota harian habis, D1 mengembalikan error; tangani dengan pesan ramah, jangan crash.

## 9. Risiko dan prosedur takedown

- **Hak cipta**: foto berasal dari internet. Bot tetap di server privat, tidak didaftarkan di direktori publik, tanpa monetisasi. `sourcePageUrl` wajib agar sumber bisa dilacak.
- **Takedown satu kartu**: set `"enabled": false` (atau hapus entri) di manifest → `pnpm seed` → `pnpm build:cards` → `pnpm deploy`. Kartu yang sudah dimiliki user tetap ada di DB tetapi tersembunyi dan tidak bisa ditukar.
- **Teks pada kartu hanya nama tokoh**, tanpa caption atau ejekan, untuk meminimalkan risiko pencemaran nama baik dan laporan ke Discord.
- **Link gambar dari Gemini sering rusak**: pipeline `fetch-images` melaporkan yang gagal dan tidak berhenti; kirim laporan itu kembali ke Gemini untuk diganti.
- **Backup**: `assets/raw/` tidak di-commit. Simpan salinannya atau andalkan `imageUrl` untuk mengunduh ulang.
