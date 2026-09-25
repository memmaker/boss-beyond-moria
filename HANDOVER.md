# BOSS: Beyond Moria 2.4b — port notes (RVIP, 2026-09-25)

- Upstream: https://github.com/dungeons-of-moria/boss-beyond-moria (Free Pascal
  port of the 1991 VMS Pascal game). `git diff` shows the port.
- Build: `make` (needs `brew install fpc`, XQuartz). `make test` = wizard mode
  from the start (`boss-test`), `make check` = range/overflow/heap checks
  (`boss-check`; run under lldb with `b fpc_rangeerror`). Delete both after.
- Run: `./play.sh` or `~/Desktop/Games/Roguelikes/BOSS.app`. Saves:
  `<name>.sav` in this folder (the game lists them at start).
- Port: `port/bcrt.pas` replaces FPC's `crt` (gotoxy/write/readkey into an
  80x25 buffer), drawn by `port/be_x11.c` (copied from Omega). Text only.
- RVIP features in `inc/rl.inc`: explore `g`, `<`/`>` walk, Enter menu,
  inventory `i`/`e` with cursor + item menus. Hooks: `rl_command` at the
  command prompt (main.inc), key queue + message counter (io.inc),
  `rl_new_level` (generate.inc), `get_item` cursor (display.inc), help.inc.
- Floor lit by your own light is now remembered (`fm`), so the map and the
  explorer keep it, also across save/load.
- ^M (= Enter) was "repeat message": now ^P. The DEBUG wizard toggle on ^P is
  gone (use `make test`).
- Fixed: `integer` is 16-bit in FPC — Doom Shrooms cost 57000 wrapped
  (dat/invent.dat → 32000); `clear()` wrote `used_line[24..25]`; win screen
  printed crown lines 0..19 of a 1..15 array.
- Web: https://ruzzoli.de/roguelikes/boss/ — `sh web/build.sh` (FPC trunk
  wasm32-wasip1 cross compiler in ~/Games/fpc-wasm + wasm-opt --asyncify),
  `web/deploy.sh`. Headless check: `node web/test.mjs " "` prints the screen
  after the given keys. Autosave every 2 s to IndexedDB (be_want_save);
  ^Z saves and ends, death/quit deletes the save.
- Not done: tiles (user chose text), sound (6b).
