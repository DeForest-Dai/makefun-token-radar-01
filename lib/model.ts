// Token Radar model: implied values calibrated from the snapshot itself.
//
// Every figure on the board comes from the sealed snapshot's own records.
// A pre-token protocol's implied value is its TVL priced the way the market
// already prices live tokens in the same category:
//
//   implied = tvl_usd x categoryMultiple x growthMult x maturityMult
//
//   categoryMultiple = median (mcap / TVL) of the snapshot's live-token
//     protocols in the same category (mcap >= $1M, TVL >= $10M), clamped to
//     [0.05, 1.5]. Categories with fewer than 3 live samples use the global
//     median over every live protocol. The dashboard prints the whole table,
//     so a reader can check each multiple against the market's own numbers.
//   growthMult   = 1 + clamp(change_7d, -50, 100) / 100 x 0.4
//   maturityMult = 0.55 + min(age_days, 1095) / 1095 x 0.45
//     (age_days = days from listed_at to the snapshot's as_of; unknown = 365)
//
// The board ranks every rankable pre-token protocol in the snapshot (the
// watchlist is the floor, never the ceiling) and keeps live-token protocols
// in a separate view with the market's own values. No protocol name is ever
// special-cased: one function scores every row.

/** One protocol record from the sealed snapshot (its ten fields). */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    multiple_source: string;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A live-token protocol, shown with the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** One category's calibration: how many live protocols priced it, and the median multiple. */
export interface CalibrationRow {
  category: string;
  live_n: number;
  median_multiple: number;
  used_multiple: number;
}

/** The compact row the dashboard renders; the page re-derives farm plans from the same fields. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** Everything the dashboard needs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  formula: string;
  global_multiple: number;
  calibration: CalibrationRow[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why a snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
export const MODEL_VERSION = 'radar-calibrated-1';
export const FORMULA =
  'implied = TVL x category multiple (median mcap/TVL of live tokens in the category) x growth (1 + clamp(7d change, -50%, +100%) x 0.4) x maturity (0.55 to 1.0 over 3 token-less years)';

/** A finite number, else the fallback. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from listed_at to as_of, clamped at zero; null when either date is missing or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list. */
function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const MULTIPLE_MIN = 0.05;
const MULTIPLE_MAX = 1.5;
const clampMultiple = (m: number): number => Math.min(MULTIPLE_MAX, Math.max(MULTIPLE_MIN, m));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the house rule treats as products of a token that already trades, not launches of their own. */
const PRODUCT_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** A wrapped or staked product carries the word in its name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** An exchange's own product starts with the exchange's name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or
 * bridged product of a token that already trades (the house watchlist rule's visible tests).
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !PRODUCT_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/**
 * The category multiples, priced by the market's own live tokens. A live
 * protocol counts toward its category's median when its mcap is at least $1M
 * and its TVL at least $10M, so dust ratios never set a price. Categories
 * with fewer than 3 such samples use the global median; every multiple is
 * clamped to [0.05, 1.5]. Returns the table plus the global multiple.
 */
export function calibrate(snapshot: Snapshot): { table: CalibrationRow[]; globalMultiple: number; byCategory: Map<string, { multiple: number; source: string }> } {
  const samples = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd < 1_000_000 || p.tvl_usd < 10_000_000) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    const key = p.category ?? 'Uncategorized';
    const list = samples.get(key) ?? [];
    list.push(ratio);
    samples.set(key, list);
    all.push(ratio);
  }
  const globalMultiple = all.length > 0 ? clampMultiple(median(all)) : 0.25;
  const byCategory = new Map<string, { multiple: number; source: string }>();
  const table: CalibrationRow[] = [];
  const categories = new Set<string>();
  for (const p of snapshot.protocols) categories.add(p.category ?? 'Uncategorized');
  for (const category of [...categories].sort()) {
    const list = samples.get(category) ?? [];
    const med = list.length > 0 ? median(list) : null;
    const used = list.length >= 3 && med !== null ? clampMultiple(med) : globalMultiple;
    byCategory.set(category, {
      multiple: used,
      source: list.length >= 3 ? `median of ${list.length} live ${category} tokens` : 'global median (category has under 3 live samples)',
    });
    table.push({ category, live_n: list.length, median_multiple: med === null ? 0 : round4(med), used_multiple: round4(used) });
  }
  table.sort((a, b) => b.live_n - a.live_n || (a.category < b.category ? -1 : 1));
  return { table, globalMultiple, byCategory };
}

