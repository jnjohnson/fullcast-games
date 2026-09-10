import { cfbdGql } from './cfbd.js';

// Categories to show per position group
const POSITION_CATEGORIES = {
    QB: ['passing', 'rushing'],
    RB: ['rushing', 'receiving'],
    WR: ['receiving'],
    TE: ['receiving'],
    K:  ['kicking'],
    P:  ['punting'],
    OL: []
};
const DEFENSIVE_POSITIONS = new Set(['CB', 'DB', 'S', 'FS', 'SS', 'LB', 'ILB', 'OLB', 'DE', 'DT', 'DL', 'NT']);

function relevantCategories(position) {
    if (POSITION_CATEGORIES[position]) return POSITION_CATEGORIES[position];
    if (DEFENSIVE_POSITIONS.has(position)) return ['defensive', 'interceptions', 'fumbles'];
    return null; // null means all categories
}

// Stat columns to display per category
const CATEGORY_COLUMNS = {
    passing:       ['ATT', 'COMPLETIONS', 'PCT', 'YDS', 'TD', 'INT'],
    rushing:       ['CAR', 'YDS', 'YPC', 'TD'],
    receiving:     ['REC', 'YDS', 'AVG', 'TD', 'LONG'],
    defensive:     ['TOT', 'SOLO', 'TFL', 'SACKS'],
    interceptions: ['INT', 'YDS', 'TD'],
    fumbles:       ['REC', 'FUM', 'LOST'],
    kicking:       ['FGM', 'FGA', 'XPM', 'XPA', 'PTS'],
    punting:       ['NO', 'YDS', 'YPP', 'LONG'],
    kickReturns:   ['NO', 'YDS', 'TD', 'YPR'],
    puntReturns:   ['NO', 'YDS', 'TD', 'YPR'],
};

// GraphQL fragment for athlete fields shared across queries.
// Maps AthleteTeam entries to seasons using startYear as the season year.
const ATHLETE_FIELDS = `
    id
    firstName
    lastName
    position { abbreviation }
    athleteTeams(orderBy: { startYear: asc }) {
        startYear
        team { school }
    }
`;

// Converts a raw GraphQL athlete object into the API response shape.
function formatAthlete(a) {
    return {
        id: a.id,
        firstName: a.firstName,
        lastName: a.lastName,
        position: a.position?.abbreviation ?? '',
        seasons: (a.athleteTeams ?? []).map(at => ({
            year: String(at.startYear),
            team: at.team?.school ?? '',
        })),
    };
}

// Returns a single random player from the CFBD athlete database as a JSON response.
// Picks a random row using athleteAggregate count + random offset. Returns 404 if empty.
// Response body: { id, firstName, lastName, position, seasons } where seasons is
// an array of { year, team } objects derived from the athlete's team history.
export async function getRandomPlayer(env) {
    const countData = await cfbdGql(
        `query { athleteAggregate { aggregate { count } } }`,
        {},
        env
    );
    const cnt = countData.athleteAggregate.aggregate.count;

    if (cnt === 0) {
        return new Response(JSON.stringify({ error: 'No players found' }), { status: 404 });
    }

    const offset = Math.floor(Math.random() * cnt);
    const data = await cfbdGql(`
        query($offset: Int!) {
            athlete(limit: 1, offset: $offset) { ${ATHLETE_FIELDS} }
        }
    `, { offset }, env);

    const player = data.athlete[0];
    if (!player) return new Response(JSON.stringify({ error: 'No player found' }), { status: 404 });

    return Response.json(formatAthlete(player));
}

// Fetches a single player by ID from the CFBD GraphQL API.
// Requires a `playerId` query parameter (integer). Returns 400 if missing, 404 if not found.
// Response body: { id, firstName, lastName, position, seasons } — same shape as getRandomPlayer.
export async function getPlayerById(request, env) {
    const playerId = parseInt(new URL(request.url).searchParams.get('playerId'), 10);
    if (!playerId) return new Response(JSON.stringify({ error: 'Missing playerId' }), { status: 400 });

    const data = await cfbdGql(`
        query($id: bigint!) {
            athleteByPk(id: $id) { ${ATHLETE_FIELDS} }
        }
    `, { id: playerId }, env);

    if (!data.athleteByPk) {
        return new Response(JSON.stringify({ error: 'Player not found' }), { status: 404 });
    }

    return Response.json(formatAthlete(data.athleteByPk));
}

// Fetches season stats for a player from the CFBD GraphQL API.
// Requires a `playerId` query parameter (integer). Returns 400 if missing, 404 if not found.
// Stats are filtered to the categories relevant for the player's position (e.g. QB gets passing +
// rushing; defensive players get defensive/interceptions/fumbles; unknown positions get everything).
// A single GraphQL call replaces the previous N parallel REST calls (one per season).
// Response body: { playerId, position, categories, categoryColumns, seasons: [{ year, team, stats }] }
export async function getPlayerStats(request, env) {
    const { searchParams } = new URL(request.url);
    const playerId = parseInt(searchParams.get('playerId'), 10);

    if (!playerId) {
        return new Response(JSON.stringify({ error: 'Missing playerId' }), { status: 400 });
    }

    const playerData = await cfbdGql(`
        query($id: bigint!) {
            athleteByPk(id: $id) {
                position { abbreviation }
                athleteTeams { startYear team { school } }
            }
        }
    `, { id: playerId }, env);

    if (!playerData.athleteByPk) {
        return new Response(JSON.stringify({ error: 'Player not found' }), { status: 404 });
    }

    const position = playerData.athleteByPk.position?.abbreviation ?? '';
    const categories = relevantCategories(position);

    const statsData = await cfbdGql(`
        query($athleteId: bigint!) {
            gamePlayerStat(where: { athleteId: { _eq: $athleteId } }) {
                year
                team { school }
                category
                statType
                stat
            }
        }
    `, { athleteId: playerId }, env);

    // Pivot flat stat rows into { year+team → { category: { statType: value } } }
    const seasonMap = {};
    for (const row of statsData.gamePlayerStat) {
        const key = `${row.year}|${row.team?.school ?? ''}`;
        if (!seasonMap[key]) {
            seasonMap[key] = { year: String(row.year), team: row.team?.school ?? '', stats: {} };
        }
        if (!seasonMap[key].stats[row.category]) seasonMap[key].stats[row.category] = {};
        seasonMap[key].stats[row.category][row.statType] = row.stat;
    }

    const seasons = Object.values(seasonMap).sort((a, b) => a.year - b.year);

    return Response.json({
        playerId,
        position,
        categories: categories ?? Object.keys(CATEGORY_COLUMNS),
        categoryColumns: CATEGORY_COLUMNS,
        seasons,
    });
}
