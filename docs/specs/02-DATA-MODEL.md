# 02 — Data Model, Stat Budget, dan Efek

## 1. Prinsip

- Stat **konstan**. Dihasilkan *sekali* oleh skrip generator (Fase 2), direview pemilik, lalu **dibekukan** (`status='approved'`, `content_version` naik).
- Tabel koleksi gacha lama **tidak diubah**. Game memakai tabel baru dan, bila perlu, *query/view* di atas tabel lama (adapter dibuat di Fase 0 setelah membaca `src/db/schema.ts` asli).
- Saat runtime, engine membaca **katalog JSON ter-bundle** (`catalog.v{N}.json`), bukan D1. D1 hanya untuk data dinamis (user, deck, match, rating, reward).

## 2. Skema D1 (migrasi baru, urut)

> **Catatan implementasi:** SQL di bawah adalah *referensi bentuk tabel*. Implementasi sebenarnya ditulis sebagai schema **Drizzle** (`sqliteTable`) di repo bot dan di-migrate dengan `drizzle-kit`, bukan file `.sql` manual. Satu D1, satu folder migrasi, hanya migrasi additive. Query game ditaruh di lapisan `db/queries` dengan gaya yang sama dengan bot (optimistic locking + `db.batch()` untuk mutasi atomik).

> Nama tabel koleksi lama tidak diketahui spec ini. Fase 0 mencatatnya di `docs/PROJECT_STATE.md` dan menyesuaikan kolom `source_card_id` / view `v_owned_cards`.

```sql
-- 0001_game_cards.sql
CREATE TABLE game_cards (
  id               TEXT PRIMARY KEY,              -- 'gc_aura_api'
  source_card_id   TEXT,                          -- kartu koleksi (nullable utk spell/token/boss)
  kind             TEXT NOT NULL CHECK (kind IN ('creature','spell','token','boss')),
  name             TEXT NOT NULL,
  rarity           INTEGER NOT NULL CHECK (rarity BETWEEN 1 AND 5),
  cost             INTEGER NOT NULL CHECK (cost BETWEEN 0 AND 10),
  atk              INTEGER,                       -- null utk spell
  hp               INTEGER,                       -- null utk spell
  class            TEXT CHECK (class IN ('striker','tank','support','trickster','wildcard')),
  series           TEXT NOT NULL DEFAULT 'netral',
  keywords         TEXT NOT NULL DEFAULT '[]',    -- JSON: ["taunt","rush"]
  abilities        TEXT NOT NULL DEFAULT '[]',    -- JSON: AbilityDef[]
  ability_name     TEXT,                          -- nama lucu
  ability_text     TEXT,                          -- deskripsi 1 kalimat (dibuat dari abilities + bumbu lucu)
  flavor_text      TEXT,
  modes            TEXT NOT NULL DEFAULT '["duel","ffa","raid"]',
  art_key          TEXT,                          -- key R2 foto mentah; null = placeholder
  frame_variant    TEXT NOT NULL DEFAULT 'default',
  content_version  INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX idx_gc_status ON game_cards(status, kind, rarity);

-- 0002_users_decks.sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,                 -- uuid
  discord_id    TEXT NOT NULL UNIQUE,
  username      TEXT NOT NULL,
  avatar_url    TEXT,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER
);
CREATE TABLE decks (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  name       TEXT NOT NULL,
  cards      TEXT NOT NULL,                       -- JSON: [{"id":"gc_x","n":2}]
  is_starter INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_decks_user ON decks(user_id);

-- 0003_matches_ratings.sql
CREATE TABLE matches (
  id              TEXT PRIMARY KEY,
  mode            TEXT NOT NULL CHECK (mode IN ('duel','ffa','raid')),
  format          TEXT NOT NULL,                  -- ranked|casual|blind|practice|raid_normal|...
  room_code       TEXT,
  seed            TEXT NOT NULL,
  engine_version  TEXT NOT NULL,
  content_version INTEGER NOT NULL,
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  result          TEXT                            -- JSON ringkas (pemenang, ronde, boss id)
);
CREATE TABLE match_players (
  match_id      TEXT NOT NULL REFERENCES matches(id),
  user_id       TEXT,                             -- null = bot
  seat          INTEGER NOT NULL,
  placement     INTEGER,                          -- 1 = menang
  rating_before INTEGER, rating_after INTEGER,
  PRIMARY KEY (match_id, seat)
);
CREATE TABLE ratings (
  user_id TEXT NOT NULL, mode TEXT NOT NULL, season INTEGER NOT NULL DEFAULT 1,
  elo INTEGER NOT NULL DEFAULT 1000, games INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, mode, season)
);

-- 0004_rewards_bosses.sql
CREATE TABLE rewards (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('exp','gacha_ticket','card_copy','cosmetic')),
  amount INTEGER NOT NULL DEFAULT 1, ref TEXT,    -- ref: game_card_id / cosmetic id
  source_match_id TEXT, created_at INTEGER NOT NULL, claimed_at INTEGER
);
CREATE INDEX idx_rewards_unclaimed ON rewards(user_id) WHERE claimed_at IS NULL;
CREATE TABLE bosses (
  id TEXT PRIMARY KEY, game_card_id TEXT NOT NULL REFERENCES game_cards(id),
  base_hp INTEGER NOT NULL, hp_per_player INTEGER NOT NULL,
  phases TEXT NOT NULL,                           -- JSON BossPhase[]
  rewards TEXT NOT NULL                           -- JSON
);
```

