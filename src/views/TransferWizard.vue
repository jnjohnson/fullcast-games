<script setup>
    import { ref } from 'vue';

    let buttonState = ref(new Array(4));
    let response = await fetch('/api/transfer-wizard/get-players');
    let res = await response.json();
    
    const question = JSON.parse(res.question);
    const answers = res.players;
    
    for (let i=0; i<buttonState.value.length; i++) {
        buttonState.value[i] = {
            pid: answers[i].id,
            correct: false,
            incorrect: false,
            waiting: false,
            disabled: false
        }
    }

    async function submit(pid, i) {
        buttonState.value.forEach((button) => {
            button.disabled = true;
        });
        buttonState.value[i].waiting = true;
        let response = await fetch('/api/transfer-wizard/submit', {
            method: "POST",
            body: JSON.stringify({
                question: question
            })
        });
        let res = await response;
        const body = await res.json();
        buttonState.value[i].waiting = false;
        if (pid == body.correctPid) {
            buttonState.value[i].correct = true;
        } else {
            buttonState.value.forEach(button => {
                if (button.pid == body.correctPid) {
                    button.correct = true;
                }
            });
            buttonState.value[i].incorrect = true;
        }
    }
</script>
<template>
    <div class="transfer-wizard">
        <RouterLink to="/">Back</RouterLink>
        <h2>THE TRANSFER WIZARD</h2>
        <p>Choose the correct player based on the trajectory they took through the transfer portal</p>
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
                {{  player.name }}
            </button>
        </div>
    </div>
</template>
<style scoped>
    .question {
        display: flex;
    }
    .answers {
        align-items: center;
        display: flex;
        flex-direction: column;
        gap: 20px;
        margin-top: 40px;
    }
    .answers button {
        border: none;
        cursor: pointer;
        line-height: 1.7;
        position: relative;
        text-transform: uppercase;
        width: 300px;
    }
    .answers button.disabled {
        pointer-events: none;
    }
    .answers button.correct::after {
        animation: correct 0.4s linear forwards;
    }
    .answers button.incorrect::after {
        animation: incorrect 0.4s linear forwards;
    }
    .answers button::after {
        background-image: linear-gradient(to bottom right, var(--incorrect-red) 0%, var(--incorrect-red) 25%, var(--ptku-pink) 33%, var(--ptku-blue) 66%, var(--correct-green) 75%, var(--correct-green) 100%);
        background-position: center;
        background-size: 400% 400%;
        border-radius: 15px;
        content: '';
        height: calc(100% + 4px);
        position: absolute;
        top: -2px;
        left: -2px;
        width: calc(100% + 4px);
        z-index: -1;
    }
    .answers button:hover,
    .answers button.waiting,
    .answers button.correct,
    .answers button.incorrect {
        color: var(--color-background);
        background-color: rgba(var(--color-background), 0);
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