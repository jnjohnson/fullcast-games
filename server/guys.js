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
export async function getRandomPlayer(request, env) {
    const params = new URL(request.url).searchParams;
    const filters = {
        position:   params.getAll('position'),
        school:     params.getAll('school'),
        conference: params.getAll('conference'),
        year:       params.getAll('year').map(Number).filter(Boolean),
    }
    let stats = {};
    let player = {};

    const where = {};
    if (filters.position?.length) {
        where.position = { abbreviation: { _in: filters.position } };
    }
    if (filters.school?.length || filters.conference?.length || filters.year?.length) {
        const teamWhere = {};
        if (filters.school?.length)     teamWhere.team = { school: { _in: filters.school } };
        if (filters.conference?.length) teamWhere.team = { ...teamWhere.team, conference: { name: { _in: filters.conference } } };
        if (filters.year?.length)       teamWhere.startYear = { _in: filters.year };
        where.athleteTeams = teamWhere;
    }

    const hasWhere = Object.keys(where).length > 0;
    const countData = await cfbdGql(
        hasWhere
            ? `query($where: AthleteBoolExp) { athleteAggregate(where: $where) { aggregate { count } } }`
            : `query { athleteAggregate { aggregate { count } } }`,
        hasWhere ? { where } : {},
        env
    );
    const cnt = countData.athleteAggregate.aggregate.count;

    if (cnt === 0) {
        return new Response(JSON.stringify({ error: 'No players match these filters' }), { status: 404 });
    }

    while (Object.keys(stats).length === 0) {
        const offset = Math.floor(Math.random() * cnt);
        const data = await cfbdGql(
            hasWhere
                ? `query($offset: Int!, $where: AthleteBoolExp) { athlete(limit: 1, offset: $offset, where: $where) { ${ATHLETE_FIELDS} } }`
                : `query($offset: Int!) { athlete(limit: 1, offset: $offset) { ${ATHLETE_FIELDS} } }`,
            hasWhere ? { offset, where } : { offset },
            env
        );
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
        if (statType === 'kicking') {
            for (const season of statMap[statType].seasons) {
                const FGsplit = season.stats['FG'].split('/');
                const XPsplit = season.stats['XP'].split('/');
                
                season.stats['FG %'] = ((Number(FGsplit[0]) / Number(FGsplit[1])) * 100).toFixed(1);
                season.stats['FG %'] = isNaN(season.stats['FG %']) ? 'N/A' : season.stats['FG %'];
                
                season.stats['XP %'] = ((Number(XPsplit[0]) / Number(XPsplit[1])) * 100).toFixed(1);
                season.stats['XP %'] = isNaN(season.stats['XP %']) ? 'N/A' : season.stats['XP %'];
            }
        } else if (statType === 'passing') {
            for (const season of statMap[statType].seasons) {
                const s = season.stats;
                const catches = Number(season.stats['C/ATT'].split('/')[0]);
                const att = Number(season.stats['C/ATT'].split('/')[1]);
                s['QBR'] = (((8.4*s['YDS']) + (330*s['TD']) + (100*catches) - (200*s['INT'])) / att).toFixed(1);
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