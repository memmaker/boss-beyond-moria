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

let events = [], waiter = null, lastYield = 0, lastSave = 0, wantSaveFlag = false;
let cols = 80, rows = 24, scr = null, cur = { y: 0, x: 0 }, hero = { y: 0, x: 0 };
let wm = null, rects = {}, L = { px: 0, wm: null, face: '', mapFace: '' };
let auto = true, cv, ctx, px = 18, cw = 11, cwT = 11, ch = 22, dirty = true;
const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
let root, dat, memory, exports, currentSave = null, savedByPlayer = false;

const $ = id => document.getElementById(id);
function status(msg, isError) { app.status(msg, isError); }

/* ---------- drawing ---------- */
/* fonts: the top-bar choice (L.face) for every window but the map, the Map
 * title bar's (L.mapFace) for the map; cw / cwT = their cell widths */
function face(map) { const n = map ? L.mapFace : L.face; return n ? '"' + n + '", ' + FONT : FONT; }
function measure() {
	ctx.font = px + 'px ' + face(true);
	cw = Math.ceil(ctx.measureText('M').width); ch = Math.ceil(px * 1.2);
	ctx.font = px + 'px ' + face(false);
	cwT = Math.ceil(ctx.measureText('M').width);
	dirty = true;
}
/* panes (port/bcrt.pas): 1 map, 2 character column, 3 status line, 4 message line; the game
 * sends each one's cells and says when a pop-up (any non-dungeon screen) covers them */
const MAP = 1, PANE_BOX = { 1: 'map', 2: 'side', 3: 'stat' }, P = {};
let popup = true;
function size(c, w, h, map, fpx = px) {
	if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
	c.style.width = w + 'px'; c.style.height = h + 'px';
	const g = c.getContext('2d');
	g.setTransform(dpr, 0, 0, dpr, 0, 0); g.font = fpx + 'px ' + face(map); g.textBaseline = 'top';
	return g;
}
/* biggest font that shows the map (single window: the whole screen) in the map window */
function fit() {
	const b = $('map'), one = !rects.side && !rects.stat, w = one ? cols : P[MAP] ? P[MAP].c : 67, h = one ? rows : P[MAP] ? P[MAP].r : 22;
	let best = 8;
	for (let p = 8; p <= 40; p++) {
		ctx.font = p + 'px ' + face(true);
		if (Math.ceil(ctx.measureText('M').width) * w <= b.clientWidth && Math.ceil(p * 1.2) * h <= b.clientHeight) best = p;
	}
	return best;
}
/* the map camera (RVIP.md W4): (fx, fy) centred, clamped at the edges */
function scroll(c, fx, fy) { RvipWM.center(c, fx, fy, parseFloat(c.style.width), parseFloat(c.style.height)); }
function grid(g, buf, C, R, cw, ch = cellH(), fpx = px) {
	g.fillStyle = '#000'; g.fillRect(0, 0, C * cw, R * ch);
	for (let y = 0; y < R; y++)
		for (let x = 0; x < C; x++) {
			const v = buf[y * C + x], c = v & 0xff;
			let fg = v >> 8 & 15, bg = 0;
			if (!fg) fg = 7;
			if (v & A_STANDOUT) { bg = fg; fg = 0; }
			if (bg) { g.fillStyle = PAL[bg]; g.fillRect(x * cw, y * ch, cw, ch); }
			if (c > 32) { g.fillStyle = PAL[fg]; g.fillText(String.fromCharCode(c), x * cw, y * ch + (ch - fpx) / 2); }
		}
}
function cellH() { return ch; }
/* Character and Status: their own A− / A+ size (the WM keeps it), else the map's */
let paneFs = {};   /* side / stat: the size A− / A+ gave them (none: the map's) */
function paneCell(p) {
	const fs = paneFs[PANE_BOX[p]];
	if (p === MAP || !fs) return { w: p === MAP ? cw : cwT, h: ch, px: px };
	ctx.font = fs + 'px ' + face(false);
	return { w: Math.ceil(ctx.measureText('M').width), h: Math.ceil(fs * 1.2), px: fs };
}
function drawPane(p) {
	const q = P[p];
	if (!q) return;
	/* message line (prompts, -more-): the prompt line over the map (rvip-wm.js) */
	if (p === 4) { RvipWM.prompt.text(String.fromCharCode(...q.buf.map(v => v & 0xff || 32))); return; }
	const b = $(PANE_BOX[p]), c = b.firstChild;
	const k = paneCell(p);
	grid(size(c, q.c * k.w, q.r * k.h, p === MAP, k.px), q.buf, q.c, q.r, k.w, k.h, k.px);
	if (p !== MAP) return;
	const cy = cur.y - q.y, cx = cur.x - q.x;
	/* no cursor on the hero */
	if (cy >= 0 && cy < q.r && cx >= 0 && cx < q.c && !(cur.y === hero.y && cur.x === hero.x)) {
		const g = c.getContext('2d');
		g.fillStyle = PAL[7]; g.fillRect(cx * cw, cy * ch + ch - 2, cw, 2);
	}
	scroll(c, (hero.x - q.x + 0.5) * cw, (hero.y - q.y + 0.5) * ch);
}
/* message history: lines the game prints (be_msg) */
let lastMsg = '';
function logMsg(s, fold) { lastMsg = s.replace(/ \(x\d+\)$/, ''); RvipWM.log($('log'), s, fold); }
function fonts() { ['log', 'inv', 'vis'].forEach(id => { $(id).style.fontFamily = L.face ? face(false) : ''; }); }
/* layout: a file next to the saves, so it goes to IndexedDB with them (persist) */
function saveLayout() { root.contents.set('web-layout.json', new File(new TextEncoder().encode(JSON.stringify(L)))); persist().then(persist); }
/* the shared tiling window manager (rvip-wm.js, RVIP.md 5b) */
function makeWM() {
	try { const s = JSON.parse(new TextDecoder().decode(root.contents.get('web-layout.json').data)); if (s) L = { px: s.px | 0, wm: s.wm, face: s.face || '', mapFace: s.mapFace || '' };
		if (s && s.font && L.wm && !L.wm.fs) L.wm.fs = { msg: s.font, inv: s.font, vis: s.font };   /* old layout: one size, L.font */
	} catch (e) { }
	loadFace(L.face); loadFace(L.mapFace); fontSel();
	['side', 'stat'].forEach(id => { if (L.wm && L.wm.fs && L.wm.fs[id]) paneFs[id] = L.wm.fs[id]; });
	if (L.px >= 8 && L.px <= 40) { px = L.px; auto = false; measure(); }
	fonts();
	wm = RvipWM({
		area: $('game'), menu: $('btn-layout'),
		wins: [{ id: 'map', title: 'Map' }, { id: 'side', title: 'Character' }, { id: 'stat', title: 'Status' },
			{ id: 'msg', title: 'Messages' }, { id: 'inv', title: 'Inventory' }, { id: 'vis', title: 'Visible' }],
		multi: { d: 'h', r: 0.72, a: { d: 'v', r: 0.88, a: { d: 'h', r: 0.16, a: 'side', b: 'map' }, b: 'stat' },
			b: { d: 'v', r: 0.35, a: 'msg', b: { d: 'v', r: 0.6, a: 'inv', b: 'vis' } } },
		single: 'map',
		state: L.wm,
		save: st => { L.wm = st; saveLayout(); },
		layout: r => { rects = r; if (auto) { px = fit(); measure(); } dirty = true; draw(); },
		/* A− / A+ on each title bar (the WM keeps the sizes); the map's zooms the map */
		zoom: { map: (size, d) => zoom(d), side: paneZoom('side'), stat: paneZoom('stat') },
		onReset: () => { auto = true; paneFs = {}; L.px = 0; L.wm = wm.state(); renderMapSel(); fonts(); px = fit(); measure(); draw(); saveLayout(); }
	});
	wm.apply();
	renderMapSel();
}
/* font choosers: the top bar's and the Map title bar's (shown on hover);
 * the faces are the index page's fonts/ (web/build.sh writes fonts.json) */
