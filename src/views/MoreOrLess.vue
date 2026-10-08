<script setup>
    import { ref, computed } from 'vue';

    const BEST_KEY = 'mol-best-streak';

    // 'loading' | 'guessing' | 'checking' | 'revealed' | 'over' | 'error'
    const status = ref('loading');
    const question = ref(null);
    const result = ref(null);
    const streak = ref(0);
    const best = ref(readBest());
    const errorMessage = ref('');
    // Promise for the next question, started as soon as a guess is correct so "Next" feels instant.
    let nextQuestion = null;

    // Reads the best streak from localStorage. Returns 0 if storage is empty or unavailable.
    function readBest() {
        try {
            return Number(localStorage.getItem(BEST_KEY)) || 0;
        } catch {
            return 0;
        }
    }

    // Saves the best streak to localStorage, ignoring storage errors (e.g. private browsing).
    function saveBest(value) {
        try {
            localStorage.setItem(BEST_KEY, String(value));
        } catch {}
    }

    // Fetches a question. With `fromId`, continues the streak from that question; otherwise starts a new run.
    // Throws if the server responds with an error.
    async function fetchQuestion(fromId) {
        const url = fromId ? `/api/more-or-less/question?from=${fromId}` : '/api/more-or-less/question';
        const res = await fetch(url);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? 'Something went wrong');
        return body;
    }

    // Shows a loaded question, or the error screen if loading failed.
    async function showQuestion(promise) {
        status.value = 'loading';
        try {
            question.value = await promise;
            result.value = null;
            status.value = 'guessing';
        } catch (error) {
            errorMessage.value = error.message;
            status.value = 'error';
        }
    }

    // Starts a new run from a streak of 0.
    function start() {
        streak.value = 0;
        nextQuestion = null;
        showQuestion(fetchQuestion());
    }

    // Sends a guess ('more' or 'less'), reveals B, and either extends the streak or ends the run.
    async function guess(choice) {
        status.value = 'checking';
        try {
            const res = await fetch('/api/more-or-less/answer', {
                method: 'POST',
                body: JSON.stringify({ id: question.value.id, guess: choice }),
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error ?? 'Something went wrong');
            result.value = body;
        } catch (error) {
            errorMessage.value = error.message;
            status.value = 'error';
            return;
        }

        if (result.value.correct) {
            streak.value++;
            if (streak.value > best.value) {
                best.value = streak.value;
                saveBest(best.value);
            }
            nextQuestion = fetchQuestion(question.value.id);
            // Avoid an unhandled rejection warning; showQuestion handles the error when "Next" is clicked.
            nextQuestion.catch(() => {});
            status.value = 'revealed';
        } else {
            status.value = 'over';
        }
    }

    // Moves on to the prefetched next question.
    function next() {
        showQuestion(nextQuestion);
    }

    // The prompt for the current question, e.g. "Did Bryce Young have more or less career passing yards than Caleb Williams?"
    const prompt = computed(() => {
        const q = question.value;
        const a_end = q.a.name.slice(-1) === 's' ? "\'" : "'s";
        const b_end = q.b.name.slice(-1) === 's' ? "\'" : "'s";
        switch (q.type) {
            case 'player':
                return `Did ${q.b.name} have more or less ${q.stat.label} than ${q.a.name}?`;
            case 'coach':
                return `Is ${q.b.name}${b_end} ${q.stat.label} more or less than ${q.a.name}${a_end} ?`;
            case 'school':
                return `Is ${q.b.name}${b_end} ${q.stat.label} more or less than ${q.a.name}${a_end} ?`;
            default:
                break;
        }
    });

    start();
</script>

<template>
    <div class="more-or-less">
        <h2>MORE OR LESS</h2>
        <div class="streaks">
            <span>Streak: <strong>{{ streak }}</strong></span>
            <span>Best: <strong>{{ best }}</strong></span>
        </div>

        <p v-if="status === 'loading'" class="loading">Loading...</p>

        <div v-else-if="status === 'error'" class="error">
            <p>{{ errorMessage }}</p>
            <button @click="start">Start Over</button>
        </div>

        <template v-else>
            <p class="prompt">{{ prompt }}</p>

            <div class="matchup" :key="question.id">
                <div class="subject">
                    <span class="name">{{ question.a.name }}</span>
                    <span class="detail">{{ question.a.detail }}</span>
                    <span class="value">{{ question.a.display }}</span>
                    <span class="stat">{{ question.stat.label }}</span>
                </div>
                <span class="vs">VS</span>
                <div
                    class="subject"
                    :class="{ correct: result?.correct, incorrect: result && !result.correct }"
                >
                    <span class="name">{{ question.b.name }}</span>
                    <span class="detail">{{ question.b.detail }}</span>
                    <span class="value">{{ result ? result.b.display : '?' }}</span>
                    <span class="stat">{{ question.stat.label }}</span>
                </div>
            </div>

            <div v-if="status === 'guessing' || status === 'checking'" class="guesses">
                <button :disabled="status === 'checking'" @click="guess('more')">More</button>
                <button class="button-alternate" :disabled="status === 'checking'" @click="guess('less')">Less</button>
            </div>

            <div v-else-if="status === 'revealed'" class="guesses">
                <button @click="next">Next</button>
            </div>

            <div v-else-if="status === 'over'" class="game-over">
                <h3>Game Over</h3>
                <p>You finished with a streak of <strong>{{ streak }}</strong>. Your best is <strong>{{ best }}</strong>.</p>
                <button @click="start">Play Again</button>
            </div>
        </template>
    </div>
</template>

<style scoped lang="scss">
    @use '../assets/base';

    .more-or-less {
        align-items: center;
        display: flex;
        flex-direction: column;
        gap: 30px;
        margin-top: 40px;
        text-align: center;

        h2 {
            font-size: 1.8rem;
        }
    }

    .streaks {
        display: flex;
        font-family: base.$inter;
        gap: 30px;
        text-transform: uppercase;

        strong {
            color: base.$ptku-blue;
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

    .prompt {
        font-size: 1.2rem;
        font-weight: 700;
        max-width: 700px;
    }

    .matchup {
        align-items: stretch;
        animation: slide-in 0.4s ease-out;
        display: flex;
        gap: 30px;
        justify-content: center;
        max-width: 800px;
        width: 100%;

        .vs {
            align-self: center;
            color: base.$ptku-pink;
            font-family: base.$inter;
            font-weight: 900;
        }

        @media screen and (max-width: 600px) {
            align-items: center;
            flex-direction: column;
            gap: 15px;
        }
    }

    .subject {
        border: 2px solid base.$ptku-blue;
        border-radius: 15px;
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 6px;
        padding: 24px 20px;
        transition: border-color 0.4s;

        .name {
            font-family: base.$inter;
            font-size: 1.4rem;
            font-weight: 900;
        }

        .detail,
        .stat {
            font-size: 0.85rem;
            opacity: 0.8;
            text-transform: uppercase;
        }

        .value {
            color: base.$ptku-blue;
            font-family: base.$inter;
            font-size: 2.2rem;
            font-weight: 900;
            margin-top: 10px;
            transition: color 0.4s;
        }

        &.correct {
            border-color: base.$correct-green;

            .value {
                color: base.$correct-green;
            }
        }

        &.incorrect {
            border-color: base.$incorrect-red;

            .value {
                color: base.$incorrect-red;
            }
        }

        @media screen and (max-width: 600px) {
            width: 100%;
        }
    }

    .guesses {
        display: flex;
        gap: 20px;

        button {
            min-width: 140px;

            &:disabled {
                cursor: wait;
                opacity: 0.6;
            }
        }
    }

    .game-over,
    .error {
        align-items: center;
        display: flex;
        flex-direction: column;
        gap: 15px;

        h3 {
            color: base.$incorrect-red;
            font-size: 1.5rem;
            text-transform: uppercase;
        }

        strong {
            color: base.$ptku-blue;
        }
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