View adapter (dibuat di Fase 0/7 sesuai skema lama):

```sql
-- v_owned_cards(user_id, source_card_id, copies)  -> dari tabel kepemilikan gacha yang sudah ada
```
Kepemilikan game card = kepemilikan kartu koleksi yang ber-`source_card_id` sama. Spell/token/boss tidak punya pemilik: spell dan token tersedia untuk semua, kartu boss didapat dari reward raid.

## 3. Stat konstan: Budget Formula

Dipakai **generator** (Fase 2) dan **validator** (CI). Setelah dibekukan, angka di DB adalah sumber kebenaran; formula hanya alat pemeriksa (toleransi ±1).

```
statPoints = 2*cost + 1 + rarityBonus − abilityPoints        (creature: ATK + HP)
rarityBonus = rarity − 1                                      (★1:0 … ★5:4)
```

- `ATK ≥ 0`, `HP ≥ 1`, `ATK ≤ 9`, `HP ≤ 12`.
- Pembagian ATK:HP menurut class:

| Class (UI) | ID | ATK : HP | Gaya ability |
|---|---|---|---|
| Penyerang | `striker` | 60 : 40 | damage, rush, lifesteal |
| Tameng | `tank` | 30 : 70 | taunt, shield, heal |
| Pendukung | `support` | 40 : 60 | buff, draw, heal |
| Tukang Tipu | `trickster` | 50 : 50 | silence, freeze, steal, discard |
| Absurd | `wildcard` | bebas | swap_stats, copy, summon, efek aneh yang lucu |

- **Spell:** `abilityPoints ≤ 2*cost + 1 + rarityBonus`; tidak punya ATK/HP.
- Cost creature normal 1–8; cost 0 hanya token.

### Tabel poin efek (awal, disetel ulang di Fase 2 lewat simulasi)

| Efek / keyword | Poin |
|---|---|
| `damage` 1 target | 1 / damage |
| `damage` semua creature lawan | 1.5 / damage |
| `heal` | 0.5 / HP |
| `buff` ATK atau HP permanen | 1 / poin |
| `draw` | 2 / kartu |
| `discard_random` (lawan) | 2 |
| `swap_stats` | 1 |
| `silence` | 2 |
| `freeze` | 2 |
| `bounce` | 2 |
| `gain_mana` (sementara) | 2 / mana |
| `copy` (salin creature ke tangan) | 3 |
| `summon_token` | total stat token × 1 |
| `destroy` 1 creature | 5 |
| `steal` (sementara) | 3 · (permanen, hanya ★5) 6 |
| keyword `taunt` / `shield` / `rush` / `lifesteal` / `stealth` | 1 / 2 / 2 / 2 / 1.5 |

Syarat sinergi (`condition`) mengurangi poin 20–30% (disetel di Fase 2).

## 4. Efek: DSL (JSON, dipakai engine)

