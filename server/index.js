import { getPlayers, checkAnswer, findPlayer, addNewPlayer, updatePlayer } from './transferWizard.js';

export default {
	async fetch(request, env) {
		const { pathname } = new URL(request.url);

        if (pathname === "/api/transfer-wizard/get-players") {
            return getPlayers(env);
		} else if (pathname === "/api/transfer-wizard/submit"){
            return checkAnswer(request, env);
        } else {
            return new Response(null, { status: 404 });
        }

	},

    async scheduled(controller, env, ctx) {
        console.log("cron processing");
        let response = await fetch('https://api.collegefootballdata.com/player/portal?year=2026', {
            headers: {
                "accept": "application/json",
                "Authorization": env.CFBD_TOKEN
            }
        });
        let res = await response.json();
        let np = 0;
        let ep = 0;
        let sp = 0;
        let result;
        console.log(res.length);
        for (const transfer of res) {
            // If both are not present, skip player for this season
            if (transfer.origin && transfer.destination) {
                const { results } = await findPlayer(transfer, env);
                if (results.length == 0) {
                    addNewPlayer(transfer, env);
                    np++;
                } else if (results.length == 1) {
                    result = updatePlayer(results[0], transfer, env);
                    if (result) {
                        ep++;
                    } else {
                        sp++;
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
        console.log('new players added: ' + np);
        console.log('existing players updated: ' + ep);
        console.log('existing players skipped: ' + sp);
        console.log("cron processed");
        return new Response(null, { status: 200 });
    }
};
