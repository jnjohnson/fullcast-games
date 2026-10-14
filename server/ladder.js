import { cfbdGql } from './cfbd.js';
import { kvGet, kvPut } from './kv.js';
import { randomItem, shuffle } from './utils.js';

// The game is only meant to be played in the offseason (February to early September), when results and
// rankings don't change, so most CFBD data is cached for about 8 months. Keys include the offseason year
// (see offseasonYear) so data cached late in one offseason can't carry into the next one.
const OFFSEASON_TTL = 60 * 60 * 24 * 240; // ~8 months
// Questions are updated on every guess, and a run can sit idle while the player thinks.
const QUESTION_TTL = 60 * 60 * 6; // 6 hours
// The run ends after this many wrong guesses.
export const MAX_MISSES = 5;
// How many of a subject's most recent games to load. The last win and last loss are almost always in here.
const GAME_LIMIT = 40;
// How many of a coach's most recent seasons to search for games.
const COACH_SEASON_LIMIT = 6;
// How many random start subjects to try before giving up.
const MAX_ATTEMPTS = 8;
// Autocomplete suggestions returned per search.
const SEARCH_LIMIT = 8;
// Options shown when the lifeline is used (the answer plus distractors).
const CHOICE_COUNT = 4;
// CFBD caps some queries at 1000 rows, so the QB and coach indexes are fetched in pages.
const PAGE_SIZE = 1000;

export const KINDS = ['team', 'coach', 'qb'];
const DIRECTIONS = ['beatBy', 'beat'];
// Every (direction, answer kind) pairing a question can use.
const COMBOS = DIRECTIONS.flatMap(direction => KINDS.map(answerKind => ({ direction, answerKind })));
// Teams outside these divisions aren't in the autocomplete index, so they can't be answers.
const INDEX_CLASSIFICATIONS = ['fbs', 'fcs'];

const GAME_FIELDS = `
    id season startDate
    homeTeam homeTeamId homePoints homeClassification
    awayTeam awayTeamId awayPoints awayClassification
`;
const PASSING_FILTER = {
    playerStatCategory: { name: { _eq: 'passing' } },
    playerStatType: { name: { _eq: 'C/ATT' } },
};

// ─── Pure helpers ────────────────────────────────────────────────────────────

// Returns the year of the offseason `date` falls in. January still belongs to the previous season's
// offseason, so it returns the previous year; every other month returns the current year.
export function offseasonYear(date = new Date()) {
    const year = date.getUTCFullYear();
    return date.getUTCMonth() === 0 ? year - 1 : year;
}

// Returns the key used to track which subjects a run has already used, e.g. "coach:70".
// The kind is included because coach and athlete ids can collide.
export function subjectKey(kind, id) {
    return `${kind}:${id}`;
}

// CFBD has no roster or depth chart data, so this predicts each team's starting QB in one game as the
// player with the most pass attempts. `rows` are passing C/ATT gamePlayerStat rows for that game
// ({ stat: "19/27", athlete: { id, name, position }, gameTeam: { teamId } }).
// Returns { [teamId]: { id, name, position } }. On a tie in attempts, the first row wins.
export function predictStartingQB(rows) {
    const starters = {};
    const attempts = {};
    for (const row of rows) {
        const teamId = row.gameTeam.teamId;
        const count = Number(String(row.stat).split('/')[1]) || 0;
        if (!(teamId in attempts) || count > attempts[teamId]) {
            attempts[teamId] = count;
            starters[teamId] = {
                id: row.athlete.id,
                name: row.athlete.name,
                position: row.athlete.position?.abbreviation ?? null,
            };
        }
    }
    return starters;
}

