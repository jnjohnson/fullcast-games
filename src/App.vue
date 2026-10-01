<script setup>
import { RouterView, useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
    <header>
        <RouterLink to="/"><img alt="Shutdown Fullcast moon snake logo" class="logo" src="@/assets/fullcast-logo.jpg"/></RouterLink>
        <div>
            <h1>Fullcast Games</h1>
            <p>The only website featuring bits from the internet's only college football podcast</p>
            <RouterLink v-if="route.path !== '/'" to="/" class="back-link"><span class="arrow" aria-hidden="true">←</span> All Games</RouterLink>
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
    margin-bottom: 30px;
    max-height: 100vh;
    
    p {
        font-weight: 700;
        font-family: base.$inter;
    }
    .logo {
        border-radius: 100%;
        display: block;
        width: 125px;
    }
    .back-link {
        color: base.$ptku-blue;
        display: inline-block;
        font-family: base.$inter;
        font-size: 0.8rem;
        font-weight: 600;
        letter-spacing: 1.2px;
        margin-top: 8px;
        opacity: 0.8;
        text-decoration: none;
        text-transform: uppercase;
        transition: opacity 0.2s;

        .arrow {
            display: inline-block;
            transition: transform 0.2s;
        }

        &:hover, &:focus-visible {
            opacity: 1;
            text-decoration: underline;
            text-underline-offset: 3px;

            .arrow {
                transform: translateX(-4px);
            }
        }
    }

    @media screen and (max-width: 600px) {
        flex-direction: column;
        gap: 10px;

        h1 {
            font-size: 1.3rem;
        }
        p, a {
            font-size: 0.8rem;
        }
        div {
            .back-link {
                margin-top: 15px;
            }
        }
        .logo {
            width: 80px;
        }
    }
}

main {
    min-height: calc(100vh - 303px);

    @media screen and (max-width: 600px) {
        min-height: calc(100vh - 338px);
    }
}
cite {
    display: block;
    margin-top: 60px;
    text-align: center;

    a {
        color: base.$ptku-pink;
        text-decoration: none;

        &:hover {
            color: base.$ptku-blue;
        }
    }

    @media screen and (max-width: 600px) {
        margin-top: 45px;
    }
}

</style>
