# PROMPTS — Cara Menjalankan ke Agent Harness

Tiga prompt: **A** (Fase 0), **B** (Fase-N, dipakai *berulang* sampai semua DONE), **C** (Fase Final).
Prompt ditulis dalam bahasa Inggris agar agent konsisten; laporan ke kamu dalam Bahasa Indonesia.

## Persiapan satu kali

1. Salin seluruh isi `game-specs/` ke repo di `docs/specs/`.
2. Pastikan agent punya akses terminal, git, `pnpm`, dan `wrangler` (login di mesinmu).
3. Mulai sesi baru untuk **setiap** fase (konteks segar). Progress ada di `docs/specs/TRACKER.md`.

---

## Prompt A — Fase 0 (sekali)

```text
You are the lead engineer building a web card game on Cloudflare's free tier.
The complete spec pack is in docs/specs/. Start by reading, in order:
1. docs/specs/00-README.md  (golden rules, stack, glossary)
2. docs/specs/TRACKER.md
3. docs/specs/02-DATA-MODEL.md (sections 1-2) and docs/specs/03-ARCHITECTURE.md (sections 1-2)
4. docs/specs/phases/PHASE-00-recon-dan-fondasi.md

Then execute PHASE 0 completely:
- Copy the Phase 0 task list into TRACKER.md (section "Fase 0") and set the phase to IN_PROGRESS.
- Work task by task in order. After each task: run its verification, run `pnpm check` (once it exists),
  tick the checkbox in TRACKER.md, and make one git commit named `phase-0: <task id> <short title>`.
- P0-T1 is a read-only recon of the existing Discord gacha bot, D1 schema and R2 layout. Never modify
  existing tables or the bot's behaviour. Write real table/column names into docs/PROJECT_STATE.md
  (do not guess; inspect the code, migrations, or the D1 database).
- If you need something only the owner can provide (Cloudflare login/IDs, access to the bot repo, Discord
  credentials), add a row to "Blockers" in TRACKER.md, set the phase to BLOCKED, and stop with a clear,
  specific request. Do not invent credentials or mock around a blocker silently.
- Any deviation from the spec goes into the Decision Log with the reason.
- Do NOT start Phase 1. Stop when the Phase 0 Definition of Done is fully met and mark it DONE
  (with date and a 1-3 sentence summary).

Final message (in Bahasa Indonesia): what you did, what you found about the existing system,
decisions made, anything the owner must do next, and the exact command to start Phase 1.
```

---

## Prompt B — Fase-N (ULANGI prompt yang sama untuk Fase 1 sampai 7)

Jalankan prompt ini di sesi baru, lagi dan lagi, sampai `TRACKER.md` menunjukkan Fase 1–7 semuanya `DONE`.
Agent sendiri yang memilih fase berikutnya, jadi kamu tidak perlu mengganti apa pun.

```text
You are the lead engineer continuing a web card game build (Cloudflare free tier). The spec pack is in docs/specs/.

STEP 1 - Orient
- Read docs/specs/00-README.md and docs/specs/TRACKER.md and docs/PROJECT_STATE.md.
- Find the FIRST phase among 1..7 whose status is not DONE. That is your phase (call it N).
  If its status is BLOCKED, check whether the blocker in TRACKER.md has been resolved; if not, stop and
  tell the owner exactly what is still needed.
  If phases 1..7 are all DONE, do nothing except report that and recommend running the Final Phase prompt.
- Read docs/specs/phases/PHASE-0N-*.md fully, plus every spec section it tells you to read first.
  Also read the Decision Log and "Temuan & utang teknis" in TRACKER.md so you respect earlier decisions.

STEP 2 - Plan
- If the phase checklist in TRACKER.md is still the "(diisi agent)" placeholder, copy the phase's tasks into it
  and set the phase to IN_PROGRESS. If it is already partially ticked, resume from the first unticked task
  (verify the last ticked task still passes before moving on).

STEP 3 - Execute
- Work task by task, in order. For each task: implement, write or update tests, run the task's verification,
  run `pnpm check` (must be green), tick the box in TRACKER.md, and make one commit:
  `phase-N: <task id> <short title>`.
- Follow the golden rules in 00-README.md. In particular: the engine stays pure and deterministic; the server is
  authoritative and never sends hidden information; card stats are constant data (never randomized at runtime);
  never modify the legacy gacha tables; stay free-tier friendly (no polling, Hibernation API, bundled catalog).
- Keep changes scoped to the phase. Do not build features of later phases. If you notice an issue outside the
  scope, log it under "Temuan & utang teknis" instead of fixing it.
- If the spec is ambiguous or you must deviate, choose the simplest option consistent with the golden rules,
  and record it in the Decision Log (date, phase, decision, reason, spec impact). If the deviation changes
  the rules or schema, also update the relevant spec file.
- Human gates (marked with the owner emoji in the phase file, e.g. reviewing card stats, playtests, credentials):
  prepare everything needed for the owner, then set the phase to BLOCKED with a precise request in "Blockers"
  and stop. Do not self-approve a human gate.
- If the session is running long, make sure TRACKER.md and git are up to date at a clean task boundary so the next
  session can resume with this same prompt.

STEP 4 - Close the phase
- Check every item in the phase's "Verification" and "Definition of Done". Only then mark the phase DONE in
  TRACKER.md with today's date and a 1-3 sentence summary.
- Stop after finishing ONE phase. Do not start the next one.

FINAL MESSAGE (Bahasa Indonesia): which phase you worked on, status (DONE/BLOCKED/IN_PROGRESS), what changed,
how to try it (exact commands/URLs), decisions and deviations, open issues, and what the owner must do (if anything).
End with: "Jalankan prompt Fase-N yang sama lagi untuk lanjut." if more phases remain, otherwise
"Semua fase 1-7 selesai, jalankan prompt Fase Final."
```

