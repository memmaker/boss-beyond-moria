{ The bits of FPC's crt unit BOSS uses, drawn by port/be_x11.c (or be_web.c):
  an 80x25 screen that write()/writeln() to Output land in. }
unit bcrt;

interface

const
  scr_cols = 80;
  scr_rows = 25;

type
  tscreen = array [1..scr_rows, 1..scr_cols] of longint;   { char | attr << 8 }
var
  scr : tscreen;
  text_attr : longint = 0;    { or-ed into written cells: colour << 8, $10000 reverse }
  crt_at_cmd : boolean = false;  { inc/rl.inc: inkey waits for a command (web prompt line) }

procedure gotoxy(x, y : integer);
procedure clreol;
procedure clrscr;
function readkey : char;
function keypressed : boolean;
procedure delay(ms : word);
function wherex : integer;
function wherey : integer;
function crt_want_save : boolean;   { web autosave hooks, see inc/rl.inc }
procedure crt_savename(const name : string; saved : boolean);
procedure crt_present;
{ page windows: the game says when its dungeon screen is up (crt_view); then
  each pane of that screen goes to its own window, else the whole screen is a
  pop-up. crt_lists: Inventory / Visible window text (see web/boss.js). }
procedure crt_view(on : boolean);
procedure crt_lists(const inv, vis : ansistring);
procedure crt_hero(y, x : longint);  { player's screen cell: the map camera centres on it (RVIP.md W4) }
procedure crt_msg(const s : string);     { message history line }

implementation

uses sysutils;

{$IFDEF CPUWASM32}
{ browser: imports from the page (web/boss.js), be_getkey/be_sleep are
  asyncified by wasm-opt (web/build.sh) }
procedure be_init(c, r : longint); external 'boss' name 'be_init';
procedure be_put(y, x, ch : longint); external 'boss' name 'be_put';
procedure be_cursor(y, x : longint); external 'boss' name 'be_cursor';
procedure be_flush; external 'boss' name 'be_flush';
function be_getkey(wait, atcmd : longint) : longint; external 'boss' name 'be_getkey';
procedure be_sleep(ms : longint); external 'boss' name 'be_sleep';
function be_want_save : longint; external 'boss' name 'be_want_save';
procedure be_savename(p : pchar; saved : longint); external 'boss' name 'be_savename';
procedure be_pane(p, y, x, r, c : longint); external 'boss' name 'be_pane';
procedure be_pput(p, y, x, ch : longint); external 'boss' name 'be_pput';
procedure be_popup(on : longint); external 'boss' name 'be_popup';
procedure be_lists(inv, vis : pchar); external 'boss' name 'be_lists';
procedure be_hero(y, x : longint); external 'boss' name 'be_hero';
procedure be_msg(s : pchar; fold : longint); external 'boss' name 'be_msg';
{$ELSE}
{$L be.o}
{$linklib X11}
{$linklib Xft}
procedure be_init(c, r : longint); cdecl; external;
procedure be_put(y, x, ch : longint); cdecl; external;
procedure be_cursor(y, x : longint); cdecl; external;
procedure be_flush; cdecl; external;
function be_getkey(wait, atcmd : longint) : longint; cdecl; external;
procedure be_sleep(ms : longint); cdecl; external;
function be_want_save : longint; begin be_want_save := 0 end;
procedure be_savename(p : pchar; saved : longint); begin end;
{ X11: one text window, no panes }
procedure be_pane(p, y, x, r, c : longint); begin end;
procedure be_pput(p, y, x, ch : longint); begin end;
procedure be_popup(on : longint); begin end;
procedure be_lists(inv, vis : pchar); begin end;
procedure be_hero(y, x : longint); begin end;
procedure be_msg(s : pchar; fold : longint); begin end;
{$ENDIF}

var
  shown : tscreen;
  cx : integer = 1;
  cy : integer = 1;
  pending : longint = -1;
  view : boolean = false;
  sentview : longint = -1;
  pshown : tscreen;
  ip : integer;

{ BOSS's dungeon screen (1-based): 1 map, 2 character column, 3 status line,
  4 message line }
const
  PANES = 4;
  PY : array [1..PANES] of integer = (2, 2, 24, 1);
  PX : array [1..PANES] of integer = (14, 1, 1, 1);
  PR : array [1..PANES] of integer = (22, 22, 1, 1);
  PC : array [1..PANES] of integer = (67, 13, 80, 80);

procedure crt_view(on : boolean);
begin
view := on
end;

{ a repeat of the last message becomes "message (xN)", replacing the
  page's last line (fold = 1) }
const prev_msg : string = '';
      reps : longint = 1;
procedure crt_msg(const s : string);
var z : ansistring;
begin
if (prev_msg <> '') and (s = prev_msg) then
  begin
  inc(reps);
  z := s + ' (x' + IntToStr(reps) + ')';
  be_msg(pchar(z), 1)
  end
else
  begin
  prev_msg := s; reps := 1;
  z := s; be_msg(pchar(z), 0)
  end
end;

procedure crt_lists(const inv, vis : ansistring);
begin
be_lists(pchar(inv), pchar(vis))
end;

procedure crt_hero(y, x : longint);
begin
be_hero(y, x)
end;

function crt_want_save : boolean;
begin crt_want_save := be_want_save <> 0 end;
procedure crt_savename(const name : string; saved : boolean);
var z : ansistring;
begin z := name; be_savename(pchar(z), ord(saved)) end;

procedure crt_present;
var y, x, p : integer;
begin
for y := 1 to scr_rows do
  for x := 1 to scr_cols do
    if scr[y, x] <> shown[y, x] then
      begin
      shown[y, x] := scr[y, x];
      be_put(y - 1, x - 1, scr[y, x])
      end;
if ord(view) <> sentview then
  begin
  sentview := ord(view);
  be_popup(ord(not view));
  fillchar(pshown, sizeof(pshown), $ff)    { resend the panes }
  end;
if view then
  for p := 1 to PANES do
    for y := PY[p] to PY[p] + PR[p] - 1 do
      for x := PX[p] to PX[p] + PC[p] - 1 do
        if scr[y, x] <> pshown[y, x] then
          begin
          pshown[y, x] := scr[y, x];
          be_pput(p, y - PY[p], x - PX[p], scr[y, x])
          end;
be_cursor(cy - 1, cx - 1);
be_flush
end;

procedure gotoxy(x, y : integer);
begin
if (x >= 1) and (x <= scr_cols) then cx := x;
if (y >= 1) and (y <= scr_rows) then cy := y
end;

function wherex : integer; begin wherex := cx end;
function wherey : integer; begin wherey := cy end;

procedure clreol;
var x : integer;
begin
for x := cx to scr_cols do scr[cy, x] := 32
end;

procedure clrscr;
var y, x : integer;
begin
for y := 1 to scr_rows do
  for x := 1 to scr_cols do scr[y, x] := 32;
cx := 1; cy := 1;
view := false
end;

function keypressed : boolean;
begin
if pending < 0 then
  begin
  crt_present;
  pending := be_getkey(0, ord(crt_at_cmd))
  end;
keypressed := pending >= 0
end;

function readkey : char;
begin
crt_present;
if pending < 0 then pending := be_getkey(1, ord(crt_at_cmd));
readkey := chr(pending);
pending := -1
end;

procedure delay(ms : word);
begin
crt_present;
be_sleep(ms)
end;

procedure putc(c : char);
begin
case c of
  #13: cx := 1;
  #10: begin cx := 1; if cy < scr_rows then inc(cy) end;
  #8: if cx > 1 then dec(cx);
  otherwise
    begin
    if cx <= scr_cols then scr[cy, cx] := ord(c) or text_attr;
    if cx < scr_cols then inc(cx)
    end
end
end;

{ FPC calls these as procedure(var t : TextRec): the signature must match
  exactly, or the indirect call traps on wasm }
procedure crt_write(var f : TextRec);
var i : longint;
begin
for i := 0 to f.bufpos - 1 do putc(f.bufptr^[i]);
f.bufpos := 0
end;

procedure crt_close(var f : TextRec);
begin
end;

procedure crt_open(var f : TextRec);
begin
f.inoutfunc := @crt_write;
f.flushfunc := @crt_write;
f.closefunc := @crt_close
end;

initialization
  fillchar(shown, sizeof(shown), 0);
  clrscr;
  be_init(scr_cols, scr_rows - 1);    { row 25 is only ever cleared }
  for ip := 1 to PANES do be_pane(ip, PY[ip] - 1, PX[ip] - 1, PR[ip], PC[ip]);
  assign(output, '');
  TextRec(output).openfunc := @crt_open;
  rewrite(output)
end.
