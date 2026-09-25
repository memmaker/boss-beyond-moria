#!/usr/bin/env python3
"""Writes the in-page game guide (dist/help.html) for the web build.

The game content comes from the desktop key guides in
~/Desktop/Games/Roguelikes/Docs (build-docs.py + guides.py), so both guides
stay in sync; only the saving and "playing in the browser" parts are
written here, because they differ on the web."""
import html, importlib.util, os, sys

DOCS = os.path.expanduser('~/Desktop/Games/Roguelikes/Docs')
PAGE = 'boss.html'

sys.path.insert(0, DOCS)
spec = importlib.util.spec_from_file_location('build_docs', os.path.join(DOCS, 'build-docs.py'))
docs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(docs)
from guides import GUIDES   # noqa: E402

game = next(g for g in docs.GAMES if g['file'] == PAGE)
guide = dict(GUIDES.get(PAGE, {}))
info = dict(game['info'])
kbd = docs.kbd
esc = html.escape

SAVING = '''<ul>
<li><strong>Saving is automatic.</strong> The game is stored in this browser (IndexedDB) between your commands (at most every two seconds). Reloading the page continues from there.</li>
<li><kbd>Ctrl+Z</kbd> saves and ends the session, as in the original; reload the page (or press <em>Play again</em>) to continue.</li>
<li>When your character dies or you quit with <kbd>Ctrl+Y</kbd>, its save is deleted: death is final.</li>
<li>The browser keeps every character's save (<code>&lt;name&gt;.sav</code>); the game lists them at the start. <em>New game</em> deletes them all.</li>
<li><em>Export save</em> downloads the current character's save file; <em>Import save</em> loads one (also a save from the Mac version).</li>
<li>Private/incognito windows and "clear site data" delete the stored game. Export first if it matters.</li>
</ul>'''

WEB = '''<ul>
<li>One 80×24 text screen, as on the VAX terminals BOSS was written for. <em>Zoom −</em> / <em>Zoom +</em> change the text size.</li>
<li><strong>Keys:</strong> the number keys, arrow keys or numeric keypad move you; <kbd>.</kbd> + direction runs.</li>
<li>Browsers keep a few shortcuts for themselves (<kbd>Ctrl+W</kbd>, <kbd>Ctrl+T</kbd>, <kbd>Ctrl+N</kbd>, and <kbd>Cmd</kbd> shortcuts on a Mac), so those never reach the game. <kbd>Ctrl+P</kbd> (repeat the last message) and <kbd>Ctrl+Z</kbd> (save) work.</li>
<li>If the game ever crashes, a message appears at the top; reload the page to continue from the last autosave.</li>
</ul>'''

KEY_HINTS = [
    ('?', 'In-game help and command list'),
    ('g', 'Auto-explore: walk to the nearest unexplored spot'),
    ('Enter', 'Menu of all commands'),
    ('i', 'Inventory with a cursor: Enter = everything you can do with the item'),
    ('>', 'Go down (walks to the nearest known staircase)'),
]


def dl(items):
    return '<dl>' + ''.join(f'<dt>{kbd(k)}</dt><dd>{esc(d)}</dd>' for k, d in items) + '</dl>'


def section(anchor, title, body):
    return f'<h2 id="h-{anchor}">{esc(title)}</h2>{body}'


parts = []
toc = [('about', 'About the game'), ('keys', 'Keyboard controls'), ('saving', 'Saving your game'),
       ('tips', 'Tips'), ('guide', "New player's guide"), ('web', 'Playing in the browser')]
parts.append('<p>' + esc(game['tagline']) + '</p>' + info['About the game'] + '<ul class="toc">' +
             ''.join(f'<li><a href="#h-{a}">{esc(t)}</a></li>' for a, t in toc) + '</ul>')


parts.append(section('about', 'About the game',
                     guide.pop('How BOSS differs from Angband')))

ess = ''.join(f'<div class="box"><h3>{esc(cat)}</h3>{dl(items)}</div>' for cat, items in game['essentials'])
all_keys = game['all']() if callable(game['all']) else game['all']
full = ''.join(f'<div>{kbd(k)}<span>{esc(d)}</span></div>' for k, d in all_keys)
parts.append(section('keys', 'Keyboard controls',
                     '<div class="box key"><h3>The keys to remember</h3>' + dl(KEY_HINTS) + '</div>'
                     '<h3>Essential keys</h3><div class="grid">' + ess + '</div>'
                     '<details><summary>Complete key list (' + str(len(all_keys)) + ' commands)</summary>'
                     '<div class="all">' + full + '</div></details>'))

parts.append(section('saving', 'Saving your game', SAVING))
parts.append(section('tips', 'Tips', info['Tips']))
parts.append(section('guide', "New player's guide",
                     ''.join(f'<h3>{esc(t)}</h3>{b}' for t, b in guide.items())))
parts.append(section('web', 'Playing in the browser', WEB))

# RVIP: About this version
parts.append('<h2 id="h-version">About this version</h2><ul>'
             '<li>Based on <strong>BOSS 0.80.2</strong> by Laurence R. Brothers, maintained by Erik Max Francis '
             '(source archive <code>boss-0.80.2-src.zip</code>; its download source was not recorded).</li>'
             '<li>Our changes (curses shim, auto-explore, stairs walking, command menu, inventory cursor and item menus, web build) '
             'are local to this port; they are not published as a repository.</li></ul>')
print('\n'.join(parts))
