<script setup>
    import { ref, onMounted } from 'vue';
    import { useRoute, useRouter } from 'vue-router';

    const route = useRoute();
    const router = useRouter();

    const player = ref(null);
    const statsData = ref(null);
    const loading = ref(false);
    const statsLoading = ref(false);
    const error = ref(null);

    onMounted(async () => {
        const id = parseInt(route.query.playerId, 10);
        if (!id) return;

        loading.value = true;
        const res = await fetch(`/api/guys/player?playerId=${id}`);
        if (res.ok) {
            player.value = await res.json();
            fetchStats(id);
        }
        loading.value = false;
    });

    async function pickRandomPlayer() {
        loading.value = true;
        error.value = null;
        player.value = null;
        statsData.value = null;

        const res = await fetch('/api/guys/random-player');
        if (!res.ok) {
            error.value = 'No players in the database yet. Check back after August 1st!';
            loading.value = false;
            return;
        }
        player.value = await res.json();
        loading.value = false;

        router.replace({ query: { playerId: player.value.id } });
        fetchStats(player.value.id);
    }

    async function fetchStats(playerId) {
        statsLoading.value = true;
        const res = await fetch(`/api/guys/player-stats?playerId=${playerId}`);
        if (res.ok) {
            statsData.value = await res.json();
        }
        statsLoading.value = false;
    }

    function reset() {
        player.value = null;
        statsData.value = null;
        error.value = null;
        router.replace({ query: {} });
    }

    function uniqueSchools(seasons) {
        return [...new Set(seasons.map(s => s.team))].join(', ');
    }

    // Returns stat value or '—' if missing
    function statVal(stats, category, col) {
        return stats[category]?.[col] ?? '0';
    }
</script>

<template>
    <div class="guys">
        <RouterLink to="/" class="back-link">← Back</RouterLink>

        <div v-if="!player" class="intro">
            <p v-if="error" class="error-msg">{{ error }}</p>
            <button :class="{ loading }" :disabled="loading" @click="pickRandomPlayer">
                {{ loading ? 'Loading...' : 'Remember A Guy' }}
            </button>
        </div>

        <template v-else>
            <div class="player-card">
                <h2>{{ player.firstName }} {{ player.lastName }}</h2>
                <div class="meta">
                    <span class="position">{{ player.position }}</span>
                    <span class="schools">{{ uniqueSchools(player.seasons) }}</span>
                </div>
            </div>

            <div v-if="statsLoading" class="stats-loading">Loading stats...</div>

            <template v-else-if="statsData">
                <div
                    v-for="category in statsData.categories"
                    :key="category"
                    class="stat-section"
                >
                    <h3>{{ category }}</h3>
                    <table>
                        <thead>
                            <tr>
                                <th>Year</th>
                                <th>Team</th>
                                <th
                                    v-for="col in statsData.categoryColumns[category]"
                                    :key="col"
                                >{{ col }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="season in statsData.seasons"
                                :key="season.year + season.team"
                            >
                                <td>{{ season.year }}</td>
                                <td>{{ season.team }}</td>
                                <td
                                    v-for="col in statsData.categoryColumns[category]"
                                    :key="col"
                                >{{ statVal(season.stats, category, col) }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <p v-if="statsData.seasons.every(s => Object.keys(s.stats).length === 0)" class="no-stats">
                    No stats found for this player.
                </p>
                <div class="intro">
                    <button :class="{ loading }" :disabled="loading" @click="pickRandomPlayer">
                        {{ loading ? 'Loading...' : 'Remember Someone Else' }}
                    </button>
                </div>
            </template>
        </template>
    </div>
</template>

<style scoped lang="scss">
    @use '../assets/base';

    .guys {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 30px;
        padding-bottom: 60px;
    }

    .back-link {
        align-self: flex-start;
        color: base.$ptku-blue;
        text-decoration: underline;
        text-underline-offset: 3px;
    }

    .intro {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 20px;
        margin-top: 40px;
        text-align: center;

        h2 {
            font-size: 1.8rem;
        }

        p {
            color: base.$color-text;
            font-size: 1.1rem;
            opacity: 0.8;
        }

        button {
            cursor: pointer;
            font-size: 1.1rem;
            margin-top: 10px;
            min-width: 220px;
            padding: 14px 24px;
            position: relative;

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

            &:hover:not(:disabled) {
                color: base.$color-background;
                background-color: rgba(base.$color-background, 0);
            }

            &:disabled {
                opacity: 0.6;
                cursor: default;
            }
        }
    }

    .error-msg {
        color: base.$incorrect-red;
        opacity: 1 !important;
    }

    .player-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        border: 2px solid base.$ptku-blue;
        border-radius: 12px;
        gap: 30px;
        padding: 20px 28px;
        width: 100%;
        max-width: 700px;

        h2 {
            font-size: 1.6rem;
            font-weight: bold;
        }

        .meta {
            display: flex;
            gap: 16px;
            align-items: center;
        }

        .position {
            background: base.$ptku-blue;
            border-radius: 6px;
            color: base.$color-background;
            font-size: 0.8rem;
            font-weight: bold;
            letter-spacing: 0.05em;
            padding: 3px 10px;
            text-transform: uppercase;
        }

        .schools {
            color: base.$color-text;
            font-size: 0.9rem;
            opacity: 0.7;
        }
    }

    .pick-another {
        background: none;
        border: none;
        color: base.$ptku-blue;
        cursor: pointer;
        font-size: 0.85rem;
        opacity: 0.8;
        padding: 4px 0;
        text-decoration: underline;
        text-underline-offset: 3px;
        white-space: nowrap;

        &:hover {
            opacity: 1;
        }
    }

    .stats-loading {
        opacity: 0.6;
    }

    .stat-section {
        width: 100%;
        max-width: 700px;

        &:nth-of-type(even) h3 {
            color: base.$ptku-pink;
        }
        h3 {
            color: base.$ptku-blue;
            font-size: 0.85rem;
            font-weight: bold;
            letter-spacing: 0.08em;
            margin-bottom: 10px;
            text-transform: uppercase;
        }

        table {
            border-collapse: collapse;
            font-size: 0.9rem;
            width: 100%;

            th, td {
                border-bottom: 1px solid rgba(base.$color-text, 0.1);
                padding: 8px 12px;
                text-align: right;

                &:first-child, &:nth-child(2) {
                    text-align: left;
                }
            }

            th {
                color: base.$color-text;
                font-size: 0.75rem;
                font-weight: bold;
                letter-spacing: 0.05em;
                opacity: 0.5;
                text-transform: uppercase;
            }

            tbody tr:hover {
                background: rgba(base.$ptku-blue, 0.05);
            }
        }
    }

    .no-stats {
        opacity: 0.5;
        font-size: 0.9rem;
    }
</style>
