import { cfbdGql } from './cfbd.js';

// GraphQL fragment for athlete fields shared across queries.
// Maps AthleteTeam entries to seasons using startYear as the season year.
const ATHLETE_FIELDS = `
    id
    firstName
    lastName
    position { abbreviation }
    athleteTeams(orderBy: { startYear: ASC }) {
        startYear
        team { school }
    }
`;

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
    if (!player) {
        return new Response(JSON.stringify({ error: 'No player found' }), { status: 404 });
    }

    return Response.json(player);
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

    return Response.json(data.athleteByPk);
}

// Fetches season stats for a player from the CFBD GraphQL API.
// Requires a `playerId` query parameter (integer). Returns 400 if missing, 404 if not found.
// A single GraphQL call replaces the previous N parallel REST calls (one per season).
// Response body: { playerId, categories, categoryColumns, seasons: [{ year, team, stats }] }
export async function getPlayerStats(request, env) {
    const { searchParams } = new URL(request.url);
    const playerId = parseInt(searchParams.get('playerId'), 10);

    if (!playerId) {
        return new Response(JSON.stringify({ error: 'Missing playerId' }), { status: 400 });
    }

    const statsData = await cfbdGql(`
        query($athleteId: bigint!) {
            gamePlayerStat(
                where: { athleteId: { _eq: $athleteId } },
                orderBy: {
                    gameTeam: {game: {season: ASC}}
                    playerStatType: {name: ASC}
                }
            ) {
                gameTeam { game { season } }
                playerStatType { name }
                stat
            }
        }
    `, { athleteId: playerId }, env);

    // Pivot flat stat rows into { year+team → { category: { statType: value } } }
    // TODO: Add team name string to each year
    const seasonMap = {};
    let statNames = [];
    for (const row of statsData.gamePlayerStat) {
        // const key = `${row.year}|${row.team?.school ?? ''}`;
        const key = `${row.gameTeam.game.season}`;
        const statName = row.playerStatType.name;
        
        if (statNames.indexOf(statName) === -1) {
            statNames.push(statName);
        }
        if (!seasonMap[key]) {
            // seasonMap[key] = { year: String(row.gameTeam.game.season), team: row.team?.school ?? '', stats: {} };
            seasonMap[key] = { year: String(row.gameTeam.game.season), stats: {} };
        }
        if (!seasonMap[key].stats[statName]) {
            if (statName == "C/ATT") {
                seasonMap[key].stats[statName] = '0/0';
            } else {
                seasonMap[key].stats[statName] = 0;
            }
        }
        if (statName == "C/ATT") {
            const seasonSplit = seasonMap[key].stats[statName].split('/');
            const gameSplit = row.stat.split('/');
            seasonSplit[0] = Number(seasonSplit[0]) + Number(gameSplit[0]);
            seasonSplit[1] = Number(seasonSplit[1]) + Number(gameSplit[1]);
            seasonMap[key].stats[statName] = seasonSplit.join("/");
        } else {
            seasonMap[key].stats[statName] += Number(row.stat);
        }
    }

    const seasons = Object.values(seasonMap).sort((a, b) => a.year - b.year);

    return Response.json({
        playerId,
        statNames,
        seasons,
    });
}
