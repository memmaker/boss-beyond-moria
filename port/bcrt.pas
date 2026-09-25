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

implementation

uses sysutils;

{$IFDEF CPUWASM32}
{ browser: imports from the page (web/boss.js), be_getkey/be_sleep are
  asyncified by wasm-opt (web/build.sh) }
procedure be_init(c, r : longint); external 'boss' name 'be_init';
procedure be_put(y, x, ch : longint); external 'boss' name 'be_put';
procedure be_cursor(y, x : longint); external 'boss' name 'be_cursor';
procedure be_flush; external 'boss' name 'be_flush';
function be_getkey(wait : longint) : longint; external 'boss' name 'be_getkey';
procedure be_sleep(ms : longint); external 'boss' name 'be_sleep';
function be_want_save : longint; external 'boss' name 'be_want_save';
procedure be_savename(p : pchar; saved : longint); external 'boss' name 'be_savename';
{$ELSE}
{$L be.o}
{$linklib X11}
{$linklib Xft}
procedure be_init(c, r : longint); cdecl; external;
procedure be_put(y, x, ch : longint); cdecl; external;
procedure be_cursor(y, x : longint); cdecl; external;
procedure be_flush; cdecl; external;
function be_getkey(wait : longint) : longint; cdecl; external;
procedure be_sleep(ms : longint); cdecl; external;
function be_want_save : longint; begin be_want_save := 0 end;
procedure be_savename(p : pchar; saved : longint); begin end;
{$ENDIF}

var
  shown : tscreen;
  cx : integer = 1;
  cy : integer = 1;
  pending : longint = -1;

function crt_want_save : boolean;
begin crt_want_save := be_want_save <> 0 end;
procedure crt_savename(const name : string; saved : boolean);
var z : ansistring;
begin z := name; be_savename(pchar(z), ord(saved)) end;

procedure crt_present;
var y, x : integer;
begin
for y := 1 to scr_rows do
  for x := 1 to scr_cols do
    if scr[y, x] <> shown[y, x] then
      begin
      shown[y, x] := scr[y, x];
      be_put(y - 1, x - 1, scr[y, x])
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
cx := 1; cy := 1
end;

function keypressed : boolean;
begin
if pending < 0 then
  begin
  crt_present;
  pending := be_getkey(0)
  end;
keypressed := pending >= 0
end;

function readkey : char;
begin
crt_present;
if pending < 0 then pending := be_getkey(1);
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
  assign(output, '');
  TextRec(output).openfunc := @crt_open;
  rewrite(output)
end.
