var p4_schools = ["Alabama","Arizona","Arizona State","Arkansas","Auburn","Baylor","Boston College","BYU","California","Cincinnati","Clemson","Colorado","Duke","Florida","Florida State","Georgia","Georgia Tech","Houston","Illinois","Indiana","Iowa","Iowa State","Kansas","Kansas State","Kentucky","Louisville","LSU","Maryland","Miami","Michigan","Michigan State","Minnesota","Mississippi State","Missouri","NC State","Nebraska","North Carolina","Northwestern","Ohio State","Oklahoma","Oklahoma State","Ole Miss","Oregon","Penn State","Pittsburgh","Purdue","Rutgers","SMU","South Carolina","Stanford","Syracuse","TCU","Tennessee","Texas","Texas A&M","Texas Tech","UCF","UCLA","USC","Utah","Vanderbilt","Virginia","Virginia Tech","Wake Forest","Washington","West Virginia","Wisconsin"];

// Selects 4 random players from PlayerTransfers filtered by difficulty, then picks one of them as
// the question. Returns a JSON response with `question` (the chosen player's Transfers JSON string)
// and `players` (array of { name, id } for all 4 choices).
// - difficulty: 'easy' (QB in P4), 'medium' (QB/RB/WR in P4), 'hard' (QB/RB/WR with any P4 history),
//   or 'sickos' (no filter).
async function getPlayers(env, difficulty) {
    const max = 4;
    let where = '';
    if (difficulty === 'easy') {
        where = "WHERE InP4 = 1 AND Position IN ('QB')";
    } else if (difficulty === 'medium') {
        where = "WHERE InP4 = 1 AND Position IN ('QB', 'RB', 'WR')";
    } else if (difficulty === 'hard') {
        where = "WHERE (WasInP4 = 1 OR InP4 = 1) AND Position IN ('QB', 'RB', 'WR')";
    }

    const { results: [{ cnt }] } = await env.games_db
        .prepare(`SELECT COUNT(*) AS cnt FROM PlayerTransfers ${where}`)
        .run();

    const offsets = new Set();
    while (offsets.size < Math.min(max, cnt)) {
        offsets.add(Math.floor(Math.random() * cnt));
    }

    const rows = await env.games_db.batch(
        [...offsets].map(offset =>
            env.games_db.prepare(`SELECT * FROM PlayerTransfers ${where} LIMIT 1 OFFSET ?`).bind(offset)
        )
    );
    const results = rows.map(r => r.results[0]);

    const answerIndex = Math.floor(Math.random() * results.length);
    const question = results[answerIndex].Transfers;
    const players = results.map((player) => {
        const name = player.FirstName + ' ' + player.LastName;
        return {name: name, id: player.PlayerId};
    });

    return new Response(JSON.stringify({
        question: question,
        players: players,
    }), { status: 200 });
}

// Validates a player's answer for the transfer wizard game. Reads `question` (a multi-element school
// array) from the POST body, queries PlayerTransfers for all players whose Transfers JSON matches
// that route, and returns a JSON response with `pids` (array of matching PlayerId integers).
// Multiple players can share the same transfer route, so pids may contain more than one entry.
async function checkAnswer(req, env) {
    const body = await req.json();
    const { results } = await env.games_db
        .prepare("SELECT PlayerId FROM PlayerTransfers WHERE Transfers = ?")
        .bind(JSON.stringify(body.question))
        .run();
    const pids = results.map((player) => {
        return player.PlayerId;
    });
    return new Response(JSON.stringify({
        pids: pids
    }), { status: 200 });
}

