/**
 * The injected settings panel: a floating, draggable panel in the ZCode
 * renderer for live-tuning blur/dim, toggling Monet colors and wallpaper
 * visibility, and swapping the wallpaper image — all via the local API
 * started by `zcode-beautify serve`.
 *
 * The script always rebuilds the panel, so a stale copy left in the DOM can
 * never shadow a newer script version, and it is safe to re-evaluate on every
 * injection or reload.
 */

export const PANEL_ROOT_ID = "zcode-beautify-panel-root";

export function buildPanelScript(apiPort: number, apiToken = "", startupClean = true): string {
  const api = `http://127.0.0.1:${apiPort}`;
  return `(function(){
  var API = ${JSON.stringify(api)};
  var TOKEN = ${JSON.stringify(apiToken)};
  var STARTUP_CLEAN = ${JSON.stringify(startupClean !== false)};
  /** Authenticated fetch: every API call carries the per-start token.
   * Non-2xx responses REJECT — a 401 body like {"error":...} otherwise
   * parses as valid data (undefined fields) and quietly poisons every
   * consumer (the 轮播状态 "未启用" ghost came exactly from there). */
  function apiFetch(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'X-Beautify-Token': TOKEN }, opts.headers || {});
    return fetch(API + path, opts).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + path);
      return r;
    });
  }
  /** Media URLs (<img>/<video> cannot send headers) authenticate via ?t=. */
  function mt(url) { return TOKEN ? url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + TOKEN : url; }
  var ROOT_ID = ${JSON.stringify(PANEL_ROOT_ID)};
  var runPanel = function() {
  // Always rebuild: an older panel left in the DOM would otherwise shadow the
  // current script version forever (the old build skipped installation).
  var stale = document.getElementById(ROOT_ID);
  if (stale) stale.remove();
  var staleStyle = document.getElementById('zcode-beautify-panel-style');
  if (staleStyle) staleStyle.remove();
  // A popup the previous panel version left open survives its panel root;
  // it belongs to a dead closure now — sweep it so it cannot shadow the
  // next openWePop.
  var stalePops = document.querySelectorAll('body > .zb-we-pop');
  for (var spi = 0; spi < stalePops.length; spi++) stalePops[spi].remove();
  // Kill the PREVIOUS panel generation's intervals: every serve restart
  // re-evaluates this script, and old closures kept polling forever with
  // their dead tokens — each 401 body parsed as data and fought the new
  // panel (the 轮播状态 line flipped to 未启用 once a second). All panel
  // intervals register through zbEvery so this sweep reaches them.
  if (window.__zbTimers) {
    for (var zti = 0; zti < window.__zbTimers.length; zti++) {
      try { clearInterval(window.__zbTimers[zti]); } catch (e) {}
    }
  }
  window.__zbTimers = [];
  var zbEvery = function (fn, ms) {
    var id = setInterval(fn, ms);
    window.__zbTimers.push(id);
    return id;
  };

  var css = [
    '#zcode-beautify-panel-root, #zcode-beautify-panel-root * { box-sizing: border-box; font-family: system-ui, sans-serif; }',
    '#zcode-beautify-panel-root { position: fixed; inset: auto; z-index: 2147483647; font-size: 12px; color: #e8e8ea; }',
    '#zb-fab { position: fixed; right: 18px; bottom: 18px; width: 34px; height: 34px; border-radius: 50%;',
      ' background: rgba(32,32,38,.78); border: 1px solid rgba(255,255,255,.12); cursor: pointer;',
      ' display: flex; align-items: center; justify-content: center; backdrop-filter: blur(10px);',
      ' box-shadow: 0 2px 12px rgba(0,0,0,.35); user-select: none; font-size: 15px; line-height: 1; }',
    '#zb-fab:hover { background: rgba(52,52,60,.85); }',
    '#zb-panel { position: fixed; right: 18px; bottom: 60px; width: 264px; padding: 0 0 10px;',
      // A panel taller than the window used to overflow past the screen edge;
      // it now caps at the viewport and scrolls inside (slim scrollbar).
      ' max-height: calc(100vh - 68px); overflow-y: auto; overscroll-behavior: contain;',
      ' background: rgba(24,24,30,.88); border: 1px solid rgba(255,255,255,.12); border-radius: 12px;',
      ' backdrop-filter: blur(16px); box-shadow: 0 8px 32px rgba(0,0,0,.45); user-select: none; }',
    '#zb-panel::-webkit-scrollbar { width: 5px; }',
    '#zb-panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); border-radius: 3px; }',
    '#zb-panel[hidden] { display: none; }',
    '#zb-head { padding: 9px 12px; font-weight: 600; cursor: move; border-bottom: 1px solid rgba(255,255,255,.1);',
      ' display: flex; justify-content: space-between; align-items: center; }',
    '#zb-body { padding: 10px 12px 0; }',
    '#zb-tabs { display: flex; gap: 6px; margin-bottom: 10px; }',
    '.zb-card { background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.09);',
      ' border-radius: 10px; padding: 8px 10px; margin-bottom: 10px; }',
    '.zb-card-title { font-size: 11px; opacity: .6; margin-bottom: 5px; }',
    '.zb-card .zb-row:last-child, .zb-card .zb-actions:last-child { margin-bottom: 0; }',
    // Collapsible cards (壁纸库): clicking the title folds the body. The
    // grid-rows 1fr→0fr trick animates to any content height smoothly.
    '.zb-collapsible .zb-card-title { display: flex; justify-content: space-between; align-items: center;',
      ' cursor: pointer; user-select: none; margin-bottom: 0; padding-bottom: 7px; }',
    '.zb-collapse-wrap { display: grid; grid-template-rows: 1fr; transition: grid-template-rows .18s ease; }',
    '.zb-collapse-wrap > .zb-collapse-inner { overflow: hidden; min-height: 0; }',
    '.zb-collapsed .zb-collapse-wrap { grid-template-rows: 0fr; }',
    '.zb-collapsed .zb-card-title { padding-bottom: 0; }',
    '.zb-fold { width: 22px; height: 18px; border-radius: 5px; background: rgba(255,255,255,.09);',
      ' border: 1px solid rgba(255,255,255,.18); display: flex; align-items: center; justify-content: center;',
      ' font-size: 10px; line-height: 1; color: inherit; flex: none;',
      ' transition: transform .15s ease, background .15s ease, border-color .15s ease; }',
    '.zb-collapsible .zb-card-title:hover .zb-fold { background: rgba(122,162,247,.35); border-color: rgba(122,162,247,.6); }',
    // Collapsed = arrow rotated right AND the chip lights up blue — the
    // direction alone was too subtle to tell collapsed cards apart.
    '.zb-collapsed .zb-fold { transform: rotate(-90deg); background: rgba(122,162,247,.5);',
      ' border-color: rgba(122,162,247,.9); color: #d6e2ff; }',
    '.zb-tab { flex: 1; text-align: center; padding: 5px 0; border-radius: 8px; cursor: pointer;',
      ' background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); color: inherit; font-size: 11px; }',
    '.zb-tab:hover { background: rgba(255,255,255,.12); }',
    '.zb-tab[data-active="1"] { background: rgba(122,162,247,.3); border-color: rgba(122,162,247,.6); }',
    '#zb-tab-main.zb-pane-in, #zb-tab-sched.zb-pane-in, #zb-tab-settings.zb-pane-in { animation: zb-pane-in 150ms ease; }',
    '@keyframes zb-pane-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }',
    '.zb-row { margin-bottom: 6px; }',
    '.zb-row label { display: flex; justify-content: space-between; margin-bottom: 2px; opacity: .85; }',
    '#zb-panel input[type=range] { width: 100%; accent-color: #7aa2f7; height: 18px; margin: 0; cursor: pointer; }',
    '.zb-toggles { display: flex; justify-content: center; gap: 16px; }',
    '.zb-toggles label { display: flex; align-items: center; gap: 5px; margin: 0; cursor: pointer; white-space: nowrap; }',
    '.zb-actions { display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; }',
    '.zb-cfg-row .zb-btn { flex: 1 1 0; min-width: 0; padding-left: 2px; padding-right: 2px; }',
    '.zb-btn { display: inline-block; padding: 6px 10px; text-align: center; border-radius: 999px; cursor: pointer;',
      ' background: rgba(255,255,255,.09); border: 1px solid rgba(255,255,255,.14); color: inherit; font-size: 12px;',
      ' white-space: nowrap; flex: 0 1 auto; }',
    '.zb-btn:hover { background: rgba(255,255,255,.16); }',
    '#zb-status { min-height: 14px; padding: 2px 12px 0; opacity: .6; font-size: 11px; }',
    // Import row: picker + paste field + action on ONE line (the old stacked
    // button/input/button block ate three rows for two functions).
    '.zb-import-row { display: flex; align-items: center; gap: 6px; margin: 0 0 6px; }',
    '.zb-import-row .zb-btn { padding: 4px 9px; font-size: 11px; flex: none; }',
    '.zb-import-row .zb-icon-btn { padding: 4px 7px; line-height: 1; }',
    '.zb-import-row .zb-grow { flex: 1; min-width: 0; }',
    '#zb-scene-path { flex: 1; min-width: 0; padding: 4px 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14);',
      ' background: rgba(0,0,0,.3); color: inherit; font-size: 11px; outline: none; }',
    '#zb-scene-path:focus { border-color: rgba(122,162,247,.6); }',
    '#zb-progress { position: relative; height: 14px; border-radius: 7px; overflow: hidden;',
      ' background: rgba(255,255,255,.08); font-size: 10px; line-height: 14px; text-align: center; }',
    '#zb-progress-bar { position: absolute; inset: 0; width: 0%; background: rgba(122,162,247,.5); transition: width .4s; }',
    '#zb-progress span { position: relative; }',
    '#zb-guide { padding: 8px 10px; background: rgba(120,53,15,.55); border-radius: 8px; font-size: 11px;',
      ' line-height: 1.5; white-space: pre-wrap; user-select: text; max-height: 180px; overflow: auto; }',
    '.zb-lib { font-size: 11px; }',
    '.zb-lib .zb-lib-head { opacity: .55; margin: 4px 0 2px; }',
    '.zb-lib-list { max-height: 110px; overflow: auto; }',
    // Hover peek: a bigger wallpaper preview that opens to the LEFT of the
    // panel when the cursor rests on any thumbnail-bearing item.
    '#zb-hover-preview { position: fixed; z-index: 2147483647; width: 320px; border-radius: 8px;',
    '  border: 1px solid rgba(255,255,255,.18); box-shadow: 0 8px 28px rgba(0,0,0,.55); background: #000;',
    '  overflow: hidden; pointer-events: none; }',
    '#zb-hover-preview img { display: block; width: 100%; max-height: 240px; object-fit: cover; }',
    '#zb-hover-preview video { display: block; width: 100%; max-height: 240px; object-fit: contain; background: #000; }',
    '#zb-hover-preview .zb-hv-off { display: none; }',
    '#zb-hover-preview[hidden] { display: none; }',
    '.zb-sched-head { display: flex; justify-content: space-between; align-items: center; opacity: .85; margin-bottom: 4px; }',
    '.zb-sched-head label { display: flex; align-items: center; gap: 5px; margin: 0; cursor: pointer; }',
    '.zb-sched-plan { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; }',
    '.zb-sched-plan select { flex: 1; min-width: 0; padding: 3px 5px; border-radius: 6px;',
      ' border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.3); color: inherit; font-size: 11px;',
      ' outline: none; color-scheme: dark; }',
    '.zb-sched-plan .zb-act { font-size: 12px; }',
    '.zb-sched-mode { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; opacity: .85; font-size: 11px; }',
    '.zb-sched-mode select { flex: 1; min-width: 0; padding: 3px 5px; border-radius: 6px;',
      ' border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.3); color: inherit; font-size: 11px;',
      ' outline: none; color-scheme: dark; }',
    '#zb-sched-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 6px; max-height: 200px; overflow-y: auto; overflow-anchor: none; padding-right: 2px; }',
    '.zb-sched-row { display: flex; align-items: center; gap: 4px; }',
    '.zb-sched-row input[type=number], .zb-sched-row input[type=time], .zb-sched-row select { padding: 3px 5px; border-radius: 6px;',
      ' border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.3); color: inherit; font-size: 11px;',
      ' outline: none; color-scheme: dark; }',
    '.zb-sched-row input[type=number] { width: 52px; flex: none; }',
    '.zb-sched-row input[type=time] { width: 66px; flex: none; }',
    '.zb-sched-row select { flex: 1; min-width: 0; }',
    '.zb-sched-dur { flex: none; opacity: .7; font-size: 11px; }',
    '.zb-wp-picker { position: relative; flex: 1; min-width: 0; }',
    '.zb-wp-btn { display: flex; align-items: center; gap: 5px; width: 100%; padding: 2px 5px; border-radius: 6px;',
      ' border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.3); color: inherit; font-size: 11px; cursor: pointer; }',
    '.zb-wp-btn img { width: 42px; height: 24px; object-fit: cover; border-radius: 3px; flex: none; background: #000; }',
    '.zb-wp-btn span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }',
    // The popup is position:fixed on <body>: an absolutely positioned popup
    // inside the scrolling playlist gets clipped by the list's overflow window
    // (and the browser scrolls the list to reveal it, cutting off row 1).
    // z-index ties with the panel root (2147483647 is the ceiling) — the popup
    // is appended later, so DOM order paints it ABOVE the panel card.
    '.zb-wp-pop { position: fixed; z-index: 2147483647; color: #e8e8ea;',
      ' background: rgba(16,16,22,.98); border: 1px solid rgba(255,255,255,.16); border-radius: 8px; padding: 3px; }',
    // Each group scrolls independently (its own scrollbar), capped at five
    // visible rows — measured .zb-wp-item height is 32px: 5x32 = 160px.
    '.zb-wp-group-list { max-height: 160px; overflow-y: auto; overscroll-behavior: contain; }',
    '.zb-wp-group { padding: 4px 6px 2px; font-size: 10px; opacity: .55; }',
    '.zb-wp-item { display: flex; align-items: center; gap: 6px; padding: 3px 5px; border-radius: 6px; cursor: pointer; font-size: 11px; }',
    '.zb-wp-item:hover { background: rgba(255,255,255,.12); }',
    '.zb-wp-item[data-cur="1"] { background: rgba(122,162,247,.28); }',
    '.zb-wp-item img { width: 46px; height: 26px; object-fit: cover; border-radius: 3px; flex: none; background: #000; }',
    '.zb-wp-item span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    // WE library browser popup: same fixed-on-body scheme as the wallpaper
    // picker (panel is narrow, so it opens as its own window to the LEFT).
    // Grid of cards: bigger previews, click-to-multi-select, bottom bar.
    '.zb-we-pop { position: fixed; z-index: 2147483647; color: #e8e8ea;',
      ' background: rgba(16,16,22,.98); border: 1px solid rgba(255,255,255,.16); border-radius: 10px; padding: 10px; width: 560px; }',
    '.zb-we-head { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 0 2px 8px; }',
    '.zb-we-head .zb-we-total { opacity: .55; font-size: 11px; flex: none; }',
    '.zb-we-search { flex: 1; min-width: 0; background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.18);',
      ' border-radius: 5px; color: inherit; font-size: 12px; padding: 4px 8px; outline: none; }',
    '.zb-we-act { cursor: pointer; background: none; border: none; color: inherit; opacity: .6; font-size: 13px; padding: 0 4px; flex: none; }',
    '.zb-we-act:hover { opacity: 1; }',
    // View-mode segmented control: group by wallpaper type, or by the user's
    // own WE browser folders.
    '.zb-we-mode { display: flex; flex: none; border: 1px solid rgba(255,255,255,.2); border-radius: 5px; overflow: hidden; }',
    '.zb-we-mode button { background: none; border: none; color: inherit; font-size: 11px; padding: 3px 9px; cursor: pointer; opacity: .55; }',
    '.zb-we-mode button:hover { opacity: .9; }',
    '.zb-we-mode button[data-on="1"] { background: rgba(122,162,247,.4); opacity: 1; }',
    // Folder-mode file-browser look: folder cards in the root view and a
    // back row above a folder's wallpaper grid.
    '.zb-we-fcard { border: 1px solid rgba(255,255,255,.14); border-radius: 8px; overflow: hidden; cursor: pointer;',
      ' background: rgba(255,255,255,.04); padding: 14px 8px 10px; text-align: center; }',
    '.zb-we-fcard:hover { border-color: rgba(122,162,247,.7); background: rgba(255,255,255,.08); }',
    '.zb-we-fcard .zb-we-fico { font-size: 36px; line-height: 1; filter: saturate(1.3); }',
    '.zb-we-fcard .zb-we-fname { font-size: 12px; margin-top: 7px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.zb-we-fcard .zb-we-fcount { font-size: 10px; opacity: .5; margin-top: 2px; }',
    '.zb-we-fcard[hidden] { display: none; }',
    '.zb-we-back { display: flex; align-items: center; gap: 6px; width: 100%; box-sizing: border-box; padding: 5px 8px;',
      ' margin-bottom: 4px; border-radius: 6px; cursor: pointer; font-size: 11px; background: rgba(255,255,255,.06);',
      ' border: 1px solid rgba(255,255,255,.12); color: inherit; }',
    '.zb-we-back:hover { background: rgba(255,255,255,.12); }',
    // Natural-aspect preview: width fixed, height follows the image. The
    // position is recomputed on load (an unsized <img> measures 0px tall,
    // so the initial clamp cannot know the real height) and again clamped
    // to the viewport — hovering the last row must stay fully on screen.
    '.zb-we-hover { position: fixed; z-index: 2147483647; width: 320px; max-height: 78vh;',
      ' border-radius: 8px; overflow: hidden;',
      ' border: 1px solid rgba(255,255,255,.18); box-shadow: 0 8px 28px rgba(0,0,0,.55); background: #000;',
      ' pointer-events: none; }',
    '.zb-we-hover img, .zb-we-hover video { display: block; width: 100%; max-height: 78vh; object-fit: contain; }',
    '.zb-we-list { max-height: 430px; overflow-y: auto; overscroll-behavior: contain; margin-right: -4px; padding-right: 4px; }',
    '.zb-we-group { padding: 6px 4px 4px; font-size: 11px; opacity: .6; }',
    '.zb-we-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }',
    '.zb-we-card { position: relative; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; overflow: hidden;',
      ' cursor: pointer; background: rgba(255,255,255,.04); }',
    '.zb-we-card:hover { border-color: rgba(122,162,247,.7); background: rgba(255,255,255,.08); }',
    '.zb-we-card[data-sel="1"] { border-color: #7aa2f7; background: rgba(122,162,247,.16); }',
    '.zb-we-card[data-off="1"] { opacity: .45; cursor: default; }',
    '.zb-we-card img { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; background: #000; }',
    '.zb-we-ph { width: 100%; aspect-ratio: 16 / 9; display: flex; align-items: center; justify-content: center;',
      ' font-size: 12px; opacity: .5; background: rgba(255,255,255,.06); }',
    '.zb-we-name { font-size: 12px; line-height: 1.35; padding: 5px 6px 6px; display: -webkit-box;',
      ' -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }',
    '.zb-we-tick { position: absolute; top: 6px; right: 6px; width: 18px; height: 18px; border-radius: 50%;',
      ' background: #7aa2f7; color: #0d0d14; font-size: 12px; font-weight: 700; line-height: 18px; text-align: center; display: none; }',
    '.zb-we-card[data-sel="1"] .zb-we-tick { display: block; }',
    '.zb-we-done { position: absolute; top: 6px; left: 6px; font-size: 10px; padding: 1px 6px; border-radius: 4px;',
      ' background: rgba(74,222,128,.9); color: #0d0d14; }',
    '.zb-we-tag { position: absolute; bottom: 6px; right: 6px; font-size: 10px; padding: 1px 5px; border-radius: 4px;',
      ' background: rgba(0,0,0,.55); border: 1px solid rgba(255,255,255,.25); }',
    '.zb-we-foot { display: flex; align-items: center; gap: 8px; padding-top: 8px; font-size: 12px; }',
    '.zb-we-selinfo { flex: 1; opacity: .75; }',
    '.zb-we-foot .zb-btn { font-size: 12px; padding: 4px 12px; }',
    '.zb-we-foot .zb-btn[disabled] { opacity: .45; cursor: default; }',
    '.zb-we-card[hidden] { display: none; }',
    '.zb-we-empty { padding: 18px 10px; font-size: 12px; opacity: .7; line-height: 1.7; text-align: center; }',
    '.zb-item { display: flex; align-items: center; gap: 4px; padding: 3px 6px; border-radius: 6px; }',
    '.zb-item:hover { background: rgba(255,255,255,.1); }',
    '.zb-item[data-current="1"] { background: rgba(122,162,247,.25); }',
    '.zb-item .zb-item-img { width: 44px; height: 25px; object-fit: cover; border-radius: 3px; flex: none; background: #000; }',
    '.zb-item .zb-label { flex: 1; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.zb-item .zb-label-input { flex: 1; min-width: 0; padding: 1px 4px; border-radius: 4px; border: 1px solid rgba(122,162,247,.6);',
      ' background: rgba(0,0,0,.35); color: inherit; font-size: 11px; outline: none; }',
    '.zb-item .zb-act { cursor: pointer; opacity: .5; padding: 0 3px; font-size: 11px; background: none; border: none; color: inherit; }',
    // Display card sections: one card hosts 画面/界面/聊天界面/昼夜护眼
    // groups — a hairline-separated mini header each, sliders paired in a
    // two-column grid so the merged card stays compact.
    '.zb-sec { display: flex; align-items: center; justify-content: space-between; gap: 8px;',
      ' padding: 5px 2px 2px; margin-top: 4px; border-top: 1px solid rgba(255,255,255,.08);',
      ' font-size: 10px; opacity: .55; letter-spacing: 2px; }',
    '.zb-collapse-inner > .zb-sec:first-child { border-top: none; margin-top: 0; padding-top: 2px; }',
    '.zb-sec .zb-sec-on { display: flex; align-items: center; gap: 4px; font-size: 10px;',
      ' letter-spacing: normal; opacity: 1; cursor: pointer; white-space: nowrap; }',
    '.zb-g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; }',
    '.zb-item .zb-act:hover { opacity: 1; }',
    '.zb-item .zb-act[data-armed="1"] { opacity: 1; color: #f87171; }',
    '#zb-offline { display: flex; flex-direction: column; gap: 6px; align-items: center;',
      ' padding: 10px 12px; background: rgba(120,53,15,.55); font-size: 11px; line-height: 1.5; text-align: center; }',
    '#zb-offline[hidden] { display: none; }',
    '#zb-offline code { background: rgba(0,0,0,.35); padding: 1px 4px; border-radius: 4px;',
      ' font-size: 10px; user-select: text; }',
    '#zb-offline .zb-hint { opacity: .85; }',
    // While offline the controls hold nothing we could read, so they must not
    // look interactive — a slider parked mid-track next to a "0px" label reads
    // as a real (wrong) setting.
    '#zcode-beautify-panel-root[data-offline="1"] #zb-body { opacity: .45; pointer-events: none; }',
    '#zcode-beautify-panel-root[data-offline="1"] #zb-status { display: none; }',
    '#zcode-beautify-panel-root[data-offline="1"] #zb-fab { border-color: rgba(248,113,113,.7); }'
  ].join('');

  var style = document.createElement('style');
  style.id = 'zcode-beautify-panel-style';
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  var root = document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML =
    '<div id="zb-fab" title="ZCode Beautify">🎨</div>' +
    '<div id="zb-panel" hidden>' +
    '  <div id="zb-head"><span>ZCode Beautify</span></div>' +
    '  <div id="zb-offline" hidden>' +
    '    <div>⚠ 美化服务未运行,面板不可用</div>' +
    '    <div class="zb-hint">在插件目录执行 <code>node dist/cli.js serve --detach</code> 启动</div>' +
    '    <button class="zb-btn" id="zb-retry">重试连接</button>' +
    '  </div>' +
    '  <div id="zb-body">' +
    '    <div id="zb-tabs">' +
    '      <button class="zb-tab" data-tab="main">壁纸</button>' +
    '      <button class="zb-tab" data-tab="sched">定时播放</button>' +
    '      <button class="zb-tab" data-tab="settings">设置</button>' +
    '    </div>' +
    '    <div id="zb-tab-main">' +
    '    <div class="zb-card zb-collapsible" id="zb-card-history"><div class="zb-card-title" style="display:flex;justify-content:space-between;align-items:center"><span>最近使用 <button class="zb-act" id="zb-stats" title="壁纸累计展示时长排行">📊</button></span> <span class="zb-fold">▾</span></div>' +
    '      <div class="zb-collapse-wrap"><div class="zb-collapse-inner">' +
    '      <div class="zb-lib-list" id="zb-history" style="max-height:192px"></div>' +
    '      </div></div>' +
    '    </div>' +
    '    <div class="zb-card zb-collapsible" id="zb-card-scenes"><div class="zb-card-title">壁纸库 · 动态 <span class="zb-fold">▾</span></div>' +
    '      <div class="zb-collapse-wrap"><div class="zb-collapse-inner">' +
    '      <div class="zb-import-row">' +
    '        <button class="zb-btn zb-icon-btn" id="zb-pick" title="打开文件选择器(可多选):选 .pkg(场景)或 .mp4(视频),选完自动排队导入">📁</button>' +
    '        <button class="zb-btn zb-icon-btn" id="zb-we-lib" title="浏览本机 Wallpaper Engine 壁纸库(创意工坊/自建项目),点击即可导入">🧩</button>' +
    '        <input type="text" id="zb-scene-path" placeholder="粘贴 .pkg/.mp4/目录路径,回车导入" spellcheck="false">' +
    '        <button class="zb-btn" id="zb-import" title="渲染并录制场景壁纸,生成无缝循环动态背景">导入</button>' +
    '      </div>' +
    '      <div id="zb-progress" hidden><div id="zb-progress-bar"></div><span>…</span></div>' +
    '      <div id="zb-guide" hidden></div>' +
    '      <div class="zb-actions" style="margin-top:6px"><button class="zb-btn" id="zb-guide-retry" hidden>已安装,重试</button></div>' +
    '      <div class="zb-lib-list" id="zb-lib-scenes"></div>' +
    '      <div class="zb-lib-head" id="zb-storage" style="display:flex;align-items:center;gap:6px;margin-top:4px">' +
    '        <span id="zb-storage-text" style="flex:1">…</span>' +
    '        <button class="zb-act" id="zb-open-scenes" title="在资源管理器中打开动态壁纸缓存目录">📂</button>' +
    '        <button class="zb-act" id="zb-compress" title="省电压缩:把动态壁纸循环重编码为 720p/24fps,显著降低 GPU 解码占用与体积(使用中的跳过,可重新导入恢复原画质)">⚡ 压缩</button>' +
    '        <button class="zb-act" id="zb-purge" title="删除全部已缓存的动态壁纸循环(正在使用的除外)">🗑 清理</button>' +
    '      </div>' +
    '      </div></div>' +
    '    </div>' +
    '    <div class="zb-card zb-collapsible" id="zb-card-images"><div class="zb-card-title">壁纸库 · 图片 <span class="zb-fold">▾</span></div>' +
    '      <div class="zb-collapse-wrap"><div class="zb-collapse-inner">' +
    '      <div class="zb-import-row">' +
    '        <label class="zb-btn zb-grow" for="zb-file" title="选择一张图片作为背景壁纸,UI 配色随之更新">🖼 更换图片…</label>' +
    '        <button class="zb-act" id="zb-img-sort" title="切换排序:按时间(新→旧)/按名称">⇅ 时间</button>' +
    '        <button class="zb-act" id="zb-img-batch" title="批量删除:勾选多个条目后一次删除">☰ 批量</button>' +
    '        <button class="zb-act" id="zb-open-images" title="在资源管理器中打开图片壁纸目录">📂</button>' +
    '        <input type="file" id="zb-file" accept="image/*" hidden>' +
    '      </div>' +
    '      <div class="zb-lib-list" id="zb-lib-images"></div>' +
    '      </div></div>' +
    '    </div>' +
    '    </div>' +
    '    <div id="zb-tab-settings" hidden>' +
    '    <div class="zb-card zb-collapsible" id="zb-card-display"><div class="zb-card-title">显示调节 <span class="zb-fold">▾</span></div>' +
    '      <div class="zb-collapse-wrap"><div class="zb-collapse-inner">' +
    '    <div class="zb-sec">画面</div>' +
    '    <div class="zb-g2">' +
    '    <div class="zb-row"><label title="背景模糊程度(像素)"><span>背景模糊</span><span><span id="zb-blur-val">0</span>px</span></label>' +
    '      <input type="range" id="zb-blur" min="0" max="30" step="1" value="0"></div>' +
    '    <div class="zb-row"><label title="背景压暗程度(百分比,越高越暗)"><span>背景压暗</span><span><span id="zb-dim-val">0</span>%</span></label>' +
    '      <input type="range" id="zb-dim" min="0" max="80" step="1" value="0"></div>' +
    '    </div>' +
    '    <div class="zb-sched-mode"><span>填充</span><select id="zb-fit" title="背景填充方式:填满裁剪铺满窗口 / 完整显示不裁剪(模糊垫底)/ 智能适配自动分析画面主体" style="flex:1">' +
    '      <option value="cover">填满裁剪</option>' +
    '      <option value="contain">完整显示</option>' +
    '      <option value="smart">智能适配</option>' +
    '    </select></div>' +
    '    <div class="zb-sec">界面</div>' +
    '    <div class="zb-row zb-toggles">' +
    '      <label title="根据壁纸自动生成 UI 配色;关闭则保留 ZCode 原生颜色"><input type="checkbox" id="zb-monet">UI 莫奈取色</label>' +
    '      <button class="zb-act" id="zb-pin" title="从壁纸主色锁定主题色(取色偏色时手工钉一个)">🎨 锁色</button>' +
    '    </div>' +
    '    <div class="zb-row zb-toggles">' +
    '      <label title="显示或隐藏背景壁纸"><input type="checkbox" id="zb-vis">显示壁纸</label>' +
    '      <label title="图片壁纸缓慢缩放平移(呼吸感);模糊开启时自动停用"><input type="checkbox" id="zb-kb">图片缓动</label>' +
    '    </div>' +
    '    <div class="zb-row"><label title="视频壁纸的音量(0=静音,仅对保留了声音的导入生效)"><span>视频音量</span><span><span id="zb-vol-val">0</span>%</span></label>' +
    '      <input type="range" id="zb-vol" min="0" max="100" step="1" value="0"></div>' +
    '    <div class="zb-sec">聊天界面</div>' +
    '    <div class="zb-g2">' +
    '    <div class="zb-row"><label title="对话列背后的额外压暗,消息文字浮在其上不受影响"><span>聊天区暗度</span><span id="zb-chat-dim-val">0.00</span></label>' +
    '      <input type="range" id="zb-chat-dim" min="0" max="100" step="1" value="0"></div>' +
    '    <div class="zb-row"><label title="窗口顶部向下渐隐遮罩的浓度"><span>遮罩上端</span><span id="zb-chat-top-val">0.00</span></label>' +
    '      <input type="range" id="zb-chat-top" min="0" max="100" step="1" value="0"></div>' +
    '    <div class="zb-row"><label title="窗口底部向上渐隐遮罩的浓度(输入框附近)"><span>遮罩下端</span><span id="zb-chat-bot-val">0.00</span></label>' +
    '      <input type="range" id="zb-chat-bot" min="0" max="100" step="1" value="0"></div>' +
    '    <div class="zb-row"><label title="整窗白色薄纱浓度,暗色壁纸下提升文字可读性"><span>大容器偏白</span><span id="zb-chat-frost-val">0.00</span></label>' +
    '      <input type="range" id="zb-chat-frost" min="0" max="100" step="1" value="0"></div>' +
    '    </div>' +
    '    <div class="zb-sec">昼夜护眼 <label title="按时间段自动切换两套显示参数" class="zb-sec-on"><input type="checkbox" id="zb-dn-on">按时段自动调暗</label></div>' +
    '      <div class="zb-sched-mode"><span>白天</span><input type="time" id="zb-dn-start" style="flex:1">' +
    '        <span style="opacity:.5">至</span><input type="time" id="zb-dn-end" style="flex:1"></div>' +
    '      <div class="zb-sched-mode"><span>白天压暗</span><input type="number" id="zb-dn-daydim" min="0" max="80" style="width:48px">%' +
    '        <span>模糊</span><input type="number" id="zb-dn-dayblur" min="0" max="30" style="width:44px">px</div>' +
    '      <div class="zb-sched-mode"><span>夜间压暗</span><input type="number" id="zb-dn-nightdim" min="0" max="80" style="width:48px">%' +
    '        <span>模糊</span><input type="number" id="zb-dn-nightblur" min="0" max="30" style="width:44px">px</div>' +
    '      </div></div>' +
    '    </div>' +
    '    <div class="zb-card" id="zb-card-config"><div class="zb-card-title">配置</div>' +
    '      <div class="zb-actions zb-cfg-row">' +
    '        <button class="zb-btn" id="zb-reset" title="移除壁纸与配色,还原 ZCode 默认外观(壁纸会被记住,可再次恢复)">还原外观</button>' +
    '        <button class="zb-btn" id="zb-cfg-export" title="导出当前壁纸/外观/播放方案为 JSON 文件">⬇ 导出</button>' +
    '        <button class="zb-btn" id="zb-cfg-import" title="从导出的 JSON 文件恢复配置">⬆ 导入</button>' +
    '        <input type="file" id="zb-cfg-file" accept="application/json,.json" hidden>' +
    '      </div>' +
    '      <div class="zb-sched-mode" style="margin:6px 0 0"><label title="ZCode 启动屏(加载页)期间不显示壁纸与美化面板,主界面就绪后再出现"><input type="checkbox" id="zb-startup-clean">启动屏时隐藏壁纸与面板</label></div>' +
    '      <div class="zb-sched-mode" style="margin-top:4px"><label title="ZCode 下载/安装更新的进度窗口默认不显示壁纸;勾选后更新窗口显示壁纸(仅壁纸,不显示美化面板)"><input type="checkbox" id="zb-updater-wp">ZCode 更新界面显示壁纸</label></div>' +
    '      <div class="zb-sched-mode" style="margin-top:4px"><label title="悬停 WE 库中的视频壁纸时直接播放其真实画面(而非封面图);场景壁纸仍显示封面"><input type="checkbox" id="zb-we-live">WE 预览播放真实视频</label></div>' +
'      <div class="zb-sched-mode" style="margin-top:4px"><span title="壁纸库·动态列表一次最多可见的行数(其余滚动查看)">动态库</span>' +
    '        <input type="number" id="zb-rows-scenes" min="3" max="20" step="1" style="width:44px" title="动态壁纸列表最多显示行数">' +
    '        <span title="壁纸库·图片列表一次最多可见的行数(其余滚动查看)">图片库</span>' +
    '        <input type="number" id="zb-rows-images" min="3" max="20" step="1" style="width:44px" title="图片壁纸列表最多显示行数">行</div>' +
'      <div class="zb-sched-mode" style="margin-top:4px"><span title="场景壁纸录制输出的分辨率;默认=壁纸项目自带尺寸">录制分辨率</span>' +
    '        <select id="zb-import-res" style="flex:1"><option value="auto">默认(跟随壁纸)</option><option value="1920x1080">1920×1080</option><option value="1280x720">1280×720(省电)</option><option value="custom">自定义…</option></select>' +
    '        <input type="number" id="zb-res-w" min="256" max="3840" step="2" style="width:52px" hidden>' +
    '        <input type="number" id="zb-res-h" min="144" max="2160" step="2" style="width:52px" hidden></div>' +
    '    </div>' +
    '    </div>' +
    '    <div id="zb-tab-sched" hidden>' +
    '    <div class="zb-card"><div class="zb-card-title" style="display:flex;justify-content:space-between;align-items:center">轮播状态 <span id="zb-rot-state" style="opacity:.7;font-weight:400">…</span></div>' +
    '    </div>' +
    '    <div class="zb-card"><div class="zb-card-title">方案</div>' +
    '      <div class="zb-sched-head" style="margin-bottom:6px"><span>当前</span>' +
    '        <label title="启用后按所选模式自动切换壁纸"><input type="checkbox" id="zb-sched-on">启用</label></div>' +
    '      <div class="zb-sched-plan"><select id="zb-plan" title="播放方案"></select>' +
    '        <button class="zb-act" id="zb-plan-add" title="新建播放方案">➕</button>' +
    '        <button class="zb-act" id="zb-plan-ren" title="重命名当前方案">✎</button>' +
    '        <button class="zb-act" id="zb-plan-del" title="删除当前方案">🗑</button>' +
    '      </div>' +
    '    </div>' +
    '    <div class="zb-card"><div class="zb-card-title">播放设置</div>' +
    '      <div class="zb-sched-mode"><span>模式</span><select id="zb-sched-mode">' +
    '        <option value="sequence">顺序轮播</option>' +
    '        <option value="random">随机轮播</option>' +
    '        <option value="schedule">定时切换</option>' +
    '      </select></div>' +
    '      <div class="zb-sched-mode"><span>特效</span><select id="zb-fx" title="本方案播放时的壁纸切换特效">' +
    '        <option value="fade">交叉淡入</option>' +
    '        <option value="slide">右侧滑入</option>' +
    '        <option value="zoom">缩放浮现</option>' +
    '        <option value="blur">模糊渐清</option>' +
    '        <option value="none">直接切换</option>' +
    '      </select></div>' +
    '      <div class="zb-sched-mode" title="方案生效时段:留空 = 全天生效;跨夜(如 20:00-06:00)支持"><span>时段</span>' +
    '        <input type="time" id="zb-win-start" style="flex:1" step="60">' +
    '        <span style="opacity:.5">至</span>' +
    '        <input type="time" id="zb-win-end" style="flex:1" step="60">' +
    '        <button class="zb-act" id="zb-win-clear" title="清除时段(全天生效)">✕</button>' +
    '      </div>' +
    '    </div>' +
    '    <div class="zb-card"><div class="zb-card-title">播放列表</div>' +
    '      <div id="zb-sched-list"></div>' +
    '      <div class="zb-actions">' +
    '        <button class="zb-btn" id="zb-sched-add" title="添加一条:选择壁纸并设定时长或时间点">➕ 添加</button>' +
    '        <button class="zb-btn" id="zb-sched-save" title="保存全部方案(不改变启用状态)">💾 保存</button>' +
    '        <button class="zb-btn" id="zb-sched-play" title="保存并立即启用当前方案开始播放">▶ 播放</button>' +
    '        <button class="zb-btn" id="zb-sched-next" title="跳过当前时长,立即切换到下一张壁纸">⏭ 立即切换</button>' +
    '      </div>' +
    '      <div class="zb-lib-head" id="zb-sched-hint" style="margin:4px 0 0"></div>' +
    '    </div>' +
    '    </div>' +
    '  </div>' +
    '</div>' +
    '<div id="zb-hover-preview" hidden><video muted autoplay loop playsinline></video><img alt=""></div>' +
    '<div id="zb-status"></div>';
  document.body.appendChild(root);

  function $(id) { return document.getElementById(id); }
  function wallpaperEl() { return document.getElementById('zcode-beautify-wallpaper'); }
  function status(msg) {
    var el = $('zb-status'); if (!el) return;
    el.textContent = msg;
    setTimeout(function () { if (el.textContent === msg) el.textContent = ''; }, 2200);
  }
  function post(path, body, cb) {
    apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (cb) cb(d); })
      .catch(function () {
        status('无法连接美化服务 service unreachable');
        // Callers count completions inside cb (batch delete); an unreachable
        // request must still drain the counter or the UI sticks mid-action.
        if (cb) cb(undefined);
      });
  }

  // --- hover peek: resting the cursor on a wallpaper thumbnail (library rows,
  // picker popup items, picker buttons) opens a bigger preview to the LEFT of
  // the panel. The 260ms delay keeps a cursor merely sweeping past quiet.
  var ZB_HOVER_SEL = '.zb-item .zb-item-img, .zb-wp-item img, .zb-wp-btn img';
  var zbHoverTimer = null;
  var zbHvPending = 0;
  function hideHoverPreview() {
    zbHvPending++;
    if (zbHoverTimer) { clearTimeout(zbHoverTimer); zbHoverTimer = null; }
    var box = $('zb-hover-preview');
    if (box) {
      box.hidden = true;
      var v = box.querySelector('video');
      if (v) { v.pause(); }
    }
  }
  function zbHvReveal(box, thumb) {
    box.hidden = false;
    var r = thumb.getBoundingClientRect();
    box.style.left = 'auto';
    box.style.right = '296px'; // panel column (264+18) plus breathing room
    var top = r.top + r.height / 2 - box.offsetHeight / 2;
    if (top < 8) top = 8;
    if (top + box.offsetHeight > window.innerHeight - 8) top = window.innerHeight - box.offsetHeight - 8;
    box.style.top = Math.round(top) + 'px';
  }
  function showHoverPreview(thumb) {
    var box = $('zb-hover-preview');
    if (!box) return;
    // Scene wallpapers get a LIVE preview: the loop video streams from serve,
    // so hovering plays the actual wallpaper instead of an enlarged poster.
    // Everything else (image library, playlists without a row key) keeps the
    // enlarged image. Swapping src while visible showed the PREVIOUS item
    // until the new one decoded (the flicker) — content is swapped while
    // hidden and the box revealed only when the new medium is ready; a
    // same-src re-hover reveals immediately.
    var item = thumb.closest('.zb-item');
    var key = item ? (item.getAttribute('data-key') || '') : '';
    var isScene = /^[a-f0-9]{32}$/.test(key);
    var vid = box.querySelector('video');
    var img = box.querySelector('img');
    zbHvPending++;
    var myTicket = zbHvPending;
    var reveal = function () {
      if (myTicket !== zbHvPending) return; // a newer hover superseded us
      vid.classList.toggle('zb-hv-off', !isScene);
      img.classList.toggle('zb-hv-off', isScene);
      if (isScene) vid.play().catch(function () {});
      zbHvReveal(box, thumb);
    };
    if (isScene) {
      var src = mt(API + '/media/scene/' + key + '.mp4');
      var vReady = function () { vid.removeEventListener('loadeddata', vReady); reveal(); };
      if (vid.getAttribute('src') === src && vid.readyState >= 2) { reveal(); return; }
      box.hidden = true; // old content must not flash while the new loads
      vid.pause();
      vid.src = src;
      vid.addEventListener('loadeddata', vReady);
      setTimeout(function () { if (myTicket === zbHvPending && box.hidden) reveal(); }, 1200);
    } else {
      var iSrc = thumb.getAttribute('src') || thumb.src;
      if (img.getAttribute('src') === iSrc && img.complete && img.naturalWidth > 0) { reveal(); return; }
      box.hidden = true;
      vid.pause();
      vid.removeAttribute('src');
      img.onload = function () { img.onload = null; reveal(); };
      img.onerror = function () { img.onerror = null; reveal(); };
      img.src = iSrc;
      setTimeout(function () { if (myTicket === zbHvPending && box.hidden) reveal(); }, 1200);
    }
  }
  var zbHvOver = function (e) {
    if (zbHvGen !== window.__zbHvGen) { document.removeEventListener('mouseover', zbHvOver); return; }
    var t = e.target;
    if (!t || !t.closest) return;
    var thumb = t.closest(ZB_HOVER_SEL);
    if (!thumb || thumb.tagName !== 'IMG') return;
    if (zbHoverTimer) clearTimeout(zbHoverTimer);
    zbHoverTimer = setTimeout(function () { zbHoverTimer = null; showHoverPreview(thumb); }, 260);
  };
  document.addEventListener('mouseover', zbHvOver);
  var zbHvOut = function (e) {
    if (zbHvGen !== window.__zbHvGen) { document.removeEventListener('mouseout', zbHvOut); return; }
    var t = e.target;
    if (!t || !t.closest) return;
    var thumb = t.closest(ZB_HOVER_SEL);
    if (!thumb) return;
    if (e.relatedTarget && thumb.contains(e.relatedTarget)) return;
    hideHoverPreview();
  };
  document.addEventListener('mouseout', zbHvOut);
  window.addEventListener('scroll', hideHoverPreview, true);

  // Local live preview; the server re-injects the authoritative CSS right after.
  function preview() {
    var w = wallpaperEl(); if (!w) return;
    var b = Number($('zb-blur').value), d = Number($('zb-dim').value);
    w.style.filter = b > 0 ? 'blur(' + b + 'px)' : 'none';
    w.style.transform = b > 0 ? 'scale(1.04)' : 'none';
    document.documentElement.style.setProperty('--zcode-beautify-dim', String(d / 100));
  }

  var pushTimer = null;
  function pushConfig() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      post('/api/config', {
        blur: Number($('zb-blur').value),
        dim: Number($('zb-dim').value),
        monet: $('zb-monet').checked,
        wallpaperVisible: $('zb-vis').checked,
        kenBurns: $('zb-kb').checked,
        startupClean: (document.getElementById('zb-startup-clean') || {}).checked !== false,
        showOnUpdater: (document.getElementById('zb-updater-wp') || {}).checked === true,
        videoVolume: Number($('zb-vol').value)
      }, function (d) { status(d && d.windows > 0 ? '已应用 applied' : '已保存(ZCode 未连接)'); });
    }, 300);
  }

  // The control service lives in a separate process that can stop or die. When
  // it is unreachable the panel must say so instead of rendering values it
  // never read, and it must recover on its own once the service is back.
  var beatTimer = null;
  function panelOpen() { return !$('zb-panel').hidden; }
  /** Re-check the service: while the panel is open, and always while offline. */
  function beat(on) {
    if (on && !beatTimer) beatTimer = zbEvery(refresh, 4000);
    if (!on && beatTimer) { clearInterval(beatTimer); beatTimer = null; }
  }

  function setOffline(on) {
    root.setAttribute('data-offline', on ? '1' : '0');
    $('zb-offline').hidden = !on;
    $('zb-retry').textContent = '重试连接';
    $('zb-fab').title = on ? 'ZCode Beautify — 美化服务未运行' : 'ZCode Beautify';
    if (on) {
      $('zb-blur').value = 0; $('zb-blur-val').textContent = '0';
      $('zb-dim').value = 0; $('zb-dim-val').textContent = '0';
      setChatSliders(0, 0, 0, 0);
      $('zb-monet').checked = false;
      $('zb-vis').checked = false;
      $('zb-fit').value = 'cover';
      $('zb-reset').textContent = '还原外观';
      $('zb-reset').setAttribute('data-mode', 'reset');
      beat(true);
    } else {
      if (!panelOpen()) beat(false);
    }
  }

  // Last /api/config seen by refresh(); the add-button uses it to preselect
  // the currently applied wallpaper in a new rotation row.
  var lastConfig = null;
  function currentWallpaperKey() {
    if (lastConfig) {
      if (lastConfig.mediaType === 'video' && lastConfig.sceneHash) return 'h:' + lastConfig.sceneHash;
      if (lastConfig.wallpaperPath) return 'p:' + lastConfig.wallpaperPath;
      return '';
    }
    try { return localStorage.getItem('zcode-beautify:current-key') || ''; } catch (e) { return ''; }
  }

  function refresh() {
    apiFetch('/api/config')
      .then(function (r) { return r.json(); })
      .then(function (c) {
        setOffline(false);
        lastConfig = c;
        $('zb-blur').value = c.blur; $('zb-blur-val').textContent = c.blur;
        $('zb-dim').value = c.dim; $('zb-dim-val').textContent = c.dim;
        $('zb-monet').checked = !!c.monet;
        $('zb-vis').checked = !!c.wallpaperVisible;
        $('zb-kb').checked = !!c.kenBurns;
        $('zb-vol').value = c.videoVolume ?? 0;
        $('zb-vol-val').textContent = String(c.videoVolume ?? 0);
        $('zb-pin').textContent = c.themeColor ? '🎨 已锁' : '🎨 锁色';
        $('zb-pin').style.color = c.themeColor ? (c.themeColor) : '';
        var dn = c.dayNight;
        $('zb-dn-on').checked = !!(dn && dn.enabled);
        if (dn) {
          $('zb-dn-start').value = dn.start; $('zb-dn-end').value = dn.end;
          $('zb-dn-daydim').value = dn.dayDim; $('zb-dn-nightdim').value = dn.nightDim;
          $('zb-dn-dayblur').value = dn.dayBlur; $('zb-dn-nightblur').value = dn.nightBlur;
        }
        var cl = c.chatLook || {};
        setChatSliders(cl.chatDim ?? 0, cl.maskTop ?? 0, cl.maskBottom ?? 0, cl.frost ?? 0);
        $('zb-fit') && applyFitLabel($('zb-fit'), c.fit || 'cover');
        var sc = document.getElementById('zb-startup-clean');
        if (sc) sc.checked = c.startupClean !== false;
        var uw = document.getElementById('zb-updater-wp');
        if (uw) uw.checked = c.showOnUpdater === true;
        var resetBtn = $('zb-reset');
        if (c.wallpaperSet) {
          resetBtn.textContent = '还原外观';
          resetBtn.setAttribute('data-mode', 'reset');
          resetBtn.title = '移除壁纸与配色,还原 ZCode 默认外观(壁纸会被记住,可再次恢复)';
        } else if (c.hasBackup) {
          resetBtn.textContent = '恢复壁纸';
          resetBtn.setAttribute('data-mode', 'restore');
          resetBtn.title = '从备份恢复你之前的壁纸与配色';
        } else {
          resetBtn.textContent = '还原外观';
          resetBtn.setAttribute('data-mode', 'reset');
          resetBtn.title = '当前已是默认外观';
        }
      })
      .catch(function () { setOffline(true); });
  }

  $('zb-blur').addEventListener('input', function () {
    $('zb-blur-val').textContent = this.value; preview(); pushConfig();
  });
  $('zb-dim').addEventListener('input', function () {
    $('zb-dim-val').textContent = this.value; preview(); pushConfig();
  });
  $('zb-monet').addEventListener('change', pushConfig);
  $('zb-vis').addEventListener('change', pushConfig);
  $('zb-kb').addEventListener('change', pushConfig);
  $('zb-vol').addEventListener('input', function () {
    $('zb-vol-val').textContent = this.value;
    pushConfig();
  });

  // --- day/night look schedule (护眼) --------------------------------------
  function pushDayNight() {
    var dn = {
      enabled: $('zb-dn-on').checked,
      start: $('zb-dn-start').value || '06:00',
      end: $('zb-dn-end').value || '18:00',
      dayDim: Number($('zb-dn-daydim').value) || 20,
      nightDim: Number($('zb-dn-nightdim').value) || 55,
      dayBlur: Number($('zb-dn-dayblur').value) || 0,
      nightBlur: Number($('zb-dn-nightblur').value) || 6
    };
    post('/api/config', { dayNight: dn }, function (d) { if (d && d.error) status(d.error); });
  }
  // Import resolution (录制分辨率): persisted in localStorage, sent with
  // every import POST; "auto" lets serve follow the wallpaper project size.
  var zbResSel = document.getElementById('zb-import-res');
  var zbResW = document.getElementById('zb-res-w');
  var zbResH = document.getElementById('zb-res-h');
  function resCustomVisible() {
    var on = zbResSel.value === 'custom';
    zbResW.hidden = !on; zbResH.hidden = !on;
  }
  function resPayload() {
    var mode = zbResSel.value;
    var p = { mode: mode };
    if (mode === 'custom') {
      p.width = Math.max(256, Math.min(3840, Number(zbResW.value) || 1920));
      p.height = Math.max(144, Math.min(2160, Number(zbResH.value) || 1080));
    }
    return p;
  }
  function resPersist() {
    try { localStorage.setItem('zcode-beautify:import-res', JSON.stringify(resPayload())); } catch (e) {}
  }
  if (zbResSel) {
    try {
      var savedRes = JSON.parse(localStorage.getItem('zcode-beautify:import-res') || 'null');
      if (savedRes && savedRes.mode) {
        zbResSel.value = savedRes.mode === 'custom' || /^\d+x\d+$/.test(savedRes.mode) ? savedRes.mode : 'auto';
        if (savedRes.width) zbResW.value = savedRes.width;
        if (savedRes.height) zbResH.value = savedRes.height;
      }
    } catch (e) {}
    resCustomVisible();
    zbResSel.addEventListener('change', function () { resCustomVisible(); resPersist(); });
    zbResW.addEventListener('change', resPersist);
    zbResH.addEventListener('change', resPersist);
  }
  var zbWeLive = document.getElementById('zb-we-live');
  if (zbWeLive) {
    try { zbWeLive.checked = localStorage.getItem('zcode-beautify:we-live') !== '0'; } catch (e) {}
    zbWeLive.addEventListener('change', function () {
      try { localStorage.setItem('zcode-beautify:we-live', this.checked ? '1' : '0'); } catch (e) {}
    });
  }
  var zbScEl = document.getElementById('zb-startup-clean');
  if (zbScEl) zbScEl.addEventListener('change', pushConfig);
  var zbUwEl = document.getElementById('zb-updater-wp');
  if (zbUwEl) zbUwEl.addEventListener('change', pushConfig);
  // Per-library visible row counts (设置 → 配置): stored in localStorage —
  // pure panel preference, no serve round-trip needed.
  // Hover delegation is DOCUMENT-level and cannot be swept like intervals —
  // handlers from previous panel generations keep firing after a serve
  // restart re-evaluates this script. Each generation mints a token; stale
  // handlers see a foreign token, unbind themselves and step aside.
  var zbHvGen = (window.__zbHvGen = (window.__zbHvGen || 0) + 1);
  var zbRowH = 32;
  var libRows = { scenes: 3, images: 3 };
  try {
    var savedRows = JSON.parse(localStorage.getItem('zcode-beautify:lib-rows') || 'null');
    if (savedRows && typeof savedRows === 'object') {
      if (savedRows.scenes >= 3 && savedRows.scenes <= 20) libRows.scenes = savedRows.scenes;
      if (savedRows.images >= 3 && savedRows.images <= 20) libRows.images = savedRows.images;
    }
  } catch (e) {}
  function applyLibRows() {
    var targets = [['zb-lib-scenes', libRows.scenes], ['zb-lib-images', libRows.images]];
    for (var i = 0; i < targets.length; i++) {
      var el = document.getElementById(targets[i][0]);
      if (!el) continue;
      var first = el.querySelector('.zb-item');
      var h = first ? first.offsetHeight : 0;
      // A hidden pane measures 0 — keep the last REAL measurement so
      // changing rows from the settings tab stays pixel-accurate.
      if (h > 5) zbRowH = h;
      var rowH = zbRowH;
      el.style.maxHeight = rowH * targets[i][1] + 'px';
    }
    var a = document.getElementById('zb-rows-scenes');
    var b = document.getElementById('zb-rows-images');
    if (a) a.value = libRows.scenes;
    if (b) b.value = libRows.images;
  }
  ['zb-rows-scenes', 'zb-rows-images'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', function () {
      var v = Math.max(3, Math.min(20, Math.round(Number(this.value) || 3)));
      this.value = v;
      if (this.id === 'zb-rows-scenes') libRows.scenes = v; else libRows.images = v;
      try { localStorage.setItem('zcode-beautify:lib-rows', JSON.stringify(libRows)); } catch (e) {}
      applyLibRows();
    });
  });
  ['zb-dn-on', 'zb-dn-start', 'zb-dn-end', 'zb-dn-daydim', 'zb-dn-nightdim', 'zb-dn-dayblur', 'zb-dn-nightblur'].forEach(function (id) {
    $(id).addEventListener('change', pushDayNight);
  });

  // --- chat-area zone look (聊天界面) ----------------------------------------
  function setChatSliders(d, mu, mb, f) {
    $('zb-chat-dim').value = d; $('zb-chat-dim-val').textContent = (d / 100).toFixed(2);
    $('zb-chat-top').value = mu; $('zb-chat-top-val').textContent = (mu / 100).toFixed(2);
    $('zb-chat-bot').value = mb; $('zb-chat-bot-val').textContent = (mb / 100).toFixed(2);
    $('zb-chat-frost').value = f; $('zb-chat-frost-val').textContent = (f / 100).toFixed(2);
    // Reflecting SERVER state: drop the drag-preview inline vars so the
    // injected :root block (the authoritative values) rules again — inline
    // vars outrank the stylesheet and would otherwise pin stale previews.
    var rs = document.documentElement.style;
    rs.removeProperty('--zb-chat-dim');
    rs.removeProperty('--zb-mask-top');
    rs.removeProperty('--zb-mask-bot');
    rs.removeProperty('--zb-frost');
  }
  // Live preview via the same CSS vars the injected style consumes — inline
  // vars outrank the :root block, so drags feel instant; the server push
  // re-applies the authoritative values right after.
  function chatPreview(d, mu, mb, f) {
    var rs = document.documentElement.style;
    rs.setProperty('--zb-chat-dim', String(d / 100));
    rs.setProperty('--zb-mask-top', String(mu / 100));
    rs.setProperty('--zb-mask-bot', String(mb / 100));
    rs.setProperty('--zb-frost', String(f / 100));
  }
  var chatPushTimer = null;
  function pushChatLook() {
    clearTimeout(chatPushTimer);
    chatPushTimer = setTimeout(function () {
      post('/api/config', {
        chatLook: {
          chatDim: Number($('zb-chat-dim').value),
          maskTop: Number($('zb-chat-top').value),
          maskBottom: Number($('zb-chat-bot').value),
          frost: Number($('zb-chat-frost').value)
        }
      }, function (d) { if (d && d.error) status(d.error); });
    }, 300);
  }
  [['zb-chat-dim', 'zb-chat-dim-val'], ['zb-chat-top', 'zb-chat-top-val'], ['zb-chat-bot', 'zb-chat-bot-val'], ['zb-chat-frost', 'zb-chat-frost-val']].forEach(function (pair) {
    $(pair[0]).addEventListener('input', function () {
      var v = Number(this.value);
      $(pair[1]).textContent = (v / 100).toFixed(2);
      chatPreview(Number($('zb-chat-dim').value), Number($('zb-chat-top').value), Number($('zb-chat-bot').value), Number($('zb-chat-frost').value));
      pushChatLook();
    });
  });

  // --- pinned theme color (🎨) ---------------------------------------------
  $('zb-pin').addEventListener('click', function () {
    apiFetch('/api/palette')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var existing = document.querySelector('body > .zb-wp-pop');
        if (existing) { existing.remove(); return; }
        var pop = document.createElement('div');
        pop.className = 'zb-wp-pop';
        var colors = (d && d.colors) || [];
        if (d && d.pinned) {
          var auto = document.createElement('div');
          auto.className = 'zb-wp-item';
          auto.textContent = '✕ 解除锁定(恢复自动取色)';
          auto.addEventListener('click', function () {
            post('/api/config', { themeColor: null }, function () { refresh(); pop.remove(); status('已恢复自动取色'); });
          });
          pop.appendChild(auto);
        }
        colors.forEach(function (hex) {
          var it = document.createElement('div');
          it.className = 'zb-wp-item';
          var sw = document.createElement('span');
          sw.style.cssText = 'width:46px;height:26px;border-radius:3px;flex:none;background:' + hex + ';border:1px solid rgba(255,255,255,.2)';
          var name = document.createElement('span');
          name.textContent = hex;
          it.appendChild(sw); it.appendChild(name);
          it.addEventListener('click', function () {
            post('/api/config', { themeColor: hex }, function () { refresh(); pop.remove(); status('已锁定主题色 ' + hex); });
          });
          pop.appendChild(it);
        });
        if (!pop.children.length) pop.textContent = '当前壁纸没有可用色板';
        document.body.appendChild(pop);
      (function () { var wep = document.querySelector('body > .zb-we-pop'); if (wep) document.body.appendChild(wep); })(); // keep the WE window on top (equal z)
        var btn = $('zb-pin').getBoundingClientRect();
        pop.style.left = Math.max(8, Math.min(btn.left, window.innerWidth - 216)) + 'px';
        pop.style.width = '208px';
        pop.style.bottom = 'auto';
        pop.style.top = (btn.bottom + 4) + 'px';
        setTimeout(function () {
          var close = function (e) {
            if (!pop.contains(e.target) && e.target !== $('zb-pin')) { pop.remove(); document.removeEventListener('mousedown', close, true); }
          };
          document.addEventListener('mousedown', close, true);
        }, 0);
      })
      .catch(function () { status('服务未连接'); });
  });

  // --- Alt+B panel shortcut -------------------------------------------------
  document.addEventListener('keydown', function (e) {
    if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      $('zb-fab').click();
    }
  });

  var FITS = ['cover', 'contain', 'smart'];
  var FIT_LABELS = { cover: '填满裁剪', contain: '完整显示', smart: '智能适配' };
  function applyFitLabel(sel, fit) {
    sel.value = FIT_LABELS[fit] ? fit : 'cover';
  }
  $('zb-fit').addEventListener('change', function () {
    var next = this.value;
    post('/api/config', { fit: next }, function (d) { status(d && d.windows > 0 ? '已应用:' + FIT_LABELS[next] : '已保存(ZCode 未连接)'); });
  });

  var FXS = ['fade', 'slide', 'zoom', 'blur', 'none'];
  var FX_LABELS = { fade: '交叉淡入', slide: '右侧滑入', zoom: '缩放浮现', blur: '模糊渐清', none: '直接切换' };
  function applyFxLabel(sel, fx) {
    sel.value = FX_LABELS[fx] ? fx : 'fade';
  }
  // The effect is a per-plan setting; the dropdown edits the plan in the
  // editor and persists immediately (playback is not disturbed — the effect
  // is read from the active plan on every switch).
  $('zb-fx').addEventListener('change', function () {
    var plan = schedPlans[schedIdx];
    if (!plan) return;
    plan.transition = this.value;
    persistPlans();
  });

  $('zb-file').addEventListener('change', function () {
    var f = this.files && this.files[0];
    this.value = '';
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { status('图片过大,上限 20 MB'); return; }
    var fr = new FileReader();
    fr.onload = function () {
      post('/api/wallpaper', { dataUri: fr.result, name: f.name }, function (d) {
        if (d && d.error) { status(d.error); return; }
        status('已添加并应用:' + f.name);
        // Server adopted the upload as current — reflect it in the highlight
        // immediately (the rows are not rebuilt anymore).
        if (d && d.wallpaperPath) {
          try { localStorage.setItem('zcode-beautify:current-key', d.wallpaperPath); } catch (e) {}
          markCurrent(d.wallpaperPath);
        }
        markLibDirty();
      });
    };
    fr.readAsDataURL(f);
  });

  // --- scene wallpaper import ------------------------------------------------
  var STAGE_LABELS = {
    starting: '准备中', detect: '识别中', deps: '检查依赖', opening: '渲染中', 'render-ready': '渲染中',
    recording: '录制中', closing: '录制中', processing: '处理中', poster: '处理中', saving: '保存中',
    'cache-hit': '缓存命中', done: '完成', error: '失败'
  };
  var importTimer = null;
  // Batch progress ("第 i/N 个") shown alongside the per-import stage while a
  // multi-file queue runs; null for single imports.
  var batchInfo = null;
  function setProgress(on, stage, fromCache) {
    var box = $('zb-progress');
    box.hidden = !on;
    if (on) {
      var label = STAGE_LABELS[stage] || stage || '…';
      if (batchInfo) label += ' (第 ' + batchInfo.i + '/' + batchInfo.n + ' 个)';
      // The pipeline stages advance in order; map them onto a smooth bar.
      var order = ['starting', 'detect', 'deps', 'opening', 'render-ready', 'recording', 'closing', 'processing', 'poster', 'saving', 'done'];
      var pct = stage === 'done' ? 100 : (stage === 'cache-hit' ? 100 : 8 + 88 * Math.max(0, order.indexOf(stage)) / (order.length - 1));
      $('zb-progress-bar').style.width = pct + '%';
      box.firstElementChild.nextSibling.textContent = label + (stage === 'cache-hit' ? '(缓存)' : '');
    }
  }
  function showGuide(guide, retryable) {
    var g = $('zb-guide');
    g.hidden = !guide;
    g.textContent = guide || '';
    $('zb-guide-retry').hidden = !retryable;
  }
  $('zb-pick').addEventListener('click', function () {
    var btn = this;
    btn.textContent = '…';
    apiFetch('/api/pick-scene', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        btn.textContent = '📁';
        if (!d || !d.ok || !d.path) return; // user cancelled the dialog
        var paths = (d.paths && d.paths.length) ? d.paths : [d.path];
        if (paths.length > 1) { startImportQueue(paths); return; }
        $('zb-scene-path').value = d.path;
        $('zb-import').click();
      })
      .catch(function () { btn.textContent = '📁'; status('无法连接美化服务 service unreachable'); });
  });

  // --- Wallpaper Engine library browser (🧩) -----------------------------------
  // Lists the machine's local WE wallpapers (workshop + myprojects) with
  // previews; picking one feeds its directory into the normal import queue.
  var wePop = null;
  /** Set while the WE popup is open: hides its hover preview. */
  var weHoverHide = null;
  function closeWePop() {
    // Sweep EVERY .zb-we-pop on <body>: after a serve restart the panel
    // script is re-evaluated and this closure's wePop is null again, while
    // the previous panel's popup element still sits in the DOM — clearing
    // only our own reference would leave that stale popup shadowing
    // querySelector('body > .zb-we-pop') and breaking the next open.
    if (weHoverHide) weHoverHide();
    var pops = document.querySelectorAll('body > .zb-we-pop, body > .zb-we-hover');
    for (var i = 0; i < pops.length; i++) pops[i].remove();
    wePop = null;
    document.removeEventListener('wheel', weScrollClose, true);
    document.removeEventListener('keydown', weEscClose, true);
  }
  // Dismiss on USER scrolling outside the popup (wheel only — a scroll EVENT
  // also fires from programmatic scrolls, and ZCode's chat column
  // auto-follows streaming output, which closed the popup the instant any
  // in-popup click coincided with a chat autoscroll). Scrolling the popup's
  // own list must not close it.
  var weScrollClose = function (e) {
    if (wePop && wePop.contains(e.target)) return;
    closeWePop();
  };
  var weEscClose = function (e) {
    if (e.key === 'Escape') closeWePop();
  };
  function openWePop(items) {
    closeWePop();
    var selected = {};
    var hasFolders = items.some(function (it) { return it.folder; });
    var weMode = localStorage.getItem('zcode-beautify:we-mode') === 'folder' && hasFolders ? 'folder' : 'type';
    wePop = document.createElement('div');
    wePop.className = 'zb-we-pop';

    var head = document.createElement('div');
    head.className = 'zb-we-head';
    var titleEl = document.createElement('span');
    titleEl.textContent = 'WE 壁纸库';
    var modeWrap = document.createElement('div');
    modeWrap.className = 'zb-we-mode';
    var modeType = document.createElement('button');
    modeType.textContent = '类型';
    var modeFolder = document.createElement('button');
    modeFolder.textContent = '文件夹';
    modeFolder.hidden = !hasFolders;
    modeWrap.appendChild(modeType);
    modeWrap.appendChild(modeFolder);
    var countEl = document.createElement('span');
    countEl.className = 'zb-we-total';
    countEl.textContent = items.length + ' 个 · 点击卡片多选';
    var search = document.createElement('input');
    search.className = 'zb-we-search';
    search.type = 'text';
    search.placeholder = '搜索标题…';
    search.spellcheck = false;
    var closeBtn = document.createElement('button');
    closeBtn.className = 'zb-we-act';
    closeBtn.textContent = '✕';
    closeBtn.title = '关闭 (Esc)';
    closeBtn.addEventListener('click', closeWePop);
    head.appendChild(titleEl); head.appendChild(modeWrap); head.appendChild(countEl);
    head.appendChild(search); head.appendChild(closeBtn);
    wePop.appendChild(head);

    var list = document.createElement('div');
    list.className = 'zb-we-list';
    var groupEls = [];
    // Folder mode navigates like a real file browser: the root shows one
    // card per WE folder (📁 + name + count); clicking one descends into it
    // with a back row on top. 未分类 is just another folder card.
    var folderNav = 'root';
    var curFolder = '';
    var selInfo = document.createElement('span');
    var impBtn = document.createElement('button');
    function refreshSel() {
      var n = Object.keys(selected).length;
      selInfo.textContent = n > 0 ? ('已选 ' + n + ' 项') : '未选择';
      impBtn.disabled = n === 0;
    }
    function refreshModeBtns() {
      modeType.setAttribute('data-on', weMode === 'type' ? '1' : '0');
      modeFolder.setAttribute('data-on', weMode === 'folder' ? '1' : '0');
    }
    function setWeMode(m) {
      if (!hasFolders || weMode === m) return;
      weMode = m;
      folderNav = 'root';
      curFolder = '';
      try { localStorage.setItem('zcode-beautify:we-mode', m); } catch (e) {}
      refreshModeBtns();
      renderGroups();
    }
    modeType.addEventListener('click', function () { setWeMode('type'); });
    modeFolder.addEventListener('click', function () { setWeMode('folder'); });
    refreshModeBtns();

    function buildCard(it) {
      var card = document.createElement('div');
      card.className = 'zb-we-card';
      card.setAttribute('data-title', it.title.toLowerCase());
      card.setAttribute('data-dir', it.dir);
      if (!it.importable) card.setAttribute('data-off', '1');
      if (selected[it.dir]) card.setAttribute('data-sel', '1');
      // Real-preview chain, best first: the wallpaper's OWN material —
      // source video for video wallpapers, its own WE preview GIF for
      // scenes — and only then the recorded loop, which is
      // content-addressed: reposts of the SAME wallpaper share one cache
      // entry, and leading with it made a folder of reposts all preview
      // as 'the same video'.
      if (it.videoUrl) card.setAttribute('data-video', it.videoUrl);
      card.title = it.title + '\\n' + it.dir + (it.folder ? '\\n📁 ' + it.folder : '') + (it.imported ? '\\n(已导入过,再次导入秒完成)' : '');
      if (it.imported) {
        var done = document.createElement('span');
        done.className = 'zb-we-done';
        done.textContent = '已导入';
        card.appendChild(done);
      }
      var tick = document.createElement('span');
      tick.className = 'zb-we-tick';
      tick.textContent = '✓';
      card.appendChild(tick);
      if (it.previewUrl) {
        var img = document.createElement('img');
        img.loading = 'lazy';
        // previewUrl is serve-relative (/media/...) — resolve against API or
        // the img loads against the ZCode app origin and 404s.
        img.src = mt(API + it.previewUrl);
        img.alt = '';
        card.appendChild(img);
      } else {
        var ph = document.createElement('div');
        ph.className = 'zb-we-ph';
        ph.textContent = '无预览';
        card.appendChild(ph);
      }
      if (!it.importable) {
        var tag = document.createElement('span');
        tag.className = 'zb-we-tag';
        tag.textContent = '网页';
        card.appendChild(tag);
      }
      var t = document.createElement('div');
      t.className = 'zb-we-name';
      t.textContent = it.title;
      card.appendChild(t);
      card.addEventListener('click', function () {
        if (!it.importable) return;
        if (selected[it.dir]) { delete selected[it.dir]; card.removeAttribute('data-sel'); }
        else { selected[it.dir] = 1; card.setAttribute('data-sel', '1'); }
        refreshSel();
      });
      return card;
    }
    function renderGroups() {
      groupEls = [];
      list.textContent = '';
      var groups;
      if (weMode === 'folder' && folderNav === 'root') {
        // Root of the folder view: folder cards only (real-file-browser
        // look), 未分类 last. Folder titles come from WE's own browser
        // folder tree (config.json → browser.folders).
        var titles = [];
        items.forEach(function (it) {
          var f = it.folder || '未分类';
          if (titles.indexOf(f) < 0) titles.push(f);
        });
        titles.sort(function (a, b) {
          return (a === '未分类' ? 1 : 0) - (b === '未分类' ? 1 : 0) || a.localeCompare(b, 'zh');
        });
        var fgrid = document.createElement('div');
        fgrid.className = 'zb-we-grid';
        titles.forEach(function (t) {
          var cnt = items.filter(function (it) { return (it.folder || '未分类') === t; }).length;
          var fc = document.createElement('div');
          fc.className = 'zb-we-fcard';
          fc.setAttribute('data-title', t.toLowerCase());
          fc.title = t + ' — ' + cnt + ' 个壁纸,点击进入';
          var ico = document.createElement('div');
          ico.className = 'zb-we-fico';
          ico.textContent = t === '未分类' ? '🗃' : '📁';
          fc.appendChild(ico);
          var fn = document.createElement('div');
          fn.className = 'zb-we-fname';
          fn.textContent = t;
          fc.appendChild(fn);
          var fcnt = document.createElement('div');
          fcnt.className = 'zb-we-fcount';
          fcnt.textContent = cnt + ' 个';
          fc.appendChild(fcnt);
          fc.addEventListener('click', function () {
            curFolder = t;
            folderNav = 'inside';
            search.value = '';
            renderGroups();
          });
          fgrid.appendChild(fc);
        });
        list.appendChild(fgrid);
        groupEls.push(fgrid);
        applyFilter();
        return;
      }
      if (weMode === 'folder' && folderNav === 'inside') {
        // Inside one folder: back row + its wallpapers as a flat grid.
        var back = document.createElement('button');
        back.className = 'zb-we-back';
        back.innerHTML = '← 返回文件夹列表';
        back.title = '返回上一层';
        back.addEventListener('click', function () {
          folderNav = 'root';
          curFolder = '';
          search.value = '';
          renderGroups();
        });
        list.appendChild(back);
        var lab = document.createElement('div');
        lab.className = 'zb-we-group';
        lab.textContent = (curFolder === '未分类' ? '🗃 ' : '📁 ') + curFolder;
        list.appendChild(lab);
        var grid = document.createElement('div');
        grid.className = 'zb-we-grid';
        items.filter(function (it) { return (it.folder || '未分类') === curFolder; })
          .forEach(function (it) { grid.appendChild(buildCard(it)); });
        list.appendChild(grid);
        groupEls.push(grid);
        applyFilter();
        return;
      }
      groups = [
        { label: '场景', list: items.filter(function (it) { return it.type === 'scene'; }) },
        { label: '视频', list: items.filter(function (it) { return it.type === 'video'; }) },
        { label: '网页 · 暂不支持导入', list: items.filter(function (it) { return it.type === 'web'; }) },
      ];
      groups.forEach(function (g) {
        if (!g.list.length) return;
        var wrap = document.createElement('div');
        var lab = document.createElement('div');
        lab.className = 'zb-we-group';
        lab.textContent = g.label + ' · ' + g.list.length;
        wrap.appendChild(lab);
        var grid = document.createElement('div');
        grid.className = 'zb-we-grid';
        g.list.forEach(function (it) { grid.appendChild(buildCard(it)); });
        wrap.appendChild(grid);
        groupEls.push(wrap);
        list.appendChild(wrap);
      });
      if (!items.length) {
        var empty = document.createElement('div');
        empty.className = 'zb-we-empty';
        empty.textContent = '未找到 Wallpaper Engine 壁纸。需要 Steam 创意工坊内容(场景/视频壁纸),或 wallpaper_engine\\\\projects\\\\myprojects 下的自建项目。';
        list.appendChild(empty);
      }
      applyFilter();
    }
    function applyFilter() {
      var q = search.value.trim().toLowerCase();
      var cards = list.querySelectorAll('.zb-we-card, .zb-we-fcard');
      for (var i = 0; i < cards.length; i++) {
        cards[i].hidden = Boolean(q) && cards[i].getAttribute('data-title').indexOf(q) < 0;
      }
      groupEls.forEach(function (g) {
        var visible = 0;
        // Count BOTH wallpaper and folder cards: the folder-view root grid
        // holds only .zb-we-fcard, and matching .zb-we-card alone read as
        // "empty group" — hiding the whole folder grid, which is exactly the
        // "popup opens blank" bug.
        var gr = g.querySelectorAll('.zb-we-card, .zb-we-fcard');
        for (var j = 0; j < gr.length; j++) if (!gr[j].hidden) visible++;
        g.hidden = visible === 0;
      });
    }
    renderGroups();
    wePop.appendChild(list);

    // Bottom action bar: multi-select summary + one-shot queued import.
    var foot = document.createElement('div');
    foot.className = 'zb-we-foot';
    selInfo.className = 'zb-we-selinfo';
    impBtn.className = 'zb-btn';
    impBtn.textContent = '导入所选';
    impBtn.title = '将选中的壁纸逐个排队导入(规格/保留声音跟随上方导入设置)';
    impBtn.disabled = true;
    impBtn.addEventListener('click', function () {
      var dirs = Object.keys(selected);
      if (!dirs.length) return;
      closeWePop();
      startImportQueue(dirs);
    });
    var clearBtn = document.createElement('button');
    clearBtn.className = 'zb-btn';
    clearBtn.textContent = '清空选择';
    clearBtn.title = '取消全部选择';
    clearBtn.addEventListener('click', function () {
      selected = {};
      var cards = list.querySelectorAll('.zb-we-card[data-sel]');
      for (var i = 0; i < cards.length; i++) cards[i].removeAttribute('data-sel');
      refreshSel();
    });
    refreshSel();
    foot.appendChild(selInfo); foot.appendChild(clearBtn); foot.appendChild(impBtn);
    wePop.appendChild(foot);
    document.body.appendChild(wePop);

    // Opens to the LEFT of the panel (the panel hugs the right edge).
    var anchor = $('zb-we-lib').getBoundingClientRect();
    wePop.style.left = Math.max(8, Math.min(window.innerWidth - 568, anchor.left - 570)) + 'px';
    wePop.style.top = Math.max(8, Math.min(window.innerHeight - wePop.offsetHeight - 8, anchor.top)) + 'px';
    document.addEventListener('wheel', weScrollClose, { capture: true, passive: true });
    document.addEventListener('keydown', weEscClose, true);

    search.addEventListener('input', applyFilter);
    setTimeout(function () { search.focus(); }, 30);

    // Hover preview: rest on a card 300ms and a large version of its
    // preview appears beside the popup (WE preview GIFs animate there).
    weHoverHide = function () {
      if (weHoverTimer) { clearTimeout(weHoverTimer); weHoverTimer = null; }
      var p = document.querySelector('body > .zb-we-hover');
      if (p) p.remove();
    };
    var weHoverTimer = null;
    list.addEventListener('mouseover', function (e) {
      var card = e.target && e.target.closest ? e.target.closest('.zb-we-card') : null;
      if (!card) return;
      weHoverHide();
      weHoverTimer = setTimeout(function () {
        weHoverTimer = null;
        var img = card.querySelector('img');
        if (!img) return;
        weHoverHide();
        // Real preview: video wallpapers play their actual footage when the
        // setting allows it; everything else (and scenes, whose only real
        // preview would be a render) shows the cover image.
        var vUrl = card.getAttribute('data-video');
        var live = false;
        try { live = localStorage.getItem('zcode-beautify:we-live') !== '0'; } catch (e) {}
        var prev = document.createElement('div');
        prev.className = 'zb-we-hover';
        var media;
        if (vUrl && live) {
          media = document.createElement('video');
          media.muted = true;
          media.loop = true;
          media.playsInline = true;
          media.autoplay = true;
          media.src = mt(API + vUrl);
        } else {
          media = document.createElement('img');
          media.src = img.src;
        }
        media.alt = '';
        prev.appendChild(media);
        // Vertical placement is derived from the CURRENT box height: centered
        // on the card, clamped to the viewport, pinned to the top when a
        // very tall preview cannot fit at all. Runs once with the estimate
        // and again when the medium is ready with its real aspect.
        var place = function () {
          var r = card.getBoundingClientRect();
          var h = prev.offsetHeight || 180;
          var top = r.top + r.height / 2 - h / 2;
          if (top + h > window.innerHeight - 8) top = window.innerHeight - h - 8;
          if (top < 8) top = 8;
          prev.style.top = Math.round(top) + 'px';
          prev.style.right = Math.max(8, window.innerWidth - r.left + 10) + 'px';
        };
        media.onload = place;
        media.addEventListener('loadedmetadata', place);
        document.body.appendChild(prev);
        place();
        if (media.tagName === 'VIDEO') media.play().catch(function () {});
      }, 300);
    });
    list.addEventListener('mouseout', function (e) {
      var card = e.target && e.target.closest ? e.target.closest('.zb-we-card') : null;
      if (!card) return;
      if (e.relatedTarget && card.contains(e.relatedTarget)) return;
      weHoverHide();
    });
  }
  $('zb-we-lib').addEventListener('click', function () {
    var btn = this;
    btn.textContent = '…';
    apiFetch('/api/we-library')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        btn.textContent = '🧩';
        if (!d || d.error) { status((d && d.error) || '读取 WE 壁纸库失败'); return; }
        openWePop(d.items || []);
      })
      .catch(function () { btn.textContent = '🧩'; status('无法连接美化服务 service unreachable'); });
  });
  /** Resolves once no import job is running (multi-file queue pacing). */
  function importIdle() {
    return new Promise(function (resolve) {
      var t = zbEvery(function () {
        apiFetch('/api/import-status')
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (!j || !j.running) { clearInterval(t); setTimeout(resolve, 400); }
          })
          .catch(function () { clearInterval(t); resolve(); });
      }, 800);
    });
  }
  /** Serial import queue for multi-selected files (one job at a time). */
  function startImportQueue(paths) {
    status('已选 ' + paths.length + ' 个,开始排队导入…');
    batchInfo = { i: 0, n: paths.length };
    var i = 0;
    var next = function () {
      if (i >= paths.length) {
        batchInfo = null;
        status('队列完成:' + paths.length + ' 个'); markLibDirty(); return;
      }
      $('zb-scene-path').value = paths[i];
      i++;
      batchInfo.i = i;
      status('导入 ' + i + '/' + paths.length + '…');
      $('zb-import').click();
      void importIdle().then(next);
    };
    next();
  }
  $('zb-scene-path').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') $('zb-import').click();
  });

  $('zb-import').addEventListener('click', function () {
    var p = $('zb-scene-path').value.trim();
    if (!p) { status('请先粘贴场景壁纸路径'); return; }
    showGuide('', false);
    post('/api/import-scene', { path: p, importRes: zbResSel ? resPayload() : undefined }, function (d) {
      if (d && d.error) { status(d.error); return; }
      setProgress(true, 'starting');
      if (importTimer) clearInterval(importTimer);
      importTimer = zbEvery(pollImport, 600);
    });
  });
  function pollImport() {
    apiFetch('/api/import-status')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        setProgress(j.running || j.stage === 'done', j.stage);
        if (j.error) {
          clearInterval(importTimer); importTimer = null;
          setProgress(false);
          showGuide(j.guide || ('导入失败: ' + j.error), Boolean(j.guide));
          return;
        }
        if (!j.running && j.stage === 'done') {
          clearInterval(importTimer); importTimer = null;
          status(j.result && j.result.fromCache ? '已从缓存载入' : '动态壁纸已应用');
          refresh();
          markLibDirty();
        }
      })
      .catch(function () { /* transient */ });
  }
  $('zb-guide-retry').addEventListener('click', function () {
    showGuide('', false);
    $('zb-import').click();
  });

  // --- library (dynamic + images, each with its import entry up front) -----
  // Collapsible library cards: clicking the title folds the body; the state
  // survives panel reopens (localStorage) per card.
  function bindFold(cardId, storeKey) {
    var card = document.getElementById(cardId);
    if (!card) return;
    var title = card.querySelector('.zb-card-title');
    var apply = function (collapsed) {
      card.classList.toggle('zb-collapsed', collapsed);
      title.title = collapsed ? '展开' : '折叠';
    };
    var saved = null;
    try { saved = localStorage.getItem(storeKey); } catch (e) {}
    apply(saved === '1');
    title.addEventListener('click', function () {
      var next = !card.classList.contains('zb-collapsed');
      apply(next);
      try { localStorage.setItem(storeKey, next ? '1' : '0'); } catch (e) {}
      hideHoverPreview(); // thumbnails vanish under the fold
    });
  }
  bindFold('zb-card-display', 'zcode-beautify:fold-display');
  bindFold('zb-card-history', 'zcode-beautify:fold-history');
  bindFold('zb-card-scenes', 'zcode-beautify:fold-scenes');
  bindFold('zb-card-images', 'zcode-beautify:fold-images');

  // Image sort mode (F6): default newest first; toggles to name order.
  var imgSort = 'time';
  var LIB_QUERY = '';
  function applyLibQuery() {
    LIB_QUERY = imgSort === 'name' ? '?sort=name' : '';
    $('zb-img-sort').textContent = imgSort === 'name' ? '⇅ 名称' : '⇅ 时间';
  }
  var batchMode = false;
  function loadLibrary() {
    apiFetch('/api/library' + LIB_QUERY)
      .then(function (r) { return r.json(); })
      .then(function (lib) {
        var scenes = $('zb-lib-scenes');
        var images = $('zb-lib-images');
        scenes.innerHTML = '';
        images.innerHTML = '';
        (lib.scenes || []).forEach(function (s) {
          var item = libItem(s.name || ('场景 ' + s.hash.slice(0, 8)), { hash: s.hash }, s.hash, 'scene', s.hash, mt(API + '/media/poster/' + s.hash + '.jpg'), s.favorite);
          if (typeof s.sizeBytes === 'number' && s.sizeBytes > 0) item.title = (s.name || s.hash.slice(0, 8)) + ' — ' + (s.sizeBytes / 1048576).toFixed(1) + ' MB';
          scenes.appendChild(item);
        });
        if (!(lib.scenes || []).length) {
          scenes.innerHTML = '<div class="zb-lib-head">暂无动态壁纸 — 用上方导入</div>';
        }
        (lib.images || []).forEach(function (im) {
          images.appendChild(libItem(im.name, { path: im.path }, im.path, 'image', im.path, mt(API + '/media/lib/' + encodeURIComponent(im.name)), im.favorite));
        });
        if (!(lib.images || []).length) {
          images.innerHTML = '<div class="zb-lib-head">暂无图片壁纸 — 用上方更换图片</div>';
        }
        if (batchMode) enterBatchMode(false); // re-arm checkboxes on the fresh rows
      })
      .catch(function () { /* offline */ });
  }
  applyLibQuery();
  $('zb-img-sort').addEventListener('click', function () {
    imgSort = imgSort === 'time' ? 'name' : 'time';
    applyLibQuery();
    markLibDirty();
  });
  $('zb-open-images').addEventListener('click', function () {
    post('/api/open-folder', { target: 'images' }, function () { status('已在资源管理器打开'); });
  });
  $('zb-open-scenes').addEventListener('click', function () {
    post('/api/open-folder', { target: 'scenes' }, function () { status('已在资源管理器打开'); });
  });
  // Batch delete (F6): checkboxes on image rows, one shot for the selection.
  function enterBatchMode(on) {
    batchMode = on;
    var btn = $('zb-img-batch');
    var images = $('zb-lib-images');
    if (on) {
      btn.textContent = '🗑 删所选';
      var rows = images.querySelectorAll('.zb-item');
      for (var i = 0; i < rows.length; i++) {
        if (!rows[i].querySelector('.zb-item-img')) continue;
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'zb-batch-cb';
        cb.setAttribute('data-key', rows[i].getAttribute('data-key'));
        rows[i].insertBefore(cb, rows[i].firstChild);
      }
    } else {
      btn.textContent = '☰ 批量';
      var cbs = images.querySelectorAll('.zb-batch-cb');
      for (var j = 0; j < cbs.length; j++) cbs[j].remove();
    }
  }
  $('zb-img-batch').addEventListener('click', function () {
    if (!batchMode) { enterBatchMode(true); status('勾选要删除的图片,再点"删所选"'); return; }
    var checked = document.querySelectorAll('#zb-lib-images .zb-batch-cb:checked');
    if (!checked.length) { enterBatchMode(false); status('未勾选任何条目'); return; }
    // Image rows carry their raw absolute path in data-key (scene rows hold a
    // hex hash and never get checkboxes) — anything non-hex is a path.
    var paths = [];
    for (var i = 0; i < checked.length; i++) {
      var k = checked[i].getAttribute('data-key') || '';
      if (k && !/^[a-f0-9]{8,64}$/.test(k)) paths.push(k);
    }
    if (!paths.length) { enterBatchMode(false); return; }
    var self = this;
    var pending = paths.length, failed = 0;
    paths.forEach(function (p) {
      post('/api/library-delete', { kind: 'image', path: p }, function (d) {
        if (!d || !d.ok) failed++;
        if (--pending === 0) {
          enterBatchMode(false);
          markLibDirty();
          status(failed ? ('部分未删除:' + failed + ' 条(使用中的需先切换)') : ('已删除 ' + (paths.length - failed) + ' 张'));
        }
      });
    });
  });

  // --- scene cache storage line (F2) ---------------------------------------
  function loadStorage() {
    apiFetch('/api/storage')
      .then(function (r) { return r.json(); })
      .then(function (s) {
        var txt = $('zb-storage-text');
        var mb = (s.scenesBytes || 0) / 1048576;
        txt.textContent = mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB 缓存' : mb.toFixed(1) + ' MB 缓存';
        txt.title = '壁纸缩略图 ' + ((s.thumbsBytes || 0) / 1048576).toFixed(1) + ' MB';
      })
      .catch(function () { $('zb-storage-text').textContent = ''; });
  }
  $('zb-compress').addEventListener('click', function () {
    var btn = this;
    if (btn.getAttribute('data-armed') !== '1') {
      btn.setAttribute('data-armed', '1');
      status('再点一次确认:全部动态壁纸压缩为 720p/24fps(使用中的跳过,耗时数秒)');
      setTimeout(function () { btn.removeAttribute('data-armed'); }, 5000);
      return;
    }
    btn.removeAttribute('data-armed');
    btn.textContent = '⚡ 压缩中…';
    post('/api/scenes-recompress', {}, function (d) {
      btn.textContent = '⚡ 压缩';
      if (!d || !d.ok) { status('压缩失败:' + ((d && d.error) || '服务未连接')); return; }
      var mb = (d.savedBytes || 0) / 1048576;
      status('已压缩 ' + d.done + ' 个' + (d.skipped ? '(跳过 ' + d.skipped + ' 个使用中)' : '') + ' 省 ' + mb.toFixed(1) + ' MB');
      markLibDirty();
    });
  });
  $('zb-purge').addEventListener('click', function () {
    var btn = this;
    if (btn.getAttribute('data-armed') !== '1') {
      btn.setAttribute('data-armed', '1');
      status('再点一次确认:清理全部动态壁纸缓存(使用中的保留)');
      setTimeout(function () { btn.removeAttribute('data-armed'); }, 5000);
      return;
    }
    btn.removeAttribute('data-armed');
    post('/api/scenes-purge', {}, function (d) {
      status(d && d.ok ? '已清理 ' + (d.removed || 0) + ' 项缓存' : '清理失败');
      markLibDirty();
    });
  });

  // --- recently used (F8) ---------------------------------------------------
  function loadHistory() {
    apiFetch('/api/history')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var box = $('zb-history');
        box.innerHTML = '';
        var items = (d && d.items) || [];
        if (!items.length) { box.innerHTML = '<div class="zb-lib-head">暂无记录</div>'; return; }
        items.slice(0, 10).forEach(function (it) {
          var el = document.createElement('div');
          el.className = 'zb-item';
          var img = document.createElement('img');
          img.className = 'zb-item-img';
          img.src = mt(it.thumbUrl || '');
          img.loading = 'lazy';
          var lb = document.createElement('span');
          lb.className = 'zb-label';
          lb.textContent = it.label;
          lb.title = it.label + (it.at ? ' — ' + new Date(it.at).toLocaleString() : '');
          lb.addEventListener('click', function () {
            post('/api/apply-wallpaper', it.hash ? { hash: it.hash } : { path: it.path }, function (r) {
              if (r && r.error) { status(r.error); return; }
              try { localStorage.setItem('zcode-beautify:current-key', it.hash ? it.hash : it.path); } catch (e) {}
              markCurrent(it.hash ? it.hash : it.path);
              markLibDirty();
            });
          });
          el.appendChild(img);
          el.appendChild(lb);
          box.appendChild(el);
        });
      })
      .catch(function () { /* offline */ });
  }

  // --- playlist status line (第 N/M 张 · 剩余 Xs), 1s while the panel is open
  var rotStateTimer = null;
  function pollRotState() {
    apiFetch('/api/rotation-state')
      .then(function (r) { return r.json(); })
      .then(function (s) {
        var el = $('zb-rot-state');
        if (!s || !s.on) { el.textContent = '未启用'; return; }
        if (s.mode === 'schedule') { el.textContent = '定点模式 ' + s.planName; return; }
        var remain = Math.ceil((s.remainMs || 0) / 1000);
        el.textContent = '第 ' + (s.index + 1) + '/' + s.total + ' 张 · ' + (s.frozen ? '已暂停(后台)' : remain + 's');
      })
      .catch(function () { /* offline */ });
  }
  // The rot-state poller starts/stops in the MAIN click handler below — a
  // capture-phase variant ran BEFORE the panel toggled, so "open" read as
  // "closed" and killed the interval the moment the panel opened, freezing
  // the status line ("第 N/M 张 · Xs" never changed).
  rotStateTimer = panelOpen() ? zbEvery(pollRotState, 1000) : null;

  // --- usage-time ranking (📊) ----------------------------------------------
  $('zb-stats').addEventListener('click', function () {
    apiFetch('/api/stats')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var existing = document.querySelector('body > .zb-wp-pop');
        if (existing) { existing.remove(); return; }
        var pop = document.createElement('div');
        pop.className = 'zb-wp-pop';
        var items = (d && d.items) || [];
        if (!items.length) pop.textContent = '暂无使用记录';
        items.forEach(function (it, i) {
          var row = document.createElement('div');
          row.className = 'zb-wp-item';
          var rank = document.createElement('span');
          rank.textContent = (i + 1) + '.';
          rank.style.cssText = 'width:16px;flex:none;opacity:.6';
          var name = document.createElement('span');
          name.textContent = it.label;
          name.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
          var t = document.createElement('span');
          var min = Math.round(it.seconds / 60);
          t.textContent = min >= 60 ? (Math.round(min / 60 * 10) / 10) + '小时' : min + '分钟';
          t.style.opacity = '.7';
          row.appendChild(rank); row.appendChild(name); row.appendChild(t);
          pop.appendChild(row);
        });
        document.body.appendChild(pop);
      (function () { var wep = document.querySelector('body > .zb-we-pop'); if (wep) document.body.appendChild(wep); })(); // keep the WE window on top (equal z)
        var btn = $('zb-stats').getBoundingClientRect();
        pop.style.left = Math.max(8, Math.min(btn.left, window.innerWidth - 216)) + 'px';
        pop.style.width = '208px';
        pop.style.bottom = 'auto';
        pop.style.top = (btn.bottom + 4) + 'px';
        setTimeout(function () {
          var close = function (e) {
            if (!pop.contains(e.target) && e.target !== $('zb-stats')) { pop.remove(); document.removeEventListener('mousedown', close, true); }
          };
          document.addEventListener('mousedown', close, true);
        }, 0);
      })
      .catch(function () { status('服务未连接'); });
  });
  // --- config export / import (F3) -----------------------------------------
  $('zb-cfg-export').addEventListener('click', function () {
    apiFetch('/api/export')
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        var blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'zcode-beautify-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
        status('已导出配置文件');
      })
      .catch(function () { status('导出失败,服务未连接'); });
  });
  $('zb-cfg-import').addEventListener('click', function () { $('zb-cfg-file').click(); });
  $('zb-cfg-file').addEventListener('change', function () {
    var f = this.files && this.files[0];
    this.value = '';
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      var body;
      try { body = JSON.parse(fr.result); } catch (e) { status('文件不是有效的 JSON'); return; }
      post('/api/import-config', body, function (d) {
        if (d && d.error) { status(d.error); return; }
        status('配置已导入并应用');
        refresh();
        markLibDirty();
        loadRotation();
      });
    };
    fr.readAsText(f);
  });

  /** Flip the data-current highlight in place. Rebuilding the whole list on
   *  every apply (loadLibrary) destroys and re-decodes every thumbnail <img>,
   *  which reads as the whole library flickering on each wallpaper switch. */
  function markCurrent(key) {
    var rows = document.querySelectorAll('#' + ROOT_ID + ' .zb-item[data-key]');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-key') === key) rows[i].setAttribute('data-current', '1');
      else rows[i].removeAttribute('data-current');
    }
  }
  /** One library row: click-to-apply label + rename (inline) + two-step delete. */
  function libItem(label, applyBody, key, kind, ref, thumbUrl, favorite) {
    var row = document.createElement('div');
    row.className = 'zb-item';
    row.setAttribute('data-key', key);
    var cur = localStorage.getItem('zcode-beautify:current-key');
    if (cur === key) row.setAttribute('data-current', '1');

    // Favorite pin: floats to the top of the list (server sorts), survives
    // restarts in favorites.json.
    var star = document.createElement('button');
    star.className = 'zb-act';
    star.textContent = favorite ? '★' : '☆';
    star.title = favorite ? '取消收藏' : '收藏置顶';
    star.addEventListener('click', function (e) {
      e.stopPropagation();
      post('/api/favorite', { on: !favorite, hash: applyBody.hash, path: applyBody.path }, function (d) {
        if (d && d.ok) markLibDirty();
      });
    });
    row.appendChild(star);

    if (thumbUrl) {
      var thumb = document.createElement('img');
      thumb.className = 'zb-item-img';
      thumb.src = thumbUrl;
      thumb.loading = 'lazy';
      row.appendChild(thumb);
    }

    var labelEl = document.createElement('span');
    labelEl.className = 'zb-label';
    labelEl.textContent = label;
    labelEl.title = label;
    labelEl.addEventListener('click', function () {
      post('/api/apply-wallpaper', applyBody, function (r) {
        if (r && r.error) { status(r.error); return; }
        try { localStorage.setItem('zcode-beautify:current-key', key); } catch (e) {}
        status('已应用 applied');
        markCurrent(key);
        markLibDirty();
      });
    });
    row.appendChild(labelEl);

    function renameEditor() {
      var input = document.createElement('input');
      input.className = 'zb-label-input';
      input.value = label;
      row.replaceChild(input, labelEl);
      input.focus(); input.select();
      var done = function (save) {
        if (save && input.value.trim() && input.value.trim() !== label) {
          post('/api/library-rename', { kind: kind, hash: applyBody.hash, path: applyBody.path, name: input.value.trim() },
            function (r) {
              if (r && r.error) { status(r.error); }
              markLibDirty();
            });
        } else {
          markLibDirty();
        }
      };
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') done(true);
        if (e.key === 'Escape') done(false);
      });
      input.addEventListener('blur', function () { done(true); });
    }

    var ren = document.createElement('button');
    ren.className = 'zb-act'; ren.textContent = '✎'; ren.title = '重命名';
    ren.addEventListener('click', renameEditor);
    row.appendChild(ren);

    var del = document.createElement('button');
    del.className = 'zb-act'; del.textContent = '🗑'; del.title = '删除';
    var disarm = null;
    del.addEventListener('click', function () {
      if (del.getAttribute('data-armed') !== '1') {
        del.setAttribute('data-armed', '1'); del.textContent = '确认删除?';
        status('再点一次确认删除 ' + label);
        disarm = setTimeout(function () { del.removeAttribute('data-armed'); del.textContent = '🗑'; }, 5000);
        return;
      }
      clearTimeout(disarm);
      post('/api/library-delete', { kind: kind, hash: applyBody.hash, path: applyBody.path }, function (r) {
        if (r && r.error) { status(r.error); del.removeAttribute('data-armed'); del.textContent = '🗑'; return; }
        if (localStorage.getItem('zcode-beautify:current-key') === key) {
          try { localStorage.removeItem('zcode-beautify:current-key'); } catch (e) {}
        }
        status('已删除 deleted');
        markLibDirty();
      });
    });
    row.appendChild(del);
    return row;
  }

  // --- wallpaper rotation (定时播放: plans, each with its own mode) ---------
  var schedOptions = [];
  var schedPlans = [];        // plans being edited (id/name/mode/entries)
  var schedIdx = 0;           // plan currently shown in the editor
  var schedActiveId = null;   // which plan plays (server side)
  var SCHED_DEFAULT_TIMES = ['09:00', '12:00', '18:00', '21:00'];
  var MODE_HINTS = {
    sequence: '每张播放设定的时长后自动切下一张,顺序循环;保存即开始',
    random: '随机顺序播放,同一张不会连续出现;保存即开始',
    schedule: '每天到设定的时间点切换到对应壁纸;保存后到点生效'
  };
  function schedMode() { return $('zb-sched-mode').value || 'sequence'; }
  function applyModeHint() { $('zb-sched-hint').textContent = MODE_HINTS[schedMode()] || ''; }
  function fetchScheduleOptions() {
    return apiFetch('/api/library' + LIB_QUERY)
      .then(function (r) { return r.json(); })
      .then(function (lib) {
        schedOptions = [];
        (lib.scenes || []).forEach(function (s) {
          schedOptions.push({
            value: 'h:' + s.hash,
            label: s.name || ('场景 ' + s.hash.slice(0, 8)),
            thumb: mt(API + '/media/poster/' + s.hash + '.jpg'),
            group: 'scene'
          });
        });
        (lib.images || []).forEach(function (im) {
          schedOptions.push({
            value: 'p:' + im.path,
            label: im.name,
            thumb: mt(API + '/media/lib/' + encodeURIComponent(im.name)),
            group: 'image'
          });
        });
        if (!schedOptions.length) schedOptions = [{ value: '', label: '(壁纸库为空)' }];
      })
      .catch(function () { /* offline */ });
  }
  /**
   * Wallpaper picker with thumbnail previews (native <option> elements cannot
   * show images). The row keeps its current value in a data-wp attribute; the
   * button shows the selected wallpaper's poster, clicking opens a popup list
   * where every option carries a preview image.
   */
  function wallpaperPicker(row, val) {
    var wrap = document.createElement('div');
    wrap.className = 'zb-wp-picker';
    var cur = null;
    for (var i = 0; i < schedOptions.length; i++) if (schedOptions[i].value === val) cur = schedOptions[i];
    var hasLib = schedOptions.length && schedOptions[0].value !== '';
    if (!cur) {
      if (!val && hasLib) { cur = schedOptions[0]; val = cur.value; }
      else cur = { value: val, label: val ? '(壁纸已失效)' : '(壁纸库为空)', thumb: null };
    }
    row.setAttribute('data-wp', val);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'zb-wp-btn';
    var img = document.createElement('img');
    if (cur.thumb) img.src = cur.thumb; else img.style.visibility = 'hidden';
    var span = document.createElement('span');
    span.textContent = cur.label;
    btn.appendChild(img); btn.appendChild(span);
    var pop = null;
    function closePop() {
      if (!pop) return;
      pop.remove(); pop = null;
      hideHoverPreview();
      document.removeEventListener('mousedown', onDoc, true);
      document.removeEventListener('wheel', onScrollClose, true);
    }
    function onDoc(e) {
      if (pop && !pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closePop();
    }
    // A fixed popup does not follow scrolling — a USER wheel scroll in the
    // background closes it. wheel (not scroll): ZCode's chat column scrolls
    // programmatically while streaming, and a scroll EVENT would close the
    // popup without any user intent. Scrolling inside the popup itself is
    // ordinary browsing and must leave it open.
    function onScrollClose(e) {
      if (pop && e && e.target && pop.contains(e.target)) return;
      closePop();
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (pop) { closePop(); return; }
      if (!hasLib) return;
      pop = document.createElement('div');
      pop.className = 'zb-wp-pop';
      // Grouped: 动态壁纸 first, then 图片壁纸 (skips empty groups); each
      // group lives in its own scroll window with its own scrollbar.
      var groups = [{ key: 'scene', label: '动态壁纸' }, { key: 'image', label: '图片壁纸' }];
      var groupLists = [];
      groups.forEach(function (g) {
        var items = schedOptions.filter(function (o) { return (o.group || '') === g.key; });
        if (!items.length) return;
        var head = document.createElement('div');
        head.className = 'zb-wp-group';
        head.textContent = g.label;
        pop.appendChild(head);
        var glist = document.createElement('div');
        glist.className = 'zb-wp-group-list';
        items.forEach(function (o) {
          var it = document.createElement('div');
          it.className = 'zb-wp-item';
          if (o.value === row.getAttribute('data-wp')) it.setAttribute('data-cur', '1');
          var t = document.createElement('img');
          if (o.thumb) t.src = o.thumb; else t.style.visibility = 'hidden';
          var s = document.createElement('span');
          s.textContent = o.label;
          it.appendChild(t); it.appendChild(s);
          it.addEventListener('click', function (ev) {
            ev.stopPropagation();
            row.setAttribute('data-wp', o.value);
            if (o.thumb) { img.src = o.thumb; img.style.visibility = 'visible'; }
            else img.style.visibility = 'hidden';
            span.textContent = o.label;
            closePop();
          });
          glist.appendChild(it);
        });
        pop.appendChild(glist);
        groupLists.push(glist);
      });
      document.body.appendChild(pop);
      (function () { var wep = document.querySelector('body > .zb-we-pop'); if (wep) document.body.appendChild(wep); })(); // keep the WE window on top (equal z)
      // Fixed placement anchored to the button: opens above it when the full
      // two-column list fits; below otherwise, shrinking the group windows
      // proportionally when the viewport runs out of room.
      var r = btn.getBoundingClientRect();
      var w = Math.max(r.width, 200);
      pop.style.width = w + 'px';
      pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
      var needed = pop.offsetHeight + 4;
      if (r.top >= needed + 8) {
        pop.style.top = 'auto';
        pop.style.bottom = (window.innerHeight - r.top + 4) + 'px';
      } else {
        pop.style.bottom = 'auto';
        pop.style.top = (r.bottom + 4) + 'px';
        var space = window.innerHeight - r.bottom - 12;
        if (space < needed && groupLists.length) {
          var chromeH = needed - groupLists.reduce(function (a, el) { return a + el.offsetHeight; }, 0);
          var per = Math.max(64, Math.floor((space - chromeH) / groupLists.length));
          groupLists.forEach(function (el) { el.style.maxHeight = per + 'px'; });
        }
      }
      document.addEventListener('mousedown', onDoc, true);
      document.addEventListener('wheel', onScrollClose, { capture: true, passive: true });
    });
    wrap.appendChild(btn);
    return wrap;
  }
  function schedRow(entry) {
    var row = document.createElement('div');
    row.className = 'zb-sched-row';
    if (schedMode() === 'schedule') {
      var t = document.createElement('input');
      t.type = 'time';
      t.value = entry.time || '09:00';
      row.appendChild(t);
    } else {
      var d = document.createElement('input');
      d.type = 'number';
      d.min = '0.5'; d.step = '0.5';
      d.value = entry.seconds ? String(Math.round((entry.seconds / 60) * 10) / 10) : '5';
      d.title = '播放时长(分钟)';
      row.appendChild(d);
      var u = document.createElement('span');
      u.className = 'zb-sched-dur'; u.textContent = '分';
      row.appendChild(u);
    }
    var val = entry.hash ? ('h:' + entry.hash) : (entry.path ? ('p:' + entry.path) : '');
    row.appendChild(wallpaperPicker(row, val));
    var del = document.createElement('button');
    del.className = 'zb-act'; del.textContent = '✕'; del.title = '删除此条';
    del.addEventListener('click', function () { row.remove(); });
    row.appendChild(del);
    return row;
  }
  function renderSchedRows(entries) {
    var list = $('zb-sched-list');
    list.innerHTML = '';
    (entries || []).forEach(function (e) { list.appendChild(schedRow(e)); });
    // A rebuilt list must start at the top — a stale scrollTop (left by scroll
    // anchoring or a clipped popup) cut off row 1's upper half.
    list.scrollTop = 0;
  }
  function renderPlanSelect() {
    var sel = $('zb-plan');
    sel.innerHTML = '';
    schedPlans.forEach(function (p, i) {
      var op = document.createElement('option');
      op.value = String(i);
      op.textContent = p.name + (p.id === schedActiveId ? ' (生效中)' : '');
      if (i === schedIdx) op.selected = true;
      sel.appendChild(op);
    });
  }
  function renderPlanEditor() {
    var plan = schedPlans[schedIdx];
    if (!plan) return;
    $('zb-sched-mode').value = plan.mode || 'sequence';
    $('zb-fx') && applyFxLabel($('zb-fx'), plan.transition || 'fade');
    $('zb-win-start').value = plan.window ? plan.window.start : '';
    $('zb-win-end').value = plan.window ? plan.window.end : '';
    applyModeHint();
    renderSchedRows(plan.entries || []);
  }
  /** Persist the per-plan activation window (F5) as the inputs change. */
  function pushPlanWindow() {
    var plan = schedPlans[schedIdx];
    if (!plan) return;
    var s = $('zb-win-start').value, e = $('zb-win-end').value;
    if (s && e && s !== e) plan.window = { start: s, end: e };
    else plan.window = undefined;
    persistPlans();
  }
  $('zb-win-start').addEventListener('change', pushPlanWindow);
  $('zb-win-end').addEventListener('change', pushPlanWindow);
  $('zb-win-clear').addEventListener('click', function () {
    $('zb-win-start').value = '';
    $('zb-win-end').value = '';
    pushPlanWindow();
    status('已清除时段,全天生效');
  });
  /** Reads the row editor into entry objects for the currently shown mode. */
  function collectPlanEntries() {
    var entries = [];
    var rows = document.querySelectorAll('#zb-sched-list .zb-sched-row');
    var isSchedule = schedMode() === 'schedule';
    for (var i = 0; i < rows.length; i++) {
      var v = rows[i].getAttribute('data-wp') || '';
      if (!v || v.length < 3) continue;
      var hash = v.slice(0, 2) === 'h:' ? v.slice(2) : undefined;
      var imgPath = v.slice(0, 2) !== 'h:' ? v.slice(2) : undefined;
      if (isSchedule) {
        var time = rows[i].querySelector('input[type=time]').value;
        if (!time) continue;
        entries.push({ time: time, hash: hash, path: imgPath });
      } else {
        var minutes = Number(rows[i].querySelector('input[type=number]').value);
        if (!isFinite(minutes) || minutes <= 0) continue;
        var seconds = Math.round(minutes * 60);
        if (seconds < 10) seconds = 10;
        entries.push({ seconds: seconds, hash: hash, path: imgPath });
      }
    }
    return entries;
  }
  /** Writes the editor (mode + rows) back into the plan being edited. */
  function syncEditorIntoPlan() {
    var plan = schedPlans[schedIdx];
    if (!plan) return;
    plan.mode = schedMode();
    plan.entries = collectPlanEntries();
  }
  function plansPayload() {
    return schedPlans.map(function (p) {
      var out = { id: p.id, name: p.name, mode: p.mode, transition: p.transition || 'fade', entries: p.entries };
      if (p.window) out.window = p.window;
      return out;
    });
  }
  /**
   * Auto-persists plan structure edits (rename / create / delete): what the
   * dropdown already shows must survive a reopen without requiring 保存.
   * Keeps the current enabled state and active plan so playback is not
   * disturbed; the editor is NOT reloaded afterwards.
   */
  function persistPlans() {
    syncEditorIntoPlan();
    var activeId = null;
    for (var i = 0; i < schedPlans.length; i++) if (schedPlans[i].id === schedActiveId) activeId = schedActiveId;
    post('/api/rotation', {
      rotation: {
        enabled: $('zb-sched-on').checked,
        activePlanId: activeId,
        plans: plansPayload()
      }
    }, function (d) {
      if (d && d.error) { status(d.error); return; }
      if (d && d.rotation) schedActiveId = d.rotation.activePlanId || schedActiveId;
      renderPlanSelect();
    });
  }
  /** Cross-mode conversion: keeps the wallpaper refs, carries over seconds
   *  when present, spreads default times when switching to schedule. */
  function convertEntries(rawEntries, toMode) {
    return (rawEntries || []).map(function (e, i) {
      var out = e.hash ? { hash: e.hash } : { path: e.path };
      if (toMode === 'schedule') out.time = e.time || SCHED_DEFAULT_TIMES[i % SCHED_DEFAULT_TIMES.length];
      else out.seconds = e.seconds || 300;
      return out;
    });
  }
  function loadRotation() {
    fetchScheduleOptions().then(function () {
      return apiFetch('/api/rotation').then(function (r) { return r.json(); });
    }).then(function (d) {
      var rot = (d && d.rotation) || {};
      schedPlans = rot.plans && rot.plans.length
        ? rot.plans
        : [{ id: 'default', name: '方案 1', mode: 'sequence', entries: [] }];
      schedActiveId = rot.activePlanId || (schedPlans[0] && schedPlans[0].id) || null;
      var activeIdx = -1;
      for (var i = 0; i < schedPlans.length; i++) if (schedPlans[i].id === schedActiveId) activeIdx = i;
      schedIdx = activeIdx >= 0 ? activeIdx : 0;
      $('zb-sched-on').checked = !!rot.enabled;
      renderPlanSelect();
      renderPlanEditor();
    }).catch(function () { /* offline */ });
  }
  // Plan switching keeps the edited plan's state; the editor loads the newly
  // selected plan from schedPlans.
  $('zb-plan').addEventListener('change', function () {
    syncEditorIntoPlan();
    schedIdx = Number(this.value) || 0;
    renderPlanSelect();
    renderPlanEditor();
  });
  $('zb-plan-add').addEventListener('click', function () {
    syncEditorIntoPlan();
    schedPlans.push({ id: 'p' + Date.now().toString(36), name: '方案 ' + (schedPlans.length + 1), mode: 'sequence', entries: [] });
    schedIdx = schedPlans.length - 1;
    renderPlanSelect();
    renderPlanEditor();
    persistPlans();
  });
  $('zb-plan-ren').addEventListener('click', function () {
    var row = document.querySelector('.zb-sched-plan');
    var sel = $('zb-plan');
    var plan = schedPlans[schedIdx];
    if (!plan || !row) return;
    var input = document.createElement('input');
    input.type = 'text';
    input.value = plan.name;
    input.className = 'zb-label-input';
    input.style.flex = '1';
    row.replaceChild(input, sel);
    input.focus(); input.select();
    // One-shot guard: restoring the select unfocuses the input and fires
    // blur, which would otherwise run done() a second time (and an Escape
    // cancel would still commit the typed name).
    var finished = false;
    var done = function (save) {
      if (finished) return;
      finished = true;
      if (save && input.value.trim()) plan.name = input.value.trim().slice(0, 20);
      row.replaceChild(sel, input);
      renderPlanSelect();
      if (save) persistPlans();
    };
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    });
    input.addEventListener('blur', function () { done(true); });
  });
  $('zb-plan-del').addEventListener('click', function () {
    var btn = this;
    if (schedPlans.length <= 1) { status('至少保留一个方案'); return; }
    if (btn.getAttribute('data-armed') !== '1') {
      btn.setAttribute('data-armed', '1'); btn.textContent = '确认?';
      setTimeout(function () { btn.removeAttribute('data-armed'); btn.textContent = '🗑'; }, 3000);
      return;
    }
    btn.removeAttribute('data-armed'); btn.textContent = '🗑';
    var removed = schedPlans.splice(schedIdx, 1)[0];
    if (schedActiveId === removed.id) schedActiveId = null;
    schedIdx = Math.min(schedIdx, schedPlans.length - 1);
    renderPlanSelect();
    renderPlanEditor();
    persistPlans();
  });
  // Switching modes re-renders the rows in the new editor shape, keeping the
  // wallpapers and converting timing fields with sensible defaults.
  $('zb-sched-mode').addEventListener('change', function () {
    applyModeHint();
    var plan = schedPlans[schedIdx];
    if (!plan) return;
    plan.mode = schedMode();
    plan.entries = convertEntries(collectPlanEntries(), plan.mode);
    renderSchedRows(plan.entries);
  });
  $('zb-sched-add').addEventListener('click', function () {
    var doAdd = function () {
      // The server caps plans at 20 entries and silently drops the rest —
      // stop at the source instead of letting rows vanish after a reload.
      if (document.querySelectorAll('#zb-sched-list .zb-sched-row').length >= 20) {
        status('播放列表最多 20 条');
        return;
      }
      var entry = schedMode() === 'schedule' ? { time: '09:00' } : { seconds: 300 };
      var key = currentWallpaperKey();
      if (key.slice(0, 2) === 'h:') entry.hash = key.slice(2);
      else if (key.length > 2) entry.path = key.slice(2);
      var row = schedRow(entry);
      $('zb-sched-list').appendChild(row);
      // A full scroll window can hide the new row entirely.
      row.scrollIntoView({ block: 'nearest' });
    };
    if (!schedOptions.length || schedOptions[0].value === '') {
      fetchScheduleOptions().then(function () {
        if (!schedOptions.length || schedOptions[0].value === '') { status('壁纸库为空,先导入或更换壁纸'); return; }
        doAdd();
      });
      return;
    }
    doAdd();
  });
  // 启用开关立即提交:服务端 startRotation() 收到后马上开播/停播。之前它
  // 只是个表单值,要再点「保存/播放」才随 payload 生效,读起来像"没反应"。
  // 语义与 persistPlans 一致:不换活动方案,只翻 enabled;任何失败回滚勾选。
  $('zb-sched-on').addEventListener('change', function () {
    var want = this.checked;
    var self = this;
    syncEditorIntoPlan();
    var activeId = null;
    for (var i = 0; i < schedPlans.length; i++) if (schedPlans[i].id === schedActiveId) activeId = schedActiveId;
    if (!activeId && schedPlans[schedIdx]) activeId = schedPlans[schedIdx].id;
    fetch(API + '/api/rotation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Beautify-Token': TOKEN },
      body: JSON.stringify({ rotation: { enabled: want, activePlanId: activeId, plans: plansPayload() }, resume: true })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.error) { self.checked = !want; status(d.error); return; }
        status(want ? '已启用,开始按方案播放' : '已停止播放');
        loadRotation();
      })
      .catch(function () {
        self.checked = !want;
        status('无法连接美化服务 service unreachable');
      });
  });
  $('zb-sched-save').addEventListener('click', function () {
    syncEditorIntoPlan();
    var payload = {
      enabled: $('zb-sched-on').checked,
      activePlanId: schedPlans[schedIdx] ? schedPlans[schedIdx].id : undefined,
      plans: plansPayload()
    };
    post('/api/rotation', { rotation: payload }, function (d) {
      if (d && d.error) { status(d.error); return; }
      status(payload.enabled ? '已保存,当前方案生效' : '已保存(未启用)');
      loadRotation();
    });
  });
  // 播放 = save everything AND force-enable the edited plan right now —
  // one click from any state to visible playback.
  $('zb-sched-play').addEventListener('click', function () {
    syncEditorIntoPlan();
    var plan = schedPlans[schedIdx];
    var payload = {
      enabled: true,
      activePlanId: plan ? plan.id : undefined,
      plans: plansPayload()
    };
    post('/api/rotation', { rotation: payload }, function (d) {
      if (d && d.error) { status(d.error); return; }
      $('zb-sched-on').checked = true;
      status(plan ? '开始播放:' + plan.name : '开始播放');
      loadRotation();
    });
  });
  // 立即切换: skip the current entry's remaining duration, next wallpaper now.
  $('zb-sched-next').addEventListener('click', function () {
    post('/api/rotation-next', {}, function (d) {
      if (d && d.error) { status(d.error); return; }
      status('已切换到下一张');
    });
  });

  $('zb-reset').addEventListener('click', function () {
    var mode = this.getAttribute('data-mode') || 'reset';
    post(mode === 'restore' ? '/api/restore' : '/api/reset', {}, function () {
      if (mode === 'reset') {
        try { localStorage.removeItem('zcode-beautify:css'); localStorage.removeItem('zcode-beautify:wallpaper'); } catch (e) {}
        status('已还原默认外观');
      } else {
        status('已恢复你的壁纸');
      }
      refresh();
    });
  });

  $('zb-retry').addEventListener('click', function () {
    this.textContent = '正在重试…';
    refresh();
  });

  // --- tabs (壁纸 / 定时播放) ------------------------------------------------
  // Library/history rebuilds are DIRTY-driven: re-rendering the lists on
  // every tab switch recreated every <img> and the panel flashed black
  // while they decoded. switchTab now only refreshes control VALUES; the
  // DOM rebuilds happen when something actually changed the data.
  var zbLibDirty = true;
  function markLibDirty() {
    zbLibDirty = true;
    if (!$('zb-tab-main').hidden) { reloadMainLists(); }
  }
  function reloadMainLists() {
    zbLibDirty = false;
    loadLibrary();
    loadStorage();
    loadHistory();
    // Row height is only measurable once list items exist — re-apply the
    // per-library row limits after the rebuild settles.
    setTimeout(function () { if (typeof applyLibRows === 'function') applyLibRows(); }, 350);
  }
  function switchTab(name) {
    var tabs = document.querySelectorAll('.zb-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].setAttribute('data-active', tabs[i].getAttribute('data-tab') === name ? '1' : '0');
    }
    var pane = $(name === 'main' ? 'zb-tab-main' : name === 'sched' ? 'zb-tab-sched' : 'zb-tab-settings');
    $('zb-tab-main').hidden = name !== 'main';
    $('zb-tab-sched').hidden = name !== 'sched';
    $('zb-tab-settings').hidden = name !== 'settings';
    // Silk: a short fade-and-rise so the pane change reads as one motion.
    pane.classList.remove('zb-pane-in');
    void pane.offsetWidth;
    pane.classList.add('zb-pane-in');
    try { localStorage.setItem('zcode-beautify:tab', name); } catch (e) {}
    if (name === 'sched') loadRotation();
    else {
      refresh();
      if (zbLibDirty) reloadMainLists();
    }
  }
  $('zb-tabs').addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('.zb-tab') : null;
    if (b) switchTab(b.getAttribute('data-tab'));
  });
  function activateSavedTab() {
    var saved = 'main';
    try { saved = localStorage.getItem('zcode-beautify:tab') || 'main'; } catch (e) {}
    switchTab(saved === 'sched' || saved === 'settings' ? saved : 'main');
  }

  $('zb-fab').addEventListener('click', function () {
    var p = $('zb-panel');
    p.hidden = !p.hidden;
    if (!p.hidden) {
      // A previously dragged panel can sit (partially) outside the viewport,
      // which reads as "the panel did not open". Pull it back in.
      var r = p.getBoundingClientRect();
      if (r.width && (r.right < 40 || r.bottom < 40 || r.left > window.innerWidth - 40 || r.top > window.innerHeight - 40)) {
        p.style.left = ''; p.style.top = ''; p.style.right = ''; p.style.bottom = '';
      }
      activateSavedTab();
      beat(true);
      if (!rotStateTimer) { pollRotState(); rotStateTimer = zbEvery(pollRotState, 1000); }
    } else {
      hideHoverPreview(); // thumbnails vanish under the closed panel
      if (root.getAttribute('data-offline') !== '1') beat(false);
      if (rotStateTimer) { clearInterval(rotStateTimer); rotStateTimer = null; }
    }
  });

  // Fill in the fit label (and control values) right away, not just on open.
  refresh();
  setTimeout(applyLibRows, 400);
  setTimeout(applyLibRows, 1500);

  (function () {
    var head = $('zb-head'), panel = $('zb-panel');
    var sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    head.addEventListener('pointerdown', function (e) {
      dragging = true; sx = e.clientX; sy = e.clientY;
      var r = panel.getBoundingClientRect(); ox = r.left; oy = r.top;
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var x = Math.max(4, Math.min(window.innerWidth - 80, ox + e.clientX - sx));
      var y = Math.max(4, Math.min(window.innerHeight - 60, oy + e.clientY - sy));
      panel.style.left = x + 'px'; panel.style.top = y + 'px';
    });
    head.addEventListener('pointerup', function () { dragging = false; });
  })();

  // Self-heal: if the theme style is missing but a previous injection saved it,
  // restore it from localStorage.
  if (!document.getElementById('zcode-beautify-style')) {
    var savedCss = null, savedWp = null;
    try {
      savedCss = localStorage.getItem('zcode-beautify:css');
      savedWp = localStorage.getItem('zcode-beautify:wallpaper');
    } catch (e) {}
    if (savedCss) {
      var s = document.createElement('style');
      s.id = 'zcode-beautify-style';
      s.textContent = savedCss;
      (document.head || document.documentElement).appendChild(s);
      if (savedWp && !wallpaperEl()) {
        var w = document.createElement('div');
        w.id = 'zcode-beautify-wallpaper';
        document.documentElement.appendChild(w);
        w.style.backgroundImage = 'url(' + savedWp + ')';
      }
    }
  }
  };
  // The registration replays at document creation where <body> does not exist
  // yet — document.body.appendChild would throw and the panel would never
  // come back after a reload. Wait for the parser (a few ms at most).
  var zbStartupOn = function() {
    if (!document.body) return false;
    var cls = document.body.className || '';
    return /zcode-startup/.test(cls) && !/ready/.test(cls);
  };
  var zbMount = function() { runPanel(); };
  var zbPanelWait = function() {
    if (!document.body) { setTimeout(zbPanelWait, 20); return; }
    // The startup screen shows loading art — mounting the FAB/panel on top
    // of it looks broken; hold off until the app marks itself ready.
    if (STARTUP_CLEAN && zbStartupOn()) {
      var mo = new MutationObserver(function() {
        if (!zbStartupOn()) { mo.disconnect(); zbMount(); }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      return;
    }
    zbMount();
  };
  zbPanelWait();
})();`;
}
