<script setup>
import { RouterView } from 'vue-router'
</script>

<template>
    <header>
        <RouterLink to="/"><img alt="Shutdown Fullcast moon snake logo" class="logo" src="@/assets/fullcast-logo.jpg" width="125" height="125" /></RouterLink>
        <div>
            <h1>Fullcast Games</h1>
            <p>The only games based on bits from the internet's only college football podcast.</p>
        </div>
    </header>
    <main>
        <Suspense>
            <RouterView />
            <template #fallback>
                Loading...
            </template>
        </Suspense>
    </main>
    <cite>All data provided by <a target="_blank" href="https://collegefootballdata.com/">collegefootballdata.com</a></cite>
</template>

<style scoped lang="scss">
    @use './assets/base';
header {
    align-items: center;
    display: flex;
    gap: 40px;
    line-height: 1.5;
    max-height: 100vh;
    
    .logo {
        border-radius: 100%;
        display: block;
        margin: 1rem auto;
    }
}

main {
    min-height: calc(100vh - 245px);
}
cite {
    display: block;
    text-align: center;

    a {
        color: base.$ptku-pink;
    }
}

</style>
