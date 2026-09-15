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

export function buildPanelScript(apiPort: number): string {
  const api = `http://127.0.0.1:${apiPort}`;
  return `(function(){
  var API = ${JSON.stringify(api)};
  var ROOT_ID = ${JSON.stringify(PANEL_ROOT_ID)};
  // Always rebuild: an older panel left in the DOM would otherwise shadow the
  // current script version forever (the old build skipped installation).
  var stale = document.getElementById(ROOT_ID);
  if (stale) stale.remove();
  var staleStyle = document.getElementById('zcode-beautify-panel-style');
  if (staleStyle) staleStyle.remove();

  var css = [
    '#zcode-beautify-panel-root, #zcode-beautify-panel-root * { box-sizing: border-box; font-family: system-ui, sans-serif; }',
    '#zcode-beautify-panel-root { position: fixed; inset: auto; z-index: 2147483647; font-size: 12px; color: #e8e8ea; }',
    '#zb-fab { position: fixed; right: 18px; bottom: 18px; width: 34px; height: 34px; border-radius: 50%;',
      ' background: rgba(32,32,38,.78); border: 1px solid rgba(255,255,255,.12); cursor: pointer;',
      ' display: flex; align-items: center; justify-content: center; backdrop-filter: blur(10px);',
      ' box-shadow: 0 2px 12px rgba(0,0,0,.35); user-select: none; font-size: 15px; line-height: 1; }',
    '#zb-fab:hover { background: rgba(52,52,60,.85); }',
    '#zb-panel { position: fixed; right: 18px; bottom: 60px; width: 264px; padding: 0 0 10px;',
      ' background: rgba(24,24,30,.88); border: 1px solid rgba(255,255,255,.12); border-radius: 12px;',
      ' backdrop-filter: blur(16px); box-shadow: 0 8px 32px rgba(0,0,0,.45); user-select: none; }',
    '#zb-panel[hidden] { display: none; }',
    '#zb-head { padding: 9px 12px; font-weight: 600; cursor: move; border-bottom: 1px solid rgba(255,255,255,.1);',
      ' display: flex; justify-content: space-between; align-items: center; }',
    '#zb-close { cursor: pointer; opacity: .7; padding: 0 4px; } #zb-close:hover { opacity: 1; }',
    '#zb-body { padding: 10px 12px 0; }',
    '.zb-row { margin-bottom: 10px; }',
    '.zb-row label { display: flex; justify-content: space-between; margin-bottom: 4px; opacity: .85; }',
    '#zb-panel input[type=range] { width: 100%; accent-color: #7aa2f7; height: 18px; margin: 0; cursor: pointer; }',
    '.zb-toggles { display: flex; justify-content: center; gap: 16px; }',
    '.zb-toggles label { display: flex; align-items: center; gap: 5px; margin: 0; cursor: pointer; }',
    '.zb-actions { display: flex; justify-content: center; gap: 10px; }',
    '.zb-btn { display: inline-block; padding: 6px 20px; text-align: center; border-radius: 999px; cursor: pointer;',
      ' background: rgba(255,255,255,.09); border: 1px solid rgba(255,255,255,.14); color: inherit; font-size: 12px; }',
    '.zb-btn:hover { background: rgba(255,255,255,.16); }',
    '#zb-status { min-height: 14px; padding: 2px 12px 0; opacity: .6; font-size: 11px; }',
    '#zb-scene-path { width: 100%; padding: 5px 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14);',
      ' background: rgba(0,0,0,.3); color: inherit; font-size: 11px; outline: none; }',
    '#zb-scene-path:focus { border-color: rgba(122,162,247,.6); }',
    '#zb-progress { position: relative; height: 14px; border-radius: 7px; overflow: hidden;',
      ' background: rgba(255,255,255,.08); font-size: 10px; line-height: 14px; text-align: center; }',
    '#zb-progress-bar { position: absolute; inset: 0; width: 0%; background: rgba(122,162,247,.5); transition: width .4s; }',
    '#zb-progress span { position: relative; }',
    '#zb-guide { padding: 8px 10px; background: rgba(120,53,15,.55); border-radius: 8px; font-size: 11px;',
      ' line-height: 1.5; white-space: pre-wrap; user-select: text; max-height: 180px; overflow: auto; }',
    '.zb-lib { max-height: 120px; overflow: auto; font-size: 11px; }',
    '.zb-lib .zb-lib-head { opacity: .55; margin: 4px 0 2px; }',
    '.zb-lib .zb-item { padding: 3px 6px; border-radius: 6px; cursor: pointer; overflow: hidden;',
      ' text-overflow: ellipsis; white-space: nowrap; }',
    '.zb-lib .zb-item:hover { background: rgba(255,255,255,.1); }',
    '.zb-lib .zb-item[data-current="1"] { background: rgba(122,162,247,.25); }',
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
    '  <div id="zb-head"><span>ZCode Beautify</span><span id="zb-close">✕</span></div>' +
    '  <div id="zb-offline" hidden>' +
    '    <div>⚠ 美化服务未运行,面板不可用</div>' +
    '    <div class="zb-hint">在插件目录执行 <code>node dist/cli.js serve --detach</code> 启动</div>' +
    '    <button class="zb-btn" id="zb-retry">重试连接</button>' +
    '  </div>' +
    '  <div id="zb-body">' +
    '    <div class="zb-row"><label title="背景模糊程度(像素)"><span>背景模糊</span><span><span id="zb-blur-val">0</span>px</span></label>' +
    '      <input type="range" id="zb-blur" min="0" max="30" step="1" value="0"></div>' +
    '    <div class="zb-row"><label title="背景压暗程度(百分比,越高越暗)"><span>背景压暗</span><span><span id="zb-dim-val">0</span>%</span></label>' +
    '      <input type="range" id="zb-dim" min="0" max="80" step="1" value="0"></div>' +
    '    <div class="zb-row zb-toggles">' +
    '      <label title="根据壁纸自动生成 UI 配色;关闭则保留 ZCode 原生颜色"><input type="checkbox" id="zb-monet">UI 莫奈取色</label>' +
    '      <label title="显示或隐藏背景壁纸"><input type="checkbox" id="zb-vis">显示壁纸</label>' +
    '    </div>' +
    '    <div class="zb-row zb-actions">' +
    '      <button class="zb-btn" id="zb-fit" title="背景填充方式:填满裁剪铺满窗口 / 完整显示不裁剪(模糊垫底)/ 智能适配自动分析画面主体">背景填充: …</button>' +
    '    </div>' +
    '    <div class="zb-row zb-actions">' +
    '      <label class="zb-btn" for="zb-file" title="选择一张图片作为背景壁纸,UI 配色随之更新">更换图片…</label>' +
    '      <input type="file" id="zb-file" accept="image/*" hidden>' +
    '    </div>' +
    '    <div class="zb-row"><label style="opacity:.85"><span>场景壁纸 (Wallpaper Engine)</span></label>' +
    '      <div class="zb-actions" style="margin:2px 0 6px">' +
    '        <button class="zb-btn" id="zb-pick" title="打开文件选择器,选 .pkg 或壁纸目录内任意文件(会自动定位壁纸目录)并开始导入">选择并导入…</button>' +
    '      </div>' +
    '      <input type="text" id="zb-scene-path" placeholder="或粘贴 .pkg / 壁纸目录完整路径…" spellcheck="false">' +
    '      <div class="zb-actions" style="margin-top:6px">' +
    '        <button class="zb-btn" id="zb-import" title="渲染并录制场景壁纸,生成无缝循环动态背景">导入粘贴的路径</button>' +
    '      </div>' +
    '      <div id="zb-progress" hidden><div id="zb-progress-bar"></div><span>…</span></div>' +
    '      <div id="zb-guide" hidden></div>' +
    '      <div class="zb-actions" style="margin-top:6px"><button class="zb-btn" id="zb-guide-retry" hidden>已安装,重试</button></div>' +
    '    </div>' +
    '    <div class="zb-row zb-lib" id="zb-lib"></div>' +
    '    <div class="zb-row zb-actions">' +
    '      <button class="zb-btn" id="zb-reset" title="移除壁纸与配色,还原 ZCode 默认外观(壁纸会被记住,可再次恢复)">还原默认外观</button>' +
    '    </div>' +
    '  </div>' +
    '</div>' +
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
    fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (cb) cb(d); })
      .catch(function () { status('无法连接美化服务 service unreachable'); });
  }

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
        wallpaperVisible: $('zb-vis').checked
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
    if (on && !beatTimer) beatTimer = setInterval(refresh, 4000);
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
      $('zb-monet').checked = false;
      $('zb-vis').checked = false;
      $('zb-fit').textContent = '背景填充: 未知';
      $('zb-fit').removeAttribute('data-fit');
      $('zb-reset').textContent = '还原默认外观';
      $('zb-reset').setAttribute('data-mode', 'reset');
      beat(true);
    } else {
      if (!panelOpen()) beat(false);
    }
  }

  function refresh() {
    fetch(API + '/api/config')
      .then(function (r) { return r.json(); })
      .then(function (c) {
        setOffline(false);
        $('zb-blur').value = c.blur; $('zb-blur-val').textContent = c.blur;
        $('zb-dim').value = c.dim; $('zb-dim-val').textContent = c.dim;
        $('zb-monet').checked = !!c.monet;
        $('zb-vis').checked = !!c.wallpaperVisible;
        $('zb-fit') && applyFitLabel($('zb-fit'), c.fit || 'cover');
        var resetBtn = $('zb-reset');
        if (c.wallpaperSet) {
          resetBtn.textContent = '还原默认外观';
          resetBtn.setAttribute('data-mode', 'reset');
          resetBtn.title = '移除壁纸与配色,还原 ZCode 默认外观(壁纸会被记住,可再次恢复)';
        } else if (c.hasBackup) {
          resetBtn.textContent = '恢复我的壁纸';
          resetBtn.setAttribute('data-mode', 'restore');
          resetBtn.title = '从备份恢复你之前的壁纸与配色';
        } else {
          resetBtn.textContent = '还原默认外观';
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

  var FITS = ['cover', 'contain', 'smart'];
  var FIT_LABELS = { cover: '填满裁剪', contain: '完整显示', smart: '智能适配' };
  function applyFitLabel(btn, fit) {
    btn.textContent = '背景填充: ' + (FIT_LABELS[fit] || fit);
    btn.setAttribute('data-fit', fit);
  }
  $('zb-fit').addEventListener('click', function () {
    var current = this.getAttribute('data-fit') || 'cover';
    var next = FITS[(FITS.indexOf(current) + 1) % FITS.length];
    applyFitLabel(this, next);
    post('/api/config', { fit: next }, function (d) { status(d && d.windows > 0 ? '已应用:' + FIT_LABELS[next] : '已保存(ZCode 未连接)'); });
  });

  $('zb-file').addEventListener('change', function () {
    var f = this.files && this.files[0];
    this.value = '';
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { status('图片过大,上限 20 MB'); return; }
    var fr = new FileReader();
    fr.onload = function () {
      post('/api/wallpaper', { dataUri: fr.result, name: f.name }, function () { status('壁纸已更新 updated'); });
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
  function setProgress(on, stage, fromCache) {
    var box = $('zb-progress');
    box.hidden = !on;
    if (on) {
      var label = STAGE_LABELS[stage] || stage || '…';
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
    btn.textContent = '打开选择器…';
    fetch(API + '/api/pick-scene', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        btn.textContent = '选择并导入…';
        if (!d || !d.ok || !d.path) return; // user cancelled the dialog
        $('zb-scene-path').value = d.path;
        $('zb-import').click();
      })
      .catch(function () { btn.textContent = '选择并导入…'; status('无法连接美化服务 service unreachable'); });
  });

  $('zb-import').addEventListener('click', function () {
    var p = $('zb-scene-path').value.trim();
    if (!p) { status('请先粘贴场景壁纸路径'); return; }
    showGuide('', false);
    post('/api/import-scene', { path: p }, function (d) {
      if (d && d.error) { status(d.error); return; }
      setProgress(true, 'starting');
      if (importTimer) clearInterval(importTimer);
      importTimer = setInterval(pollImport, 600);
    });
  });
  function pollImport() {
    fetch(API + '/api/import-status')
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
        }
      })
      .catch(function () { /* transient */ });
  }
  $('zb-guide-retry').addEventListener('click', function () {
    showGuide('', false);
    $('zb-import').click();
  });

  // --- library (static images + imported scene loops) ------------------------
  function loadLibrary() {
    fetch(API + '/api/library')
      .then(function (r) { return r.json(); })
      .then(function (lib) {
        var el = $('zb-lib');
        el.innerHTML = '';
        var head1 = document.createElement('div');
        head1.className = 'zb-lib-head'; head1.textContent = '壁纸库 — 场景';
        el.appendChild(head1);
        (lib.scenes || []).forEach(function (s) {
          el.appendChild(libItem('场景 ' + s.hash.slice(0, 8), { hash: s.hash }, s.hash));
        });
        var head2 = document.createElement('div');
        head2.className = 'zb-lib-head'; head2.textContent = '壁纸库 — 图片';
        el.appendChild(head2);
        (lib.images || []).forEach(function (im) {
          el.appendChild(libItem(im.name, { path: im.path }, im.path));
        });
        if (!(lib.scenes || []).length && !(lib.images || []).length) {
          el.innerHTML = '<div class="zb-lib-head">壁纸库为空 — 导入或更换壁纸后出现在这里</div>';
        }
      })
      .catch(function () { /* offline */ });
  }
  function libItem(label, applyBody, key) {
    var d = document.createElement('div');
    d.className = 'zb-item';
    d.textContent = label;
    d.title = label;
    var cur = localStorage.getItem('zcode-beautify:current-key');
    if (cur === key) d.setAttribute('data-current', '1');
    d.addEventListener('click', function () {
      post('/api/apply-wallpaper', applyBody, function (r) {
        if (r && r.error) { status(r.error); return; }
        try { localStorage.setItem('zcode-beautify:current-key', key); } catch (e) {}
        status('已应用 applied');
        loadLibrary();
      });
    });
    return d;
  }

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

  $('zb-fab').addEventListener('click', function () {
    var p = $('zb-panel');
    p.hidden = !p.hidden;
    if (!p.hidden) {
      refresh();
      loadLibrary();
      beat(true);
    } else if (root.getAttribute('data-offline') !== '1') {
      beat(false);
    }
  });
  $('zb-close').addEventListener('click', function () {
    $('zb-panel').hidden = true;
    if (root.getAttribute('data-offline') !== '1') beat(false);
  });

  // Fill in the fit label (and control values) right away, not just on open.
  refresh();

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
})();`;
}
