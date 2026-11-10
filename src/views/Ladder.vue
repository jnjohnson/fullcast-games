<script setup>
    import { ref, computed, nextTick } from 'vue';
    import AutocompleteInput from '../components/AutocompleteInput.vue';

    const BEST_KEY = 'ladder-best-score';
    const MAX_MISSES = 5;
    const KIND_LABELS = { team: 'team', coach: 'coach', qb: 'quarterback' };
    const KIND_TAGS = { team: 'Team', coach: 'Coach', qb: 'QB' };

    // 'loading' | 'guessing' | 'checking' | 'over' | 'error'
    const status = ref('loading');
    const question = ref(null);
    // Solved questions from this run, oldest first, as { question, reveal }. They stay on screen as the rungs
    // of the ladder, with the current question below them.
    const history = ref([]);
    const run = ref({ score: 0, misses: 0, lifelineUsed: false });
    const best = ref(readBest());
    // The revealed answer and game for the current question, once the run is over.
    const reveal = ref(null);
    const selection = ref(null);
    // Lifeline options for the current question, and the ids already guessed wrong among them.
    const choices = ref(null);
    const wrongChoices = ref(new Set());
    const wrongFlash = ref(false);
    const errorMessage = ref('');
    const autocomplete = ref(null);

    // Reads the best score from localStorage. Returns 0 if storage is empty or unavailable.
    function readBest() {
        try {
            return Number(localStorage.getItem(BEST_KEY)) || 0;
        } catch {
            return 0;
        }
    }

    // Saves the best score to localStorage, ignoring storage errors (e.g. private browsing).
    function saveBest(value) {
        try {
            localStorage.setItem(BEST_KEY, String(value));
        } catch {}
    }

    // Sends a request to the ladder API and returns the parsed body. Throws if the server responds with an error.
    async function api(path, body) {
        const res = body
            ? await fetch(`/api/ladder/${path}`, { method: 'POST', body: JSON.stringify(body) })
            : await fetch(`/api/ladder/${path}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Something went wrong');
        return data;
    }

    // Fetches a question. With `fromId`, continues the chain from that question; otherwise starts a new run.
    function fetchQuestion(fromId) {
        return api(fromId ? `question?from=${fromId}` : 'question');
    }

    // Shows a loaded question below the solved ones, or the error screen if loading failed.
    // After the first question, scrolls the new text box to the middle of the screen and focuses it.
    async function showQuestion(promise) {
        status.value = 'loading';
        try {
            question.value = await promise;
            run.value = question.value.run;
            reveal.value = null;
            selection.value = null;
            choices.value = question.value.choices;
            wrongChoices.value = new Set();
            wrongFlash.value = false;
            status.value = 'guessing';
        } catch (error) {
            errorMessage.value = error.message;
            status.value = 'error';
            return;
        }
        if (history.value.length) {
            await nextTick();
            autocomplete.value?.focus();
        }
    }

    // Starts a new run, clearing the ladder.
    function start() {
        history.value = [];
        showQuestion(fetchQuestion());
    }

    // Sends a guess (a suggestion or lifeline choice id). A correct guess adds the question and its answer to
    // the ladder and loads the next question below it; a wrong one adds a miss and lets the player try again,
    // until the run is over.
    async function guess(guessId) {
        status.value = 'checking';
        wrongFlash.value = false;
        let result;
        try {
            result = await api('answer', { id: question.value.id, guessId });
        } catch (error) {
            errorMessage.value = error.message;
            status.value = 'error';
            return;
        }
        run.value = result.run;

        if (result.correct) {
            if (run.value.score > best.value) {
                best.value = run.value.score;
                saveBest(best.value);
            }
            history.value.push({ question: question.value, reveal: result });
            showQuestion(fetchQuestion(question.value.id));
        } else if (result.gameOver) {
            reveal.value = result;
            status.value = 'over';
        } else {
            if (choices.value) {
                wrongChoices.value = new Set([...wrongChoices.value, guessId]);
            } else {
                autocomplete.value?.clear();
                selection.value = null;
            }
            wrongFlash.value = true;
            status.value = 'guessing';
        }
    }

    // Uses the run's one lifeline, swapping the text box for multiple choice buttons.
    async function useLifeline() {
        status.value = 'checking';
        try {
            const { choices: options } = await api('lifeline', { id: question.value.id });
            choices.value = options;
            run.value = { ...run.value, lifelineUsed: true };
            status.value = 'guessing';
        } catch (error) {
            errorMessage.value = error.message;
            status.value = 'error';
        }
    }

    // The question text, e.g. "Who was the last team to beat Matt Campbell?" or "Who was the last coach Arch Manning beat?"
    function promptFor({ subject, direction, answerKind }) {
        const label = KIND_LABELS[answerKind];
        return direction === 'beatBy'
            ? `Who was the last ${label} to beat ${subject.name}?`
            : `Who was the last ${label} ${subject.name} beat?`;
    }

    // The revealed game, e.g. "Mississippi State 31, Missouri 24 · Sep 2026".
    function gameLine(game) {
        if (!game) return '';
        const date = new Date(game.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        return `${game.score} · ${date}`;
    }

    // A rung shows its subject card when it starts a chain: the first question, or one after a restart.
    // Otherwise the subject is the answer shown just above it, and the rung is linked to the one before.
    function startsChain(q, index) {
        return index === 0 || q.restarted;
    }

    const canGuess = computed(() => status.value === 'guessing');

    start();
</script>

<template>
    <div class="ladder">
        <div class="ladder-header">
            <h2>THE LADDER</h2>
            <div class="scoreboard">
                <span>Score: <strong>{{ run.score }}</strong></span>
                <span>Best: <strong>{{ best }}</strong></span>
                <span class="misses" :aria-label="`${run.misses} of ${MAX_MISSES} misses`">
                    <span v-for="n in MAX_MISSES" :key="n" class="miss" :class="{ used: n <= run.misses }">✕</span>
                </span>
            </div>
        </div>

        <div
            v-for="(rung, i) in history"
            :key="rung.question.id"
            class="rung"
            :class="{ linked: !startsChain(rung.question, i) }"
        >
            <p v-if="rung.question.restarted" class="restarted">That chain ran dry. Starting a new one!</p>
            <div v-if="startsChain(rung.question, i)" class="subject">
                <span class="tag">{{ KIND_TAGS[rung.question.subject.kind] }}</span>
                <span class="name">{{ rung.question.subject.name }}</span>
                <span v-if="rung.question.subject.detail" class="detail">{{ rung.question.subject.detail }}</span>
            </div>
            <p class="prompt">{{ promptFor(rung.question) }}</p>
            <div class="reveal correct">
                <span class="name">{{ rung.reveal.answer.name }}</span>
                <span v-if="rung.reveal.answer.detail" class="detail">{{ rung.reveal.answer.detail }}</span>
                <span class="game">{{ gameLine(rung.reveal.game) }}</span>
            </div>
        </div>

        <p v-if="status === 'loading'" class="loading">Loading...</p>

        <div v-else-if="status === 'error'" class="error">
            <p>{{ errorMessage }}</p>
            <button @click="start">Start Over</button>
        </div>

        <div
            v-else
            :key="question.id"
            class="rung current"
            :class="{ linked: !startsChain(question, history.length) }"
        >
            <p v-if="question.restarted" class="restarted">That chain ran dry. Starting a new one!</p>

            <div v-if="startsChain(question, history.length)" class="subject">
                <span class="tag">{{ KIND_TAGS[question.subject.kind] }}</span>
                <span class="name">{{ question.subject.name }}</span>
                <span v-if="question.subject.detail" class="detail">{{ question.subject.detail }}</span>
            </div>

            <p class="prompt">{{ promptFor(question) }}</p>

            <template v-if="status === 'guessing' || status === 'checking'">
                <div v-if="choices" class="choices">
                    <button
                        v-for="choice in choices"
                        :key="choice.id"
                        :class="{ wrong: wrongChoices.has(choice.id) }"
                        :disabled="!canGuess || wrongChoices.has(choice.id)"
                        @click="guess(choice.id)"
                    >
                        {{ choice.name }}
                        <span v-if="choice.detail" class="choice-detail">{{ choice.detail }}</span>
                    </button>
                </div>

                <form v-else class="guess-form" @submit.prevent="selection && guess(selection.id)">
                    <AutocompleteInput
                        ref="autocomplete"
                        :kind="question.answerKind"
                        :placeholder="`Search for a ${KIND_LABELS[question.answerKind]}...`"
                        :disabled="!canGuess"
                        @select="selection = $event"
                    />
                    <button type="submit" :disabled="!canGuess || !selection">Guess</button>
                </form>

                <p v-if="wrongFlash" class="wrong-flash">Nope. Try again.</p>

                <button
                    v-if="!run.lifelineUsed"
                    class="button-alternate lifeline"
                    :disabled="!canGuess"
                    @click="useLifeline"
                >Lifeline</button>
            </template>

            <div v-else-if="status === 'over'" class="game-over">
                <div class="reveal incorrect">
                    <span class="label">The answer was</span>
                    <span class="name">{{ reveal.answer.name }}</span>
                    <span v-if="reveal.answer.detail" class="detail">{{ reveal.answer.detail }}</span>
                    <span class="game">{{ gameLine(reveal.game) }}</span>
                </div>
                <h3>Game Over</h3>
                <button @click="start">Play Again</button>
            </div>
        </div>
    </div>
</template>

<style scoped lang="scss">
    @use '../assets/base';

    .ladder {
        align-items: center;
        display: flex;
        flex-direction: column;
        gap: 30px;
        margin: 0 auto;
        max-width: 640px;
        text-align: center;
        width: 100%;
    }

    // The title and scoreboard stay pinned to the top of the screen as the ladder grows down the page.
    // Sticky (not fixed) keeps the header's space in the layout, so it never covers the first question.
    .ladder-header {
        align-items: center;
        background: base.$color-background;
        border-bottom: 1px solid base.$ptku-blue;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 35px 0;
        position: sticky;
        top: 0;
        width: 100%;
        // Above the autocomplete suggestions, so they slide under it when scrolled.
        z-index: 20;

        h2 {
            font-size: 1.8rem;
        }
    }

    .scoreboard {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        font-family: base.$inter;
        gap: 30px;
        justify-content: center;
        text-transform: uppercase;

        strong {
            color: base.$ptku-blue;
        }
    }

    .misses {
        display: flex;
        gap: 6px;

        .miss {
            font-weight: 900;
            opacity: 0.25;
            transition: all 0.3s;

            &.used {
                color: base.$incorrect-red;
                opacity: 1;
            }
        }
    }

    .loading {
        color: base.$ptku-blue;
        font-family: base.$inter;
        font-size: 20px;
        font-weight: 600;
        opacity: 0.6;
        text-transform: uppercase;
    }

    // One question of the ladder. A linked rung continues the chain from the answer above it,
    // so a short connector line joins them.
    .rung {
        align-items: center;
        animation: slide-in 0.4s ease-out;
        display: flex;
        flex-direction: column;
        gap: 20px;
        width: 100%;

        &.linked {
            margin-top: -10px;

            &::before {
                background: base.$ptku-pink;
                content: '';
                height: 30px;
                width: 2px;
            }
        }
    }

    .restarted {
        color: base.$ptku-pink;
        font-weight: 700;
    }

    .subject {
        border: 2px solid base.$ptku-blue;
        border-radius: 15px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 24px 20px;
        width: 100%;

        .tag {
            color: base.$ptku-pink;
            font-family: base.$inter;
            font-size: 0.8rem;
            font-weight: 900;
            letter-spacing: 1.2px;
            text-transform: uppercase;
        }

        .name {
            font-family: base.$inter;
            font-size: 1.8rem;
            font-weight: 900;
        }

        .detail {
            font-size: 0.85rem;
            opacity: 0.8;
            text-transform: uppercase;
        }
    }

    .prompt {
        font-size: 1.2rem;
        font-weight: 700;
    }

    .guess-form {
        display: flex;
        gap: 15px;
        width: 100%;

        button {
            min-width: 120px;
        }

        @media screen and (max-width: 600px) {
            flex-direction: column;
        }
    }

    .choices {
        display: grid;
        gap: 15px;
        grid-template-columns: 1fr 1fr;
        width: 100%;

        button {
            display: flex;
            flex-direction: column;
            gap: 4px;

            &.wrong {
                border-color: base.$incorrect-red;
                color: base.$incorrect-red;
            }
        }

        .choice-detail {
            font-size: 0.75rem;
            font-weight: 500;
            opacity: 0.8;
        }

        @media screen and (max-width: 600px) {
            grid-template-columns: 1fr;
        }
    }

    button:disabled {
        cursor: not-allowed;
        opacity: 0.6;
    }

    .wrong-flash {
        color: base.$incorrect-red;
        font-weight: 700;
        text-transform: uppercase;
    }

    .reveal {
        align-items: center;
        border: 2px solid;
        border-radius: 15px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 24px 20px;
        width: 100%;

        &.correct {
            border-color: base.$correct-green;

            .name {
                color: base.$correct-green;
            }
        }

        &.incorrect {
            border-color: base.$incorrect-red;

            .name {
                color: base.$incorrect-red;
            }
        }

        .label,
        .detail {
            font-size: 0.85rem;
            opacity: 0.8;
            text-transform: uppercase;
        }

        .name {
            font-family: base.$inter;
            font-size: 1.6rem;
            font-weight: 900;
        }

        .game {
            margin-bottom: 10px;
        }
    }

    .game-over,
    .error {
        align-items: center;
        display: flex;
        flex-direction: column;
        gap: 15px;
        width: 100%;

        h3 {
            color: base.$incorrect-red;
            font-size: 1.5rem;
            text-transform: uppercase;
        }

        strong {
            color: base.$ptku-blue;
        }
    }
    .game-over {
        gap: 30px;
    }

@keyframes slide-in {
    from {
        opacity: 0;
        transform: translateX(40px);
    }
    to {
        opacity: 1;
        transform: translateX(0);
    }
}
</style>
