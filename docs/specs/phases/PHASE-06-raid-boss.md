# FASE 6 — Mode Raid Boss (Co-op 2–6)

**Tujuan:** semua pemain bersama melawan boss meme dengan intent yang terlihat, fase boss, dan reward.

**Baca dulu:** `01-GAME-DESIGN.md` §6, `02-DATA-MODEL.md` §5, `03-ARCHITECTURE.md` §3 dan §5.

## Task

- [ ] **P6-T1 `RaidRules` module.** Fase Rencana simultan (semua pemain boleh bertindak bersamaan, tiap pemain mana/tangan/meja sendiri), tombol `raid_ready`, ronde berakhir saat semua siap atau timer 60 dtk habis. Aksi simultan tetap diserialisasi DO; tidak ada race.
- [ ] **P6-T2 Boss entity.** HP = `base_hp + hp_per_player × n`, fase di 100/66/33%, boss bisa jadi target `boss`, minion boss (token) dengan Taunt menghalangi serangan ke boss, status (freeze/silence berlaku pada boss dengan batasan: boss kebal destroy, freeze hanya 1 ronde).
- [ ] **P6-T3 Intent system.** Eksekusi `BossIntent` (`attack_target`, `aoe_players`, `summon_minions`, `buff_self`, `curse`, `heal_self`), pengumuman intent ronde berikutnya di `view`, event `boss_intent` untuk animasi. Intent tidak boleh acak yang tak bisa diprediksi: pemain wajib bisa merencanakan.
- [ ] **P6-T4 Hantu.** Pemain gugur jadi hantu: 1 spell dukungan per ronde (heal 2 / buff +1 ATK sementara) ke rekan, tidak punya meja.
- [ ] **P6-T5 Kondisi menang/kalah & Enrage.** Menang HP boss 0; kalah semua gugur; ronde 12 Enrage (damage boss ×2 per ronde berikutnya). Kesulitan Normal/Susah/Kacau (pengali 1.0/1.3/1.6).
- [ ] **P6-T6 Konten boss.** Siapkan 6 boss dari kartu ★5 (naik ke `content_version=3`): tiap boss punya tema, 3 fase, minion, dan 1 mekanik khas (mis. kutukan "tidak boleh spell", boss yang membuat Takhta). Setiap boss punya `rewards` (EXP, tiket gacha, peluang salinan kartu boss). Validator ditambah untuk `bosses`.
- [ ] **P6-T7 Simulasi & balancing raid.** Bot kooperatif (2–6 pemain) vs tiap boss di tiap kesulitan. Target tingkat kemenangan bot `normal`: Normal 60–75%, Susah 35–50%, Kacau 10–25%. Setel `base_hp`/`hp_per_player`/damage lewat laporan `content/balance/report-raid.md`.
- [ ] **P6-T8 Reward.** Saat menang, tulis `rewards` ke D1 (exp, gacha_ticket, card_copy dengan peluang), sekali per pemain per match, anti-duplikasi (idempotent berdasar `match_id`). Pemain yang gugur tetap dapat reward penuh jika tim menang (partisipasi).
- [ ] **P6-T9 UI Raid.** Layar boss besar di atas (HP bar bertahap fase, intent berikutnya jelas dengan ikon + teks), strip rekan satu tim (HP, siap/belum), meja sendiri di bawah, tombol Siap, layar hantu, layar hasil dengan reward. Pilihan boss dan kesulitan di lobby.
- [ ] **P6-T10 Bot rekan.** Kursi kosong atau AFK diisi bot kooperatif.
- [ ] **P6-T11 Test.** Property test (500 raid acak), test DO untuk aksi simultan dan reconnect di tengah Fase Rencana, idempotensi reward.
- [ ] **P6-T12 Playtest 🧑** dengan 3–5 orang, setel angka, catat di Decision Log.

## Verifikasi
- Semua boss bisa dikalahkan dan bisa dikalahkan-oleh pada simulasi (tidak ada boss yang mustahil atau trivial).
- Tidak ada reward ganda saat reconnect atau DO restart.

## Definition of Done
Raid playable 2–6 pemain, 6 boss, 3 kesulitan, reward tercatat benar, katalog v3 disetujui, status Fase 6 = DONE.