// Turns a CFBD game into a game entry from the point of view of `selfSchool`.
// `starters` is predictStartingQB's result for the game; `coaches` maps "season|school" to that
// team-season's coaches. Each side gets the team, coach and QB that can be used as answers:
// - team is null unless the school is FBS or FCS (only those are in the autocomplete index)
// - coach is null unless the team-season had exactly one coach (otherwise we can't tell who coached the game)
// - qb is null unless the predicted starter is listed at QB
// Returns null for ties and for games without a final score.
export function toGameEntry(game, selfSchool, starters, coaches) {
    if (game.homePoints == null || game.awayPoints == null || game.homePoints === game.awayPoints) {
        return null;
    }
    const selfHome = game.homeTeam === selfSchool;

    const side = home => {
        const school = home ? game.homeTeam : game.awayTeam;
        const classification = home ? game.homeClassification : game.awayClassification;
        const seasonCoaches = coaches[`${game.season}|${school}`] ?? [];
        const starter = starters[home ? game.homeTeamId : game.awayTeamId];
        return {
            team: INDEX_CLASSIFICATIONS.includes(classification)
                ? { id: school, name: school, detail: '' }
                : null,
            coach: seasonCoaches.length === 1 ? { ...seasonCoaches[0], detail: school } : null,
            qb: starter?.position === 'QB' ? { id: starter.id, name: starter.name, detail: school } : null,
        };
    };

    const homeWon = game.homePoints > game.awayPoints;
    const [winner, loser] = homeWon
        ? [[game.homeTeam, game.homePoints], [game.awayTeam, game.awayPoints]]
        : [[game.awayTeam, game.awayPoints], [game.homeTeam, game.homePoints]];

    return {
        gameId: game.id,
        season: game.season,
        date: game.startDate,
        won: selfHome === homeWon,
        score: `${winner[0]} ${winner[1]}, ${loser[0]} ${loser[1]}`,
        self: side(selfHome),
        opponent: side(!selfHome),
    };
}

// Finds the answer for one (direction, answerKind) pairing. `games` are the subject's game entries, newest first.
// 'beatBy' looks at the subject's last loss and 'beat' at its last win. Only the most recent such game
// counts: if it has no usable answer of `answerKind`, or the answer is in `usedKeys`, this returns null
// rather than falling back to an older game (which would be the wrong answer).
// Returns { answer: { kind, id, name, detail }, game: { date, score } } or null.
export function findAnswer(games, direction, answerKind, usedKeys) {
    const game = games.find(g => g.won === (direction === 'beat'));
    const answer = game?.opponent[answerKind];
    if (!answer || usedKeys.includes(subjectKey(answerKind, answer.id))) {
        return null;
    }
    return {
        answer: { kind: answerKind, ...answer },
        game: { date: game.date, score: game.score },
    };
}

// Picks the question for a subject: tries each (direction, answerKind) pairing in `combos` (random order by
// default) and returns the first one findAnswer can answer, as { direction, answerKind, answer, game }.
// Returns null when the chain dead-ends.
export function chooseQuestion(games, usedKeys, combos = shuffle(COMBOS)) {
    for (const { direction, answerKind } of combos) {
        const found = findAnswer(games, direction, answerKind, usedKeys);
        if (found) return { direction, answerKind, ...found };
    }
    return null;
}

// Picks the AP poll to start runs from: the latest season's postseason (final) poll if there is one,
// otherwise that season's latest week. `polls` are { season, seasonType, week, rankings }.
export function latestPoll(polls) {
    const season = Math.max(...polls.map(p => p.season));
    const inSeason = polls.filter(p => p.season === season);
    return inSeason.find(p => p.seasonType === 'postseason')
        ?? inSeason.reduce((latest, p) => (p.week > latest.week ? p : latest));
}

