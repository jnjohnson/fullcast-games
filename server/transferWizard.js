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
        .bind(JSON.stringify(body.question).replaceAll(',', ', '))
        .run();

    return new Response(JSON.stringify({
        correctPid: results[0].PlayerId
    }), { status: 200 });
}

export { getPlayers, checkAnswer };