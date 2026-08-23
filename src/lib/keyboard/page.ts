// The visualizer, as a single self-contained page.
//
// A string rather than an .html file on disk because this repo has no asset
// pipeline and no build step — the CLI is bun evaluating TypeScript directly,
// and `dotfiles` is run from a stow symlink, so anything resolved relative to
// the module would have to survive being reached through a link. One string has
// none of those problems.
//
// The embedded JavaScript uses string concatenation rather than template
// literals throughout. That is not style: this file IS a template literal, so a
// `${` in the page body would be interpolated by TypeScript before the browser
// ever saw it.
import { ACTIONS } from "./profile.ts"

/** Physical rows of a US ANSI keyboard, as `[code, label, widthUnits]`. */
const ROWS: readonly (readonly (readonly [string, string, number])[])[] = [
  [
    ["Escape", "esc", 1], ["F1", "F1", 1], ["F2", "F2", 1], ["F3", "F3", 1],
    ["F4", "F4", 1], ["F5", "F5", 1], ["F6", "F6", 1], ["F7", "F7", 1],
    ["F8", "F8", 1], ["F9", "F9", 1], ["F10", "F10", 1], ["F11", "F11", 1],
    ["F12", "F12", 1], ["PrintScreen", "prt", 1], ["Delete", "del", 1],
  ],
  [
    ["Backquote", "`", 1], ["Digit1", "1", 1], ["Digit2", "2", 1], ["Digit3", "3", 1],
    ["Digit4", "4", 1], ["Digit5", "5", 1], ["Digit6", "6", 1], ["Digit7", "7", 1],
    ["Digit8", "8", 1], ["Digit9", "9", 1], ["Digit0", "0", 1], ["Minus", "-", 1],
    ["Equal", "=", 1], ["Backspace", "backspace", 2], ["Home", "home", 1],
  ],
  [
    ["Tab", "tab", 1.5], ["KeyQ", "Q", 1], ["KeyW", "W", 1], ["KeyE", "E", 1],
    ["KeyR", "R", 1], ["KeyT", "T", 1], ["KeyY", "Y", 1], ["KeyU", "U", 1],
    ["KeyI", "I", 1], ["KeyO", "O", 1], ["KeyP", "P", 1], ["BracketLeft", "[", 1],
    ["BracketRight", "]", 1], ["Backslash", "\\", 1.5], ["End", "end", 1],
  ],
  [
    ["CapsLock", "caps", 1.75], ["KeyA", "A", 1], ["KeyS", "S", 1], ["KeyD", "D", 1],
    ["KeyF", "F", 1], ["KeyG", "G", 1], ["KeyH", "H", 1], ["KeyJ", "J", 1],
    ["KeyK", "K", 1], ["KeyL", "L", 1], ["Semicolon", ";", 1], ["Quote", "'", 1],
    ["Enter", "enter", 2.25], ["PageUp", "pgup", 1],
  ],
  [
    ["ShiftLeft", "shift", 2.25], ["KeyZ", "Z", 1], ["KeyX", "X", 1], ["KeyC", "C", 1],
    ["KeyV", "V", 1], ["KeyB", "B", 1], ["KeyN", "N", 1], ["KeyM", "M", 1],
    ["Comma", ",", 1], ["Period", ".", 1], ["Slash", "/", 1],
    ["ShiftRight", "shift", 1.75], ["ArrowUp", "↑", 1], ["PageDown", "pgdn", 1],
  ],
  [
    ["ControlLeft", "ctrl", 1.25], ["MetaLeft", "super", 1.25], ["AltLeft", "alt", 1.25],
    ["Space", "", 6.25], ["AltRight", "alt", 1.25], ["MetaRight", "super", 1.25],
    ["ContextMenu", "menu", 1.25], ["ControlRight", "ctrl", 1.25],
    ["ArrowLeft", "←", 1], ["ArrowDown", "↓", 1], ["ArrowRight", "→", 1],
  ],
]

/** Render the keyboard as static markup; the script only toggles classes on it. */
function renderKeyboard(): string {
  return ROWS.map((row) => {
    const keys = row
      .map(
        ([code, label, width]) =>
          '<div class="key" data-code="' +
          code +
          '" style="flex:' +
          width +
          ' 0 0"><span>' +
          label +
          "</span></div>",
      )
      .join("")
    return '<div class="row">' + keys + "</div>"
  }).join("")
}

/**
 * Build the visualizer page.
 *
 * @param mode - `dom` listens for browser key events; `raw` also opens a
 *   WebSocket to the evdev stream so compositor-grabbed chords appear.
 * @param platform - Whose conventions to render chords in.
 * @returns A complete HTML document.
 */
