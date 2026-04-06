<template>
    <main>
        <section>
            <h2>Transfer Wizard</h2>
            <p>Test your knowledge of the Wizard's spells and incantations.</p>
            <RouterLink to="/transfer-wizard" class="button">Transfer Wizard</RouterLink>
        </section>
        <section>
            <h2>Remember Some Guys</h2>
            <p>Sit back and be reminded of Some Guys of yore.</p>
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
        flex-direction: column;

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
