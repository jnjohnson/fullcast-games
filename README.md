# fullcast-games

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