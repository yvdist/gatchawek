# 01 — Game Design

## 1. Pilar desain

1. **Kartu meme adalah bintangnya.** Nama, gambar, dan ability harus lucu; mekanik hanya pendukung.
2. **Mudah dipelajari dalam 2 menit**, dalam enam menit sudah terasa strategi.
3. **Ramean itu kelas satu.** FFA dan Co-op bukan tempelan dari 1v1.
4. **Gacha tetap berarti, tapi tidak pay-to-win.** Rarity memberi kartu lebih "keren", dibatasi *Deck Budget* (lihat 3.4).
5. **Turn-based**, jadi murah di infrastruktur dan ramah koneksi buruk.

## 2. Jenis kartu

| Kind | Punya | Keterangan |
|---|---|---|
| `creature` | cost, ATK, HP, keyword, ability | Ditaruh di meja (maks 5 slot per pemain) |
| `spell` | cost, efek | Langsung resolve lalu masuk discard |
| `token` | ATK/HP (creature) atau efek | Hanya dari efek, tidak masuk deck |
| `boss` | HP, fase, intent script | Hanya mode Raid |

**Rarity 1–5** (★ sampai ★★★★★; nama tingkat mengikuti data bot). Rarity menentukan *budget stat/efek* (lihat `02`), batas salinan, dan frame visual.

## 3. Aturan inti (dipakai semua mode)

### 3.1 Sumber daya
- **HP pemain:** Duel 20, FFA 20, Raid 15 per pemain.
- **Mana:** giliran ke-N pemain itu = `min(N, 8)` mana maksimum, terisi penuh tiap awal giliran. Kartu "Kopi" bisa beri +1 mana sementara.
- **Deck:** 20 kartu. **Tangan:** maks 8 (kartu ke-9 yang ditarik langsung dibuang, "kebanyakan jajan").
- **Mulligan:** sekali di awal, ganti kartu mana pun dari tangan awal.
- **Tarik awal:** pemain pertama 4, selain itu 5 + 1 token "Kopi".
- **Fatigue:** menarik dari deck kosong = damage ke pemain, naik 1 tiap kali (1, 2, 3, …).

### 3.2 Giliran
1. Awal giliran: naik mana → isi mana → tarik 1 kartu → trigger `on_turn_start`.
2. Fase aksi (urutan bebas, berapa kali pun selama mampu):
   - `play_creature` (bayar cost, pilih slot) → trigger `on_play`
   - `cast_spell` (bayar cost, pilih target bila perlu)
   - `attack` (creature milik sendiri menyerang target legal)
3. Akhir: `end_turn` → trigger `on_turn_end` → giliran berikutnya.
4. **Timer:** Duel 60 dtk, FFA 45 dtk, Raid 60 dtk per ronde. Habis = auto `end_turn`. 3 timeout beruntun = dianggap menyerah (diganti bot di FFA/Raid).

### 3.3 Serangan
- Creature boleh menyerang **1x per giliran**, tidak bisa di giliran ia ditaruh kecuali punya **Gercep (Rush)**.
- Target legal: creature lawan atau pemain lawan. Jika lawan punya creature **Pasang Badan (Taunt)**, creature/pemain itu *harus* diserang dulu (Taunt hanya melindungi pemiliknya sendiri).
- Creature vs creature: damage dua arah bersamaan. Creature vs pemain: tidak ada balasan.
- **Beku (Freeze):** creature tidak bisa menyerang sampai akhir giliran pemiliknya berikutnya.

### 3.4 Deck Budget (anti pay-to-win)
Deck valid jika: tepat 20 kartu · maks 2 salinan per kartu · maks **1 salinan untuk ★5** · **total bintang ≤ 40** (rata-rata ★2) · minimal 6 creature. Rarity tinggi memberi kartu lebih kuat per cost, tapi tidak bisa memenuhi satu deck.

### 3.5 Keyword

| Keyword (UI) | ID | Efek |
|---|---|---|
| Pasang Badan | `taunt` | Harus diserang dulu |
| Gercep | `rush` | Boleh menyerang di giliran ditaruh |
| Sedot | `lifesteal` | Damage yang diberikan menyembuhkan pemilik |
| Tameng | `shield` | Menyerap damage pertama sepenuhnya, lalu hilang |
| Ngumpet | `stealth` | Tidak bisa jadi target sampai ia menyerang |
| Beku | `frozen` | Status, lihat 3.3 |

### 3.6 Trigger ability
`on_play` · `on_death` · `on_turn_start` · `on_turn_end` · `on_attack` · `on_damaged` · `aura` (pasif selama di meja) · `on_cast` (spell).
Resolusi: efek masuk antrean FIFO. Beberapa trigger bersamaan diurut: pemain aktif dulu, lalu urutan giliran; dalam satu pemain, urut `seq` (siapa duluan ditaruh). Batas pengaman: **200 langkah efek per action**, lewat itu dihentikan dan dicatat sebagai `LOOP_GUARD` event.
Kematian dicek setelah setiap efek selesai; creature HP ≤ 0 pindah ke discard lalu trigger `on_death`.

