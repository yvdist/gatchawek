# FASE 5 — Mode Rebutan Takhta (FFA 3–6)

**Tujuan:** mode ramean khianat-khianatan yang seru, memakai engine yang sama lewat *rule module* baru.

**Baca dulu:** `01-GAME-DESIGN.md` §5 dan §8, `03-ARCHITECTURE.md` §5.

## Task

- [ ] **P5-T1 `FfaRules` module.** Implementasi `ModeRules`: 3–6 pemain, urutan giliran, ronde, target legal ke pemain/creature mana pun, Taunt melindungi hanya pemilik, eliminasi (creature dibuang), peringkat berdasar urutan eliminasi.
- [ ] **P5-T2 Takhta.** Hitung pemegang di awal tiap ronde (HP tertinggi, seri = kosong), Bounty +1 damage, bonus tarik 1 kartu untuk penyerang pertama per ronde, event `crown_changed`.
- [ ] **P5-T3 Bonus eliminasi.** Pembunuh tarik 2 + heal 3. Test pembunuhan oleh efek/spell dan oleh serangan.
- [ ] **P5-T4 Sudden Death.** Mulai ronde 12: damage `ronde−11` ke pemain aktif di awal gilirannya.
- [ ] **P5-T5 Operasi khianat.** `steal`, `swap_hands`, `drain`, `pajak` (sudah ada di DSL) bekerja dengan `chosen_player`; kartu dengan `modes` yang menyertakan `ffa` (spell khianat hanya boleh di FFA). Edge case: steal lalu pemilik asli tereliminasi, steal lalu creature mati.
- [ ] **P5-T6 Konten FFA.** Tambah ±15 spell khianat ke katalog (naik ke `content_version=2`, lewat alur validator, simulasi, dan review pemilik singkat). Perbarui laporan balancing dengan simulasi FFA 3–6 pemain (bot): cek tidak ada strategi "dogpile" yang selalu menang, game selesai ≤ 15 ronde di ≥ 95% kasus.
- [ ] **P5-T7 Bot FFA.** Bot normal dengan heuristik target (jangan hanya menyerang Takhta; pertimbangkan lethal, ancaman, dendam).
- [ ] **P5-T8 Room & lobby FFA.** Pilih mode, 3–6 kursi, kursi kosong diisi bot (opsi host), Blind Deck default, timer 45 dtk, AFK → bot.
- [ ] **P5-T9 UI FFA.** Tata letak 3–6 pemain di HP (lawan sebagai strip kecil yang bisa di-tap untuk membuka mejanya, indikator giliran dan Takhta 👑, HP semua pemain terlihat), pemilihan target pemain, log yang jelas "siapa menyerang siapa", layar eliminasi (penonton tetap bisa menonton), hasil peringkat.
- [ ] **P5-T10 Test.** Unit + property test FFA (500 game 3–6 pemain tanpa exception), test DO: pemain keluar di tengah game, penonton setelah eliminasi.
- [ ] **P5-T11 Playtest 🧑** dengan 4+ orang, catat temuan, lakukan satu putaran penyetelan aturan (angka Bounty, bonus eliminasi, batas Sudden Death) dan catat di Decision Log.

## Verifikasi
- Simulasi 3, 4, 5, 6 pemain: tidak ada deadlock, durasi wajar, distribusi menang tidak timpang ekstrem berdasar kursi (kursi pertama ≤ 25% pada 4 pemain).
- Playtest manusia dicatat.

## Definition of Done
Mode FFA playable 3–6 pemain online dengan bot pengisi, aturan `01` §5 lengkap, katalog v2 disetujui, status Fase 5 = DONE.
