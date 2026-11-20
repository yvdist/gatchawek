# Guide Tambah Data Kartu — Mode Cepat

Dokumen ini dibaca **sebelum** mengerjakan permintaan tambah/ubah data kartu
(member baru, grup baru, pool baru). Tujuannya: selesai dalam **±20 menit**,
tanpa mengulang kesalahan sesi KMP 2026-11-20 (sesi itu makan ~2 jam untuk
pekerjaan yang seharusnya 20 menit).

Prinsip: **percaya plan, verifikasi di ujung, bukan di tengah.**

---

## 0. Mode kerja (tentukan di awal)

Tanya diri sendiri satu hal: *apakah user memberi keputusan eksplisit*
(jumlah foto, sumber foto, toleransi kualitas)?

- **Ya → mode cepat.** Ikuti guide ini. Jangan verifikasi ulang fakta yang
  plan/user sudah nyatakan. Jangan tanya ulang keputusan user.
- **Tidak → mode normal.** Ikuti `AGENTS.md` + plan penuh, keputusan penting
  (`ask`) sebelum eksekusi.

Biaya mode cepat yang disadari: kualitas foto tidak dikurasi per foto,
kurasi visual jadi tech debt di laporan akhir (bukan di kode).

---

## 1. Jangan verifikasi ulang fakta plan (penghemat terbesar)

- Plan menyatakan "X sudah terverifikasi kemarin" → **pakai langsung**.
  Dilarang: probing judul Wikipedia satu-per-satu, cek QID/P373 per nama,
  baca ulang 10 file "untuk konteks".
- Bacaan wajib sebelum menulis kode, **hanya 3**:
  1. Skema roster (`scripts/discover-*.ts`, bagian `rosterSchema`).
  2. Fungsi yang diubah (`discoverMember`, `fetchRemoteImage`).
  3. `shared/manifest.schema.ts` (batas `photoSchema`/`memberSchema`).
- Fakta lain (isi tabel sumber, URL foto, struktur D1) dibaca **saat butuh**,
  bukan di muka.

## 2. Keputusan 1-foto (default untuk deadline)

Bila user bilang "1 foto cukup" / deadline <1 jam:

1. Trim manifest ke foto rank-1: tiap member `photos = [photos[0]]`,
   `photoNo = 1`.
2. Set `group.allowSinglePhoto = true` (skema sudah mendukung — jangan
   otak-atik `superRefine`).
3. Update **satu** assertion di `tests/manifest.test.ts` ke angka final
   **setelah** run (jangan tulis angka sebelum run).
4. Ingat di laporan: serial kartu lama berubah → koleksi user menunjuk kartu
   berbeda. Ini konsekuensi yang disetujui user, bukan bug — tapi wajib
   dilaporkan eksplisit.

## 3. Gate ukuran gambar

- `fetch-images.ts` era pasca-#21: undersize = **warn-only**, bukan reject.
  Jangan tambah gate baru, jangan hapus gate yang ada.
- Bila portrait resmi kecil (<500×700, mis. thumbnail Setneg 150×192):
  **biarkan lolos** — `build-cards` cover-crop + upscale ke frame 584×884,
  tidak kentara di kartu. User KMP 2026-11-20 memutuskan ini eksplisit.
- Satu-satunya gate yang tetap berlaku: file harus **ter-decode**
  (`loadImage` gagal → `decode failed`, tetap reject).

## 4. Pola fallback anti-tebak (pelajaran Sanae Takaichi)

- `wikipediaTitleFallback`: tulis **hanya** bila judul sudah terbukti ada
  (hasil run kemarin / user menyebut eksplisit). Tidak terbukti → jangan
  tulis; member gugur dengan benar (`fewer-than-3-eligible-photos`).
- Bila fallback Wikidata gagal massal (>5 member, pola sama: tanpa P373 /
  tanpa item), **setop probing** (rate-limit 429 hanya buang waktu).
  Langsung tulis `commonsCategoryFallback: "Category:<Nama Lengkap>"`
  untuk semuanya sekaligus — pola ini benar untuk tokoh Indonesia
  (>90% kategori Commons = nama lengkap), dan run ulang yang akan
  membuktikan per member (yang tidak ada kategorinya gugur dengan benar).
- Jangan pernah `curl` satu-per-satu dengan `sleep` manual untuk
  verifikasi massal. Satu run discover = verifikasi massal gratis.

## 5. Ritme edit–verify (anti-bug-sintaks)

- Maksimal **2 edit** tanpa `pnpm typecheck`. Pelanggaran aturan ini di sesi
  KMP merusak 4 file (import hilang, `const` termakan, kurung hilang).
- Setelah `typecheck` hijau → `pnpm lint` → lanjut. Test penuh (`pnpm test`)
  hanya di akhir; tengah jalan cukup
  `pnpm exec vitest run tests/<file-ubahan>.test.ts`.
- File CRLF (mis. `tests/manifest.test.ts`): hati-hati `PUT` menelan baris
  tetangga. Bila ragu, baca ulang region sebelum edit berikutnya.

## 6. Urutan eksekusi + kapan berhenti verifikasi

Urutan baku (tiap langkah hijau sebelum lanjut, **tanpa audit ekstra**):

```
roster → discover → validate → fetch → build → seed --remote → deploy → register → commit → PR → merge → hapus worktree
```

- `discover` full = background job (3–5 menit untuk ~70 member, jangan
  tunggu dengan `sleep` — kerjakan yang lain / akhiri turn).
- `fetch` gagal 429 massal + keputusan 1-foto sudah ada → **jangan retry**,
  langsung trim ke 1 foto (retry hanya untuk kasus tanpa keputusan 1-foto,
  maks 3 run dengan `--gap-ms 15000`).
- `seed --remote` gagal `UNIQUE cards.pool_id, cards.serial` → lock basi:
  regenerasi dari manifest kini (kartu lama dipertahankan, kartu baru di
  atas max serial prod). **Jangan** revert lock — itu mengembalikan bom waktu.
- Sebelum commit: `git status --short` — hanya file langkah di plan.
  Larangan tetap: `public/`, `.env`, `*.log`, `assets/raw/`, `data/reports/`.

## 7. Konflik dengan agent lain (checkout bersama)

- Branch sendiri, rebase (bukan merge). Konflik di file non-milik
  (grup dummy, inject harness, `serials.lock.json`): **ikuti main**,
  regenerasi bagian kita di atasnya.
- Test assertion angka grup kita ikut angka file kita; grup harness ikut main.
- Jangan sentuh checkout `D:/projects/gatchawek` selain read `.env`.

---

## Checklist mode cepat (copy ke awal kerja)

- [ ] Keputusan user dicatat (foto/member/sumber/toleransi)
- [ ] Baca hanya 3 file wajib (§1)
- [ ] Roster ditulis, tanpa probing ulang fakta plan
- [ ] Typecheck tiap ≤2 edit
- [ ] Discover full → validate → fetch → build → seed → deploy → register
- [ ] Bila ada kartu inject baru: `render-inject --remote` (laptop) → `deploy`
- [ ] Test + lint hijau, assertion = angka final run