> Tips: kalau agent kehabisan konteks di tengah fase, cukup jalankan prompt yang sama lagi; dia akan lanjut dari task terakhir yang belum dicentang.

---

## Prompt C — Fase Final (Fase 8)

```text
You are the lead engineer closing out a web card game build (Cloudflare free tier). The spec pack is in docs/specs/.

PRECONDITION: read docs/specs/TRACKER.md. Phases 0-7 must all be DONE. If not, stop and report which are not.

Then read, in full: docs/specs/00-README.md, 01-GAME-DESIGN.md, 02-DATA-MODEL.md, 03-ARCHITECTURE.md,
docs/specs/phases/PHASE-08-FINAL-hardening-rilis.md, the Decision Log, and "Temuan & utang teknis" in TRACKER.md.

Execute PHASE 8 as an AUDIT-AND-HARDEN phase, not a feature phase:
- Copy the Phase 8 tasks into TRACKER.md, set IN_PROGRESS, and work task by task with one commit per task
  (`phase-8: <task id> <short title>`), `pnpm check` green after each.
- P8-T1: build docs/AUDIT.md by checking the actual code and tests against EVERY requirement in 01, 02 and 03
  (not from memory of what you built). Fix every gap or document it as a deliberate deviation.
- P8-T2/T3: be adversarial. Try to leak hidden info, forge actions, replay tickets, flood messages, break turn
  order, double-claim rewards, and crash the engine with fuzzed input. Fix what you find and add regression tests.
- P8-T4: measure real usage against the free-tier limits in 03-ARCHITECTURE.md section 6, and re-check the current
  Cloudflare documentation for Workers/Durable Objects/D1/R2 free limits since they may have changed. Report the
  margin honestly; optimise if it is under 30%.
- Owner-only steps (production deploy, DNS/domain, Discord production redirect URI, final content approvals):
  prepare scripts and a precise checklist, set the phase BLOCKED with the request, and stop. Do not deploy to
  production without the owner's go-ahead.
- Finish with P8-T13: update TRACKER.md with a final summary and write docs/ROADMAP.md.
- Mark Phase 8 DONE only when the Definition of Done is fully met and AUDIT.md contains no unresolved items.

FINAL MESSAGE (Bahasa Indonesia): audit summary (counts of OK/deviation/fixed), security findings and fixes,
capacity numbers and safe matches-per-day estimate, remaining risks, production launch steps for the owner,
and a ready-to-paste announcement text for the group chat.
```

---

## Prompt cadangan (opsional)

**Lanjut setelah BLOCKED** (setelah kamu menyelesaikan tugas pemilik):
```text
The owner has resolved the blockers listed in docs/specs/TRACKER.md (details: <tulis apa yang sudah kamu lakukan, mis. "stat kartu sudah direview, file content/review/cards-review.csv sudah diedit">). Re-read TRACKER.md, verify the blockers are really resolved, update their status, then continue the current phase using the Fase-N prompt procedure.
```

**Minta revisi spesifik di tengah jalan:**
```text
Before continuing, apply this design change: <perubahan>. Update the affected spec files (01/02/03 and phase files), record it in the Decision Log, adjust the TRACKER checklist if tasks change, then implement it as part of the current phase and add tests.
```

**Cek kewarasan (kapan saja):**
```text
Without changing code, review the repo against docs/specs and TRACKER.md. Report: tasks ticked but not actually done, drift from the golden rules (engine purity, hidden-information leaks, polling, runtime randomness of stats, edits to legacy tables), and the top 5 risks. Answer in Bahasa Indonesia.
```
