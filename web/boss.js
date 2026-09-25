/*
 * BOSS in the browser: draws the 80x25 text screen port/bcrt.pas sends
 * (imports "boss".be_*), keyboard, files in an in-memory WASI file system
 * (vendor/wasi = @bjorn3/browser_wasi_shim) mirrored to IndexedDB.
 * readkey waits through Binaryen's Asyncify (web/build.sh).
 * Page structure copied from ~/Games/omega/web/omega.js.
 */
import { WASI, WASIProcExit, File, Directory, OpenFile, PreopenDirectory, ConsoleStdout } from './vendor/wasi/index.js';

const FONT = '"DejaVu Sans Mono", Menlo, Consolas, "Liberation Mono", monospace';
const PAL = ['#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa',
	'#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff'];
const A_STANDOUT = 0x10000;
/* arrows and keypad = BOSS's number keys */
const KEYS = { ArrowUp: 56, ArrowDown: 50, ArrowLeft: 52, ArrowRight: 54, Home: 55, PageUp: 57,
	End: 49, PageDown: 51, Clear: 53, Enter: 13, Escape: 27, Backspace: 8, Delete: 8, Tab: 9 };

let events = [], waiter = null, running = false, lastYield = 0, lastSave = 0, wantSaveFlag = false;
let cols = 80, rows = 24, scr = null, cur = { y: 0, x: 0 };
let wm = null, rects = {}, L = { px: 0, font: 13, wm: null };
let auto = true, cv, ctx, px = 18, cw = 11, ch = 22, dirty = true;
const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
let root, dat, memory, exports, currentSave = null, savedByPlayer = false;

const $ = id => document.getElementById(id);
function status(msg, isError) {
	const s = $('status');
	s.textContent = msg; s.hidden = !msg; s.classList.toggle('error', !!isError);
}

