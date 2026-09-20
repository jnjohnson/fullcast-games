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

### Compile and Minify for Production

```sh
npm run build
```

## Notes / Things Learned
### Cloudflare
- Workers
- Workers KV
### GraphQL
### Claude (Sonnet 4.6)
- If you have a bad idea and prompt Claude, Claude will do what you ask. For example prompting Claude to create a hash function to generate keys for a KV namespace. [Claude created a hash function that used SHA-256 to generate the key.](https://github.com/jnjohnson/fullcast-games/commit/ba079d274757b74c0093ebb5621a9debe6a4faf0) If you ask Claude later if that's overkill, it'll tell you that yes, it is.
- On the other hand Claude is super helpful for researching the right way to do something, especially if you don't know how to precisely describe the problem. For example I asked Claude to explain how to use Cloudflare Cache to store objects. Claude recommended that I use Cloudflare Workers KV instead, which was the service I actually needed.
- Claude was able to debug an issue where I had set up the data structure in getPlayerStats incorrectly. It diagnosed that seasonObj.stats is initialized as [] instead of {}, which made it invisible to the Vue front end. It also fixed a few front end bugs on Guys.vue at the same time.
- Maybe it's an issue of how I'm prompting Claude, but the [initial attempt at a filter UI for the Remember Some Guys page](https://github.com/jnjohnson/fullcast-games/commit/5e87ab8ad4e56f1ec8a33e7ef989edc0b322454c) was pretty thin. Could be that I need to be more descriptive in my prompting.