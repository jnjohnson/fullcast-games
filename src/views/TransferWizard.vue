<script setup>
    import { ref } from 'vue';
    import { useRouter } from 'vue-router';

    const router = useRouter();
    let buttonState = ref(new Array(4));
    let showNewQuestionButton = false;
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
        showNewQuestionButton = true;
    }

    const refreshPage = () => {
        router.go();
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
        <div v-if="showNewQuestionButton" class="next-question">
            <button @click="refreshPage">New Question</button>
        </div>
    </div>
</template>
<style scoped lang="scss">
    @use '../assets/base';

    .question {
        display: flex;
        gap: 20px;
        margin-top: 25px;
        
        div {
            border: 2px solid base.$ptku-blue;
            border-radius: 15px;
            color: base.$ptku-blue;
            padding: 10px;
            position: relative;

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
    }
    .answers {
        align-items: center;
        display: flex;
        flex-flow: row wrap;
        gap: 20px;
        margin-top: 40px;
        max-width: 700px;
        width: 100%;
        
        button {
            border: none;
            cursor: pointer;
            line-height: 1.7;
            position: relative;
            text-transform: uppercase;
            width: 300px;
            
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
                height: calc(100% + 4px);
                position: absolute;
                top: -2px;
                left: -2px;
                width: calc(100% + 4px);
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
    }
    .next-question {
        margin-top: 50px;
        
        button {
            cursor: pointer;
        }
    }

@media screen and (max-width: 600px) {
    .question {
        display: flex;
        flex-direction: column;
        gap: 20px;
        margin-top: 25px;
        
        div {
            width: 200px;
            text-align: center;

            &::after {
                background-color: base.$ptku-blue;
                bottom: -22px;
                content: '';
                height: 20px;
                left: 50%;
                top: auto;
                transform: translateX(-50%);
                width: 2px;
            }
        }
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