// Lowercases a name and strips accents and punctuation so "Texas A&M" matches "texas am".
function normalize(text) {
    return String(text)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Searches an autocomplete index for `query`. Names that start with the query rank first, then names
// with a word that starts with it, then names that contain it anywhere. Within a rank, index order is
// kept (indexes are sorted most recent first). Returns up to `limit` entries.
export function searchIndex(index, query, limit = SEARCH_LIMIT) {
    const q = normalize(query);
    if (!q) return [];

    const matches = [];
    for (const entry of index) {
        const name = normalize(entry.name);
        let rank;
        if (name.startsWith(q)) rank = 0;
        else if (name.split(' ').some(word => word.startsWith(q))) rank = 1;
        else if (name.includes(q)) rank = 2;
        else continue;
        matches.push({ rank, entry });
    }
    return matches
        .sort((a, b) => a.rank - b.rank)
        .slice(0, limit)
        .map(({ entry }) => entry);
}

// Formats a first and last year as "2021" or "2021-2024".
function yearRange(start, end) {
    return !start || start === end ? String(end ?? start ?? '') : `${start}-${end}`;
}

// Removes the answer and internal run state before a question is sent to the client.
function toPublicQuestion(id, q) {
    return {
        id,
        subject: { kind: q.subject.kind, name: q.subject.name, detail: q.subject.detail },
        direction: q.direction,
        answerKind: q.answerKind,
        run: publicRun(q.run),
        choices: q.choices ?? null,
        restarted: q.restarted ?? false,
    };
}

function publicRun(run) {
    return { score: run.score, misses: run.misses, lifelineUsed: run.lifelineUsed };
}

// ─── CFBD fetchers ───────────────────────────────────────────────────────────

// Fetches the extra data needed to build game entries, in one request: passing rows for every game
// (for predictStartingQB) and the coaches of every team-season involved.
// `games` are CFBD games. Returns { starters: { [gameId]: { [teamId]: starter } }, coaches: { "season|school": [{ id, name }] } }.
async function fetchGameContext(games, env) {
    const years = [...new Set(games.map(g => g.season))];
    const schools = [...new Set(games.flatMap(g => [g.homeTeam, g.awayTeam]))];

    const data = await cfbdGql(`
        query($passing: GamePlayerStatBoolExp, $coaches: CoachSeasonBoolExp) {
            gamePlayerStat(where: $passing) {
                stat
                athlete { id name position { abbreviation } }
                gameTeam { gameId teamId }
            }
            coachSeason(where: $coaches) {
                year
                team { school }
                coach { id firstName lastName }
            }
        }
    `, {
        passing: { ...PASSING_FILTER, gameTeam: { gameId: { _in: games.map(g => g.id) } } },
        coaches: { year: { _in: years }, team: { school: { _in: schools } } },
    }, env);

    const rowsByGame = {};
    for (const row of data.gamePlayerStat) {
        (rowsByGame[row.gameTeam.gameId] ??= []).push(row);
    }
    const starters = {};
    for (const [gameId, rows] of Object.entries(rowsByGame)) {
        starters[gameId] = predictStartingQB(rows);
    }

    const coaches = {};
    for (const row of data.coachSeason) {
        const key = `${row.year}|${row.team.school}`;
        (coaches[key] ??= []).push({ id: row.coach.id, name: `${row.coach.firstName} ${row.coach.lastName}` });
    }
    return { starters, coaches };
}

// Loads a subject's most recent completed games and returns them as game entries (see toGameEntry), newest first.
// - team: the school's games.
// - coach: games from the coach's most recent seasons. The list stops at the first game where the coach
//   can't be confirmed (a team-season with more than one coach), since the real last win or loss could be in it.
// - qb: games where the QB was his team's predicted starter.
// Cached in KV under `ladder:games:<kind>:<id>:<year>` for OFFSEASON_TTL.
async function subjectGames(subject, env) {
    const cacheKey = `ladder:games:${subject.kind}:${subject.id}:${offseasonYear()}`;
    const cached = await kvGet(cacheKey, env);
    if (cached) return cached;

    // Each item is { game, selfSchool }.
    let raw = [];
    if (subject.kind === 'team') {
        const data = await cfbdGql(`
            query($where: gameBoolExp) {
                game(where: $where, orderBy: { startDate: DESC }, limit: ${GAME_LIMIT}) { ${GAME_FIELDS} }
            }
        `, { where: {
            status: { _eq: 'completed' },
            _or: [{ homeTeam: { _eq: subject.id } }, { awayTeam: { _eq: subject.id } }],
        } }, env);
        raw = data.game.map(game => ({ game, selfSchool: subject.id }));
    } else if (subject.kind === 'coach') {
        const coachData = await cfbdGql(`
            query($id: Int!) {
                coach(where: { id: { _eq: $id } }) {
                    seasons(orderBy: { year: DESC }, limit: ${COACH_SEASON_LIMIT}) { year team { school } }
                }
            }
        `, { id: subject.id }, env);
        const seasons = coachData.coach[0]?.seasons ?? [];
        if (seasons.length) {
            const data = await cfbdGql(`
                query($where: gameBoolExp) {
                    game(where: $where, orderBy: { startDate: DESC }, limit: ${GAME_LIMIT}) { ${GAME_FIELDS} }
                }
            `, { where: {
                status: { _eq: 'completed' },
                _or: seasons.map(({ year, team }) => ({
                    season: { _eq: year },
                    _or: [{ homeTeam: { _eq: team.school } }, { awayTeam: { _eq: team.school } }],
                })),
            } }, env);
            raw = data.game.map(game => {
                const season = seasons.find(s => s.year === game.season
                    && (s.team.school === game.homeTeam || s.team.school === game.awayTeam));
                return { game, selfSchool: season.team.school };
            });
        }
    } else {
        const data = await cfbdGql(`
            query($where: GamePlayerStatBoolExp) {
                gamePlayerStat(
                    where: $where,
                    orderBy: { gameTeam: { game: { startDate: DESC } } },
                    limit: ${GAME_LIMIT}
                ) { gameTeam { teamId game { ${GAME_FIELDS} } } }
            }
        `, { where: {
            ...PASSING_FILTER,
            athleteId: { _eq: subject.id },
            gameTeam: { game: { status: { _eq: 'completed' } } },
        } }, env);
        raw = data.gamePlayerStat.map(({ gameTeam: { teamId, game } }) => ({
            game,
            selfSchool: teamId === game.homeTeamId ? game.homeTeam : game.awayTeam,
        }));
    }

    let games = [];
    if (raw.length) {
        const { starters, coaches } = await fetchGameContext(raw.map(r => r.game), env);
        games = raw
            .map(({ game, selfSchool }) => toGameEntry(game, selfSchool, starters[game.id] ?? {}, coaches))
            .filter(Boolean);

        if (subject.kind === 'qb') {
            games = games.filter(g => g.self.qb?.id === subject.id);
        } else if (subject.kind === 'coach') {
            const stop = games.findIndex(g => g.self.coach?.id !== subject.id);
            if (stop !== -1) games = games.slice(0, stop);
        }
    }

    await kvPut(cacheKey, games, env, OFFSEASON_TTL);
    return games;
}

// Returns the teams in the latest AP poll as [{ school, rank }].
// Cached in KV under `ladder:ranked:<year>` for OFFSEASON_TTL.
async function getRankedTeams(env) {
    const cacheKey = `ladder:ranked:${offseasonYear()}`;
    const cached = await kvGet(cacheKey, env);
    if (cached) return cached;

    const data = await cfbdGql(`
        query($where: PollBoolExp) {
            poll(where: $where, orderBy: [{ season: DESC }, { week: DESC }], limit: 40) {
                season seasonType week
                rankings(orderBy: { rank: ASC }) { rank team { school } }
            }
        }
    `, { where: { pollType: { name: { _eq: 'AP Top 25' } } } }, env);

    const poll = latestPoll(data.poll);
    const ranked = poll.rankings.map(r => ({ school: r.team.school, rank: r.rank }));
    await kvPut(cacheKey, ranked, env, OFFSEASON_TTL);
    return ranked;
}

// Fetches every page of a CFBD list query. `query` must take `$offset: Int!` and use `limit: PAGE_SIZE`;
// `field` is the root field to read. Gets the total from `countQuery` (which reads `<field>Aggregate`)
// so the pages can be fetched in parallel.
async function fetchAllPages(query, countQuery, field, variables, env) {
    const countData = await cfbdGql(countQuery, variables, env);
    const total = countData[`${field}Aggregate`].aggregate.count;
    const offsets = Array.from({ length: Math.ceil(total / PAGE_SIZE) }, (_, i) => i * PAGE_SIZE);
    const pages = await Promise.all(offsets.map(offset => cfbdGql(query, { ...variables, offset }, env)));
    return pages.flatMap(page => page[field]);
}

// Builds the autocomplete index for one kind: [{ id, name, detail }], most recent first for coaches and QBs.
// - team: FBS and FCS schools, with their conference as detail
// - coach: every coach, with their latest school and season as detail
// - qb: every athlete listed at QB, with their latest school and years as detail
async function buildIndex(kind, env) {
    if (kind === 'team') {
        const data = await cfbdGql(`
            query($where: currentTeamsBoolExp) {
                currentTeams(where: $where, orderBy: { school: ASC }) { school conference classification }
            }
        `, { where: { classification: { _in: INDEX_CLASSIFICATIONS } } }, env);
        return data.currentTeams.map(t => ({
            id: t.school,
            name: t.school,
            detail: t.conference ?? t.classification.toUpperCase(),
        }));
    }

    if (kind === 'coach') {
        const coaches = await fetchAllPages(`
            query($offset: Int!) {
                coach(orderBy: { id: ASC }, limit: ${PAGE_SIZE}, offset: $offset) {
                    id firstName lastName
                    seasons(orderBy: { year: DESC }, limit: 1) { year team { school } }
                }
            }
        `, `query { coachAggregate { aggregate { count } } }`, 'coach', {}, env);
        return coaches
            .map(c => ({
                id: c.id,
                name: `${c.firstName} ${c.lastName}`,
                detail: [c.seasons[0]?.team?.school, c.seasons[0]?.year].filter(Boolean).join(' · '),
                year: c.seasons[0]?.year ?? 0,
            }))
            .sort((a, b) => b.year - a.year)
            .map(({ year, ...entry }) => entry);
    }

    const where = { position: { abbreviation: { _eq: 'QB' } } };
    const athletes = await fetchAllPages(`
        query($where: AthleteBoolExp, $offset: Int!) {
            athlete(where: $where, orderBy: { id: ASC }, limit: ${PAGE_SIZE}, offset: $offset) {
                id name
                athleteTeams(orderBy: { endYear: DESC }, limit: 1) { startYear endYear team { school } }
            }
        }
    `, `query($where: AthleteBoolExp) { athleteAggregate(where: $where) { aggregate { count } } }`,
    'athlete', { where }, env);
    return athletes
        .filter(a => a.name)
        .map(a => {
            const team = a.athleteTeams[0];
            return {
                id: a.id,
                name: a.name,
                detail: team ? [team.team?.school, yearRange(team.startYear, team.endYear)].filter(Boolean).join(' · ') : '',
                year: team?.endYear ?? 0,
            };
        })
        .sort((a, b) => b.year - a.year)
        .map(({ year, ...entry }) => entry);
}

// Parsed indexes kept in memory for the life of the Worker isolate, so searches don't re-read and
// re-parse the (large) QB index from KV on every keystroke.
const indexMemo = new Map();

// Returns the autocomplete index for `kind`. Cached in KV under `ladder:index:<kind>:<year>` for OFFSEASON_TTL.
async function getIndex(kind, env) {
    const cacheKey = `ladder:index:${kind}:${offseasonYear()}`;
    if (indexMemo.has(cacheKey)) return indexMemo.get(cacheKey);

    let index = await kvGet(cacheKey, env);
    if (!index) {
        index = await buildIndex(kind, env);
        await kvPut(cacheKey, index, env, OFFSEASON_TTL);
    }
    indexMemo.set(cacheKey, index);
    return index;
}

// ─── Question builders ───────────────────────────────────────────────────────

// Starts a chain from a random team in the latest AP poll: the team itself, its coach, or its predicted
// starting QB (taken from the team's most recent game, falling back to the team when unavailable).
// `run` carries the score, misses and used subjects forward. Throws if no start subject works.
// Returns the full question: { subject, direction, answerKind, answer, game, run }.
async function startQuestion(run, env) {
    const ranked = await getRankedTeams(env);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const { school, rank } = randomItem(ranked);
        let subject = { kind: 'team', id: school, name: school, detail: `No. ${rank} AP` };

        const kind = randomItem(KINDS);
        if (kind !== 'team') {
            const person = (await subjectGames(subject, env))[0]?.self[kind];
            if (person) subject = { kind, id: person.id, name: person.name, detail: school };
        }

        const key = subjectKey(subject.kind, subject.id);
        if (run.usedKeys.includes(key)) continue;

        const usedKeys = [...run.usedKeys, key];
        const question = chooseQuestion(await subjectGames(subject, env), usedKeys);
        if (question) {
            return { subject, ...question, run: { ...run, usedKeys } };
        }
    }
    throw new Error('Could not find a starting question');
}

