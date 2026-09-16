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
    let stats = {};
    let player = {};

    const countData = await cfbdGql(
        `query { athleteAggregate { aggregate { count } } }`,
        {},
        env
    );
    const cnt = countData.athleteAggregate.aggregate.count;

    if (cnt === 0) {
        return new Response(JSON.stringify({ error: 'No players found' }), { status: 404 });
    }

    while (Object.keys(stats).length === 0) {
        const offset = Math.floor(Math.random() * cnt);
        const data = await cfbdGql(`
            query($offset: Int!) {
                athlete(limit: 1, offset: $offset) { ${ATHLETE_FIELDS} }
            }
        `, { offset }, env);
        player = data.athlete[0];

        if (!player) {
            continue;
        }
        stats = await getPlayerStats(player.id, env);
    }
    return Response.json({
        player,
        stats
    });
}

// Fetches a single player by ID from the CFBD GraphQL API.
// Requires a `playerId` query parameter (integer). Returns 400 if missing, 404 if not found.
// Response body: { id, firstName, lastName, position, seasons } — same shape as getRandomPlayer.
export async function getPlayerById(request, env) {
    let stats = {};
    let player = {};
    const playerId = parseInt(new URL(request.url).searchParams.get('playerId'), 10);
    
    if (!playerId) {
        return new Response(JSON.stringify({ error: 'Missing playerId' }), { status: 400 });
    }

    const data = await cfbdGql(`
        query($id: bigint!) {
            athleteByPk(id: $id) { ${ATHLETE_FIELDS} }
        }
    `, { id: playerId }, env);

    if (!data.athleteByPk) {
        return new Response(JSON.stringify({ error: 'Player not found' }), { status: 404 });
    }

    player = data.athleteByPk;
    stats = await getPlayerStats(playerId, env);

    return Response.json({
        player,
        stats
    });
}

// Fetches season stats for a player from the CFBD GraphQL API.
// Requires a `playerId` query parameter (integer). Returns 400 if missing, 404 if not found.
// A single GraphQL call replaces the previous N parallel REST calls (one per season).
// Response body: { playerId, categories, categoryColumns, seasons: [{ year, team, stats }] }
export async function getPlayerStats(playerId, env) {
    let statsData = {};
    if (!playerId) {
        return [];
    }
    try {
        statsData = await cfbdGql(`
            query($athleteId: bigint!) {
                gamePlayerStat(
                    where: { athleteId: { _eq: $athleteId } },
                    orderBy: {
                        gameTeam: {game: {season: ASC}}
                        playerStatType: {name: ASC}
                    }
                ) {
                    gameTeam { game { season } }
                    playerStatCategory { name }
                    playerStatType { name }
                    stat
                }
            }
        `, { athleteId: playerId }, env);
    } catch (error) {
        return new Response(JSON.stringify({ error: error }), { status: 404 });
    }
    
    // TODO: Add team name string to each year
    const statMap = {};
    for (const row of statsData.gamePlayerStat) {
        const key = row.playerStatCategory.name;
        const statName = row.playerStatType.name;
        const season = row.gameTeam.game.season;
        let seasonIdx = -1;
        let seasonObj = {};

        if (!statMap[key]) {
            // Seasons - Array of {season: String, stats: {statName: statValue}}
            statMap[key] = {statNames: [], seasons: []};
        }
        if (statMap[key].statNames.indexOf(statName) === -1) {
            statMap[key].statNames.push(statName);
        }

        seasonIdx = statMap[key].seasons.findIndex(o => o.season === season);
        if (seasonIdx === -1) {
            seasonIdx = statMap[key].seasons.length;
            seasonObj = {season: season, stats: {}};
        } else {
            seasonObj = statMap[key].seasons[seasonIdx];
        }
        if (!(statName in seasonObj.stats)) {
            seasonObj.stats[statName] = statName === "C/ATT" ? '0/0' : 0;
        }
        if (statName === "C/ATT") {
            const seasonSplit = seasonObj.stats[statName].split('/');
            const gameSplit = row.stat.split('/');
            seasonSplit[0] = Number(seasonSplit[0]) + Number(gameSplit[0]);
            seasonSplit[1] = Number(seasonSplit[1]) + Number(gameSplit[1]);
            seasonObj.stats[statName] = seasonSplit.join("/");
        } else {
            seasonObj.stats[statName] += Number(row.stat);
        }
        statMap[key].seasons[seasonIdx] = seasonObj;
    }
    // const seasons = Object.values(statMap.seasons).sort((a, b) => a.seasons - b.seasons);
    return statMap;
}