/** The three multipliers and the implied value one protocol gets. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  multiple: number,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const growthPct = Math.min(100, Math.max(-50, finite(p.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * 0.4;
  const ageForModel = age ?? 365;
  const maturityMult = 0.55 + (Math.min(Math.max(ageForModel, 0), 1095) / 1095) * 0.45;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one string within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Position size by the protocol's own TVL: big protocols need a bigger footprint to count. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 2_000_000_000) return 500;
  if (p.tvl_usd >= 500_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 20_000_000) return 100;
  return 50;
}

/** Hold window by age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 75;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** Gas for one setup transaction, by chain family. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('ethereum') || c.includes('mainnet')) return '$3-12 of Ethereum gas';
  if (c.includes('solana')) return 'under $0.05 of Solana fees';
  if (c.includes('tron') || c.includes('bsc') || c.includes('bnb')) return 'about $0.10-1 of gas';
  return 'about $0.50-3 of gas';
}

/** The category's qualifying action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against it so both sides of the market count you.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('options'))
    return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} and leave it earning.`;
  if (c.includes('bridge'))
    return `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds once in the destination app.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis'))
    return `Deposit $${capital} of USDC as margin on ${name} and open one small, hedged position.`;
  if (c.includes('prediction'))
    return `Fund $${capital} and take one small position in a liquid market on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('aggregator'))
    return `Deposit $${capital} into ${name}'s largest vault on ${chain} and keep the vault shares.`;
  if (c.includes('stable'))
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa'))
    return `Mint $${capital} of ${name}'s yield asset on ${chain} and hold it.`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('privacy'))
    return `Deposit $${capital} into ${name} on ${chain} and keep the balance parked there.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The weekly qualifying action, by category. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp')) return 'add a small supply or repay and re-borrow, so the account stays active on both sides';
  if (c.includes('dex') || c.includes('yield')) return 'make one small swap or rebalance the LP position';
  if (c.includes('bridge')) return 'bridge a small amount back or forth';
  if (c.includes('perpetual') || c.includes('derivative')) return 'open and close one small trade';
  if (c.includes('prediction')) return 'take one small position in a new market';
  return 'make one small deposit, withdrawal or governance action';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time,
 * derived from the protocol's own record (category, chains, TVL, age) —
 * never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm with ${p.name}; keep the seed phrase offline and never connect it to a claim site.`,
      cost: `${gas} for the first transaction`,
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital plus ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: `Each week, ${weeklyFor(p)}, so the wallet reads as an active user and not a one-day deposit.`,
      cost: `${gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity lands in more than one snapshot of the protocol's user base.`,
      cost: `the $${capital} stays in the position; smart-contract risk is real and no airdrop is promised`,
      time: `${hold} days`,
    },
    {
      text: `Check ${p.name}'s own points or rewards page from its official link only; a real claim never asks you to pay or to reveal your seed phrase.`,
      cost: 'nothing to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Log the wallet, dates, amounts and transaction hashes so you can repeat the position or unwind it cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/**
 * The ranked board: the watchlist (the floor) plus every rankable pre-token protocol below
 * the floor — the early rows the radar exists to find. Protocols at or above the floor that
 * the house rule left off the watchlist stay off: the rule's parent-protocol test is not in
 * the snapshot, and a child protocol is not a launch of its own.
 */
export function buildBoard(snapshot: Snapshot, cal: ReturnType<typeof calibrate>): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watchlistSet = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const entry = cal.byCategory.get(p.category ?? 'Uncategorized') ?? { multiple: cal.globalMultiple, source: 'global median' };
    // Round the multiple first: board.json and the page then run the identical arithmetic.
    const multiple = round4(entry.multiple);
    const { implied, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, multiple);
    return { p, entry, multiple, implied, growthPct, growthMult, maturityMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    on_watchlist: watchlistSet.has(s.p.slug),
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.multiple,
      multiple_source: s.entry.source,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the Live token view (the market's own values). */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    on_watchlist: row.on_watchlist,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const cal = calibrate(snapshot);
  const board = buildBoard(snapshot, cal);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.on_watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    formula: FORMULA,
    global_multiple: round4(cal.globalMultiple),
    calibration: cal.table,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
