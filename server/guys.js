const CFBD_BASE = 'https://apinext.collegefootballdata.com';

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

// Fetches the full roster for a given year from the CFBD API and syncs it into the Players table.
// For each player, inserts a new row if they don't exist yet, or appends the season/team entry to
// their existing Seasons JSON array if it isn't already recorded. Skips players missing id or team.
// Logs a summary of added/updated/skipped counts on completion.
export async function syncPlayers(env) {
    const year = '2019';
    const response = await fetch(`${CFBD_BASE}/roster?year=${year}`, {
        headers: { accept: 'application/json', Authorization: env.CFBD_TOKEN }
    });
    if (!response.ok) {
        console.error(`Roster fetch failed: ${response.status}`);
        return;
    }
    const players = await response.json();
    console.log(`Syncing ${players.length} players for ${year}`);

    let added = 0, updated = 0, skipped = 0;
    for (const player of players) {
        if (!player.id || !player.team) continue;

        const { results } = await env.games_db
            .prepare('SELECT PlayerId, Seasons FROM Players WHERE PlayerId = ?')
            .bind(player.id)
            .run();

        if (results.length === 0) {
            const seasons = JSON.stringify([{ year, team: player.team }]);
            await env.games_db
                .prepare('INSERT INTO Players (PlayerId, FirstName, LastName, Position, Seasons) VALUES (?, ?, ?, ?, ?)')
                .bind(player.id, player.firstName ?? '', player.lastName ?? '', player.position ?? '', seasons)
                .run();
            added++;
        } else {
            const seasons = JSON.parse(results[0].Seasons);
            const alreadyHas = seasons.some(s => s.year === year && s.team === player.team);
            if (!alreadyHas) {
                seasons.push({ year, team: player.team });
                await env.games_db
                    .prepare('UPDATE Players SET Seasons = ? WHERE PlayerId = ?')
                    .bind(JSON.stringify(seasons), player.id)
                    .run();
                updated++;
            } else {
                console.log(player.id + ' - ' + player.team);
                console.log('typeof year: ' + typeof(year));
                for (const s of seasons) {
                    console.log(s.year + ' (' + typeof(s.year) + ') - ' + s.team);
                }
                skipped++;
            }
        }
    }

    console.log(`Players sync complete — added: ${added}, updated: ${updated}, skipped: ${skipped}`);
}

// Returns a single random player from the Players table as a JSON response.
// Picks a random row using COUNT + random OFFSET. Returns 404 if the table is empty.
// Response body: { id, firstName, lastName, position, seasons } where seasons is a parsed array
// of { year, team } objects.
export async function getRandomPlayer(env) {
    const { results: [{ cnt }] } = await env.games_db
        .prepare('SELECT COUNT(*) AS cnt FROM Players')
        .run();

    if (cnt === 0) {
        return new Response(JSON.stringify({ error: 'No players in database' }), { status: 404 });
    }

    const offset = Math.floor(Math.random() * cnt);
    const { results } = await env.games_db
        .prepare('SELECT * FROM Players LIMIT 1 OFFSET ?')
        .bind(offset)
        .run();

    const player = results[0];
    return new Response(JSON.stringify({
        id: player.PlayerId,
        firstName: player.FirstName,
        lastName: player.LastName,
        position: player.Position,
        seasons: JSON.parse(player.Seasons),
    }), { status: 200 });
}

// Fetches a single player's basic info by ID from the Players table.
// Requires a `playerId` query parameter (integer). Returns 400 if missing, 404 if not found.
// Response body: { id, firstName, lastName, position, seasons } — same shape as getRandomPlayer.
export async function getPlayerById(request, env) {
    const playerId = parseInt(new URL(request.url).searchParams.get('playerId'), 10);
    if (!playerId) return new Response(JSON.stringify({ error: 'Missing playerId' }), { status: 400 });

    const { results } = await env.games_db
        .prepare('SELECT * FROM Players WHERE PlayerId = ?')
        .bind(playerId)
        .run();

    if (results.length === 0) return new Response(JSON.stringify({ error: 'Player not found' }), { status: 404 });

    const p = results[0];
    return new Response(JSON.stringify({
        id: p.PlayerId,
        firstName: p.FirstName,
        lastName: p.LastName,
        position: p.Position,
        seasons: JSON.parse(p.Seasons),
    }), { status: 200 });
}

// Fetches season stats for a player from the CFBD API and returns them grouped by season.
// Requires a `playerId` query parameter (integer). Returns 400 if missing, 404 if not in the DB.
// Stats are filtered to the categories relevant for the player's position (e.g. QB gets passing +
// rushing; defensive players get defensive/interceptions/fumbles; unknown positions get everything).
// For each season in the player's history, fires one CFBD request and pivots the flat stat rows
// into a nested { category: { stat_type: value } } object.
// Response body: { playerId, position, categories, categoryColumns, seasons: [{ year, team, stats }] }
export async function getPlayerStats(request, env) {
    const { searchParams } = new URL(request.url);
    const playerId = parseInt(searchParams.get('playerId'), 10);

    if (!playerId) {
        return new Response(JSON.stringify({ error: 'Missing playerId' }), { status: 400 });
    }

    const { results } = await env.games_db
        .prepare('SELECT Position, Seasons FROM Players WHERE PlayerId = ?')
        .bind(playerId)
        .run();

    if (results.length === 0) {
        return new Response(JSON.stringify({ error: 'Player not found' }), { status: 404 });
    }

    const { Position: position, Seasons: seasonsJson } = results[0];
    const seasons = JSON.parse(seasonsJson);
    const categories = relevantCategories(position);

    // Fetch stats for each season in parallel
    const fetches = seasons.map(({ year, team }) =>
        fetch(`${CFBD_BASE}/stats/player/season?year=${year}&team=${encodeURIComponent(team)}`, {
            headers: { accept: 'application/json', Authorization: env.CFBD_TOKEN }
        }).then(r => r.ok ? r.json() : []).then(rows => ({ year, team, rows }))
    );
    const seasonData = await Promise.all(fetches);

    const seasonStats = seasonData.map(({ year, team, rows }) => {
        // Filter to this player's rows, then to relevant categories
        const playerRows = rows.filter(r => r.playerId == playerId);
        // const filteredRows = categories
        //     ? playerRows.filter(r => categories.includes(r.category))
        //     : playerRows;
        // Pivot flat rows into { category: { stat_type: value } }
        const stats = {};
        for (const row of playerRows) {
            if (!stats[row.category]) stats[row.category] = {};
            stats[row.category][row.statType] = row.stat;
        }

        return { year, team, stats };
    });

    return new Response(JSON.stringify({
        playerId,
        position,
        categories: categories ?? Object.keys(CATEGORY_COLUMNS),
        categoryColumns: CATEGORY_COLUMNS,
        seasons: seasonStats,
    }), { status: 200 });
}
