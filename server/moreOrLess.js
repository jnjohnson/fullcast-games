// TODO
// Check to see if win percentage is calculated for coaches entire history, not just since 2000.
// Same goes for schools

import { cfbdGql } from './cfbd.js';
import { kvGet, kvPut } from './kv.js';
import { P4_SCHOOLS } from './constants.js';

// Coach and school records only count FBS seasons from this year on.
const RECORD_SINCE = 2000;
// Player pool: NFL draft picks from this year on (so their college careers reach 2020 or later).
const DRAFT_SINCE = 2021;
// Coaches need at least this many qualifying seasons, which filters out interim coaches.
const MIN_COACH_SEASONS = 5;
// How many random picks to try before giving up on finding a usable subject.
const MAX_ATTEMPTS = 8;
// KV lifetimes (seconds). The coach count only changes when a coach reaches MIN_COACH_SEASONS, and the
// draft pools only change after each NFL draft, so both can be cached for a long time.
const COACH_COUNT_TTL = 60 * 60 * 24 * 30; // ~30 days
const DRAFT_POOL_TTL = 60 * 60 * 24 * 30;   // 30 days

const COACH_SEASON_FILTER = {
    year: { _gte: RECORD_SINCE },
    team: { classification: { _eq: 'fbs' } },
};
const COACH_FILTER = {
    seasonsAggregate: { count: { predicate: { _gte: MIN_COACH_SEASONS }, filter: COACH_SEASON_FILTER } },
};

const WIN_PCT = { key: 'winPct', label: `win % since ${RECORD_SINCE}` };

// Player stats by position group. `category` and `type` are CFBD playerStatCategory / playerStatType names.
const STATS = {
    completions: { key: 'completions', label: 'career completions',     category: 'passing',   type: 'C/ATT' },
    passYards:   { key: 'passYards',   label: 'career passing yards',   category: 'passing',   type: 'YDS' },
    passTds:     { key: 'passTds',     label: 'career passing TDs',     category: 'passing',   type: 'TD' },
    rushYards:   { key: 'rushYards',   label: 'career rushing yards',   category: 'rushing',   type: 'YDS' },
    rushTds:     { key: 'rushTds',     label: 'career rushing TDs',     category: 'rushing',   type: 'TD' },
    carries:     { key: 'carries',     label: 'career carries',         category: 'rushing',   type: 'CAR' },
    receptions:  { key: 'receptions',  label: 'career receptions',      category: 'receiving', type: 'REC' },
    recYards:    { key: 'recYards',    label: 'career receiving yards', category: 'receiving', type: 'YDS' },
    recTds:      { key: 'recTds',      label: 'career receiving TDs',   category: 'receiving', type: 'TD' },
};
const PLAYER_GROUPS = {
    qb: { positions: ['QB'],       stats: ['completions', 'passYards', 'passTds', 'rushYards'] },
    rb: { positions: ['RB'],       stats: ['rushYards', 'rushTds', 'carries', 'recYards'] },
    wr: { positions: ['WR', 'TE'], stats: ['receptions', 'recYards', 'recTds'] },
};

// Players show up twice as often as coaches or schools on a fresh run.
const QUESTION_TYPES = ['player', 'player', 'coach', 'school'];

// ─── Pure helpers ────────────────────────────────────────────────────────────