const mapSel = document.createElement('select');
mapSel.title = 'Map font';
mapSel.innerHTML = '<option value="">Default font</option>';
mapSel.addEventListener('pointerdown', e => e.stopPropagation());   /* not a window drag */
function renderMapSel() {
	const bs = document.querySelector('#t-map .wm-btns');
	if (bs && mapSel.parentNode !== bs) bs.insertBefore(mapSel, bs.firstChild);
}
function fontSel() { $('sel-font').value = L.face || ''; mapSel.value = L.mapFace || ''; }
function loadFace(n, now) {
	const redraw = () => { if (auto && wm) px = fit(); measure(); fonts(); draw(); };
	if (!n) { if (now) redraw(); return; }
	const ff = new FontFace(n, 'url(../fonts/' + n + '.woff)');
	ff.load().then(() => { document.fonts.add(ff); redraw(); }).catch(() => status('Could not load the font ' + n + '.', true));
}
/* single window: the whole screen in the map window; multi: the panes, the whole screen over them while a pop-up is up */
function draw() {
	if (!dirty || !scr || !wm) return;
	dirty = false;
	const log = $('log'); log.scrollTop = log.scrollHeight;   /* newest message in view */
	const one = !rects.side && !rects.stat, box = one ? $('map') : $('full');
	if (cv.parentNode !== box) box.appendChild(cv);
	$('map').firstChild.style.display = one ? 'none' : '';
	$('full').hidden = one || !popup;
	if (one || popup) {
		/* one window shows the map: its font; a pop-up is text */
		const w = one ? cw : cwT;
		size(cv, cols * w, rows * ch, one);
		grid(ctx, scr, cols, rows, w);
		/* no cursor on the hero (only at the command prompt: a pop-up's cursor may share the cell) */
		if (popup || cur.y !== hero.y || cur.x !== hero.x) { ctx.fillStyle = PAL[7]; ctx.fillRect(cur.x * w, cur.y * ch + ch - 2, w, 2); }
		if (one) scroll(cv, (hero.x + 0.5) * w, (hero.y + 0.5) * ch);
		else {
			const b = $('full'), s = Math.min(1, b.clientWidth / (cols * w), b.clientHeight / (rows * ch));
			cv.style.width = cols * w * s + 'px'; cv.style.height = rows * ch * s + 'px';
			scroll(cv, 0, 0);
		}
	}
	if (!one) [1, 2, 3, 4].forEach(drawPane);
}
function paneZoom(id) { return size => { paneFs[id] = size; dirty = true; draw(); }; }
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
	/* run report (roguelikes-index/server/CONTRACT.md): fire-and-forget, never throws */
	be_beacon(ev, name, killer, depth, score, turns, lvl) {
		try {
			const q = [['g', 'boss'], ['ev', cstr(ev)], ['name', cstr(name).trim()], ['killer', cstr(killer)],
				['depth', depth], ['score', score], ['turns', turns], ['lvl', lvl]]
				.filter(a => a[1] !== '' && !(a[1] < 0)).map(a => a[0] + '=' + encodeURIComponent(a[1])).join('&');
			if (window.RvipWM && RvipWM.report) RvipWM.report(q); else fetch('/roguelikes/beacon?' + q, { keepalive: true, mode: 'no-cors' }).catch(function () {});
		} catch (e) { }
	},
	be_hero(y, x) { hero.y = y; hero.x = x; dirty = true; },
	be_flush() { draw(); },
	be_pane(p, y, x, r, c) { P[p] = { y, x, r, c, buf: new Uint32Array(r * c) }; dirty = true; },
	be_pput(p, y, x, v) { P[p].buf[y * P[p].c + x] = v; dirty = true; },
	be_popup(on) { if (popup !== !!on) { popup = !!on; dirty = true; } },
	be_msg(p, fold) { const s = cstr(p).trim(); if (s) logMsg(s, fold); },
	be_lists(inv, vis) {
		$('inv').innerHTML = '';
		cstr(inv).split('\n').forEach(l => {
			if (!l) return;
			const t = l.split('\t'), d = document.createElement('div');
			d.textContent = t[1]; d.style.color = PAL[parseInt(t[0], 16) || 7]; $('inv').appendChild(d);
		});
		RvipWM.visible($('vis'), cstr(vis).replace(/\t([0-9a-f])$/gm, (m, c) => '\t' + PAL[parseInt(c, 16) || 7]));
	},
	/* asyncified: a Promise makes the game wait */
	be_getkey(wait, atCmd) {
		RvipWM.prompt.wait(atCmd);
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
	if (!app.running || e.isComposing || e.metaKey) return;
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
/* saves, help, crashes: ../rvip-app.js. The saves live in a WASI directory, not
 * Emscripten's FS: Module.FS gives rvip-app.js the two calls it uses (syncfs, readFile) */
window.Module = { FS: {
	syncfs: (populate, cb) => { persist().then(() => cb(), cb); },
	readFile: name => root.contents.get(name).data
} };
const app = RvipApp({
	name: 'boss',
	save: () => { const n = currentSave && root.contents.has(currentSave) ? currentSave : saves()[0]; return n || null; },
	clear: () => { for (const n of saves()) root.contents.delete(n); },
	put: (file, data) => { root.contents.set(/\.sav$/.test(file.name) ? file.name : file.name + '.sav', new File(data)); },
	helpText: 'Press ? in the game for its own help.'
});

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
	app.running = true; status('');
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
		else { app.crashed(e); return; }
	}
	end(code);
}
async function end() {
	app.running = false;
	draw();
	if (!savedByPlayer && currentSave && root.contents.has(currentSave)) root.contents.delete(currentSave);   /* died or quit */
	await persist();
	$('overlay-msg').textContent = savedByPlayer ? 'Your game has been saved. Play again to continue it.' : 'The game is over.';
	$('overlay').hidden = false;
}
document.addEventListener('visibilitychange', () => { if (document.hidden) wantSaveFlag = true; });
window.addEventListener('resize', () => { if (wm) wm.apply(); });
document.addEventListener('keydown', onKey);
document.addEventListener('DOMContentLoaded', () => {
	cv = document.createElement('canvas');
	ctx = cv.getContext('2d');
	RvipWM.dropdown($('btn-file'), $('menu-file'));
	fetch('fonts.json').then(r => r.json()).then(list => {
		[$('sel-font'), mapSel].forEach(sel => list.forEach(n => {
			const o = document.createElement('option');
			o.value = n; o.textContent = n.replace(/^Web(Plus|437)_/, '').replace(/_/g, ' '); sel.appendChild(o);
		}));
		fontSel();
	}).catch(() => { });
	[[$('sel-font'), 'face'], [mapSel, 'mapFace']].forEach(([sel, k]) => {
		sel.onchange = function () { L[k] = this.value; if (root) saveLayout(); loadFace(this.value, true); this.blur(); };
	});
	$('btn-restart').onclick = () => location.reload();
	document.querySelectorAll('button').forEach(b => b.addEventListener('mousedown', e => e.preventDefault()));
	main().catch(err => { if (app.running) app.crashed(err); else status('Could not start the game (' + (err && err.message || err) + ').', true); });
});