// Builds the next question from a solved one: the previous answer becomes the subject.
// If the chain dead-ends, starts a new chain from a ranked team and marks the question `restarted`.
async function nextQuestion(prev, env) {
    const subject = prev.answer;
    const usedKeys = [...prev.run.usedKeys, subjectKey(subject.kind, subject.id)];
    const run = { ...prev.run, usedKeys };

    const question = chooseQuestion(await subjectGames(subject, env), usedKeys);
    if (question) {
        return { subject, ...question, run };
    }
    return { ...(await startQuestion(run, env)), restarted: true };
}

// Builds the lifeline options for a question: the answer plus up to CHOICE_COUNT - 1 distractors, shuffled.
// Distractors come from the subject's other games in the same direction (e.g. earlier teams that beat them)
// and are topped up with random entries from the autocomplete index.
async function buildChoices(question, env) {
    const { subject, direction, answerKind, answer } = question;
    const toChoice = ({ id, name, detail }) => ({ id, name, detail: detail ?? '' });
    const seen = new Set([String(answer.id)]);
    const distractors = [];

    const add = candidate => {
        if (candidate && !seen.has(String(candidate.id)) && distractors.length < CHOICE_COUNT - 1) {
            seen.add(String(candidate.id));
            distractors.push(toChoice(candidate));
        }
    };

    const games = await subjectGames(subject, env);
    shuffle(games.filter(g => g.won === (direction === 'beat'))).forEach(g => add(g.opponent[answerKind]));

    if (distractors.length < CHOICE_COUNT - 1) {
        const index = await getIndex(answerKind, env);
        for (let i = 0; i < 50 && distractors.length < CHOICE_COUNT - 1; i++) {
            add(randomItem(index));
        }
    }
    return shuffle([toChoice(answer), ...distractors]);
}