// Returns a random element of `arr`, or undefined if it's empty.
function randomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// Returns a shuffled copy of `arr` (Fisher-Yates).
function shuffle(arr) {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

// Computes win percentage from a { wins, losses, ties } record, counting a tie as half a win.
// Returns a number between 0 and 1, or 0 when no games were played.
export function winPct({ wins = 0, losses = 0, ties = 0 }) {
    const games = wins + losses + ties;
    return games === 0 ? 0 : (wins + ties / 2) / games;
}

// Adds up per-game CFBD stat strings into a career total.
// For `C/ATT` rows ("20/28") it counts completions, the number before the slash.
// Non-numeric values count as 0.
export function sumStatRows(rows, statType) {
    return rows.reduce((total, row) => {
        const raw = statType === 'C/ATT' ? String(row.stat).split('/')[0] : row.stat;
        const value = Number(raw);
        return total + (isNaN(value) ? 0 : value);
    }, 0);
}

// Checks a guess about subject B relative to subject A.
// `guess` is 'more' or 'less'. A tie counts as correct for either guess.
export function isCorrect(aValue, bValue, guess) {
    if (aValue === bValue) return true;
    return guess === 'more' ? bValue > aValue : bValue < aValue;
}

// Formats a value for display.
// Win % shows as ".800 (187-53)" (ties appended when present); other stats use thousands separators.
export function formatValue(statKey, value, record) {
    if (statKey !== WIN_PCT.key) {
        return value.toLocaleString('en-US');
    }
    const pct = value.toFixed(3).replace(/^0/, '');
    const { wins, losses, ties } = record;
    return `${pct} (${wins}-${losses}${ties ? `-${ties}` : ''})`;
}

// Removes B's hidden value and the internal stat fields before a question is sent to the client.
function toPublicQuestion(id, q) {
    return {
        id,
        type: q.type,
        stat: { key: q.stat.key, label: q.stat.label },
        a: { name: q.a.name, detail: q.a.detail, value: q.a.value, display: q.a.display },
        b: { name: q.b.name, detail: q.b.detail },
    };
}

// ─── CFBD fetchers ───────────────────────────────────────────────────────────

// Returns how many coaches match COACH_FILTER. Cached in KV under `mol:coach-count` for COACH_COUNT_TTL.
// A stale count is harmless: an offset past the end returns no coach, and pickCoaches retries.
async function getCoachCount(env) {
    const cacheKey = 'mol:coach-count';
    const cached = await kvGet(cacheKey, env);
    if (cached !== null) {
        return cached;
    }

    const data = await cfbdGql(
        `query($where: CoachBoolExp) { coachAggregate(where: $where) { aggregate { count } } }`,
        { where: COACH_FILTER },
        env
    );
    const total = data.coachAggregate.aggregate.count;
    await kvPut(cacheKey, total, env, COACH_COUNT_TTL);
    return total;
}

// Picks `count` distinct random coaches with at least MIN_COACH_SEASONS FBS seasons since RECORD_SINCE,
// skipping any id in `excludeIds`. Gets the (usually cached) coach count, then makes one query per coach.
// Returns subjects: [{ id, name, detail, value, display, record }].
async function pickCoaches(count, excludeIds, env) {
    const total = await getCoachCount(env);
    const picked = [];
    const seen = new Set(excludeIds);

    for (let attempt = 0; picked.length < count && attempt < MAX_ATTEMPTS * count; attempt++) {
        const data = await cfbdGql(`
            query($where: CoachBoolExp, $seasons: CoachSeasonBoolExp, $offset: Int!) {
                coach(where: $where, limit: 1, offset: $offset) {
                    id
                    firstName
                    lastName
                    seasons(where: $seasons, orderBy: { year: DESC }, limit: 1) { team { school } }
                    seasonsAggregate(where: $seasons) { aggregate { sum { wins losses ties } } }
                }
            }
        `, { where: COACH_FILTER, seasons: COACH_SEASON_FILTER, offset: Math.floor(Math.random() * total) }, env);

        const coach = data.coach[0];
        if (!coach || seen.has(coach.id)) continue;
        seen.add(coach.id);

        const record = coach.seasonsAggregate.aggregate.sum;
        const value = winPct(record);
        picked.push({
            id: coach.id,
            name: `${coach.firstName} ${coach.lastName}`,
            detail: coach.seasons[0]?.team?.school ?? '',
            value,
            display: formatValue(WIN_PCT.key, value, record),
            record,
        });
    }
    if (picked.length < count) throw new Error('Could not find enough coaches');
    return picked;
}

// Builds a school subject from its summed coachSeason records since RECORD_SINCE.
// Returns { id, name, detail, value, display, record }.
async function schoolSubject(school, env) {
    const data = await cfbdGql(`
        query($where: CoachSeasonBoolExp) {
            coachSeasonAggregate(where: $where) { aggregate { sum { wins losses ties } } }
        }
    `, { where: { year: { _gte: RECORD_SINCE }, team: { school: { _eq: school } } } }, env);

    const record = data.coachSeasonAggregate.aggregate.sum;
    const value = winPct(record);
    return {
        id: school,
        name: school,
        detail: `Since ${RECORD_SINCE}`,
        value,
        display: formatValue(WIN_PCT.key, value, record),
        record,
    };
}

// Picks `count` distinct random P4 schools not in `excludeIds` and returns their subjects.
async function pickSchools(count, excludeIds, env) {
    const schools = shuffle(P4_SCHOOLS.filter(s => !excludeIds.includes(s))).slice(0, count);
    return Promise.all(schools.map(school => schoolSubject(school, env)));
}

// Returns the draft pool for a position group: [{ id, name, detail }], one per drafted player
// with a linked CFBD athlete record. Cached in KV under `mol:draft:<group>` for DRAFT_POOL_TTL.
async function getDraftPool(group, env) {
    const cacheKey = `mol:draft:${group}`;
    const cached = await kvGet(cacheKey, env);
    if (cached) return cached;

    const data = await cfbdGql(`
        query($where: DraftPicksBoolExp) {
            draftPicks(where: $where) {
                position { abbreviation }
                collegeTeam { school }
                collegeAthleteRecord { id firstName lastName }
            }
        }
    `, { where: {
        year: { _gte: DRAFT_SINCE },
        position: { abbreviation: { _in: PLAYER_GROUPS[group].positions } },
    } }, env);

    const pool = data.draftPicks
        .filter(pick => pick.collegeAthleteRecord)
        .map(pick => ({
            id: pick.collegeAthleteRecord.id,
            name: `${pick.collegeAthleteRecord.firstName} ${pick.collegeAthleteRecord.lastName}`,
            detail: `${pick.position.abbreviation} · ${pick.collegeTeam?.school ?? 'N/A'}`,
        }));
    await kvPut(cacheKey, pool, env, DRAFT_POOL_TTL);
    return pool;
}

// Fetches one player's per-game rows for a single stat and adds them into a career total.
async function playerStatValue(athleteId, stat, env) {
    const data = await cfbdGql(`
        query($id: bigint!, $category: String!, $type: String!) {
            gamePlayerStat(where: {
                athleteId: { _eq: $id }
                playerStatCategory: { name: { _eq: $category } }
                playerStatType: { name: { _eq: $type } }
            }) { stat }
        }
    `, { id: athleteId, category: stat.category, type: stat.type }, env);
    return sumStatRows(data.gamePlayerStat, stat.type);
}

// Returns a copy of a player from the draft pool with `value` and `display` filled in for `stat`.
async function withPlayerValue(player, stat, env) {
    const value = await playerStatValue(player.id, stat, env);
    return { ...player, value, display: formatValue(stat.key, value) };
}

// Picks a random player from `group` who isn't in `excludeIds` and has a non-zero total for `stat`.
// Throws after MAX_ATTEMPTS players with no usable value.
async function pickPlayer(group, stat, excludeIds, env) {
    const pool = (await getDraftPool(group, env)).filter(p => !excludeIds.includes(p.id));
    for (const player of shuffle(pool).slice(0, MAX_ATTEMPTS)) {
        const subject = await withPlayerValue(player, stat, env);
        if (subject.value > 0) return subject;
    }
    throw new Error(`Could not find a ${group} player with ${stat.key}`);
}

// ─── Question builders ───────────────────────────────────────────────────────

// Builds the first question of a run. `type` is 'player', 'coach' or 'school'; random when omitted.
// Returns the full question, including B's hidden value: { type, stat, group?, a, b }.
async function buildFreshQuestion(type, env) {
    type = QUESTION_TYPES.includes(type) ? type : randomItem(QUESTION_TYPES);

    if (type === 'coach') {
        const [a, b] = await pickCoaches(2, [], env);
        return { type, stat: WIN_PCT, a, b };
    }
    if (type === 'school') {
        const [a, b] = await pickSchools(2, [], env);
        return { type, stat: WIN_PCT, a, b };
    }

    const group = randomItem(Object.keys(PLAYER_GROUPS));
    const stat = STATS[randomItem(PLAYER_GROUPS[group].stats)];
    const a = await pickPlayer(group, stat, [], env);
    const b = await pickPlayer(group, stat, [a.id], env);
    return { type, group, stat, a, b };
}

// Builds the next question in a streak: the previous B becomes A, and a new B of the same type is picked.
// Player questions switch to a different stat for the group when possible, using the first one
// where the new A has a non-zero total.
async function buildNextQuestion(prev, env) {
    const exclude = [prev.a.id, prev.b.id];

    if (prev.type === 'coach') {
        const [b] = await pickCoaches(1, exclude, env);
        return { type: prev.type, stat: WIN_PCT, a: prev.b, b };
    }
    if (prev.type === 'school') {
        const [b] = await pickSchools(1, exclude, env);
        return { type: prev.type, stat: WIN_PCT, a: prev.b, b };
    }

    // Try the other stats first, and fall back to repeating the previous one.
    const statKeys = [
        ...shuffle(PLAYER_GROUPS[prev.group].stats.filter(key => key !== prev.stat.key)),
        prev.stat.key,
    ];
    for (const key of statKeys) {
        const stat = STATS[key];
        const a = await withPlayerValue(prev.b, stat, env);
        if (a.value > 0) {
            const b = await pickPlayer(prev.group, stat, exclude, env);
            return { type: prev.type, group: prev.group, stat, a, b };
        }
    }
    throw new Error('Could not continue the streak');
}

// ─── Handlers ────────────────────────────────────────────────────────────────

// GET /api/more-or-less/question[?from=<id>][&type=player|coach|school]
// Without `from`, starts a new run (of `type`, if given). With `from`, continues the streak from that
// cached question; returns 404 if it has expired. Caches the full question in KV under `mol:q:<id>`.
// Response: { id, type, stat: { key, label }, a: { name, detail, value, display }, b: { name, detail } }
export async function getQuestion(request, env) {
    const params = new URL(request.url).searchParams;
    const from = params.get('from');
    let question;

    try {
        if (from) {
            const prev = await kvGet(`mol:q:${from}`, env);
            if (!prev) {
                return Response.json({ error: 'Question not found' }, { status: 404 });
            }
            question = await buildNextQuestion(prev, env);
        } else {
            question = await buildFreshQuestion(params.get('type'), env);
        }
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }

    const id = crypto.randomUUID();
    await kvPut(`mol:q:${id}`, question, env);
    return Response.json(toPublicQuestion(id, question));
}

// POST /api/more-or-less/answer with body { id, guess: 'more' | 'less' }
// Checks the guess against the cached question. Returns 400 for a bad guess and 404 if the question expired.
// Response: { correct, b: { value, display } }
export async function submitAnswer(request, env) {
    const { id, guess } = await request.json();
    if (guess !== 'more' && guess !== 'less') {
        return Response.json({ error: 'Guess must be "more" or "less"' }, { status: 400 });
    }

    const question = id ? await kvGet(`mol:q:${id}`, env) : null;
    if (!question) {
        return Response.json({ error: 'Question not found' }, { status: 404 });
    }

    return Response.json({
        correct: isCorrect(question.a.value, question.b.value, guess),
        b: { value: question.b.value, display: question.b.display },
    });
}
