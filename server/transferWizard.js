var p4_schools = ["Alabama","Arizona","Arizona State","Arkansas","Auburn","Baylor","Boston College","BYU","California","Cincinnati","Clemson","Colorado","Duke","Florida","Florida State","Georgia","Georgia Tech","Houston","Illinois","Indiana","Iowa","Iowa State","Kansas","Kansas State","Kentucky","Louisville","LSU","Maryland","Miami","Michigan","Michigan State","Minnesota","Mississippi State","Missouri","NC State","Nebraska","North Carolina","Northwestern","Ohio State","Oklahoma","Oklahoma State","Ole Miss","Oregon","Penn State","Pittsburgh","Purdue","Rutgers","SMU","South Carolina","Stanford","Syracuse","TCU","Tennessee","Texas","Texas A&M","Texas Tech","UCF","UCLA","USC","Utah","Vanderbilt","Virginia","Virginia Tech","Wake Forest","Washington","West Virginia","Wisconsin"];

async function getPlayers(env) {
    const max = 4;
    const answerIndex = Math.floor(Math.random() * max);
    const { results } = await env.games_db
        .prepare("SELECT * FROM PlayerTransfers ORDER BY RANDOM() LIMIT ?")
        .bind(max)
        .run();
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

async function findPlayer(transfer, env) {
    return env.games_db
                .prepare("SELECT PlayerId, Transfers, instr(Transfers, ?1) OriginPos FROM PlayerTransfers WHERE FirstName = ?2 AND LastName = ?3 AND Position = ?4 AND OriginPos > 0")
                .bind(transfer.origin, transfer.firstName, transfer.lastName, transfer.position)
                .run();
}

function addNewPlayer(transfer, env) {
    let inP4 = p4_schools.includes(transfer.destination);
    let wasInP4 = p4_schools.includes(transfer.origin);
    
    env.games_db
        .prepare("INSERT INTO PlayerTransfers (FirstName, LastName, Position, WasInP4, InP4, Transfers) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
        .bind(transfer.firstName, transfer.lastName, transfer.position, wasInP4, inP4, '["'+transfer.origin+'","'+transfer.destination+'"]')
        .run();
    return;
}

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

export { getPlayers, checkAnswer, findPlayer, addNewPlayer, updatePlayer };