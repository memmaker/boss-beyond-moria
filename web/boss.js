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
	dirty = true;
}
/* panes (port/bcrt.pas): 1 map, 2 character column, 3 status line, 4 message line; the game
 * sends each one's cells and says when a pop-up (any non-dungeon screen) covers them */
const MAP = 1, PANE_BOX = { 1: 'map', 2: 'side', 3: 'stat', 4: 'msgcv' }, P = {};
let popup = true;
function size(c, w, h) {
	if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
	c.style.width = w + 'px'; c.style.height = h + 'px';
	const g = c.getContext('2d');
	g.setTransform(dpr, 0, 0, dpr, 0, 0); g.font = px + 'px ' + FONT; g.textBaseline = 'top';
	return g;
}
/* biggest font that shows the map (single window: the whole screen) in the map window */
function fit() {
	const b = $('map'), one = !rects.side && !rects.stat, w = one ? cols : P[MAP] ? P[MAP].c : 67, h = one ? rows : P[MAP] ? P[MAP].r : 22;
	let best = 8;
	for (let p = 8; p <= 40; p++) {
		ctx.font = p + 'px ' + FONT;
		if (Math.ceil(ctx.measureText('M').width) * w <= b.clientWidth && Math.ceil(p * 1.2) * h <= b.clientHeight) best = p;
	}
	return best;
}
/* a canvas bigger than its window scrolls to keep (fx, fy) in the middle; smaller ones are centred */
function scroll(c, fx, fy) {
	const b = c.parentNode, W = b.clientWidth, H = b.clientHeight, w = parseFloat(c.style.width), h = parseFloat(c.style.height);
	c.style.left = (w <= W ? (W - w) / 2 : -Math.max(0, Math.min(w - W, fx - W / 2))) + 'px';
	c.style.top = (h <= H ? 0 : -Math.max(0, Math.min(h - H, fy - H / 2))) + 'px';
}
function grid(g, buf, C, R) {
	g.fillStyle = '#000'; g.fillRect(0, 0, C * cw, R * ch);
	for (let y = 0; y < R; y++)
		for (let x = 0; x < C; x++) {
			const v = buf[y * C + x], c = v & 0xff;
			let fg = v >> 8 & 15, bg = 0;
			if (!fg) fg = 7;
			if (v & A_STANDOUT) { bg = fg; fg = 0; }
			if (bg) { g.fillStyle = PAL[bg]; g.fillRect(x * cw, y * ch, cw, ch); }
			if (c > 32) { g.fillStyle = PAL[fg]; g.fillText(String.fromCharCode(c), x * cw, y * ch + (ch - px) / 2); }
		}
}
function drawPane(p) {
	const q = P[p], b = $(PANE_BOX[p]), c = b.firstChild;
	if (!q) return;
	/* message line (prompts, -more-): plain text in the log's style above it; gone when empty */
	if (p === 4) { const t = String.fromCharCode(...q.buf.map(v => v & 0xff || 32)).trimEnd(); b.textContent = t; b.hidden = !t || t === ($("log").lastChild || {}).textContent; return; }
	grid(size(c, q.c * cw, q.r * ch), q.buf, q.c, q.r);
	if (p !== MAP) return;
	const cy = cur.y - q.y, cx = cur.x - q.x;
	if (cy >= 0 && cy < q.r && cx >= 0 && cx < q.c) {
		const g = c.getContext('2d');
		g.fillStyle = PAL[7]; g.fillRect(cx * cw, cy * ch + ch - 2, cw, 2);
		scroll(c, (cx + 0.5) * cw, (cy + 0.5) * ch);
	} else scroll(c, 0, 0);
}
/* message history: lines the game prints (be_msg) */
function logMsg(s) {
	const l = $('log'), d = document.createElement('div'), end = l.scrollTop + l.clientHeight >= l.scrollHeight - 4;
	d.textContent = s; l.appendChild(d);
	if (l.childNodes.length > 500) l.removeChild(l.firstChild);
	if (end) l.scrollTop = l.scrollHeight;
}
function fonts() { ['msgcv', 'log', 'inv', 'vis'].forEach(id => { $(id).style.fontSize = L.font + 'px'; }); }
/* layout: a file next to the saves, so it goes to IndexedDB with them (persist) */
function saveLayout() { root.contents.set('web-layout.json', new File(new TextEncoder().encode(JSON.stringify(L)))); persist().then(persist); }
/* the shared tiling window manager (rvip-wm.js, RVIP.md 5b) */
function makeWM() {
	try { const s = JSON.parse(new TextDecoder().decode(root.contents.get('web-layout.json').data)); if (s) L = { px: s.px | 0, font: s.font || 13, wm: s.wm }; } catch (e) { }
	if (L.px >= 8 && L.px <= 40) { px = L.px; auto = false; measure(); }
	fonts();
	wm = RvipWM({
		area: $('game'), menu: $('btn-layout'),
		wins: [{ id: 'map', title: 'Map' }, { id: 'side', title: 'Character' }, { id: 'stat', title: 'Status' },
			{ id: 'msg', title: 'Messages' }, { id: 'inv', title: 'Inventory' }, { id: 'vis', title: 'Visible' }],
		multi: { d: 'h', r: 0.72, a: { d: 'v', r: 0.88, a: { d: 'h', r: 0.16, a: 'side', b: 'map' }, b: 'stat' },
			b: { d: 'v', r: 0.35, a: 'msg', b: { d: 'v', r: 0.6, a: 'inv', b: 'vis' } } },
		single: 'map',
		state: L.wm, noFont: 'map',
		save: st => { L.wm = st; saveLayout(); },
		layout: r => { rects = r; if (auto) { px = fit(); measure(); } dirty = true; draw(); },
		font: (id, d) => { L.font = Math.max(8, Math.min(28, L.font + d)); fonts(); saveLayout(); },
		onReset: () => { auto = true; L.px = 0; L.font = 13; L.wm = wm.state(); fonts(); px = fit(); measure(); draw(); saveLayout(); }
	});
	wm.apply();
}
/* single window: the whole screen in the map window; multi: the panes, the whole screen over them while a pop-up is up */
function draw() {
	if (!dirty || !scr || !wm) return;
	dirty = false;
	const one = !rects.side && !rects.stat, box = one ? $('map') : $('full');
	if (cv.parentNode !== box) box.appendChild(cv);
	$('map').firstChild.style.display = one ? 'none' : '';
	$('full').hidden = one || !popup;
	if (one || popup) {
		size(cv, cols * cw, rows * ch);
		grid(ctx, scr, cols, rows);
		ctx.fillStyle = PAL[7]; ctx.fillRect(cur.x * cw, cur.y * ch + ch - 2, cw, 2);
		if (one) scroll(cv, cur.x * cw, cur.y * ch);
		else {
			const b = $('full'), s = Math.min(1, b.clientWidth / (cols * cw), b.clientHeight / (rows * ch));
			cv.style.width = cols * cw * s + 'px'; cv.style.height = rows * ch * s + 'px';
			scroll(cv, 0, 0);
		}
	}
	if (!one) [1, 2, 3, 4].forEach(drawPane);
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
	be_pane(p, y, x, r, c) { P[p] = { y, x, r, c, buf: new Uint32Array(r * c) }; dirty = true; },
	be_pput(p, y, x, v) { P[p].buf[y * P[p].c + x] = v; dirty = true; },
	be_popup(on) { if (popup !== !!on) { popup = !!on; dirty = true; } },
	be_msg(p) { const s = cstr(p).trim(); if (s) logMsg(s); },
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