/* ---------- drawing ---------- */
function measure() {
	ctx.font = px + 'px ' + FONT;
	cw = Math.ceil(ctx.measureText('M').width); ch = Math.ceil(px * 1.2);
	cv.width = cols * cw * dpr; cv.height = rows * ch * dpr;
	cv.style.width = cols * cw + 'px'; cv.style.height = rows * ch + 'px';
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.font = px + 'px ' + FONT;
	ctx.textBaseline = 'top';
	dirty = true;
}
/* screen: row 0 messages, cols 0-12 stats, cols 13-79 rows 1-22 map, rows 23- status */
const MX = 13, MH = 22;
/* biggest font that shows the map (single window: the whole screen) in the map window */
function fit() {
	const b = $('map'), one = !rects.side && !rects.stat, w = one ? cols : cols - MX, h = one ? rows : MH;
	let best = 8;
	for (let p = 8; p <= 40; p++) {
		ctx.font = p + 'px ' + FONT;
		if (Math.ceil(ctx.measureText('M').width) * w <= b.clientWidth && Math.ceil(p * 1.2) * h <= b.clientHeight) best = p;
	}
	return best;
}
/* windows are crops of the offscreen screen canvas; bigger than the window = centred on the cursor */
function blit(id, sx, sy, sw, sh, fx, fy) {
	const b = $(id), c = b.firstChild, W = b.clientWidth, H = b.clientHeight, s = id === 'full' ? Math.min(1, W / sw, H / sh) : 1;
	if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px'; }
	const g = c.getContext('2d'), ox = sw * s <= W ? (sw * s - W) / 2 : Math.max(0, Math.min(sw - W, fx - W / 2)),
		oy = sh * s <= H ? 0 : Math.max(0, Math.min(sh - H, fy - H / 2));
	g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
	g.imageSmoothingEnabled = s < 1;
	g.setTransform(dpr * s, 0, 0, dpr * s, -ox * dpr, -oy * dpr);
	g.drawImage(cv, sx * dpr, sy * dpr, sw * dpr, sh * dpr, 0, 0, sw, sh);
}
function rowText(y, x0, x1) { let s = ''; for (let x = x0; x < x1; x++) s += String.fromCharCode(scr[y * cols + x] & 0xff || 32); return s; }
/* the dungeon screen shows "STR :" in the stats column; anything else (menus, stores) is full screen */
function onMap() { for (let y = 1; y <= MH; y++) if (/^\s*STR :/.test(rowText(y, 0, MX))) return true; return false; }
function show() {
	if (!wm) return;
	const one = !rects.side && !rects.stat, full = !one && !onMap();
	$('full').hidden = !full;
	if (full) blit('full', 0, 0, cols * cw, rows * ch, 0, 0);
	if (one) blit('map', 0, 0, cols * cw, rows * ch, cur.x * cw, cur.y * ch);
	else if (rects.map) blit('map', MX * cw, ch, (cols - MX) * cw, MH * ch, (cur.x - MX) * cw, (cur.y - 1) * ch);
	if (rects.side) blit('side', 0, ch, MX * cw, MH * ch, 0, 0);
	if (rects.stat) blit('stat', 0, (MH + 1) * ch, cols * cw, (rows - MH - 1) * ch, 0, 0);
	logRow(rowText(0, 0, cols));
}
/* message log: new text on row 0 goes to the Messages window */
let lastMsg = '';
function logRow(s) {
	s = s.replace(/[^ -~]/g, ' ').trim();
	if (s === lastMsg) return;
	lastMsg = s;
	if (!/[A-Za-z]{2}/.test(s)) return;
	const l = $('log'), d = document.createElement('div'), end = l.scrollTop + l.clientHeight >= l.scrollHeight - 4;
	d.textContent = s; l.appendChild(d);
	if (l.childNodes.length > 500) l.removeChild(l.firstChild);
	if (end) l.scrollTop = l.scrollHeight;
}
function saveLayout() { try { localStorage.setItem('boss-layout', JSON.stringify(L)); } catch (e) { } }
/* the shared tiling window manager (rvip-wm.js, RVIP.md 5b) */
function makeWM() {
	try { const s = JSON.parse(localStorage.getItem('boss-layout')); if (s) L = { px: s.px | 0, font: s.font || 13, wm: s.wm }; } catch (e) { }
	if (L.px >= 8 && L.px <= 40) { px = L.px; auto = false; measure(); }
	$('log').style.fontSize = L.font + 'px';
	wm = RvipWM({
		area: $('game'), menu: $('btn-layout'),
		wins: [{ id: 'map', title: 'Map' }, { id: 'side', title: 'Character' }, { id: 'stat', title: 'Status' }, { id: 'msg', title: 'Messages' }],
		multi: { d: 'h', r: 0.78, a: { d: 'v', r: 0.88, a: { d: 'h', r: 0.16, a: 'side', b: 'map' }, b: 'stat' }, b: 'msg' },
		single: 'map',
		state: L.wm, noFont: 'map',
		save: st => { L.wm = st; saveLayout(); },
		layout: r => { rects = r; if (auto) { px = fit(); measure(); } dirty = true; draw(); },
		font: (id, d) => { L.font = Math.max(8, Math.min(28, L.font + d)); $('log').style.fontSize = L.font + 'px'; saveLayout(); },
		onReset: () => { auto = true; L.px = 0; L.font = 13; L.wm = wm.state(); $('log').style.fontSize = '13px'; px = fit(); measure(); draw(); saveLayout(); }
	});
	wm.apply();
}
function draw() {
	if (!dirty || !scr) return;
	dirty = false;
	ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cols * cw, rows * ch);
	for (let y = 0; y < rows; y++)
		for (let x = 0; x < cols; x++) {
			const v = scr[y * cols + x], c = v & 0xff;
			let fg = v >> 8 & 15, bg = 0;
			if (!fg) fg = 7;
			if (v & A_STANDOUT) { bg = fg; fg = 0; }
			if (bg) { ctx.fillStyle = PAL[bg]; ctx.fillRect(x * cw, y * ch, cw, ch); }
			if (c > 32) { ctx.fillStyle = PAL[fg]; ctx.fillText(String.fromCharCode(c), x * cw, y * ch + (ch - px) / 2); }
		}
	ctx.fillStyle = PAL[7];
	ctx.fillRect(cur.x * cw, cur.y * ch + ch - 2, cw, 2);
	show();
}
function zoom(d) {
	auto = false;
	px = Math.max(8, Math.min(40, px + d));
	measure(); draw();
	L.px = px; saveLayout();
}

/* ---------- the game's imports ---------- */
function cstr(p) {
	const m = new Uint8Array(memory.buffer);
	let e = p; while (m[e]) e++;
	return new TextDecoder().decode(m.subarray(p, e));
}
const boss = {
	be_init(c, r) {
		cols = c; rows = r; scr = new Uint32Array(c * r);
		$('game').hidden = false;
		px = 16; measure(); makeWM();
	},
	be_put(y, x, v) { scr[y * cols + x] = v; dirty = true; },
	be_cursor(y, x) { cur.y = y; cur.x = x; dirty = true; },
	be_flush() { draw(); },
	/* asyncified: a Promise makes the game wait */
	be_getkey(wait) {
		if (events.length) return events.shift();
		if (!wait) {
			/* polling (explore, rest): let the page paint now and then */
			if (performance.now() - lastYield < 50) return -1;
			lastYield = performance.now();
			return new Promise(res => requestAnimationFrame(() => res(-1)));
		}
		draw();
		return new Promise(res => { waiter = res; });
	},
	be_sleep(ms) { draw(); return new Promise(res => setTimeout(res, ms)); },
	/* autosave at most every 2 s, and when the page is hidden */
	be_want_save() {
		const now = performance.now();
		if (now - lastSave < 2000 && !document.hidden) return 0;
		if (!wantSaveFlag) return 0;
		wantSaveFlag = false; lastSave = now;
		setTimeout(persist, 0);
		return 1;
	},
	be_savename(p, saved) { currentSave = cstr(p); if (saved) savedByPlayer = true; }
};

