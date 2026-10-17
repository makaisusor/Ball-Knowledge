# Ball Knowledge

Free-to-play MLB trivia and multiplayer web game deployed with GitHub Pages, using Supabase for authenticated account data and match APIs.

## Main files

| File | Purpose |
|---|---|
| `index.html` | Page structure, visual styling, and the existing authentication/private-room scripts. |
| `assets/js/mlb-player-data.js` | Static MLB player data. Must load before `game.js`. |
| `assets/js/game.js` | MLB daily challenge, solo/computer game logic, menus, scores, and result displays. |
| `supabase/` | SQL changes and backend definitions tracked in this repository. |

The two extracted JavaScript files use **classic scripts**, not ES modules, to preserve existing shared variables and execution order. The links in `index.html` intentionally load player data first and the game second.

### How to edit

- Gameplay or score logic: edit `assets/js/game.js`.
- MLB player catalog: edit `assets/js/mlb-player-data.js` or its future generation script.
- Page layout and remaining styles: edit `index.html`.
- Database changes: review Supabase SQL carefully and apply separately; committing SQL does not change the live database.
- When changing external JS files for a release, bump the `?v=` cache-buster in `index.html` if necessary.

## Account score sync

- Solo and versus-computer results save locally and, when the player is signed in, call Supabase `record_career_game`.
- The saved score counts the **human** player's valid answers only; computer-generated answers are excluded.
- Signed-in players can view the most recent ten stored solo/computer scores from `bk_game_results`.
- Guests only have local browser history.
- This is **not** an anti-cheat-verified scoring system and must not be used to award cash prizes.

## Pre-merge smoke tests

1. Load the homepage and verify the player data and game JavaScript return HTTP 200.
2. Play a guest solo game; confirm the guest local history experience still works.
3. Sign in, finish solo and versus-computer games, and check the sync messages.
4. Confirm the saved scores appear under **Your recent games**.
5. Sign in from another device and confirm those scores appear there.
6. Verify today's daily challenge and an online private multiplayer match still work.
7. Test the game on mobile and check the browser console for JavaScript errors.

## Future refactoring

Keep the initial extraction small to avoid breaking launch functionality. After testing, gradually separate CSS, daily challenges, profiles, matchmaking, and score services into dedicated files with automated tests. Consider a modern build tool only when it clearly improves maintainability.
