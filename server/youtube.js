const YOUTUBE_SEARCH = 'https://www.googleapis.com/youtube/v3/search';

// Searches YouTube for player highlight videos and caches results for 24h.
// Returns an array of { videoId, title, thumbnail, channel } objects.
export async function getPlayerVideos(firstName, lastName, position, env) {
    const cacheKey = `yt:${firstName}_${lastName}_${position}`;
    const cached = await env.CFBD_CACHE.get(cacheKey, { type: 'json' });
    if (cached) return cached;

    const q = encodeURIComponent(`${firstName} ${lastName} ${position} college football highlights`);
    const url = `${YOUTUBE_SEARCH}?part=snippet&type=video&maxResults=4&q=${q}&key=${env.YOUTUBE_API_KEY}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`YouTube API ${res.status}`);
    const json = await res.json();

    const videos = (json.items ?? []).map(item => ({
        videoId:   item.id.videoId,
        title:     item.snippet.title,
        thumbnail: item.snippet.thumbnails.medium.url,
        channel:   item.snippet.channelTitle,
    }));

    await env.CFBD_CACHE.put(cacheKey, JSON.stringify(videos), { expirationTtl: 86400 });
    return videos;
}
