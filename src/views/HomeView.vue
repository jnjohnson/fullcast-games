<template>
    <div class="home">
        <RouterLink to="/transfer-wizard" class="button">
            <h2>Transfer Wizard</h2>
            <p>Test your knowledge of the Wizard's spells and incantations.</p>
        </RouterLink>
        <RouterLink to="/guys" class="button">
            <h2>Remember Some Guys</h2>
            <p>Sit back and be reminded of Some Guys of yore.</p>
        </RouterLink>
    </div>
</template>

<style scoped lang="scss">
    @use '../assets/base';

    .home {
        display: flex;
        flex-flow: row wrap;
        justify-content: center;
        gap: 50px;
        margin-top: 70px;

        a.button {
            align-items: center;
            display: flex;
            flex-direction: column;
            gap: 20px;
            text-align: center;
            width: calc(50% - 25px);

            &:hover {
                p {
                    color: #222222;
                    opacity: 1;
                }
            }
            h2 {
                font-size: 2.5rem;
                margin: 0;
            }

            p {
                color: base.$color-text;
                font-size: 1.1rem;
                font-weight: 700;
                margin: 0;
                opacity: 0.8;
                transition: all 0.4s;
            }
        }
    }
</style>
