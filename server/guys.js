import { cfbdGql } from './cfbd.js';
import { getPlayerVideos } from './youtube.js';

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

// Returns a single random player's compiled statistics from the CFBD database as a JSON response.
// Picks a random row using athleteAggregate count + random offset. Returns 404 if empty.
// Response body: 
// { player: {
//      id: Int
//      firstName: String
//      lastName: String
//      position: {
//          abbreviation: String
//      }
//      athleteTeams: [{
// 			startYear: String
// 			team: {
// 				school: String
// 			}
// 		}]
//  },
//  stats: {
// 	    statType (String): {
// 		    statNames: [String]
//      }
// 		seasons: [{
//          season: Int
//          stats: {statname (String): statValue (Int)}
//      }]
//  }
// }
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
// Response body is same shape as getRandomPlayer.
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
// Requires a `playerId` parameter (integer). Returns 400 if missing, 404 if not found.
// A single GraphQL call replaces the previous N parallel REST calls (one per season).
export async function getPlayerStats(playerId, env) {
    let statsData = {};
    if (!playerId) {
        return new Response(JSON.stringify({ error: 'Missing playerId' }), { status: 400 });
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
                    athlete { athleteTeams { startYear team { nickname } } }
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
    
    const statMap = {};
    for (const row of statsData.gamePlayerStat) {
        const statName = row.playerStatType.name;
        const season = row.gameTeam.game.season;
        const teams = row.athlete.athleteTeams;
        let key = row.playerStatCategory.name;
        let seasonIdx = -1;
        let seasonObj = {};

        if (key === 'kickReturns') {
            key = 'Kick Returns';
        } else if (key === 'puntReturns') {
            key = 'Punt Returns';
        }

        if (!statMap[key]) {
            // Seasons - Array of {season: String, stats: {statName: statValue}}
            statMap[key] = {statNames: [], seasons: []};
        }
        if (statMap[key].statNames.indexOf(statName) === -1 && statName !== 'PCT') {
            statMap[key].statNames.push(statName);
            
            if (statName === 'FG') {
                statMap[key].statNames.push('FG %');
            } else if (statName === 'XP') {
                statMap[key].statNames.push('XP %');
            }
        }

        seasonIdx = statMap[key].seasons.findIndex(o => o.season === season);
        if (seasonIdx === -1) {
            let teamName = 'N/A';
            let curStartYear = 0;
            seasonIdx = statMap[key].seasons.length;
            
            for (const team of teams) {
                if (team.startYear <= season && team.startYear > curStartYear) {
                    teamName = team.team.nickname;
                    curStartYear = team.startYear;
                }
            }

            seasonObj = {season: season, team: teamName, stats: {}};
        } else {
            seasonObj = statMap[key].seasons[seasonIdx];
        }
        if (!(statName in seasonObj.stats)) {
            if (['C/ATT', 'FG', 'XP'].includes(statName)) {
                seasonObj.stats[statName] = '0/0';

                if (statName === 'FG') {
                    seasonObj.stats['FG %'] = 0;
                } else if (statName === 'XP') {
                    seasonObj.stats['XP %'] = 0;
                }
            } else if (statName === 'PCT') {
                continue;
            } else {
                seasonObj.stats[statName] = 0;
            }
        }
        if (['C/ATT', 'FG', 'XP'].includes(statName)) {
            const seasonSplit = seasonObj.stats[statName].split('/');
            const gameSplit = row.stat.split('/');
            seasonSplit[0] = Number(seasonSplit[0]) + Number(gameSplit[0]);
            seasonSplit[1] = Number(seasonSplit[1]) + Number(gameSplit[1]);
            seasonObj.stats[statName] = seasonSplit.join("/");
        } else if (statName === 'LONG') {
            const long = seasonObj.stats['LONG'];
            seasonObj.stats['LONG'] = long > Number(row.stat) ? long : Number(row.stat);
        } else if (statName === 'AVG') {
            seasonObj.stats['AVG'] = 0;
        } else if (!isNaN(row.stat)) {
            seasonObj.stats[statName] += Number(row.stat);
        }
        statMap[key].seasons[seasonIdx] = seasonObj;
    }
    
    for (const statType in statMap) {
        if (statMap[statType].statNames.includes('AVG')) {
            for (const season of statMap[statType].seasons) {
                const yards = season.stats['YDS'];
                const attempts = season.stats['REC'] || season.stats['CAR'] || season.stats['NO'] || Number(season.stats['C/ATT'].split('/')[1]);
                season.stats['AVG'] = (yards / attempts).toFixed(1);
            }
        }
        if (statMap[statType].statNames.includes('FG')) {
            for (const season of statMap[statType].seasons) {
                const split = season.stats['FG'].split('/');
                season.stats['FG %'] = ((Number(split[0]) / Number(split[1])) * 100).toFixed(1);
            }
        }
        if (statMap[statType].statNames.includes('XP')) {
            for (const season of statMap[statType].seasons) {
                const split = season.stats['XP'].split('/');
                season.stats['XP %'] = ((Number(split[0]) / Number(split[1])) * 100).toFixed(1);
            }
        }
    }
    return statMap;
}

export async function getPlayerHighlights(request, env) {
    const { searchParams } = new URL(request.url);
    const firstName = searchParams.get('firstName');
    const lastName  = searchParams.get('lastName');
    const position  = searchParams.get('position') ?? '';
    if (!firstName || !lastName) {
        return new Response(JSON.stringify({ error: 'Missing name params' }), { status: 400 });
    }
    try {
        const videos = await getPlayerVideos(firstName, lastName, position, env);
        return Response.json({ videos });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
}