<script setup>
    import { ref, onMounted } from 'vue';
    import { useRoute, useRouter } from 'vue-router';

    const POSITIONS   = ['QB','RB','FB','WR','TE','OT','OG','C','DE','DT','LB','CB','S','K','P','LS'];
    const CONFERENCES = ['ACC','Big 12','Big Ten','C-USA','Ind','MAC','MWC','SEC','Sun Belt'];
    const YEARS       = Array.from({ length: 24 }, (_, i) => 2026 - i);
    const SCHOOLS = [
        'Air Force','Akron','Alabama','Appalachian State','Arizona','Arizona State',
        'Arkansas','Arkansas State','Army','Auburn','Ball State','Baylor','Boise State',
        'Boston College','Bowling Green','Buffalo','BYU','California','Central Michigan',
        'Charlotte','Cincinnati','Clemson','Coastal Carolina','Colorado','Colorado State',
        'Connecticut','Duke','East Carolina','Eastern Michigan','Florida','Florida Atlantic',
        'Florida International','Florida State','Fresno State','Georgia','Georgia Southern',
        'Georgia State','Georgia Tech','Hawaii','Houston','Illinois','Indiana',
        'Iowa','Iowa State','Jacksonville State','James Madison','Kansas','Kansas State',
        'Kent State','Kentucky','Liberty','Louisiana','Louisiana Monroe','Louisiana Tech',
        'Louisville','LSU','Marshall','Maryland','Massachusetts','Memphis','Miami',
        'Miami (OH)','Michigan','Michigan State','Middle Tennessee','Minnesota','Mississippi State',
        'Missouri','Navy','NC State','Nebraska','Nevada','New Mexico','New Mexico State',
        'North Carolina','North Texas','Northern Illinois','Northwestern','Notre Dame',
        'Ohio','Ohio State','Oklahoma','Oklahoma State','Old Dominion','Ole Miss',
        'Oregon','Oregon State','Penn State','Pittsburgh','Purdue','Rice','Rutgers',
        'Sam Houston','San Diego State','San Jose State','SMU','South Alabama',
        'South Carolina','South Florida','Southern Miss','Stanford','Syracuse',
        'TCU','Temple','Tennessee','Texas','Texas A&M','Texas State','Texas Tech',
        'Toledo','Troy','Tulane','Tulsa','UAB','UCF','UCLA','UNLV','USC','Utah',
        'Utah State','UTEP','UTSA','Vanderbilt','Virginia','Virginia Tech','Wake Forest',
        'Washington','Washington State','Western Kentucky','Western Michigan','Wisconsin','Wyoming',
    ];

    const FILTER_DEFS = [
        { key: 'position',   label: 'Position',   options: POSITIONS   },
        { key: 'school',     label: 'School',     options: SCHOOLS     },
        { key: 'conference', label: 'Conference', options: CONFERENCES  },
        { key: 'year',       label: 'Year',       options: YEARS,       isYear: true },
    ];

    const route = useRoute();
    const router = useRouter();

    const player = ref(null);
    const statsData = ref(null);
    const loading = ref(false);
    const statsLoading = ref(false);
    const error = ref(null);
    const videos = ref(null);
    const videosLoading = ref(false);
    const isFilterOpen = ref({position: false, school: false, conference: false, year: false});
    const filters = ref({ position: [], school: [], conference: [], year: [] });

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

        const params = new URLSearchParams();
        for (const [key, arr] of Object.entries(filters.value)) {
            for (const val of arr) params.append(key, val);
        }
        const res = await fetch(`/api/guys/random-player?${params}`);
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
        filters.value = { position: [], school: [], conference: [], year: [] };
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

    function formatYearChips(years) {
        if (!years.length) return [];
        const sorted = [...years].sort((a, b) => a - b);
        const ranges = [];
        let start = sorted[0], end = sorted[0];
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i] === end + 1) {
                end = sorted[i];
            } else {
                ranges.push(start === end ? `${start}` : `${start} - ${end}`);
                start = end = sorted[i];
            }
        }
        ranges.push(start === end ? `${start}` : `${start} - ${end}`);
        return ranges;
    }

    function toggleFilter(filter) {
        for (const [key, arr] of Object.entries(isFilterOpen.value)) {
            if (key === filter) {
                isFilterOpen.value[filter] = !isFilterOpen.value[filter];
            } else {
                isFilterOpen.value[key] = false;
            }
        }
    }

    function removeFilter(key, value) {
        filters.value[key] = filters.value[key].filter(v => v !== value);
    }

    function removeYearRange(rangeLabel) {
        const [from, to] = rangeLabel.includes(' - ')
            ? rangeLabel.split(' - ').map(Number)
            : [Number(rangeLabel), Number(rangeLabel)];
        filters.value.year = filters.value.year.filter(y => y < from || y > to);
    }