// Looks up a player in PlayerTransfers by name, position, and origin school. Uses SQLite's instr()
// to confirm the origin appears somewhere in the Transfers JSON string, guarding against false
// positives on players with no transfer history from that school.
// - transfer: object with { firstName, lastName, position, origin } from the CFBD portal API.
// Returns the raw D1 result object ({ results: [...] }) with PlayerId, Transfers, and OriginPos.
async function findPlayer(transfer, env) {
    return env.games_db
                .prepare("SELECT PlayerId, Transfers, instr(Transfers, ?1) OriginPos FROM PlayerTransfers WHERE FirstName = ?2 AND LastName = ?3 AND Position = ?4 AND instr(Transfers, ?1) > 0")
                .bind(transfer.origin, transfer.firstName, transfer.lastName, transfer.position)
                .run();
}

// Inserts a new row into PlayerTransfers for a player not yet in the database.
// Derives WasInP4 and InP4 by checking origin/destination against the p4_schools list.
// Transfers is stored as a JSON array string: ["origin","destination"].
// - transfer: object with { firstName, lastName, position, origin, destination }.
function addNewPlayer(transfer, env) {
    let inP4 = p4_schools.includes(transfer.destination);
    let wasInP4 = p4_schools.includes(transfer.origin);
    
    env.games_db
        .prepare("INSERT INTO PlayerTransfers (FirstName, LastName, Position, WasInP4, InP4, Transfers) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
        .bind(transfer.firstName, transfer.lastName, transfer.position, wasInP4, inP4, '["'+transfer.origin+'","'+transfer.destination+'"]')
        .run();
    return;
}

// Appends a new destination to an existing player's Transfers JSON string and updates InP4.
// Returns false (no-op) if the destination is already the last entry in Transfers, meaning the
// player's current location is already recorded. Returns true if the update was written to D1.
// - player: a PlayerTransfers row with at least { PlayerId, Transfers }.
// - transfer: object with { destination } from the CFBD portal API.
function updatePlayer(player, transfer, env) {
    let transferStr = player.Transfers;

    /* Search if transfer.destination is last location in player.Transfers string.
    *  If it is the last location, do not update.
    *  Else, update the player.Transfers string, update inP4 value in SQL
    */
    if (transferStr.indexOf(transfer.destination + '"]') != -1) {
        console.log(player);
        console.log(transfer);
        return false;
    } else {
        let inP4 = p4_schools.includes(transfer.destination);
        let closingBracePos = transferStr.indexOf(']');
        let newDestStr = ',"'+transfer.destination+'"';
        transferStr = transferStr.slice(0, closingBracePos) + newDestStr + transferStr.slice(closingBracePos);

        env.games_db
            .prepare("UPDATE PlayerTransfers SET InP4 = ?1, Transfers = ?2 WHERE PlayerId = ?3")
            .bind(inP4, transferStr, player.PlayerId)
            .run();
        return true;
    }
}

// Fetches the current year's transfer portal data from the CFBD API and upserts it into
// PlayerTransfers. For each transfer with both an origin and destination, it either inserts a new
// player or appends the destination to an existing player's Transfers history. Logs a summary of
// added/updated/skipped counts on completion.
async function syncTransfers(env) {
    let response = await fetch('https://api.collegefootballdata.com/player/portal?year=2026', {
        headers: {
            "accept": "application/json",
            "Authorization": env.CFBD_TOKEN
        }
    });
    let res = await response.json();
    let added = 0;
    let updated = 0;
    let skipped = 0;
    let result;
    for (const transfer of res) {
        // If both are not present, skip player for this season
        if (transfer.origin && transfer.destination) {
            const { results } = await findPlayer(transfer, env);
            if (results.length == 0) {
                addNewPlayer(transfer, env);
                added++;
            } else if (results.length == 1) {
                result = updatePlayer(results[0], transfer, env);
                if (result) {
                    updated++;
                } else {
                    skipped++;
                }
            } else {
                console.error('multiple players found!');
                console.error('results:');
                console.error(results);
                console.error('transfer:');
                console.error(transfer);
            }
        }
    };
    console.log(`Transfer sync complete — added: ${added}, updated: ${updated}, skipped: ${skipped}`);
}

export { getPlayers, checkAnswer, findPlayer, addNewPlayer, updatePlayer, syncTransfers };