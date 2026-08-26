# Fullcast Games
A collection of games based on segments from the Shutdown Fullcast podcast

## Games
### Transfer Wizard
Test your knowledge of the Wizard's spells and incantations!

Choose the correct player based on the trajectory they took through the transfer portal

### Remember Some Guys - WIP
Sit back and be reminded of Some Guys of yore!

A work in progress. Selects a random player and compiles his stats and highlights

### More or Less - Coming Soon
Compare players, coaches, or teams and guess whether one has More or Less wins, losses, yards, etc than the other.

### Hell Ladder - Coming Soon
Answer a question about a player, coach or team. Get it correct and you keep playing. How far can you climb?

## Project Setup

```sh
npm install
```

### Compile and Hot-Reload for Development

```sh
npm run dev
```

### Querying the DB
```sh
npx wrangler d1 execute [db_name] --command [command]
```

For querying the local instance of your DB, add the --local flag

### Testing Cron Jobs
```sh
npx wrangler dev --test-scheduled
```

Then in a new shell:
```sh
curl "http://localhost:8787/__scheduled"
```

### Compile and Minify for Production

```sh
npm run build
```

### BUGGED INPUTS
Q:
{
    "question":"[\"New Mexico\",\"UTSA\"]",
    "players":[
        {
            "name":"Brendan Sorsby",
            "id":4961
        },
        {
            "name":"John Blunt Jr.",
            "id":2554
        },
        {
            "name":"CJ Smith",
            "id":5079
        },
        {
            "name":"CJ James",
            "id":5838
        }
    ]
}
A: "correctPid":5651