</script>

<template>
    <div class="guys">
        <RouterLink to="/" class="back-link">← Back</RouterLink>

        <div v-if="!player" class="intro">
            <div class="filters">
                <div v-for="f in FILTER_DEFS" :key="f.key" class="filter-group">
                    <div class="chips">
                        <template v-if="f.isYear">
                            <span
                                v-for="range in formatYearChips(filters.year)"
                                :key="range"
                                class="chip"
                                @click="removeYearRange(range)"
                            >{{ range }} ×</span>
                        </template>
                        <template v-else>
                            <span
                                v-for="val in filters[f.key]"
                                :key="val"
                                class="chip"
                                @click="removeFilter(f.key, val)"
                            >{{ val }} ×</span>
                        </template>
                    </div>
                    <label>{{ f.label }}</label>
                    <div class="filter-list" :class="{ open: isFilterOpen[f.key] }">
                        <label class="checkbox-item filter-name" @click="toggleFilter(f.key)">
                            {{ f.label }}
                            <i class="fa fa-chevron-down" aria-hidden="true"></i>
                        </label>
                        <div class="filter-items">
                            <label v-for="opt in f.options" :key="opt" class="checkbox-item">
                                <input type="checkbox" :value="opt" v-model="filters[f.key]" />
                                {{ opt }}
                            </label>
                        </div>
                    </div>
                </div>
            </div>
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
        text-align: center;
        width: 100%;

        h2 {
            font-size: 1.8rem;
        }

        p {
            color: base.$color-text;
            font-size: 1.1rem;
            opacity: 0.8;
        }
    }

    .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        justify-content: center;
        width: 100%;
    }

    .filter-group {
        flex: 1;
        min-width: 120px;
        padding-bottom: 48px;
        position: relative;

        > label {
            color: base.$color-text;
            font-size: 0.7rem;
            font-weight: bold;
            letter-spacing: 0.08em;
            opacity: 0.6;
            text-transform: uppercase;
        }

    }

    .filter-list {
        background: base.$color-background;
        border: 1px solid base.$ptku-blue;
        border-radius: 6px;
        position: absolute;
        top: calc(100% - 40px);
        width: 100%;

        &:focus-within {
            border-color: base.$ptku-pink;
        }
        &.open {
            .filter-items {
                height: 240px;
            }
            .checkbox-item.filter-name {
                i {
                    transform: rotate(180deg);
                }
            }
        }

        .filter-items {
            height: 0px;
            overflow-y: scroll;
            transition: height 0.3s;
        }
    }

    .checkbox-item {
        align-items: center;
        cursor: pointer;
        display: flex;
        font-size: 0.85rem;
        gap: 8px;
        padding: 4px 10px;

        &:hover {
            background: rgba(base.$ptku-blue, 0.1);
        }

        input[type="checkbox"] {
            accent-color: base.$ptku-blue;
            cursor: pointer;
            flex-shrink: 0;
        }

        &.filter-name {
            padding: 9px 10px;
            position: relative;

            i {
                right: 10px;
                position: absolute;
                top: 12px;
                transition: transform 0.3s;
            }
        }
    }

    .chips {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: 4px;
        min-height: 60px;
        margin-bottom: 10px;
    }

    .chip {
        background: base.$ptku-blue;
        border-radius: 4px;
        color: base.$color-background;
        cursor: pointer;
        font-size: 0.75rem;
        font-weight: bold;
        padding: 2px 7px;

        &:hover {
            background: base.$ptku-pink;
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
        .video-cards {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            
            .video-card {
                border: 2px solid base.$ptku-blue;
                border-radius: 8px;
                display: flex;
                flex-direction: column;
                gap: 10px;
                overflow: hidden;
            }
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
    }

</style>