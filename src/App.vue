<script setup>
import { RouterView } from 'vue-router'
</script>

<template>
    <header>
        <RouterLink to="/"><img alt="Shutdown Fullcast moon snake logo" class="logo" src="@/assets/fullcast-logo.jpg" width="125" height="125" /></RouterLink>
        <div>
            <h1>jigsaw-puppet.horse</h1>
            <p>The only collection of games based on bits<br/>from the internet's only college football podcast.</p>
        </div>
    </header>
    <Suspense>
        <RouterView />
        <template #fallback>
            Loading...
        </template>
    </Suspense>
</template>

<style scoped>
header {
    align-items: center;
    display: flex;
    gap: 40px;
    line-height: 1.5;
    max-height: 100vh;
}

.logo {
    border-radius: 100%;
    display: block;
    margin: 1rem auto;
}

</style>