// ─── Handlers ────────────────────────────────────────────────────────────────

// GET /api/ladder/question[?from=<id>]
// Without `from`, starts a new run. With `from`, continues the chain from that question, which must be
// solved (400 if not, 404 if it has expired). Caches the full question in KV under `ladder:q:<id>`.
// Response: { id, subject: { kind, name, detail }, direction, answerKind, run: { score, misses, lifelineUsed },
//             choices, restarted }
export async function getQuestion(request, env) {
    const from = new URL(request.url).searchParams.get('from');
    let question;

    try {
        if (from) {
            const prev = await kvGet(`ladder:q:${from}`, env);
            if (!prev) {
                return Response.json({ error: 'Question not found' }, { status: 404 });
            }
            if (!prev.solved) {
                return Response.json({ error: 'Question has not been solved' }, { status: 400 });
            }
            question = await nextQuestion(prev, env);
        } else {
            question = await startQuestion({ score: 0, misses: 0, lifelineUsed: false, usedKeys: [] }, env);
        }
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }

    const id = crypto.randomUUID();
    await kvPut(`ladder:q:${id}`, { ...question, solved: false, choices: null }, env, QUESTION_TTL);
    return Response.json(toPublicQuestion(id, { ...question, choices: null }));
}

// POST /api/ladder/answer with body { id, guessId }
// Compares the guess to the answer by id. A correct guess solves the question and adds to the score; a wrong
// one adds a miss, and the player retries the same question. The answer is only revealed when the guess is
// correct or the run is over (MAX_MISSES misses). Returns 400 for a missing guess or a finished question,
// and 404 if the question expired.
// Response: { correct, gameOver, run: { score, misses, lifelineUsed }, answer?: { name, detail }, game?: { date, score } }
export async function submitAnswer(request, env) {
    const { id, guessId } = await request.json();
    if (guessId === undefined || guessId === null || guessId === '') {
        return Response.json({ error: 'Missing guess' }, { status: 400 });
    }

    const question = id ? await kvGet(`ladder:q:${id}`, env) : null;
    if (!question) {
        return Response.json({ error: 'Question not found' }, { status: 404 });
    }
    if (question.solved || question.run.misses >= MAX_MISSES) {
        return Response.json({ error: 'Question is already finished' }, { status: 400 });
    }

    const correct = String(guessId) === String(question.answer.id);
    if (correct) {
        question.solved = true;
        question.run.score++;
    } else {
        question.run.misses++;
    }
    await kvPut(`ladder:q:${id}`, question, env, QUESTION_TTL);

    const gameOver = question.run.misses >= MAX_MISSES;
    const body = { correct, gameOver, run: publicRun(question.run) };
    if (correct || gameOver) {
        body.answer = { name: question.answer.name, detail: question.answer.detail };
        body.game = question.game;
    }
    return Response.json(body);
}

