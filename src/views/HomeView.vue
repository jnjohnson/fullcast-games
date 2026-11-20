<template>
    <div class="home">
        <RouterLink to="/transfer-wizard" class="button">
            <h2>Transfer Wizard</h2>
            <p>Test your knowledge of the Wizard's spells and incantations</p>
        </RouterLink>
        <RouterLink to="/more-or-less" class="button">
            <h2>More or Less</h2>
            <p>Determine who had more and who had less</p>
        </RouterLink>
        <RouterLink to="/the-ladder" class="button">
            <h2>The Ladder</h2>
            <p>Climb the chain of who beat who</p>
        </RouterLink>
        <RouterLink to="/guys" class="button">
            <h2>Remember Some Guys</h2>
            <p>Sit back and be reminded of Some Guys of yore</p>
        </RouterLink>
    </div>
</template>

<style scoped lang="scss">
    @use '../assets/base';

    .home {
        display: flex;
        flex-flow: row wrap;
        gap: 50px;
        margin-top: 70px;
        justify-content: center;

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
        @media screen and (max-width: 1200px) {
            gap: 30px;

            a.button {
                gap: 15px;
                width: calc(50% - 15px);

                h2 {
                    font-size: 1.8rem;
                }
                p {
                    font-size: 0.8rem;
                }
            }
        }

        @media screen and (max-width: 930px) {
            gap: 20px;

            a.button {
                gap: 10px;
                width: calc(50% - 10px);

                h2 {
                    font-size: 1.4rem;
                }
            }
        }

        @media screen and (max-width: 800px) {
            align-items: center;
            flex-flow: column nowrap;
            margin-top: 40px;

            a.button {
                max-width: 500px;
                width: 100%;
            }
        }
    }

</style>
