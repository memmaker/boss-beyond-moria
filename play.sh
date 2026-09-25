#!/bin/sh
# BOSS: Beyond Moria 2.4b (Free Pascal + X11). Saves (<name>.sav) in this folder;
# with several saves the game asks which to load.
cd "$(dirname "$0")"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
export BOSS_TEXT="${BOSS_TEXT:-28}" BOSS_POS="${BOSS_POS:-40,0}"
exec "./${BOSS_BIN:-boss}"
