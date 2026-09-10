import { cfbdGql } from './cfbd.js';
import { kvGet, kvPut } from './kv.js';
const p4_schools = ["Alabama","Arizona","Arizona State","Arkansas","Auburn","Baylor","Boston College","BYU","California","Cincinnati","Clemson","Colorado","Duke","Florida","Florida State","Georgia","Georgia Tech","Houston","Illinois","Indiana","Iowa","Iowa State","Kansas","Kansas State","Kentucky","Louisville","LSU","Maryland","Miami","Michigan","Michigan State","Minnesota","Mississippi State","Missouri","NC State","Nebraska","North Carolina","Northwestern","Ohio State","Oklahoma","Oklahoma State","Ole Miss","Oregon","Penn State","Pittsburgh","Purdue","Rutgers","SMU","South Carolina","Stanford","Syracuse","TCU","Tennessee","Texas","Texas A&M","Texas Tech","UCF","UCLA","USC","Utah","Vanderbilt","Virginia","Virginia Tech","Wake Forest","Washington","West Virginia","Wisconsin"];
const p4_conferences = ["ACC", "Big Ten", "Big 12", "SEC"];

// Returns an array of size [size] of elements from the input array
function getRandIndicies(arr, size) {
    var randArr = [];
    if (arr.length <= size) {
        return arr;
    }
    while (randArr.length < size) {
        let randIdx = Math.floor(Math.random() * arr.length);
        if (randArr.length != 0 && randArr.find((school) => school == arr[randIdx])) {
            continue;
        } else {
            randArr.push(arr[randIdx]);
        }
    }

    return randArr;
}

// Fetches transfer records from CFBD GraphQL, filtered by difficulty.
// Returns 4 randomly selected transfer records
async function fetchRandomTransfers(difficulty, env) {
    var randSchools = getRandIndicies(p4_schools, 10);

    // Creates the 'where' object for the transfer query based on difficulty.
    // - 'easy': QB transferring to a P4 school
    // - 'medium': QB/RB/WR transferring to a P4 school
    // - 'hard': QB/RB/WR with any P4 history
    // - 'sickos': no position or school filter
    var where = {};

    if (difficulty === 'easy') {
        where = {season: {_eq: 2026}, position: { position: { _eq: 'QB' } }, toTeam: { school: { _in: randSchools } } };
    }
    if (difficulty === 'medium') {
        where = {season: {_eq: 2026}, position: { position: { _in: ['QB', 'RB', 'WR'] } }, toTeam: { school: { _in: randSchools } } };
    }
    if (difficulty === 'hard') {
        where = {position: { position: { _in: ['QB', 'RB', 'WR'] } }, toTeam: { school: { _in: randSchools } } };
    }
    const data = await cfbdGql(`
        query($where: TransferBoolExp!) {
            transfer(where: $where, limit: 50) {
                firstName
                lastName
                position { position }
                fromTeam { school }
                toTeam { school }
            }
        }
    `, { where: where }, env);
    return getRandIndicies(data.transfer, 4); // get 4 players from the list of transfers returned by CFBD
}

// Pure transform: raw GraphQL transfer rows → question chain array.
// Handles 5 edge cases:
//   1. fromTeam == toTeam on a non-sole row → duplicate destination skipped
//   2. fromTeam == toTeam on the only row → returns length-1 array (unplayable, caller skips)
//   3. toTeam is null, other rows exist → null row skipped, chain continues
//   4. toTeam is null on the only row → returns length-1 array (unplayable, caller skips)
//   5. fromTeam[N] ≠ toTeam[N-1] (gap) → fromTeam[N] inserted as an intermediate stop
export function buildTransferChain(rows) {
    const stops = [];
    let lastSchool = null;
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const fromSchool = row.fromTeam?.school;
        const toSchool   = row.toTeam?.school || null;
        
        if (i === 0) {
            if (!fromSchool) return [];
            stops.push({ team: fromSchool });
            lastSchool = fromSchool;
        } else if (fromSchool && fromSchool !== lastSchool) {
            stops.push({ season: 'N/A', team: fromSchool });
        }

        if (toSchool && toSchool !== lastSchool) {
            stops.push({ season: row.season, team: toSchool });
        } else if (!toSchool) {
            stops.push({ season: row.season, team: 'N/A' });
        }
        lastSchool = toSchool;
    }
    return stops;
}

// Fetches all transfer records for a single player from the CFBD GraphQL API,
// filtered by first name, last name, and position. Returns the question chain array.
async function GetTransferRecord(firstName, lastName, position, env) {
    const data = await cfbdGql(`
        query($firstName: String!, $lastName: String!, $position: String!) {
            transfer(where: {
                firstName: { _eq: $firstName }
                lastName: { _eq: $lastName }
                position: { position: { _eq: $position } }
            }
            orderBy: {season: ASC}) {
                season
                fromTeam { school }
                toTeam { school }
            }
        }
    `, { firstName, lastName, position }, env);
    return buildTransferChain(data.transfer);
}

// Computes a SHA-256 hex digest of a value's JSON representation. Used as a stable cache key.
// TODO: SHA-256 seems like overkill and may be slowing the game down. See if there's a simper option
async function hashValue(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Selects 4 random unique players from the CFBD transfer portal, filtered by difficulty. Tries each
// candidate (in random order) until one yields a valid transfer chain (≥ 2 stops). Returns 404 if all
// candidates have degenerate chains (e.g. only one school, null destination).
// Response: { question: [{team}|{season,team}], players: [{name, id}] }
async function getPlayers(env, difficulty) {
    let question = null;
    let questionPlayer = null;
    let transfers = null;
    while (!question) {
        transfers = await fetchRandomTransfers(difficulty, env);

        if (transfers.length === 0) {
            return new Response(JSON.stringify({ error: 'No players found' }), { status: 404 });
        }

        const startIdx = Math.floor(Math.random() * transfers.length);

        for (let i = 0; i < transfers.length; i++) {
            const candidate = transfers[(startIdx + i) % transfers.length];
            const chain = await GetTransferRecord(candidate.firstName, candidate.lastName, candidate.position.position, env);
            
            if (chain.length > 2 || (chain.length == 2 && chain[1].school != 'N/A')) {
                question = chain;
                questionPlayer = candidate;
                break;
            }
        }
    }

    const cacheKey = await hashValue(question);
    await kvPut(cacheKey, questionPlayer, env);

    return Response.json({
        question,
        players: transfers.map(p => ({
            name: `${p.firstName} ${p.lastName}`,
            id: `${p.firstName}_${p.lastName}_${p.position.position}`,
        })),
    });
}

// Validates a player's answer for the transfer wizard game. Reads `question` from the POST body,
// looks up the transfer record `getPlayers` cached under the hash of that same question, and returns
// a JSON response with `pids` (array of "FirstName_LastName_Position" strings) for the correct player(s).
async function checkAnswer(req, env) {
    const body = await req.json();
    const cacheKey = await hashValue(body.question);
    const cached = await kvGet(cacheKey, env);

    if (!cached) {
        return new Response(JSON.stringify({ error: 'Question not found' }), { status: 404 });
    }

    const pid = [`${cached.firstName}_${cached.lastName}_${cached.position.position}`];
    return Response.json({ pid });
}

export { getPlayers, checkAnswer, hashValue, buildTransferChain };