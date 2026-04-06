<script setup>
    import { ref } from 'vue';
    import { useRouter } from 'vue-router';

    const router = useRouter();

    function getCookie(name) {
        const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        return match ? decodeURIComponent(match[2]) : null;
    }
    function setCookie(name, value, days) {
        const expires = new Date(Date.now() + days * 864e5).toUTCString();
        document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
    }

    const difficulty = ref(getCookie('tw-difficulty'));
    const question = ref(null);
    const answers = ref([]);
    const buttonState = ref([]);
    const showNewQuestionButton = ref(false);
    const loading = ref(false);

    async function fetchQuestion(level) {
        loading.value = true;
        const response = await fetch(`/api/transfer-wizard/get-players?difficulty=${level}`);
        const res = await response.json();
        question.value = JSON.parse(res.question);
        answers.value = res.players;
        buttonState.value = answers.value.map(player => ({
            pid: player.id,
            correct: false,
            incorrect: false,
            waiting: false,
            disabled: false
        }));
        showNewQuestionButton.value = false;
        loading.value = false;
    }

    function selectDifficulty(level) {
        difficulty.value = level;
        setCookie('tw-difficulty', level, 30);
        fetchQuestion(level);
    }

    function changeDifficulty() {
        difficulty.value = null;
        question.value = null;
        showNewQuestionButton.value = false;
    }

    async function submit(pid, i) {
        buttonState.value.forEach(button => { button.disabled = true; });
        buttonState.value[i].waiting = true;
        const response = await fetch('/api/transfer-wizard/submit', {
            method: "POST",
            body: JSON.stringify({ question: question.value })
        });
        const body = await response.json();
        buttonState.value[i].waiting = false;
        if (body.pids.includes(pid)) {
            buttonState.value[i].correct = true;
        } else {
            buttonState.value.forEach(button => {
                if (body.pids.includes(button.pid)) {
                    button.correct = true;
                }
            });
            buttonState.value[i].incorrect = true;
        }
        showNewQuestionButton.value = true;
    }

    const refreshPage = () => { router.go(); }

    if (difficulty.value) {
        fetchQuestion(difficulty.value);
    }
</script>
<template>
    <div class="transfer-wizard">
        <RouterLink to="/" class="back-link">← Back</RouterLink>

        <!-- Difficulty selection screen -->
        <div v-if="!question" class="difficulty-select">
            <h2>SELECT DIFFICULTY</h2>
            <p v-if="loading" class="loading">Loading...</p>
            <div v-else class="difficulty-buttons">
                <button @click="selectDifficulty('easy')">
                    <span class="diff-label">Easy</span>
                    <span class="diff-desc">QB's currently at a P4 school</span>
                </button>
                <button @click="selectDifficulty('medium')">
                    <span class="diff-label">Medium</span>
                    <span class="diff-desc">QB/RB/WR with any P4 history</span>
                </button>
                <button @click="selectDifficulty('hard')">
                    <span class="diff-label">Hard</span>
                    <span class="diff-desc">All positions with any P4 history</span>
                </button>
                <button @click="selectDifficulty('sickos')">
                    <span class="diff-label">Sickos</span>
                    <span class="diff-desc">All positions from any D1 school</span>
                </button>
            </div>
        </div>

        <!-- Question screen -->
        <template v-else>
            <h2>THE TRANSFER WIZARD</h2>
            <p>Choose the correct player based on the trajectory they took through the transfer portal</p>
            <button class="change-difficulty" @click="changeDifficulty">Change Difficulty</button>
            <div class="question">
                <div class="destination" v-for="destination in question">
                    {{ destination }}
                </div>
            </div>
            <div class="answers">
                <button
                    v-for="(player, i) in answers"
                    :pid="player.id"
                    :class="{
                        correct: buttonState[i].correct,
                        incorrect: buttonState[i].incorrect,
                        waiting: buttonState[i].waiting,
                        disabled: buttonState[i].disabled
                    }"
                    @click="submit(player.id, i)"
                >
                    {{ player.name }}
                </button>
            </div>
            <div v-if="showNewQuestionButton" class="next-question">
                <button @click="refreshPage">New Question</button>
            </div>
        </template>
    </div>
