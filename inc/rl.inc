{ RVIP additions: auto-explore (g), walk to stairs (< >), command menu
  (Enter), inventory with a cursor and item menus (i, e).
  Everything that acts on the game queues the keys a player would type
  (rl_q, read by inkey), so every command keeps its own prompts and checks. }

const
  rl_explore_key = 'g';

var
  rl_mode    : integer = 0;     { 0 off, 1 explore, 2 walk to <, 3 walk to > }
  rl_stood   : array [1..max_height, 1..max_width] of boolean;
  rl_door    : array [1..max_height, 1..max_width] of boolean;  { tried to open }
  rl_last_msgs, rl_ly, rl_lx : longint;
  rl_near0   : integer;         { monsters in view when the walk started }
  rl_moved   : boolean;         { last step was a move: it must change our spot }
  rl_reopen  : char = #0;       { 'i' / 'e': inventory list to reopen }
  rl_q_owned : boolean = false; { the queue belongs to the last command }

procedure rl_new_level;
begin
fillchar(rl_stood, sizeof(rl_stood), 0);
fillchar(rl_door, sizeof(rl_door), 0);
rl_mode := 0
end;

function rl_monsters_near : integer;
var i, r, n : integer;
begin
n := 0;
if dun_level = 0 then r := 5 else r := 40;  { townspeople are always about }
i := muptr;
while i > 0 do
  with m_list[i] do
    begin
    if ml and (cdis <= r) then inc(n);
    i := nptr
    end;
rl_monsters_near := n
end;

function rl_monster_near : boolean;
begin
rl_monster_near := rl_monsters_near > 0
end;

{ ---------- Popup boxes (sized to their content) ---------- }

procedure rl_put(s : string; row, col : integer; hl : boolean);
begin
if hl then text_attr := $10000;
gotoxy(col, row);
write(s);
text_attr := 0
end;

procedure rl_hl_row(row : integer; on : boolean);
var x : integer;
begin
if (row < 1) or (row > 24) then exit;
for x := 1 to 80 do
  if on then scr[row, x] := scr[row, x] or $10000
  else scr[row, x] := scr[row, x] and not $10000
end;

