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
    const { results } = await env.games_db
        .prepare("SELECT Transfers FROM PlayerTransfers WHERE PlayerId = ?")
        .bind(req.PlayerId)
        .run();

    return (results === req.question) ? true : false;
}

export default getPlayers;