</template>
<style scoped lang="scss">
    @use '../assets/base';

    .back-link {
        color: base.$ptku-blue;
        text-decoration: underline;
        text-underline-offset: 3px;
    }

    .difficulty-select {
        align-items: center;
        display: flex;
        flex-direction: column;
        gap: 30px;
        margin-top: 40px;

        h2 {
            font-size: 1.8rem;
        }

        .loading {
            opacity: 0.6;
        }

        .difficulty-buttons {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            max-width: 700px;
            width: 100%;

            button {
                border: none;
                cursor: pointer;
                display: flex;
                flex-direction: column;
                gap: 6px;
                line-height: 1.4;
                padding: 16px 20px;
                position: relative;

                .diff-label {
                    font-size: 1.1rem;
                    font-weight: bold;
                    text-transform: uppercase;
                }

                .diff-desc {
                    font-size: 0.8rem;
                    opacity: 0.7;
                    text-transform: none;
                }

                &::after {
                    background-image: linear-gradient(to bottom right, base.$ptku-pink 0%, base.$ptku-blue 100%);
                    background-position: center;
                    background-size: 100%;
                    border-radius: 15px;
                    content: '';
                    height: calc(100% + 6px);
                    position: absolute;
                    top: -3px;
                    left: -3px;
                    width: calc(100% + 6px);
                    z-index: -1;
                }

                &:hover {
                    color: base.$color-background;
                    background-color: rgba(base.$color-background, 0);
                }
            }

            @media screen and (max-width: 600px) {
                grid-template-columns: 1fr;
            }
        }
    }

    .change-difficulty {
        background: none;
        border: none;
        color: base.$ptku-blue;
        cursor: pointer;
        font-size: 0.85rem;
        margin-top: 8px;
        opacity: 0.8;
        padding: 4px 0;
        text-decoration: underline;
        text-underline-offset: 3px;

        &:hover {
            opacity: 1;
        }
    }

    .question {
        display: flex;
        gap: 20px;
        margin-top: 25px;

        div {
            border: 2px solid base.$ptku-blue;
            border-radius: 15px;
            color: base.$ptku-blue;
            min-width: 120px;
            padding: 12px 16px;
            position: relative;
            text-align: center;

            &::after {
                background-color: base.$ptku-blue;
                content: '';
                height: 2px;
                position: absolute;
                top: 50%;
                transform: translateY(-50%);
                right: -22px;
                width: 20px;
            }
            &:last-of-type::after {
                content: none;
            }
        }

        @media screen and (max-width: 600px) {
            flex-direction: column;

            div {
                width: 200px;
                text-align: center;

                &::after {
                    bottom: -22px;
                    height: 20px;
                    left: 50%;
                    right: auto;
                    top: auto;
                    transform: translateX(-50%);
                    width: 2px;
                }
            }
        }
    }

    .answers {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
        margin-top: 40px;
        width: 100%;

        button {
            border: none;
            cursor: pointer;
            line-height: 1.7;
            position: relative;
            text-transform: uppercase;
            width: 100%;

            &.disabled {
                pointer-events: none;
            }
            &.correct::after {
                animation: correct 0.4s linear forwards;
            }
            &.incorrect::after {
                animation: incorrect 0.4s linear forwards;
            }
            &::after {
                background-image: linear-gradient(to bottom right, base.$incorrect-red 0%, base.$incorrect-red 25%, base.$ptku-pink 33%, base.$ptku-blue 66%, base.$correct-green 75%, base.$correct-green 100%);
                background-position: center;
                background-size: 400% 400%;
                border-radius: 15px;
                content: '';
                height: calc(100% + 6px);
                position: absolute;
                top: -3px;
                left: -3px;
                width: calc(100% + 6px);
                z-index: -1;
            }
            &:hover,
            &.waiting,
            &.correct,
            &.incorrect {
                color: base.$color-background;
                background-color: rgba(base.$color-background, 0);
            }
        }

        @media screen and (max-width: 600px) {
            grid-template-columns: 1fr;
        }
    }

    .next-question {
        display: flex;
        justify-content: center;
        margin-top: 50px;

        button {
            cursor: pointer;
        }
    }

@keyframes correct {
    to {
        background-position: 100% 100%;
    }
}
@keyframes incorrect {
    to {
        background-position: 0% 0%;
    }
}
</style>
