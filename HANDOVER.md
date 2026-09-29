# BOSS: Beyond Moria 2.4b — port notes (RVIP)

- Upstream: https://github.com/dungeons-of-moria/boss-beyond-moria (Free Pascal
  port of the 1991 VMS Pascal game). `git diff` shows the port.
- Web: https://ruzzoli.de/roguelikes/boss/ — `sh web/build.sh` (FPC trunk
  wasm32-wasip1 cross compiler in ~/Games/fpc-wasm + wasm-opt --asyncify),
  `web/deploy.sh`. Headless check: `node web/test.mjs " "` prints the screen
  after the given keys. Autosave every 2 s to IndexedDB (be_want_save);
  ^Z saves and ends, death/quit deletes the save.
- Native (X11, for testing): `make` (needs `brew install fpc`, XQuartz),
  `./play.sh`. `make test` = wizard mode from the start (`boss-test`),
  `make check` = range/overflow/heap checks (`boss-check`; run under lldb with
  `b fpc_rangeerror`). Delete both binaries after.
- Port: `port/bcrt.pas` replaces FPC's `crt` (gotoxy/write/readkey into an
  80x25 buffer with panes: 1 map, 2 character column, 3 status line, 4 message
  line), drawn by `port/be_x11.c` natively and `web/boss.js` on the web. Text only.
- RVIP features in `inc/rl.inc`: explore `g`, `<`/`>` walk, Enter menu,
  inventory `i`/`e` with cursor + item menus. Hooks: `rl_command` at the
  command prompt (main.inc), key queue + message counter (io.inc),
  `rl_new_level` (generate.inc), `get_item` cursor (display.inc), help.inc.
- Prompt line: pane 4 goes to `RvipWM.prompt`; `crt_at_cmd` (set around
  `inkey(command)` in `rl_command`) tells the page whether the game waits for
  a command, so a question stays up until answered.
- Floor lit by your own light is remembered (`fm`), also across save/load.
- ^M (= Enter) was "repeat message": now ^P. The DEBUG wizard toggle on ^P is
  gone (use `make test`).
- Fixed upstream bugs: `integer` is 16-bit in FPC — Doom Shrooms cost 57000
  wrapped (dat/invent.dat → 32000); `clear()` wrote `used_line[24..25]`; win
  screen printed crown lines 0..19 of a 1..15 array.

## Open
- Presentation rule 6: the character column and status line (panes 2, 3) are
  still drawn on canvases in `web/boss.js`; they should be HTML text.
- Sound: Stage 6 web search for upstream audio not done/noted yet.