/* ---------- input ---------- */
function onKey(e) {
	if (!$('help').hidden) {
		if (e.key === 'Escape') { $('help').hidden = true; e.preventDefault(); }
		return;
	}
	if (!running || e.isComposing || e.metaKey) return;
	const k = e.key, code = e.code || '', m = /^Numpad(\d)$/.exec(code);
	let c;
	if (m) c = 48 + +m[1];
	else if (code === 'NumpadEnter') c = 13;
	else if (code === 'NumpadDecimal') c = 46;
	else if (KEYS[k] !== undefined) c = KEYS[k];
	else if (k.length === 1) {
		c = k.charCodeAt(0);
		if (e.ctrlKey && !e.altKey) {
			const u = k.toUpperCase().charCodeAt(0);
			if (u >= 65 && u <= 90) c = u & 0x1f; else return;
		}
		if (c > 126) return;
	}
	else return;
	wantSaveFlag = true;
	e.preventDefault();
	if (waiter) { const w = waiter; waiter = null; w(c); }
	else events.push(c);
}

/* ---------- files: memory FS <-> IndexedDB ---------- */
const DB = 'boss', STORE = 'files';
function idb() {
	return new Promise((res, rej) => {
		const r = indexedDB.open(DB, 1);
		r.onupgradeneeded = () => r.result.createObjectStore(STORE);
		r.onsuccess = () => res(r.result);
		r.onerror = () => rej(r.error);
	});
}
async function idbAll() {
	const db = await idb();
	return new Promise((res, rej) => {
		const out = new Map(), req = db.transaction(STORE).objectStore(STORE).openCursor();
		req.onsuccess = () => { const c = req.result; if (!c) return res(out); out.set(c.key, c.value); c.continue(); };
		req.onerror = () => rej(req.error);
	});
}
async function idbWrite(sets, dels) {
	const db = await idb();
	return new Promise((res, rej) => {
		const tx = db.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE);
		for (const [k, v] of sets) st.put(v, k);
		for (const k of dels) st.delete(k);
		tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
	});
}
const written = new Map();   /* path -> bytes last stored, to skip unchanged files */
function same(a, b) {
	if (!a || a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}
function files() {   /* every file that may change: saves in the root, dat/ */
	const out = new Map();
	for (const [n, f] of root.contents) if (f instanceof File) out.set(n, f.data);
	for (const [n, f] of dat.contents) if (f instanceof File) out.set('dat/' + n, f.data);
	return out;
}
let persisting = null;
function persist() {
	if (persisting) return persisting;
	const sets = [], dels = [];
	const now = files();
	for (const [k, v] of now) if (!same(written.get(k), v)) { const c = v.slice(); sets.push([k, c]); written.set(k, c); }
	for (const k of written.keys()) if (!now.has(k)) { dels.push(k); written.delete(k); }
	if (!sets.length && !dels.length) return Promise.resolve();
	persisting = idbWrite(sets, dels).catch(err => {
		status('Saving to browser storage (IndexedDB) failed: ' + err + '. Use "Export save" to keep a copy.', true);
	}).then(() => { persisting = null; });
	return persisting;
}
function saves() { return [...root.contents.keys()].filter(n => /\.sav$/.test(n)); }
function exportSave() {
	const name = currentSave && root.contents.has(currentSave) ? currentSave : saves()[0];
	if (!name) { status('There is no saved game yet.', true); setTimeout(() => status(''), 2000); return; }
	const a = document.createElement('a');
	a.href = URL.createObjectURL(new Blob([root.contents.get(name).data], { type: 'application/octet-stream' }));
	a.download = name;
	document.body.appendChild(a); a.click();
	setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function importSave(file) {
	const r = new FileReader();
	r.onload = async () => {
		const name = /\.sav$/.test(file.name) ? file.name : file.name + '.sav';
		if (!confirm('Add "' + name + '" to the saved games in this browser and restart?')) return;
		running = false;
		root.contents.set(name, new File(new Uint8Array(r.result)));
		await persist(); location.reload();
	};
	r.readAsArrayBuffer(file);
}
async function newGame() {
	if (!confirm('Delete every saved game in this browser and start over?')) return;
	running = false;
	for (const n of saves()) root.contents.delete(n);
	await persist(); location.reload();
}

/* ---------- startup ---------- */
async function main() {
	const names = (await (await fetch('dat/files.txt')).text()).trim().split('\n');
	const bufs = await Promise.all(names.map(n => fetch('dat/' + n).then(r => r.arrayBuffer())));
	dat = new Directory(names.map((n, i) => [n, new File(new Uint8Array(bufs[i]))]));
	root = new Directory([['dat', dat]]);
	try {
		for (const [k, v] of await idbAll()) {
			written.set(k, v);
			if (k.startsWith('dat/')) dat.contents.set(k.slice(4), new File(v.slice()));
			else root.contents.set(k, new File(v.slice()));
		}
	} catch (err) {
		status('Could not read saved games from IndexedDB (' + err + '). Saving may not work in this browser mode.', true);
	}
	const wasi = new WASI(['boss'], [], [
		new OpenFile(new File([])),
		ConsoleStdout.lineBuffered(s => console.log(s)),
		ConsoleStdout.lineBuffered(s => console.warn(s)),
		new PreopenDirectory('.', root.contents),
		new PreopenDirectory('./dat', dat.contents),   /* FPC resolves ./dat/x against this */
	]);
	const imports = { wasi_snapshot_preview1: wasi.wasiImport, boss: {} };
	/* Asyncify: an import that returns a Promise unwinds the stack; the
	   result of the promise is returned when the stack is rewound. */
	let pending = null, value = 0, data = 0;
	for (const [n, f] of Object.entries(boss))
		imports.boss[n] = (...a) => {
			if (exports.asyncify_get_state() === 2) { exports.asyncify_stop_rewind(); return value; }
			const r = f(...a);
			if (r instanceof Promise) { pending = r; exports.asyncify_start_unwind(data); return 0; }
			return r;
		};
	const { instance } = await WebAssembly.instantiateStreaming(fetch('boss.wasm', { cache: 'no-cache' }), imports);
	exports = instance.exports; memory = exports.memory;
	wasi.inst = instance;
	/* unwind buffer: fresh pages after the program's own memory */
	const base = memory.grow(8) * 65536;
	new Int32Array(memory.buffer, base, 2).set([base + 8, base + 8 * 65536]);
	data = base;
	running = true; status('');
	let code = 0;
	try {
		exports._start();
		while (exports.asyncify_get_state() === 1) {
			exports.asyncify_stop_unwind();
			value = await pending;
			exports.asyncify_start_rewind(data);
			exports._start();
		}
	} catch (e) {
		if (e instanceof WASIProcExit) code = e.code;
		else { crashed(e); return; }
	}
	end(code);
}
async function end() {
	running = false;
	draw();
	if (!savedByPlayer && currentSave && root.contents.has(currentSave)) root.contents.delete(currentSave);   /* died or quit */
	await persist();
	$('overlay-msg').textContent = savedByPlayer ? 'Your game has been saved. Play again to continue it.' : 'The game is over.';
	$('overlay').hidden = false;
}
function crashed(err) {
	running = false;
	console.error('[boss] crash:', err);
	status('The game crashed (' + (err && err.message || err) + '). Reload the page to continue from the last autosave.', true);
}

/* ---------- help ---------- */
let helpLoaded = false;
function toggleHelp() {
	const h = $('help');
	h.hidden = !h.hidden;
	if (!h.hidden && !helpLoaded) {
		helpLoaded = true;
		fetch('help.html').then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
			.then(t => { $('help-body').innerHTML = t; })
			.catch(err => { helpLoaded = false; $('help-body').textContent = 'Could not load the guide (' + err + '). Press ? in the game for its own help.'; });
	}
	if (!h.hidden) $('help-body').focus();
}

document.addEventListener('visibilitychange', () => { if (document.hidden) wantSaveFlag = true; });
window.addEventListener('resize', () => { if (wm) wm.apply(); });
document.addEventListener('keydown', onKey);
document.addEventListener('DOMContentLoaded', () => {
	cv = document.createElement('canvas');
	ctx = cv.getContext('2d');
	$('btn-export').onclick = exportSave;
	$('btn-import').onclick = () => $('import-file').click();
	$('import-file').onchange = function () { if (this.files[0]) importSave(this.files[0]); this.value = ''; };
	$('btn-new').onclick = newGame;
	$('btn-help').onclick = toggleHelp;
	$('help-close').onclick = toggleHelp;
	$('btn-zoom-in').onclick = () => zoom(1);
	$('btn-zoom-out').onclick = () => zoom(-1);
	$('btn-restart').onclick = () => location.reload();
	document.querySelectorAll('button').forEach(b => b.addEventListener('mousedown', e => e.preventDefault()));
	main().catch(crashed);
});
