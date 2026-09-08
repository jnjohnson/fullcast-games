import { getPlayers, checkAnswer } from './transferWizard.js';
import { getRandomPlayer, getPlayerById, getPlayerStats } from './guys.js';

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
};
