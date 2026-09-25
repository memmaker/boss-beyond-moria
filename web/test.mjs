// Headless check of web/dist/boss.wasm: node web/test.mjs "keys" — prints the final screen.
// Keys are fed synchronously (no Asyncify unwinding needed); \r = Enter, \x1b = Escape.
import { WASI, WASIProcExit, File, Directory, OpenFile, PreopenDirectory, ConsoleStdout } from './vendor/wasi/index.js';
import fs from 'fs';
const dir = new URL('dist/', import.meta.url).pathname;
const dat = new Directory(fs.readdirSync(dir + 'dat').map(n => [n, new File(fs.readFileSync(dir + 'dat/' + n))]));
const root = new Directory([['dat', dat]]);
const keys = [...(process.argv[2] || '')].map(c => c.charCodeAt(0));
let cols = 80, rows = 24, scr = [], mem;
const show = () => { for (let y = 0; y < rows; y++) console.log(String.fromCharCode(...scr.slice(y * cols, y * cols + cols).map(v => (v & 255) || 32)).trimEnd()); };
const w = new WASI(['boss'], [], [new OpenFile(new File([])), ConsoleStdout.lineBuffered(console.log), ConsoleStdout.lineBuffered(console.log),
	new PreopenDirectory('.', root.contents), new PreopenDirectory('./dat', dat.contents)]);
const boss = {
	be_init(c, r) { cols = c; rows = r; scr = new Array(c * r).fill(32); },
	be_put(y, x, v) { scr[y * cols + x] = v; }, be_cursor() {}, be_flush() {},
	be_getkey(wait) { if (keys.length) return keys.shift(); if (!wait) return -1; show(); console.log('--- out of keys'); process.exit(0); },
	be_sleep() {}, be_want_save() { return 0; }, be_savename() {},
};
// every key goes through an Asyncify unwind/rewind, as in the browser
let ex, pending, value, data;
const imp = {};
for (const [n, f] of Object.entries(boss)) imp[n] = (...a) => {
	if (ex.asyncify_get_state() === 2) { ex.asyncify_stop_rewind(); return value; }
	if (n !== 'be_getkey') return f(...a);
	pending = f(...a); ex.asyncify_start_unwind(data); return 0;
};
const { instance } = await WebAssembly.instantiate(fs.readFileSync(dir + 'boss.wasm'), { wasi_snapshot_preview1: w.wasiImport, boss: imp });
ex = instance.exports; w.inst = instance;
data = ex.memory.grow(8) * 65536;
new Int32Array(ex.memory.buffer, data, 2).set([data + 8, data + 8 * 65536]);
try {
	ex._start();
	while (ex.asyncify_get_state() === 1) { ex.asyncify_stop_unwind(); value = pending; ex.asyncify_start_rewind(data); ex._start(); }
} catch (e) { if (!(e instanceof WASIProcExit)) throw e; }
show(); console.log('--- exited');