### 3.7 Sinergi
Efek boleh bersyarat: `count(series=X) >= N`, `count(class=Y) >= N` di meja sendiri, atau `has_tag_in_hand`. Series diturunkan dari grup/seri kartu koleksi (maks ±12 series, sisanya `netral`).

## 4. Mode 1 — Duel 1v1

- 2 pemain, aturan inti apa adanya.
- Menang: HP lawan ≤ 0. Seri jika keduanya ≤ 0 bersamaan.
- Format: **Santai** (deck sendiri, tanpa rating), **Ranked** (Elo, K=32, mulai 1000), **Blind Deck** (masing-masing dapat 20 kartu acak yang seimbang rarity-nya, cocok jika tidak punya deck).
- Pemain pertama ditentukan RNG.

## 5. Mode 2 — Rebutan Takhta (FFA 3–6)

Aturan inti + tambahan:

- **Urutan giliran** searah jarum jam, pemain pertama acak. Timer 45 dtk.
- **Serangan:** boleh ke creature/pemain lawan mana pun. Taunt hanya melindungi pemiliknya.
- **Takhta 👑:** di awal tiap *ronde* (satu putaran semua pemain), pemain hidup dengan **HP tertinggi** memegang Takhta (seri → tidak ada yang pegang). Pemegang Takhta:
  - menerima **+1 damage** dari setiap serangan/efek damage yang mengenainya (Bounty), dan
  - penyerang pertamanya tiap ronde **menarik 1 kartu**.
  Ini rubber-band alami: yang unggul jadi target, tidak ada yang bisa kabur dengan aman.
- **Eliminasi:** pemain HP ≤ 0 keluar; creature-nya dibuang. Pembunuhnya **menarik 2 kartu dan heal 3**.
- **Spell khianat** (khas mode ini, dibatasi `modes` pada kartu): `steal` (kuasai creature sampai akhir giliran), `swap_hands`, `drain` (damage + heal diri), `pajak` (lawan buang kartu).
- **Sudden Death:** mulai ronde 12, tiap awal giliran pemain terkena damage `ronde − 11` ke dirinya.
- **Menang:** pemain terakhir hidup. Peringkat 2..N berdasarkan urutan eliminasi.
- **Kursi kosong / AFK** diisi bot agar game tidak macet.
- Pilihan deck: *Standar* (deck sendiri) atau *Blind Deck* (rekomendasi untuk tongkrongan).

## 6. Mode 3 — Raid Boss (Co-op 2–6)

- Pemain bekerja sama melawan **boss** (kartu ★5 yang diberi `boss config`).
- **Ronde:**
  1. **Fase Rencana** — semua pemain bermain *bersamaan* (60 dtk atau semua tekan "Siap"). Tiap pemain punya mana, tangan, dan meja sendiri; aturan kartu sama seperti 3.2–3.3. Target serangan: boss atau minion boss.
  2. **Fase Boss** — boss menjalankan **intent** yang sudah diumumkan sejak awal ronde (misal "Serang 5 ke pemain HP terendah", "AoE 2 ke semua", "Panggil 2 minion", "Kutuk: pemain X tidak bisa main spell"). Lalu intent ronde berikutnya diumumkan.
- **HP Boss:** `base_hp + hp_per_player × jumlah_pemain`. Boss punya 3 fase (100/66/33%) yang mengubah pola intent.
- **Pemain gugur** menjadi *hantu*: tidak bisa menaruh creature, tapi 1 spell dukungan per ronde ke rekan (heal/buff kecil). Mencegah pemain mati menunggu bosan.
- **Menang:** HP boss 0. **Kalah:** semua pemain gugur, atau ronde 12 (Enrage = boss mendapat damage ×2 per ronde).
- **Kesulitan:** Normal / Susah / Kacau (pengali HP dan damage boss: 1.0 / 1.3 / 1.6; reward naik).
- **Reward:** EXP, tiket gacha, peluang 1 salinan kartu boss. Dicatat di tabel `rewards` untuk dibaca bot Discord.

## 7. Mode bonus (murah, sesudah inti selesai)

- **Latihan vs Bot** (pakai bot heuristik dari Fase 2).
- **Blind Pick Cepat** (best-of-3, deck acak seimbang), melanjutkan "Blind Pick" yang sudah ada di bot.
- **2v2** (backlog): FFA dengan flag `teams`.

## 8. Kasus tepi yang wajib punya test

- Board penuh saat spell *summon* → token tidak muncul, tanpa error.
- Kartu terakhir di deck + fatigue.
- Dua creature saling bunuh bersamaan dan memicu `on_death` yang saling bunuh (loop guard).
- Taunt + Stealth pada creature yang sama (Stealth menang: tidak bisa ditarget, jadi tidak memaksa).
- Steal creature lalu pemilik asli tereliminasi.
- Disconnect lalu reconnect di tengah giliran sendiri.
- Dua aksi tiba bersamaan di Raid (diserialisasi oleh Durable Object).
- Pemegang Takhta berpindah di tengah ronde.
