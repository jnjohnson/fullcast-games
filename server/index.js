import { getPlayers, checkAnswer } from './transferWizard.js';

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
        let response = await fetch('https://api.collegefootballdata.com/games?year=2024&seasonType=regular&classification=fbs&team=Michigan', {
            headers: {
                "accept": "application/json",
                "Authorization": "Bearer r8m5gAFIDp/a+0XfE9w6emF5k08s3BmfzNVIkfre/lwcGsUa55eLSQ0m6yHNJENC"
            }
        });
        let res = await response.json();
        console.log(res);
        console.log("cron processed");
        return new Response(null, { status: 200 });
    }
};
