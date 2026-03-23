<template>
    <main>
        <section>
            <h2>Fullcast Games</h2>
            <p>Test your knowledge of the Transfer Wizard's spells and incantations.</p>
            <RouterLink to="/transfer-wizard" class="button">Transfer Wizard</RouterLink>
            <RouterLink to="/guys" class="button">Remember Some Guys</RouterLink>
        </section>
    </main>
</template>

<style scoped lang="scss">
    @use '../assets/base';

    main {
        align-items: center;
        display: flex;
        justify-content: center;
        min-height: calc(100vh - 230px);

        section {
            align-items: center;
            display: flex;
            flex-direction: column;
            gap: 20px;
            text-align: center;

            h2 {
                font-size: 2.5rem;
                margin: 0;
            }

            p {
                color: base.$color-text;
                font-size: 1.1rem;
                margin: 0;
                opacity: 0.8;
            }

            a {
                font-size: 1.2rem;
                margin-top: 10px;
                min-width: 220px;
            }
        }
    }
</style>