{ Draws lines[top..] in a box; returns the chosen index, 0 = cancelled.
  sel/keys: keys[i] <> #0 picks entry i directly; lines with keys[i] = #1
  are headers and can't be selected. }
function rl_choose(title : string; var lines : array of string;
                   var keys : array of char; n, sel : integer) : integer;
var
  saved : tscreen;
  w, h, top, r0, c0, i, j : integer;
  c : char;
  done : boolean;
begin
saved := scr;
crt_view(false);
w := length(title);
for i := 0 to n - 1 do
  if length(lines[i]) > w then w := length(lines[i]);
h := n;
if h > 21 then h := 21;              { taller than the screen: scroll }
if w > 76 then w := 76;
r0 := (24 - h - 2) div 2 + 1;
c0 := (80 - w - 4) div 2 + 1;
top := 0;
while (sel < n - 1) and (keys[sel] = #1) do inc(sel);
rl_choose := 0;
done := false;
repeat
  if sel < top then top := sel;
  if sel >= top + h then top := sel - h + 1;
  rl_put('+' + title + addcharr('-', '', w + 2 - length(title)) + '+', r0, c0, false);
  for i := 0 to h - 1 do
    begin
    j := top + i;
    rl_put('| ', r0 + 1 + i, c0, false);
    rl_put(copy(lines[j] + addcharr(' ', '', w), 1, w), r0 + 1 + i, c0 + 2, j = sel);
    rl_put(' |', r0 + 1 + i, c0 + 2 + w, false)
    end;
  rl_put('+' + addcharr('-', '', w + 2) + '+', r0 + h + 1, c0, false);
  gotoxy(c0 + 2, r0 + 1 + sel - top);
  inkey(c);
  case c of
    '8': repeat if sel > 0 then dec(sel) until (keys[sel] <> #1) or (sel = 0);
    '2': repeat if sel < n - 1 then inc(sel) until (keys[sel] <> #1) or (sel = n - 1);
    #13, #10, '5', ' ', '6', '+': if keys[sel] <> #1 then
      begin rl_choose := sel + 1; done := true end;
    #27, '0', '.', '4': done := true;
    otherwise
      for i := 0 to n - 1 do
        if (keys[i] = c) and not done then
          begin rl_choose := i + 1; done := true end
  end
until done;
scr := saved
end;

{ ---------- Command menu (Enter) ---------- }

const
  rl_ncmd = 60;
  rl_cmds : array [1..rl_ncmd] of string[40] = (
    '-Moving',
    '1-9 Move (5 = stay a turn)', '.   Run in a direction',
    'g   Explore automatically', '<   Go up / walk to an up staircase',
    '>   Go down / walk to a down staircase',
    'R   Rest for a period', 'S   Search mode on/off', 's   Search for hidden doors',
    'T   Tunnel',
    '-Items',
    'i   Inventory list', 'e   Equipment list', 'w   Wear/wield an item',
    't   Take off an item', 'x   Exchange weapon', 'd   Drop an item',
    'E   Eat some food', 'q   Quaff a potion', 'r   Run a disk program',
    'a   Aim & fire a ray gun', 'u   Use an alien device', 'f   Fire a gun',
    'h   Hurl an item', 'F   Put D-cell in lantern', 'M   Mix potions',
    '-Skills',
    'b   Browse a book', 'm   Do skill from manual', 'p   Read a prayer',
    '-Doors and traps',
    'o   Open a door/chest', 'c   Close a door', 'B   Bash (object/creature)',
    'D   Disarm a trap/chest', 'j   Jam a door with spike',
    '-Information',
    'l   Look in a direction', '/   Identify a character', 'C   Display character',
    'L   Current location', 'P   Print map / character sheet',
    'k   Display the kill list', '?   Help', 'V   Version and credits',
    '^P  Repeat the last message', '^R  Redraw the screen',
    'Q   Toggle -more- prompts', 'W   Toggle wall patterns',
    '-Game',
    '^Z  Save character and quit', '^Y  Quit without saving',
    '-Keypad in lists',
    '8/2 Move the cursor', '4/6 Switch list / back, confirm',
    '5   Choose (Enter too)', '+   Main action', '-   Drop', '*   Examine',
    '0   Close (Escape, . too)');

function rl_menu : char;
var
  lines : array [0..rl_ncmd - 1] of string;
  keys : array [0..rl_ncmd - 1] of char;
  i : integer;
  s : string;
  info : boolean;
begin
info := false;
for i := 1 to rl_ncmd do
  begin
  s := rl_cmds[i];
  keys[i - 1] := #1;                  { headers and explanations }
  if s[1] = '-' then
    begin
    lines[i - 1] := copy(s, 2, 40) + ':';
    info := s = '-Keypad in lists'
    end
  else
    begin
    lines[i - 1] := '  ' + s;
    if info then
    else if s[1] = '^' then keys[i - 1] := chr(ord(s[2]) - 64)
    else if s[2] = ' ' then keys[i - 1] := s[1]
    end
  end;
i := rl_choose(' Commands ', lines, keys, rl_ncmd, 0);
if i = 0 then rl_menu := #0 else rl_menu := keys[i - 1]
end;

{ ---------- Explore and stairs ---------- }

function rl_known(y, x : integer) : boolean;
begin
rl_known := test_light(y, x)
end;

{ Moria forgets dark floor once your light moves on; remember it (fm is saved
  with the level), so the map and the explorer keep what you have seen. }
procedure rl_remember;
var y, x : integer;
begin
for y := 1 to cur_height do
  for x := 1 to cur_width do
    with cave[y, x] do
      if tl and (fval < 10) then fm := true
end;

function rl_passable(y, x : integer) : boolean;
begin
rl_passable := false;
if not rl_known(y, x) then exit;
with cave[y, x] do
  begin
  if tptr > 0 then
    case t_list[tptr].tval of
      102, 110, 111, 120: exit;             { known traps, shops, bank }
      105: begin rl_passable := not rl_door[y, x]; exit end
    end;
  rl_passable := fopen
  end
end;

function rl_target(y, x : integer) : boolean;
var i, j : integer;
begin
rl_target := false;
with cave[y, x] do
  case rl_mode of
    2: rl_target := (tptr > 0) and (t_list[tptr].tval = 107);
    3: rl_target := (tptr > 0) and (t_list[tptr].tval = 108);
    otherwise
      begin
      if rl_stood[y, x] then exit;
      if (tptr > 0) and (t_list[tptr].tval <= 100) then
        begin rl_target := true; exit end;
      if (tptr > 0) and (t_list[tptr].tval = 105) then
        begin rl_target := not rl_door[y, x]; exit end;   { open it }
      if not fopen then exit;
      for i := y - 1 to y + 1 do
        for j := x - 1 to x + 1 do
          if in_bounds(i, j) and not rl_known(i, j) then
            begin rl_target := true; exit end
      end
  end
end;

{ BFS over known grids; returns the direction key of the first step, #0 if
  nothing is reachable. Sets opens when that step is a closed door. }
function rl_path(var opens : boolean) : char;
type tpos = record y, x : byteint end;
var
  from : array [1..max_height, 1..max_width] of shortint;
  q : array [1..max_height * max_width] of tpos;
  qh, qt, y, x, ny, nx, d, dy, dx : integer;
const
  ddy : array [1..9] of integer = (1, 1, 1, 0, 0, 0, -1, -1, -1);
  ddx : array [1..9] of integer = (-1, 0, 1, -1, 0, 1, -1, 0, 1);
begin
rl_path := #0;
opens := false;
fillchar(from, sizeof(from), 0);
qh := 1; qt := 1;
q[1].y := char_row; q[1].x := char_col;
from[char_row, char_col] := 5;
while qh <= qt do
  begin
  y := q[qh].y; x := q[qh].x; inc(qh);
  if ((y <> char_row) or (x <> char_col)) and rl_target(y, x) then
    begin
    { walk back to the first step }
    while true do
      begin
      d := from[y, x];
      ny := y - ddy[d]; nx := x - ddx[d];
      if (ny = char_row) and (nx = char_col) then break;
      y := ny; x := nx
      end;
    with cave[y, x] do
      opens := (tptr > 0) and (t_list[tptr].tval = 105);
    rl_path := chr(ord('0') + d);
    exit
    end;
  { doors are entered, not crossed, until opened }
  if ((y <> char_row) or (x <> char_col)) and not cave[y, x].fopen then continue;
  for d := 1 to 9 do
    if d <> 5 then
      begin
      dy := ddy[d]; dx := ddx[d];
      ny := y + dy; nx := x + dx;
      if in_bounds(ny, nx) and (from[ny, nx] = 0) and
         rl_passable(ny, nx) then
        begin
        from[ny, nx] := d;
        inc(qt); q[qt].y := ny; q[qt].x := nx
        end
      end
  end
end;

procedure rl_stop(why : string);
begin
rl_mode := 0;
if why <> '' then msg_print(why)
end;

{ One step of explore / stairs walking: a command key, or #0 when stopped. }
function rl_step : char;
var
  y, x : integer;
  c, k : char;
  opens : boolean;
begin
rl_step := #0;
rl_stood[char_row, char_col] := true;
if keypressed then
  begin inkey(k); rl_stop(''); exit end;
if rl_msgs <> rl_last_msgs then begin rl_stop(''); exit end;
if rl_moved and (char_row = rl_ly) and (char_col = rl_lx) then
  begin rl_stop(''); exit end;
if rl_monsters_near > rl_near0 then begin rl_stop(''); exit end;
if py.flags.blind > 0 then begin rl_stop('You can''t see.'); exit end;
with cave[char_row, char_col] do
  if (rl_mode > 1) and (tptr > 0) and (t_list[tptr].tval = 105 + rl_mode) then
    begin
    if rl_mode = 2 then rl_step := '<' else rl_step := '>';
    rl_mode := 0;
    exit
    end;
c := rl_path(opens);
if c = #0 then
  begin
  case rl_mode of
    1: if (equipment[33].tval = 0) and (dun_level > 0) then
         rl_stop('Nothing left to explore that you can see: wield a light.')
       else
         rl_stop('Nothing left to explore.');
    2: rl_stop('You know no way up.');
    3: rl_stop('You know no way down.')
  end;
  exit
  end;
rl_ly := char_row; rl_lx := char_col;
if opens then
  begin
  x := char_col; y := char_row;
  move(ord(c) - ord('0'), y, x);
  rl_door[y, x] := true;       { stuck or locked: don't try again }
  rl_moved := false;
  rl_q := c;                   { the direction for "Which direction?" }
  rl_step := 'o'
  end
else
  begin
  rl_moved := true;
  rl_step := c
  end
end;

procedure rl_start(mode : integer);
begin
rl_near0 := rl_monsters_near;
if (mode = 1) and (rl_near0 > 0) then
  begin msg_print('Not with a monster in view.'); exit end;
rl_mode := mode;
rl_last_msgs := rl_msgs;
rl_moved := false
end;

{ ---------- Inventory ---------- }

{ The main action key for an inventory item (#0 = examine). }
function rl_main_key(tval : integer) : char;
begin
case tval of
  80: rl_main_key := 'E';
  75, 76: rl_main_key := 'q';
  70, 71: rl_main_key := 'r';
  65: rl_main_key := 'a';
  55: rl_main_key := 'u';
  90, 91, 92: rl_main_key := 'b';
  77: rl_main_key := 'F';
  13: rl_main_key := 'j';
  82, 84: rl_main_key := 'h';
  10, 11, 12: rl_main_key := 'f';
  15, 19, 20, 21, 23, 25, 29, 30..36, 40, 45: rl_main_key := 'w';
  otherwise rl_main_key := #0
end
end;

function rl_key_name(k : char) : string;
begin
case k of
  'E': rl_key_name := 'Eat';
  'q': rl_key_name := 'Quaff';
  'r': rl_key_name := 'Run the disk';
  'a': rl_key_name := 'Aim';
  'u': rl_key_name := 'Use';
  'b': rl_key_name := 'Browse';
  'm': rl_key_name := 'Use a skill';
  'p': rl_key_name := 'Pray';
  'F': rl_key_name := 'Refill the lantern';
  'j': rl_key_name := 'Jam a door';
  'h': rl_key_name := 'Hurl';
  'f': rl_key_name := 'Fire';
  'w': rl_key_name := 'Wear/wield';
  't': rl_key_name := 'Take off';
  'x': rl_key_name := 'Exchange weapons';
  'd': rl_key_name := 'Drop';
  '*': rl_key_name := 'Examine';
  otherwise rl_key_name := k
end
end;

{ Keys that run action k on inventory item i / equipment line i. }
function rl_action_keys(k : char; i : integer; equip : boolean) : string;
begin
if equip then
  case k of
    't': rl_action_keys := 't' + chr(96 + i) + #27#27;
    otherwise rl_action_keys := k
  end
else
  case k of
    'w': rl_action_keys := 'w' + alpha_set[i] + #27#27;
    'F', 'j', 'x', 'm', 'p': rl_action_keys := k;
    otherwise rl_action_keys := k + alpha_set[i]
  end
end;

{ equipment slot shown on line n of the equipment list }
function rl_equip_slot(n : integer) : integer;
var i : integer;
begin
rl_equip_slot := 0;
for i := 23 to equip_max do
  if equipment[i].tval > 0 then
    begin
    dec(n);
    if n = 0 then begin rl_equip_slot := i; exit end
    end
end;

procedure rl_examine(i : integer; equip : boolean);
var s : shortstring;
begin
if equip then objdes(s, rl_equip_slot(i), true, 'e')
else objdes(s, i, true, 'i');
msg_print(s)
end;

{ Item menu: every action that fits, each with its usual key. }
function rl_item_menu(i : integer; equip : boolean) : string;
var
  lines : array [0..7] of string;
  keys : array [0..7] of char;
  n, c : integer;
  k : char;
  procedure add(key : char);
  begin
  keys[n] := key;
  lines[n] := key + '  ' + rl_key_name(key);
  inc(n)
  end;
begin
rl_item_menu := '';
n := 0;
if equip then
  begin
  add('t');
  if rl_equip_slot(i) in [23, 34] then add('x')
  end
else
  begin
  k := rl_main_key(inventory[i].tval);
  if k <> #0 then add(k);
  if (inventory[i].tval in [90, 92]) then add('m');
  if inventory[i].tval = 91 then add('p');
  if k <> 'h' then add('h');
  add('d')
  end;
add('*');
c := rl_choose(' ' + chr(96 + i) + ') ', lines, keys, n, 0);
if c = 0 then exit;
if keys[c - 1] = '*' then rl_examine(i, equip)
else rl_item_menu := rl_action_keys(keys[c - 1], i, equip)
end;

{ The inventory / equipment list with a cursor. Returns keys to queue
  (an item action, or a normal command typed here). }
function rl_inven(which : char) : string;
var
  saved : tscreen;
  sel, top, n, i, slot, row : integer;
  c, k : char;
  s : shortstring;
  equip, done : boolean;
  procedure count;
  var j : integer;
  begin
  if equip then begin n := 0; for j := 23 to equip_max do if equipment[j].tval > 0 then inc(n) end
  else n := inven_ctr
  end;
begin
saved := scr;
rl_inven := '';
equip := which = 'e';
sel := 1; top := 1;
done := false;
repeat
  count;
  if n = 0 then
    begin
    if equip then msg_print('You are not using any equipment.')
    else msg_print('You are not carrying anything.');
    break
    end;
  if sel > n then sel := n;
  if sel < top then top := sel;
  if sel > top + 20 then top := sel - 20;
  clrscr;
  if equip then rl_put('Equipment (4/6: switch list, Enter: item menu, 0/Esc: close)', 1, 1, false)
  else rl_put('Inventory (4/6: switch list, Enter: item menu, 0/Esc: close)', 1, 1, false);
  for row := 0 to 20 do
    begin
    i := top + row;
    if i > n then break;
    if equip then
      begin
      slot := rl_equip_slot(i);
      objdes(s, slot, true, 'e');
      s := chr(96 + i) + ') ' + s
      end
    else
      begin
      objdes(s, i, true, 'i');
      s := alpha_set[i] + ') ' + s
      end;
    rl_put(copy(s, 1, 78), row + 2, 1, i = sel)
    end;
  rl_put('letter: ' + 'main action   Shift+letter: drop   Ctrl+letter: examine   + - *: keypad', 24, 1, false);
  gotoxy(1, sel - top + 2);
  inkey(c);
  msg_flag := false;
  case c of
    '8': if sel > 1 then dec(sel);
    '2': if sel < n then inc(sel);
    '4', '6': begin equip := not equip; sel := 1; top := 1 end;
    #27, '0', '.': done := true;
    #13, #10, '5', ' ':
      begin
      rl_inven := rl_item_menu(sel, equip);
      done := rl_inven <> ''
      end;
    '+': begin
      if equip then rl_inven := rl_action_keys('t', sel, true)
      else
        begin
        k := rl_main_key(inventory[sel].tval);
        if k = #0 then rl_examine(sel, false)
        else rl_inven := rl_action_keys(k, sel, false)
        end;
      done := rl_inven <> ''
      end;
    '-': if not equip then begin rl_inven := rl_action_keys('d', sel, false); done := true end;
    '*': rl_examine(sel, equip);
    otherwise
      begin
      i := pos(c, alpha_set);
      if (c in ['a'..'z']) and (i <= n) then
        begin
        sel := i;
        if equip then rl_inven := rl_action_keys('t', i, true)
        else
          begin
          k := rl_main_key(inventory[i].tval);
          if k = #0 then rl_examine(i, false)
          else rl_inven := rl_action_keys(k, i, false)
          end;
        done := rl_inven <> ''
        end
      else if (c in ['A'..'Z']) and not equip and (n <= 26) and (i - 26 <= n) then
        begin rl_inven := rl_action_keys('d', i - 26, false); done := true end
      else if (c in [#1..#26]) and (ord(c) <= n) and not (c in [#8, #9, #10, #13]) then
        begin sel := ord(c); rl_examine(sel, equip) end
      else
        begin rl_inven := c; rl_reopen := #0; scr := saved; exit end
      end
  end
until done;
scr := saved;
if rl_inven <> '' then
  if equip then rl_reopen := 'e' else rl_reopen := 'i'
else
  rl_reopen := #0
end;

{ ---------- Inventory and Visible windows (web) ---------- }

{ inv: "<colour>\t<text>" lines; vis: "M<glyph><name>\t<colour>" and
  "I<glyph><name>\t<colour>" (PC palette indexes; BOSS has no colours) }
procedure rl_lists;
var
  inv, vis : ansistring;
  s : shortstring;
  i, y, x : integer;
  keep : treasure_type;
begin
inv := ''; vis := '';
for i := 1 to inven_ctr do
  begin
  objdes(s, i, true, 'i');
  inv := inv + '7'#9 + alpha_set[i] + ') ' + s + #10
  end;
for i := 23 to equip_max do
  if equipment[i].tval > 0 then
    begin
    objdes(s, i, true, 'e');
    inv := inv + '7'#9'worn: ' + s + #10
    end;
if py.flags.blind < 1 then
  begin
  i := muptr;
  while i > 0 do
    with m_list[i] do
      begin
      if ml then vis := vis + 'M' + c_list[mptr].cchar + c_list[mptr].name + #9'7'#10;
      i := nptr
      end;
  keep := temporary_slot;
  for y := panel_row_min to panel_row_max do
    for x := panel_col_min to panel_col_max do
      with cave[y, x] do
        if (tptr > 0) and (t_list[tptr].tval <= 100) and test_light(y, x) and los(char_row, char_col, y, x) then
          begin
          temporary_slot := t_list[tptr];
          objdes(s, 0, true, 't');
          vis := vis + 'I' + t_list[tptr].tchar + s + #9'7'#10
          end;
  temporary_slot := keep
  end;
crt_lists(inv, vis)
end;

{ ---------- The command prompt ---------- }

{ Replaces inkey(command) at the dungeon command prompt. }
procedure rl_command(var command : char);
var s : string;
begin
if rl_q_owned then begin rl_q := ''; rl_q_owned := false end;
rl_remember;
crt_savename(py.misc.name + '.sav', false);
if crt_want_save then
  begin
  rl_quiet_save := true;
  save_char;
  rl_quiet_save := false
  end;
repeat
  crt_view(true);
  rl_lists;
  if rl_q <> '' then
    begin inkey(command); rl_q_owned := true; exit end;
  if rl_mode > 0 then
    begin
    command := rl_step;
    if command <> #0 then begin rl_q_owned := rl_q <> ''; exit end;
    continue
    end;
  if (rl_reopen <> #0) then
    begin
    if rl_monster_near then rl_reopen := #0
    else begin s := rl_inven(rl_reopen); if s <> '' then rl_q := s; continue end
    end;
  inkey(command);
  if command in [#13, #10] then
    begin
    command := rl_menu;
    if command = #0 then continue
    end;
  case command of
    rl_explore_key: rl_start(1);
    '<', '>':
      with cave[char_row, char_col] do
        if (dun_level = 0) and (command = '<') then exit
        else if (tptr > 0) and (t_list[tptr].tval in [107, 108, 110]) then exit
        else if command = '<' then rl_start(2)
        else rl_start(3);
    'i', 'e':
      begin
      s := rl_inven(command);
      if s <> '' then rl_q := s
      end;
    #16: begin command := #13; exit end;    { ^P = repeat the last message }
    otherwise exit
  end
until false
end;
