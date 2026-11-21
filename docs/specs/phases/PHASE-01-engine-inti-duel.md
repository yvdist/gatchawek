# FASE 1 — Engine Inti + Mode Duel

**Tujuan:** engine murni yang bisa memainkan satu Duel 1v1 penuh dari awal sampai menang, teruji, dengan CLI teks untuk dicoba manusia. Kartu pakai **katalog dummy** (±40 kartu) dulu; konten asli di Fase 2.

**Baca dulu:** `01-GAME-DESIGN.md` §2–4 dan §8, `02-DATA-MODEL.md` §4–5, `03-ARCHITECTURE.md` §5.

## Task

- [ ] **P1-T1 Tipe inti** di `packages/shared`/`engine`: `GameState`, `PlayerState`, `CardInstance` (id, defId, seq, atk/hp saat ini, keyword aktif, status), `Action`, `GameEvent`, `EngineError`, `Catalog`.
- [ ] **P1-T2 RNG & setup.** mulberry32 di dalam state; `createGame` (shuffle deck, tarik awal, mulligan, tentukan pemain pertama, token Kopi).
- [ ] **P1-T3 Mana, giliran, timer logic.** `end_turn`, naik mana, tarik kartu, hand limit, fatigue, `runTimeout`.
- [ ] **P1-T4 Aksi kartu.** `play_creature` (slot, board penuh, cost), `cast_spell` (target), validasi lengkap + `legalActions`.
- [ ] **P1-T5 Pertempuran.** `attack` dengan Taunt, Rush, summoning sickness, retaliation, Shield, Lifesteal, Stealth, Freeze, 1 serangan per giliran.
- [ ] **P1-T6 Interpreter efek.** Semua 17 operasi `02` §4, antrean FIFO, target pilihan vs acak, `condition` sinergi, trigger `on_play/on_death/on_turn_*/on_attack/on_damaged/aura`, urutan trigger, `LOOP_GUARD` 200 langkah.
- [ ] **P1-T7 Kondisi menang & seri**, `surrender`.
- [ ] **P1-T8 `viewFor`** — penyaringan informasi tersembunyi + test bahwa tangan/deck lawan tidak bocor (serialisasi view tidak mengandung id kartu lawan di tangan/deck).
- [ ] **P1-T9 Katalog dummy** `content/catalog.dummy.json` (±40 kartu: creature berbagai class/keyword, 10 spell, 4 token) yang mencakup semua operasi efek.
- [ ] **P1-T10 Test.** Unit test per keyword/operasi; semua kasus tepi `01` §8 yang relevan Duel; property test (fast-check): 500 game acak (aksi legal acak) selesai tanpa exception, tanpa NaN, kartu konservatif (jumlah kartu total tetap), dan selalu berakhir atau mencapai batas ronde.
- [ ] **P1-T11 Determinisme.** Test: seed sama + urutan aksi sama = state akhir identik (hash).
- [ ] **P1-T12 CLI** `pnpm duel:cli` — main lawan bot acak di terminal (teks sederhana), berguna untuk uji manual.

## Catatan implementasi
- Mutasi boleh dilakukan di dalam `applyAction` pada salinan (structuredClone) atau pakai immer; pilih satu dan konsisten. State harus tetap JSON-serializable.
- Jangan hardcode kartu di engine; semua dari `Catalog`.
- Rule module mode: buat antarmuka `ModeRules` (turn order, target legal, win check, hooks awal/akhir giliran) dari sekarang agar Fase 5–6 tinggal menambah modul.

## Verifikasi
- `pnpm --filter engine test` hijau; cakupan engine ≥ 85% baris.
- `pnpm duel:cli` bisa dimainkan sampai ada pemenang.
- Property test 500 game lolos.

## Definition of Done
Semua task tercentang, aturan `01` §3 dan §4 terimplementasi lengkap, `ModeRules` ada, tidak ada import non-murni di engine (aturan lint `no-restricted-imports`), status Fase 1 = DONE.