// POST /api/ladder/lifeline with body { id }
// Uses the run's one lifeline: turns the question into multiple choice. Returns 400 if the lifeline was
// already used this run or the question is finished, and 404 if the question expired.
// Response: { choices: [{ id, name, detail }] }
export async function useLifeline(request, env) {
    const { id } = await request.json();
    const question = id ? await kvGet(`ladder:q:${id}`, env) : null;
    if (!question) {
        return Response.json({ error: 'Question not found' }, { status: 404 });
    }
    if (question.run.lifelineUsed) {
        return Response.json({ error: 'Lifeline already used' }, { status: 400 });
    }
    if (question.solved || question.run.misses >= MAX_MISSES) {
        return Response.json({ error: 'Question is already finished' }, { status: 400 });
    }

    try {
        question.choices = await buildChoices(question, env);
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
    question.run.lifelineUsed = true;
    await kvPut(`ladder:q:${id}`, question, env, QUESTION_TTL);
    return Response.json({ choices: question.choices });
}

// GET /api/ladder/search?kind=team|coach|qb&q=<text>
// Autocomplete suggestions for a guess. Returns 400 for an unknown kind, and [] for queries under 2 characters.
// Response: [{ id, name, detail }]
export async function search(request, env) {
    const params = new URL(request.url).searchParams;
    const kind = params.get('kind');
    const q = params.get('q') ?? '';
    if (!KINDS.includes(kind)) {
        return Response.json({ error: 'Unknown kind' }, { status: 400 });
    }
    if (q.trim().length < 2) {
        return Response.json([]);
    }

    try {
        return Response.json(searchIndex(await getIndex(kind, env), q));
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
}
