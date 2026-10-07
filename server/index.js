import { getPlayers, checkAnswer } from './transferWizard.js';
import { getRandomPlayer, getPlayerById, getPlayerStats, getPlayerHighlights } from './guys.js';
import { getQuestion, submitAnswer } from './moreOrLess.js';

export default {
	async fetch(request, env) {
		const { pathname } = new URL(request.url);

        if (pathname === "/api/transfer-wizard/get-players") {
            const difficulty = new URL(request.url).searchParams.get('difficulty') ?? 'sickos';
            return getPlayers(env, difficulty);
		} else if (pathname === "/api/transfer-wizard/submit"){
            return checkAnswer(request, env);
        } else if (pathname === "/api/guys/random-player") {
            return getRandomPlayer(request, env);
        } else if (pathname === "/api/guys/player") {
            return getPlayerById(request, env);
        } else if (pathname === "/api/guys/videos") {
            return getPlayerHighlights(request, env);
        } else if (pathname === "/api/more-or-less/question") {
            return getQuestion(request, env);
        } else if (pathname === "/api/more-or-less/answer" && request.method === "POST") {
            return submitAnswer(request, env);
        } else {
            return new Response(null, { status: 404 });
        }
	},
};