export function visualizerPage(mode: "dom" | "raw", platform: "darwin" | "linux"): string {
  const actionsJson = JSON.stringify(ACTIONS)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>dotfiles keys</title>
<style>
:root {
  --bg: #f6f7f9; --fg: #1b1d21; --dim: #6b7280; --line: #d6d9de;
  --key: #ffffff; --active: #2563eb; --activefg: #ffffff; --raw: #b45309;
  --panel: #ffffff; --same: #15803d; --differs: #b91c1c;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #121417; --fg: #e6e8eb; --dim: #9099a6; --line: #2a2f36;
    --key: #1b1f24; --active: #3b82f6; --activefg: #ffffff; --raw: #f59e0b;
    --panel: #171a1e; --same: #4ade80; --differs: #f87171;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 24px; background: var(--bg); color: var(--fg);
  font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
h1 { font-size: 15px; margin: 0 0 4px; letter-spacing: -0.01em; }
.sub { color: var(--dim); margin: 0 0 20px; font-size: 13px; }
.kbd { max-width: 900px; margin: 0 0 24px; }
.row { display: flex; gap: 5px; margin-bottom: 5px; }
.key {
  height: 46px; border: 1px solid var(--line); border-radius: 6px;
  background: var(--key); display: flex; align-items: center;
  justify-content: center; font-size: 11px; color: var(--dim);
  transition: background 40ms linear, color 40ms linear;
  min-width: 0; overflow: hidden;
}
.key.active { background: var(--active); color: var(--activefg); border-color: var(--active); }
.key.evdev { background: var(--raw); color: #fff; border-color: var(--raw); }
.panel {
  max-width: 900px; background: var(--panel); border: 1px solid var(--line);
  border-radius: 8px; padding: 16px;
}
.grid { display: grid; grid-template-columns: 120px 1fr; gap: 6px 16px; }
.grid dt { color: var(--dim); font-size: 12px; }
.grid dd {
  margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
}
.chord { font-size: 20px; font-weight: 600; letter-spacing: 0.02em; }
.note { color: var(--dim); font-size: 12px; margin-top: 14px; }
.rec { max-width: 900px; margin-bottom: 20px; }
.prompt { font-size: 19px; font-weight: 600; margin: 0 0 6px; }
.progress { color: var(--dim); font-size: 12px; }
.controls { margin-top: 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
button, input {
  font: inherit; padding: 6px 12px; border-radius: 6px;
  border: 1px solid var(--line); background: var(--key); color: var(--fg);
}
button { cursor: pointer; }
.hidden { display: none; }
.done { color: var(--same); font-weight: 600; }
</style>
</head>
<body>
<h1>dotfiles keys</h1>
<p class="sub" id="sub"></p>

<div class="rec hidden" id="rec">
  <p class="prompt" id="prompt"></p>
  <p class="progress" id="progress"></p>
  <div class="controls">
    <button id="skip">Skip (→)</button>
    <input id="manual" placeholder="or type it: Meta+KeyW" size="24">
    <button id="manualGo">Set</button>
  </div>
  <p class="note">
    Chrome will not let a page intercept a few chords — Cmd/Ctrl+W, Cmd/Ctrl+T,
    Cmd/Ctrl+N among them. Type those into the box rather than pressing them,
    or the tab closes instead.
  </p>
</div>

<div class="kbd" id="kbd">${renderKeyboard()}</div>

<div class="panel">
  <dl class="grid">
    <dt>chord</dt><dd class="chord" id="v-chord">—</dd>
    <dt>event.code</dt><dd id="v-code">—</dd>
    <dt>event.key</dt><dd id="v-key">—</dd>
    <dt>modifiers</dt><dd id="v-mods">—</dd>
    <dt>source</dt><dd id="v-source">—</dd>
  </dl>
  <p class="note" id="hint"></p>
</div>

<script>
(function () {
  var MODE = ${JSON.stringify(mode)};
  var PLATFORM = ${JSON.stringify(platform)};
  var ACTIONS = ${actionsJson};

  // Mirrors src/lib/keyboard/chord.ts. The order is the contract: two chords
  // are equal exactly when these strings are equal, so a profile recorded here
  // must sort identically to one the evdev reader produced.
  var ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'];
  var SELF = {
    ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt',
    ShiftLeft: 'Shift', ShiftRight: 'Shift', MetaLeft: 'Meta', MetaRight: 'Meta'
  };
  var GLYPH = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' };
  var LNAME = { Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Super' };

  function chordOf(code, held) {
    var self = SELF[code];
    var set = {};
    for (var i = 0; i < held.length; i++) set[held[i]] = true;
    if (self) set[self] = true;
    var mods = ORDER.filter(function (m) { return set[m]; });
    return self ? mods.join('+') : mods.concat([code]).join('+');
  }

  function baseLabel(code) {
    if (code.indexOf('Key') === 0) return code.slice(3);
    if (code.indexOf('Digit') === 0) return code.slice(5);
    if (code.indexOf('Arrow') === 0) return code.slice(5);
    return code;
  }

  function describe(chord) {
    var parts = chord.split('+');
    var last = parts[parts.length - 1];
    var bare = ORDER.indexOf(last) !== -1;
    var mods = (bare ? parts : parts.slice(0, -1)).map(function (p) {
      return PLATFORM === 'darwin' ? GLYPH[p] : LNAME[p];
    });
    if (bare) return PLATFORM === 'darwin' ? mods.join('') : mods.join('+');
    var base = baseLabel(last);
    return PLATFORM === 'darwin' ? mods.join('') + base : mods.concat([base]).join('+');
  }

  function heldFrom(e) {
    var held = [];
    if (e.ctrlKey) held.push('Ctrl');
    if (e.altKey) held.push('Alt');
    if (e.shiftKey) held.push('Shift');
    if (e.metaKey) held.push('Meta');
    return held;
  }

  var kbd = document.getElementById('kbd');
  function keyEl(code) { return kbd.querySelector('[data-code="' + code + '"]'); }

  function light(code, cls) {
    var el = keyEl(code);
    if (!el) return;
    el.classList.add(cls);
    if (cls === 'evdev') setTimeout(function () { el.classList.remove('evdev'); }, 160);
  }

  function show(code, key, chord, source) {
    document.getElementById('v-chord').textContent = describe(chord);
    document.getElementById('v-code').textContent = code;
    document.getElementById('v-key').textContent = key;
    document.getElementById('v-mods').textContent = chord.split('+').slice(0, -1).join(' ') || '—';
    document.getElementById('v-source').textContent = source;
  }

  // ---- record mode -------------------------------------------------------
  var recording = false;
  var queue = [];
  var results = [];
  var recEl = document.getElementById('rec');

  function renderPrompt() {
    if (queue.length === 0) {
      document.getElementById('prompt').innerHTML = '<span class="done">Captured. Saving…</span>';
      document.getElementById('progress').textContent = '';
      fetch('/record', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(results)
      }).then(function () {
        document.getElementById('prompt').innerHTML =
          '<span class="done">Saved. You can close this tab.</span>';
      });
      recording = false;
      return;
    }
    var total = results.length + queue.length;
    document.getElementById('prompt').textContent = 'Press: ' + queue[0].prompt;
    document.getElementById('progress').textContent =
      (results.length + 1) + ' of ' + total + '  ·  ' + queue[0].group;
  }

  function record(chord) {
    if (queue.length === 0) return;
    results.push({ action: queue[0].id, chord: chord });
    queue.shift();
    renderPrompt();
  }

  document.getElementById('skip').addEventListener('click', function () { record(null); });
  document.getElementById('manualGo').addEventListener('click', function () {
    var raw = document.getElementById('manual').value.trim();
    document.getElementById('manual').value = '';
    if (raw) record(raw);
  });

  // ---- DOM source --------------------------------------------------------
  document.addEventListener('keydown', function (e) {
    // Stops the page acting on a chord being measured. Chrome reserves a few
    // (Cmd/Ctrl+W, +T, +N) and ignores this, hence the manual-entry box.
    e.preventDefault();
    var chord = chordOf(e.code, heldFrom(e));
    light(e.code, 'active');
    show(e.code, e.key, chord, 'dom');
    if (recording && !SELF[e.code] && !e.repeat) record(chord);
  });

  document.addEventListener('keyup', function (e) {
    e.preventDefault();
    var el = keyEl(e.code);
    if (el) el.classList.remove('active');
  });

  window.addEventListener('blur', function () {
    var active = kbd.querySelectorAll('.active');
    for (var i = 0; i < active.length; i++) active[i].classList.remove('active');
  });

  // ---- evdev source ------------------------------------------------------
  if (MODE === 'raw') {
    var ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    ws.addEventListener('message', function (ev) {
      var p = JSON.parse(ev.data);
      if (p.phase === 'release') return;
      light(p.code, 'evdev');
      show(p.code, '—', p.chord, 'evdev');
      if (recording && !SELF[p.code] && p.phase === 'press') record(p.chord);
    });
    ws.addEventListener('close', function () {
      document.getElementById('hint').textContent = 'evdev stream closed.';
    });
  }

  // ---- boot --------------------------------------------------------------
  var params = new URLSearchParams(location.search);
  if (params.get('record') === '1') {
    var only = params.get('group');
    queue = ACTIONS.filter(function (a) { return !only || a.group === only; });
    recording = true;
    recEl.classList.remove('hidden');
    renderPrompt();
  }

  document.getElementById('sub').textContent =
    MODE === 'raw'
      ? 'Reading evdev below the compositor — chords Hyprland grabs show in amber.'
      : 'Reading browser key events. Chords the compositor grabs never arrive here; use --raw.';
  document.getElementById('hint').textContent =
    'event.code is the physical key and never changes. event.key is what the layout resolved it to — that is the pair that tells you whether a remap took effect.';
})();
</script>
</body>
</html>`
}
