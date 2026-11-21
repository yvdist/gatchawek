# FASE 2 — Konten Kartu & Balancing

**Tujuan:** 300+ kartu koleksi menjadi **kartu game dengan stat konstan**, plus spell, token, boss. Ada bot dan simulasi untuk mengecek keseimbangan. Ada **gate review pemilik**.

**Baca dulu:** `02-DATA-MODEL.md` (seluruhnya), `01-GAME-DESIGN.md` §3.5–3.7, `PROJECT_STATE.md`.

## Task

- [ ] **P2-T1 Ekspor seed.** `scripts/export-seed` membaca kartu koleksi → `content/cards.seed.csv` (id, judul, rarity, grup, nomor, art_key).
- [ ] **P2-T2 Tentukan series.** Turunkan series dari grup/awalan judul (mis. "Aura …", "Alik …", "Abang …"). Maks ±12 series, sisanya `netral`. Hasil usulan ditulis ke `content/series.proposal.md`.
- [ ] **P2-T3 Kalkulator budget.** `packages/engine` atau `scripts`: fungsi `statBudget(cost, rarity, abilityPoints, class)` dan tabel poin efek (`02` §3) sebagai data. Unit test.
- [ ] **P2-T4 Generator stat (deterministik).** Untuk tiap kartu: tentukan `class` (heuristik dari judul/seri + sebar merata), `cost` dari rarity + class, pilih ability dari pustaka efek sesuai class, hitung ATK/HP dengan formula, tulis ke `content/game_cards.draft.json`. Generator memakai hash id kartu sebagai seed sehingga hasilnya **stabil di tiap run**.
- [ ] **P2-T5 Teks lucu.** Untuk setiap kartu, buat `ability_name`, `ability_text` (1 kalimat, mencerminkan efek persis) dan `flavor_text` pendek yang cocok dengan judul meme. Kerjakan dalam batch ±25 kartu, tulis nada humor ala tongkrongan (aman, tidak menyinggung SARA/pribadi yang menyakitkan). Kartu bergambar orang nyata: humor berdasar judul yang sudah ada, tanpa menambah ejekan baru.
- [ ] **P2-T6 Spell, token, boss.** Buat ±40 spell (mis. Api, Sapu, Nasi Padang, Kopi, Sandal Jepit…), ±12 token, ±6 boss (dari kartu ★5 + `boss config`) dengan `art_key` null (placeholder emoji). Daftarkan daftar gambar yang dibutuhkan ke `content/art-needed.md` untuk dicari pemilik.
- [ ] **P2-T7 Validator.** `scripts/validate-content` (jalan di `pnpm check`): skema, batas stat, budget ±1, keyword valid, `token_id` ada, tidak ada ability tanpa teks, distribusi (tiap class 15–25%, tiap rarity sesuai data lama), setiap series ≥ 6 kartu atau `netral`.
- [ ] **P2-T8 Bot heuristik.** `packages/bots`: bot yang memilih aksi legal dengan skor sederhana (value trade, lethal check, curve). Level `easy` (acak terarah) dan `normal`.
- [ ] **P2-T9 Simulator.** `pnpm sim --games 10000`: bot vs bot dengan deck acak yang lolos Deck Budget. Laporan `content/balance/report-v1.md`: win-rate tiap kartu (dengan kontrol frekuensi muncul), tiap series/class/rarity, rata-rata panjang game, persentase game mentok batas ronde.
- [ ] **P2-T10 Iterasi balancing.** Kartu dengan win-rate di luar 42–58% (sampel cukup) disetel (stat/cost/efek) di draft; ulang simulasi sampai ≥ 90% kartu masuk rentang. Catat perubahan di laporan.
- [ ] **P2-T11 Paket review pemilik.** Hasilkan `content/review/cards-review.csv` (id, judul, rarity, class, series, cost, ATK, HP, ability_name, ability_text, catatan_win_rate) + ringkasan 1 halaman. **Berhenti dan minta review.** 🧑 Pemilik boleh mengedit CSV.
- [ ] **P2-T12 Impor hasil review → D1.** `scripts/import-reviewed` memasukkan ke `game_cards` (`status='approved'`, `content_version=1`), menjalankan validator lagi.
- [ ] **P2-T13 Ekspor katalog.** `pnpm content:export` → `content/catalog.v1.json` (< 600 KB), dipakai engine/api/web. Ganti katalog dummy di test dengan katalog asli.
- [ ] **P2-T14 Beku.** Tambah test snapshot: hash katalog v1 tidak boleh berubah tanpa menaikkan `content_version`.

## 🧑 Gate pemilik
P2-T11 butuh review CSV (kelucuan, rarity yang terasa adil, kartu yang ingin dibuat spesial). Tanpa persetujuan, fase tidak boleh DONE. Pemilik juga mencari gambar untuk daftar di `art-needed.md` (boleh menyusul di Fase 7/8).

## Verifikasi
- `pnpm validate-content` hijau; laporan sim v1 ada; ≥ 90% kartu win-rate 42–58%.
- Katalog v1 dimuat engine dan 500 game property test Fase 1 tetap lolos memakai katalog asli.

## Definition of Done
Katalog v1 disetujui pemilik dan dibekukan, laporan balancing tersimpan, bot `easy` dan `normal` berfungsi, daftar gambar yang dibutuhkan tersedia, status Fase 2 = DONE.