```ts
type AbilityDef = {
  trigger: 'on_play'|'on_death'|'on_turn_start'|'on_turn_end'|'on_attack'|'on_damaged'|'aura'|'on_cast';
  condition?: { type: 'count_series'|'count_class'|'hp_below'|'board_full'|'is_crown_holder'; value: string|number; min?: number };
  effects: EffectDef[];
  once_per_turn?: boolean;
};

type Target =
  | 'self' | 'self_player' | 'enemy_player' | 'chosen_player'        // chosen_player: FFA/Raid
  | 'chosen_ally_creature' | 'chosen_enemy_creature' | 'chosen_creature'
  | 'random_enemy_creature' | 'random_ally_creature'
  | 'all_enemy_creatures' | 'all_ally_creatures' | 'all_creatures'
  | 'all_enemy_players' | 'boss';

type EffectDef =
  | { op: 'damage';        target: Target; amount: number }
  | { op: 'heal';          target: Target; amount: number }
  | { op: 'buff';          target: Target; atk?: number; hp?: number; until?: 'end_of_turn'|'permanent' }
  | { op: 'debuff';        target: Target; atk?: number; until?: 'end_of_turn'|'permanent' }
  | { op: 'draw';          target: Target; count: number }
  | { op: 'discard_random';target: Target; count: number }
  | { op: 'swap_stats';    target: Target }
  | { op: 'silence';       target: Target }
  | { op: 'freeze';        target: Target }
  | { op: 'grant_keyword'; target: Target; keyword: Keyword }
  | { op: 'destroy';       target: Target }
  | { op: 'bounce';        target: Target }
  | { op: 'summon_token';  token_id: string; count: number }
  | { op: 'steal';         target: Target; until: 'end_of_turn'|'permanent' }
  | { op: 'gain_mana';     amount: number }
  | { op: 'copy_to_hand';  target: Target }
  | { op: 'swap_hands';    target: Target }                           // FFA
  | { op: 'drain';         target: Target; amount: number }           // damage + heal diri
  | { op: 'boss_intent';   intent: BossIntent };                      // khusus boss
```
Total 17 operasi inti; semua kartu (300+) dibangun dari kombinasi ini. **Kelucuan ada di `ability_name`/`ability_text`/`flavor_text`**, bukan di operasi baru. Operasi baru hanya boleh ditambah lewat Decision Log.

Contoh kartu (ilustrasi, bukan final):

```json
{
  "id": "gc_aura_api", "kind": "creature", "name": "Aura Api", "rarity": 3, "cost": 4,
  "atk": 4, "hp": 3, "class": "striker", "series": "aura", "keywords": ["rush"],
  "abilities": [{ "trigger": "on_play", "condition": { "type": "count_series", "value": "aura", "min": 2 },
                  "effects": [{ "op": "damage", "target": "chosen_enemy_creature", "amount": 2 }] }],
  "ability_name": "Panas Dalam", "ability_text": "Gercep. Jika kamu punya Aura lain: beri 2 damage ke 1 creature lawan."
}
```

## 5. Boss config

```ts
type BossIntent =
  | { type: 'attack_target'; who: 'lowest_hp'|'highest_hp'|'random'|'crown'; damage: number }
  | { type: 'aoe_players'; damage: number }
  | { type: 'summon_minions'; token_id: string; count: number }
  | { type: 'buff_self'; atk?: number; shield?: number }
  | { type: 'curse'; kind: 'no_spells'|'no_attack'|'skip_draw'; who: 'random'|'highest_hp' }
  | { type: 'heal_self'; amount: number };

type BossPhase = { from_hp_pct: number; script: BossIntent[]; loop: boolean };  // script dijalankan berurutan per ronde
```

## 6. Format katalog (`content/catalog.v{N}.json`)

```json
{ "content_version": 1, "generated_at": 0, "series": ["aura","alik","..."],
  "cards": { "gc_aura_api": { /* baris game_cards tanpa field DB-only */ } },
  "tokens": { }, "bosses": { } }
```
Dihasilkan oleh `pnpm content:export` dari D1 (hanya `status='approved'`), di-bundle ke Worker dan web saat build. Ukuran target < 600 KB.

## 7. Sumber gambar & render kartu

- Simpan **foto mentah** di R2 (`art_key`). Jika pipeline gacha lama hanya menyimpan gambar jadi, Fase 0 menelusuri apakah foto mentah masih ada.
- Kartu game dirender **di browser** (komponen React + CSS meniru frame sekarang, ditambah lencana **Cost/ATK/HP**). Hasilnya: stat bisa berubah live saat buff, tanpa pipeline render server, dan hemat R2.
- Fallback: `art_key` null → emoji/ikon + warna series.
