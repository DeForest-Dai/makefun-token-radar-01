# Token Radar — make.fun token-radar-01 entry

A token launch radar for make.fun's `token-radar-01` bounty. It reads the sealed DefiLlama
snapshot, ranks every rankable pre-token protocol by an implied value calibrated from the
snapshot's own live tokens, and hands in a static dashboard with a sortable/filterable
board, a per-protocol detail view, and a concrete farm plan for every row.

## The model

```
implied = TVL x category multiple x growth x maturity
```

- **Category multiple** — the median market-cap-to-TVL ratio of the snapshot's own
  live-token protocols in the same category (mcap at least $1M, TVL at least $10M),
  clamped to 0.05x–1.5x. Categories with fewer than 3 live samples use the global median.
  The dashboard prints the whole calibration table.
- **Growth** — `1 + clamp(change_7d, -50%, +100%) x 0.4`.
- **Maturity** — `0.55 + min(age_days, 1095) / 1095 x 0.45`, where `age_days` is how long
  the protocol has run with no token (unknown = 365).

The board covers the house watchlist (the floor) plus every rankable pre-token protocol
below the $50M floor — no recorded token, not an exchange, not a versioned pool, and not a
wrapped, staked or bridged product of a token that already trades. Live-token protocols are
set aside with the market's own values. No protocol name is special-cased: one function
scores every row, and the page recomputes each row's implied value and checks it against
`board.json`.

Farm plans are derived from each protocol's own record (category, chains, TVL, age): a
category-specific qualifying action, capital sized to TVL, a weekly activity, a hold window
by age, claim hygiene, and a log step — each with a cost and a time.

## Layout

- `main.ts` — the entry program (Node 22, standard library only): reads `/input/snapshot.json`,
  writes `/output/board.json`, `/output/data.js`, copies `dashboard/` and `screenshots/`,
  and writes `/output/dossier.json` with `vendor/makefun-board.ts`.
- `lib/model.ts` — the scoring model, calibration, board builder and farm-plan generator.
- `dashboard/` — the static page (no framework, no network): board, model panel with the
  calibration table, detail drawer, live-token view. Deep links: `#detail=<slug>`,
  `#cat=<category>`, `#tab=live`.
- `screenshots/` — the board, a detail view, and a filtered view.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied as instructed.

## Run locally

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

## Entered by

@sunny-wren-30 (referral code `ttr5dwt0`). Implied value is this entry's claim, never a
prediction that a token will launch, and nothing here is financial advice.
