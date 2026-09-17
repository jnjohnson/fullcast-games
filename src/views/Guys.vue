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
    const videos = ref(null);
    const videosLoading = ref(false);

    onMounted(async () => {
        const id = parseInt(route.query.playerId, 10);
        if (!id) return;

        loading.value = true;
        const res = await fetch(`/api/guys/player?playerId=${id}`);
        if (!res.ok) {
            error.value = 'Hmm, we can\'t find this player. Check back later!';
            loading.value = false;
            return;
        }
        const data = await res.json();
        player.value = data.player;
        statsData.value = data.stats;
        loading.value = false;
        fetchVideos(data.player);
    });

    async function pickRandomPlayer() {
        loading.value = true;
        error.value = null;
        player.value = null;
        statsData.value = null;

        const res = await fetch('/api/guys/random-player');
        if (!res.ok) {
            error.value = 'We can\'t remember a single guy right now. Check back later!';
            loading.value = false;
            return;
        }
        const data = await res.json();
        player.value = data.player;
        statsData.value = data.stats;
        loading.value = false;
        fetchVideos(data.player);

        router.replace({ query: { playerId: player.value.id } });
    }

    function reset() {
        player.value = null;
        statsData.value = null;
        error.value = null;
        videos.value = null;
        router.replace({ query: {} });
    }

    async function fetchVideos(p) {
        videosLoading.value = true;
        videos.value = null;
        const params = new URLSearchParams({
            firstName: p.firstName,
            lastName:  p.lastName,
            position:  p.position?.abbreviation ?? '',
        });
        try {
            const res = await fetch(`/api/guys/videos?${params}`);
            if (res.ok) {
                const data = await res.json();
                videos.value = data.videos;
            }
        } finally {
            videosLoading.value = false;
        }
    }

    function uniqueSchools(seasons) {
        return [...new Set(seasons.map(s => s.team.school))].join(', ');
    }

    // Returns stat value or '—' if missing
    function statVal(stats, category, col) {
        return stats[category] ?? '0';
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
                    <span class="position">{{ player.position?.abbreviation || 'N/A' }}</span>
                    <span class="schools">{{ uniqueSchools(player.athleteTeams) }}</span>
                </div>
            </div>

            <div v-if="statsLoading" class="stats-loading">Loading stats...</div>

            <template v-else-if="statsData">
                <div class="stat-section">
                    <div class="stat-type"
                        v-for="(stats, key) in statsData"
                    >
                        <h3>{{ key }}</h3>
                        <table>
                            <thead>
                                <tr>
                                    <th>Year</th>
                                    <th>Team</th>
                                    <th
                                        v-for="name in stats.statNames"
                                        :key="name"
                                    >{{ name }}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for="season in stats.seasons"
                                >
                                    <td>{{ season.season }}</td>
                                    <td>{{ season.team }}</td>
                                    <td
                                        v-for="col in season.stats"
                                        :key="col"
                                    >{{ col }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
                <p v-if="Object.keys(statsData).length === 0" class="no-stats">
                    No stats found for this player.
                </p>

                <div v-if="videosLoading" class="videos-loading">Loading highlights...</div>
                <div v-else-if="videos?.length" class="video-section">
                    <h3>Highlights</h3>
                    <div class="video-cards">
                        <div
                            v-for="v in videos"
                            :key="v.videoId"
                            class="video-card"
                        >
                            <div class="video-iframe-wrapper">
                                <iframe
                                    :src="`https://www.youtube.com/embed/${v.videoId}`"
                                    :title="v.title"
                                    frameborder="0"
                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                    allowfullscreen
                                ></iframe>
                            </div>
                            <div class="video-meta">
                                <span class="video-title">{{ v.title }}</span>
                                <span class="video-channel">{{ v.channel }}</span>
                            </div>
                        </div>
                    </div>
                </div>

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
    @use '../assets/main.scss';

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
        display: flex;
        flex-flow: column nowrap;
        gap: 30px;
        max-width: 700px;
        width: 100%;

        .stat-type {
            &:nth-of-type(even) h3 {
                color: base.$ptku-pink;
            }
            h3 {
                color: base.$ptku-blue;
                font-size: 0.85rem;
                font-weight: bold;
                letter-spacing: 0.08em;
                text-transform: uppercase;
            }
            table {
                border-collapse: collapse;
                font-size: 0.9rem;
                width: 100%;

                th, td {
                    padding: 8px 12px;
                    text-align: right;

                    &:first-child, &:nth-child(2) {
                        text-align: left;
                    }
                }

                th {
                    border-bottom: 1px solid base.$ptku-pink;
                    color: base.$color-text;
                    font-size: 0.75rem;
                    font-weight: bold;
                    letter-spacing: 0.05em;
                    opacity: 0.5;
                    text-transform: uppercase;
                }
                tbody tr {
                    &:nth-of-type(even) {
                        color: base.$ptku-pink;
                        border-bottom: 1px solid base.$ptku-pink;
                    }
                    &:nth-of-type(odd) {
                        color: base.$ptku-blue;
                        border-bottom: 1px solid base.$ptku-blue;
                    }
                }
            }
        }
    }

    .no-stats {
        opacity: 0.5;
        font-size: 0.9rem;
    }

    .videos-loading {
        opacity: 0.6;
        font-size: 0.9rem;
    }

    .video-section {
        max-width: 700px;
        width: 100%;

        h3 {
            color: base.$ptku-blue;
            font-size: 0.85rem;
            font-weight: bold;
            letter-spacing: 0.08em;
            margin-bottom: 12px;
            text-transform: uppercase;
        }
    }

    .video-cards {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
    }

    .video-card {
        border: 2px solid base.$ptku-blue;
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        overflow: hidden;
    }

    .video-iframe-wrapper {
        aspect-ratio: 16 / 9;
        width: 100%;

        iframe {
            display: block;
            height: 100%;
            width: 100%;
        }
    }

    .video-meta {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 0 14px 12px;
    }

    .video-title {
        display: -webkit-box;
        font-size: 0.9rem;
        font-weight: bold;
        line-clamp: 2;
        overflow: hidden;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
    }

    .video-channel {
        color: base.$color-text;
        font-size: 0.75rem;
        opacity: 0.5;
    }
</style>
