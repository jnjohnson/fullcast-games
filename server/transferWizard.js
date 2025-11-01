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
    let correct = false;
    const body = await req.json();
    const { results } = await env.games_db
        .prepare("SELECT Transfers FROM PlayerTransfers WHERE PlayerId = ?")
        .bind(body.pid)
        .run();
    const transfers = JSON.parse(results[0].Transfers);
    transfers.every((location, i) => {
        if (location == body.question[i]) {
            correct = true;
        } else {
            correct = false;
            return false;
        }
        return true;
    });
    return new Response(JSON.stringify({
        correct: correct
    }), { status: 200 });
}

export { getPlayers, checkAnswer };