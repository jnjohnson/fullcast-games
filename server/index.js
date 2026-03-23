import { getPlayers, checkAnswer, syncTransfers } from './transferWizard.js';
import { syncPlayers, getRandomPlayer, getPlayerById, getPlayerStats } from './guys.js';

export default {
	async fetch(request, env) {
		const { pathname } = new URL(request.url);

        if (pathname === "/api/transfer-wizard/get-players") {
            const difficulty = new URL(request.url).searchParams.get('difficulty') ?? 'sickos';
            return getPlayers(env, difficulty);
		} else if (pathname === "/api/transfer-wizard/submit"){
            return checkAnswer(request, env);
        } else if (pathname === "/api/guys/random-player") {
            return getRandomPlayer(env);
        } else if (pathname === "/api/guys/player") {
            return getPlayerById(request, env);
        } else if (pathname === "/api/guys/player-stats") {
            return getPlayerStats(request, env);
        } else {
            return new Response(null, { status: 404 });
        }

	},

    async scheduled(controller, env, ctx) {
        if (controller.cron === "0 0 1 8 *") {
            console.log("Players sync starting");
            await syncPlayers(env);
            console.log("Players sync complete");
            return;
        } else if (controller.cron === "0 0 * * sun") {
            console.log("Transfer sync processing");
            await syncTransfers(env);
            console.log("Transfer sync complete");
        }

    }
};
