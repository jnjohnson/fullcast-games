<script setup>
    let response = await fetch('/api/transfer-wizard/get-players');
    let res = await response.json();
    
    const question = JSON.parse(res.question);
    const answers = res.players;
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
            <button v-for="player in answers" :pid="player.id">{{  player.name }}</button>
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
    .answers button::after {
        background-image: linear-gradient(to bottom right, var(--ptku-pink), var(--ptku-blue));
        border-radius: 15px;
        content: '';
        height: calc(100% + 4px);
        position: absolute;
        top: -2px;
        left: -2px;
        width: calc(100% + 4px);
        z-index: -1;
    }
    .answers button:hover {
        background-color: rgba(var(--color-background), 0);
    }
</style>