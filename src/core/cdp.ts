/**
 * Minimal Chrome DevTools Protocol client for the ZCode desktop renderer.
 *
 * ZCode (production) starts without a debug port; the launcher must start it
 * with `--remote-debugging-port=<port>` before this module can connect.
 */

export interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

export class CdpError extends Error {}

export async function listTargets(port: number, host = "127.0.0.1"): Promise<CdpTarget[]> {
  let res: Response;
  try {
    res = await fetch(`http://${host}:${port}/json/list`, { signal: AbortSignal.timeout(3000) });
  } catch {
    throw new CdpError(`Cannot reach CDP at ${host}:${port} — is ZCode running with --remote-debugging-port=${port}?`);
  }
  if (!res.ok) throw new CdpError(`CDP /json/list returned HTTP ${res.status}`);
  return (await res.json()) as CdpTarget[];
}

/** The main chat window renderer; excludes helper pages and overlay panels. */
export function pickRendererTargets(targets: CdpTarget[]): CdpTarget[] {
  const pages = targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  const main = pages.filter(
    (t) => t.url.includes("out/renderer/index.html") || t.title === "ZCode"
  );
  return main.length > 0 ? main : pages.filter((t) => !t.url.includes("devtools://"));
}

/**
 * ZCode's update-status window (download/install progress dialog): the same
 * renderer page with `windowKind=update-status` in the query. Beautifying it
 * is opt-in (config.showOnUpdater) — by default the plugin leaves it stock.
 */
export function isUpdaterTarget(t: { url?: string }): boolean {
  return typeof t.url === "string" && t.url.includes("windowKind=update-status");
}

export class CdpConnection {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private eventHandlers = new Map<string, Set<(params: any) => void>>();
  readonly targetUrl: string;

  private constructor(wsUrl: string) {
    this.targetUrl = wsUrl;
    this.ws = new WebSocket(wsUrl);
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new CdpError(`${msg.error.message} (code ${msg.error.code})`));
          else p.resolve(msg.result);
        }
      } else if (msg.method) {
        this.eventHandlers.get(msg.method)?.forEach((h) => h(msg.params));
      }
    });
    this.ws.addEventListener("close", () => {
      for (const p of this.pending.values()) p.reject(new CdpError("CDP connection closed"));
      this.pending.clear();
    });
  }

  static connect(wsUrl: string): Promise<CdpConnection> {
    return new Promise((resolve, reject) => {
      const conn = new CdpConnection(wsUrl);
      const timer = setTimeout(() => reject(new CdpError("CDP websocket connect timeout")), 5000);
      conn.ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(conn);
      });
      conn.ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new CdpError(`CDP websocket error for ${wsUrl}`));
      });
    });
  }

  get isOpen(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event: string, handler: (params: any) => void): void {
    let set = this.eventHandlers.get(event);
    if (!set) this.eventHandlers.set(event, (set = new Set()));
    set.add(handler);
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

export interface InjectionPayload {
  /** CSS text covering :root/.dark variable overrides + wallpaper layer styling. */
  css: string;
  /** Optional data-URI wallpaper image; empty to skip the wallpaper layer. */
  wallpaperDataUri?: string;
  /**
   * Optional scene-wallpaper loop video URL (http://127.0.0.1 from serve).
   * Rendered as a <video> inside the wallpaper layer container: file:/// URLs
   * are unreliable in the renderer, and a 1080p data URI would blow the
   * localStorage quota, so scene videos skip persistence entirely.
   */
  videoSrc?: string;
  /** Unique-ish id so re-injection is idempotent. */
  marker?: string;
  /** "contain" additionally drives a blurred backdrop layer behind the image. */
  fit?: "cover" | "contain";
  /** Switching effect played by the transition overlay (default "fade"). */
  transition?: string;
  /** Slow pan/zoom breathing on a static image wallpaper (Ken Burns). */
  kenBurns?: boolean;
  /** Video wallpaper audio 0-100 (0/absent = muted). */
  videoVolume?: number;
  /** Zone-refined chat-area masks (聊天界面); absent = all zero. */
  chatLook?: { chatDim: number; maskTop: number; maskBottom: number; frost: number };
  /** Defer mounting until the ZCode startup screen finished (default true). */
  startupClean?: boolean;
}

/**
 * Injects CSS + a persistence script into one renderer target. The script is
 * registered via Page.addScriptToEvaluateOnNewDocument so it survives reloads
 * for as long as this CDP session lives.
 */
export async function injectIntoTarget(
  target: CdpTarget,
  payload: InjectionPayload
): Promise<void> {
  const conn = await CdpConnection.connect(target.webSocketDebuggerUrl!);
  try {
    await conn.send("Page.enable");
    await conn.send("Runtime.enable");
    const bootstrap = buildBootstrapScript(payload);
    await conn.send("Page.addScriptToEvaluateOnNewDocument", { source: bootstrap });
    await conn.send("Runtime.evaluate", {
      expression: bootstrap,
      returnByValue: true,
    });
  } finally {
    conn.close();
  }
}

export function buildBootstrapScript(payload: InjectionPayload): string {
  const marker = payload.marker ?? "zcode-beautify";
  const videoSrc = payload.videoSrc ?? "";
  return `(function(){
  var MARKER = ${JSON.stringify(marker)};
  var STARTUP_CLEAN = ${JSON.stringify(payload.startupClean !== false)};
  // The startup screen phase (body carries zcode-startup-* but not yet
  // -ready) shows the loading art — a wallpaper layer and the panel FAB on
  // top of it look broken. With startupClean the whole bootstrap (and the
  // panel) waits for the ready class; without it everything mounts at once.
  var inStartupScreen = function() {
    if (!document.body) return true;
    var cls = document.body.className || '';
    return /zcode-startup/.test(cls) && !/ready/.test(cls);
  };
  var runBootstrapBody = function() {
  if (!window.__zcodeBeautify) window.__zcodeBeautify = {};
  var VIDEO_SRC = ${JSON.stringify(videoSrc)};
  var WP_IMG = ${JSON.stringify(payload.wallpaperDataUri ?? "")};
  var VOL = Math.max(0, Math.min(100, Math.round(${JSON.stringify(payload.videoVolume ?? 0)})));
  var CHAT = ${JSON.stringify(JSON.stringify(payload.chatLook ?? { chatDim: 0, maskTop: 0, maskBottom: 0, frost: 0 }))};
  // Volume-only fast path: changing just the audio must not rebuild the
  // video (instant switch would retire + re-create the decoder). VOL must be
  // declared ABOVE this block — it used to sit below the fast path, which
  // therefore read undefined, unmuted the video and wrote NaN volume (the
  // serve-side volume re-evaluate fallback was masking exactly this).
  if (VIDEO_SRC && VOL !== (window.__zcodeBeautify.vol ?? 0)
      && window.__zcodeBeautify.cssText === ${JSON.stringify(payload.css)}
      && window.__zcodeBeautify.videoSrc === VIDEO_SRC
      && window.__zcodeBeautify.kb === ${JSON.stringify(Boolean(payload.kenBurns))}) {
    var liveVid = document.getElementById(MARKER + '-video');
    if (liveVid) {
      liveVid.muted = VOL === 0;
      liveVid.volume = VOL / 100;
      liveVid.play().catch(function() {});
    }
    window.__zcodeBeautify.vol = VOL;
    if (window.__zcodeBeautify.chatKey !== CHAT) {
      window.__zcodeBeautify.chatKey = CHAT;
      applyChatLook();
    }
    return;
  }

  // Chat-look fast path: the zone masks are standalone CSS-var layers, so a
  // slider drag must not replay the wallpaper transition. When ONLY the chat
  // look changed (wallpaper state identical + style element alive), apply it
  // and bail before any wallpaper work.
  if (window.__zcodeBeautify.chatKey !== CHAT) {
    var chatOnly = window.__zcodeBeautify.cssText === ${JSON.stringify(payload.css)}
      && window.__zcodeBeautify.videoSrc === VIDEO_SRC
      && window.__zcodeBeautify.wpImg === WP_IMG
      && window.__zcodeBeautify.kb === ${JSON.stringify(Boolean(payload.kenBurns))}
      && window.__zcodeBeautify.vol === VOL
      && document.getElementById(MARKER + '-style');
    window.__zcodeBeautify.chatKey = CHAT;
    applyChatLook();
    if (chatOnly) return;
  }

  // State alone is not proof the DOM work succeeded: an earlier run may have
  // died halfway (e.g. aborted mid-transition) leaving state set but no style
  // element — without the element check every later injection would silently
  // no-op and the page would never heal. kb participates too: toggling Ken
  // Burns alone changes no CSS, and without it the toggle would early-return
  // before applyKb ever runs.
  if (window.__zcodeBeautify.cssText === ${JSON.stringify(payload.css)} && window.__zcodeBeautify.videoSrc === VIDEO_SRC && window.__zcodeBeautify.wpImg === WP_IMG && window.__zcodeBeautify.kb === ${JSON.stringify(Boolean(payload.kenBurns))} && window.__zcodeBeautify.vol === VOL && document.getElementById(MARKER + '-style')) return;
  window.__zcodeBeautify.cssText = ${JSON.stringify(payload.css)};
  window.__zcodeBeautify.videoSrc = VIDEO_SRC;
  window.__zcodeBeautify.wpImg = WP_IMG;
  window.__zcodeBeautify.kb = ${JSON.stringify(Boolean(payload.kenBurns))};
  window.__zcodeBeautify.vol = VOL;

  var style = document.getElementById(MARKER + '-style');
  if (!style) {
    style = document.createElement('style');
    style.id = MARKER + '-style';
    (document.head || document.documentElement).appendChild(style);
  }
  // Theme CSS (Monet palette) invalidates the WHOLE document's styles; applying
  // it mid-animation costs a 50-80ms main-thread task that stutters the effect.
  // When a transition plays, the swap is deferred to the promote step; instant
  // switches apply it right away. Base wallpaper rules are identical between
  // injections, so holding the old content for one transition is safe.
  var CSS_TEXT = ${JSON.stringify(payload.css)};
  var cssDeferred = false;

  // --- wallpaper application with transition effect --------------------------
  // The OLD content stays visible while a temporary overlay carrying the NEW
  // wallpaper animates in on top; on completion the new content is promoted
  // into the main layer and the overlay removed. TRANSITION picks the effect:
  // fade (crossfade), slide (new wallpaper sweeps in from the right), zoom
  // (scales down while fading in), blur (sharpens while fading in), or none
  // (instant swap). The first injection (nothing on screen yet) and every
  // change from a blank state apply instantly. The overlay is a plain child
  // of the wallpaper layer, so the ::after dim mask keeps painting above it.
  var wp = document.getElementById(MARKER + '-wallpaper');
  var HAS_NEW = ${JSON.stringify(Boolean(payload.wallpaperDataUri))} || VIDEO_SRC;
  var TRANSITION = ${JSON.stringify(payload.transition ?? "fade")};
  var KB_ON = ${JSON.stringify(Boolean(payload.kenBurns))} && !VIDEO_SRC;
  /** Ken Burns breathing on the settled wallpaper layer (image only): the
   *  running animation's transform outranks the stylesheet's static scale,
   *  and the payload only arms it when blur is off, so the two never fight.
   *  Re-assigning the same animation is a no-op — clear + reflow restarts it
   *  so every switch begins the pan from its first keyframe. */
  var applyKb = function(on) {
    if (!wp) return;
    if (!on) {
      wp.style.animation = '';
      return;
    }
    wp.style.animation = 'none';
    void wp.offsetWidth;
    wp.style.animation = MARKER + '-kb 26s ease-in-out infinite alternate';
  };
  if (HAS_NEW && !wp) {
    wp = document.createElement('div');
    wp.id = MARKER + '-wallpaper';
    document.documentElement.appendChild(wp);
  }
  // A transition still in flight (rapid switches) is promoted immediately
  // first so only one overlay ever exists.
  if (window.__zcodeBeautify.finishFade) window.__zcodeBeautify.finishFade();

  // Retiring a video pauses and hides it but leaves the element in the DOM:
  // detaching a video's compositor surface mid-transition makes Windows flash
  // a black rectangle on screen (invisible to CDP captures, very visible to
  // the user). The retired element is swept at the START of the next switch,
  // when the fresh transition masks any surface churn. Clearing src + load()
  // also RELEASES the hardware decoder session right away — a paused <video>
  // keeps its decoder (and its GPU budget) alive until unloaded.
  var retireVideo = function(v) {
    if (!v) return;
    v.removeAttribute('id');
    try { v.pause(); } catch (e) {}
    try { v.removeAttribute('src'); v.load(); } catch (e) {}
    v.style.opacity = '0';
    v.style.pointerEvents = 'none';
    v.dataset.zbRetired = '1';
  };
  if (wp) {
    var strays = wp.querySelectorAll('video');
    for (var si = 0; si < strays.length; si++) {
      var sv = strays[si];
      if (sv.id !== MARKER + '-video' || sv.dataset.zbRetired) sv.remove();
    }
  }

  if (!HAS_NEW) {
    if (wp) wp.remove();
  } else {
    var oldVid = document.getElementById(MARKER + '-video');
    var oldImg = wp.style.backgroundImage && wp.style.backgroundImage !== 'none';
    var animate = Boolean((oldVid || oldImg) && TRANSITION !== 'none');

    // The image transition runs on a temporary overlay div. Videos NEVER live
    // in that overlay: promote would have to reparent the <video> into the
    // wallpaper layer, and reparenting (or removing) a playing video rebuilds
    // its compositor surface — the black flash this whole block exists to
    // avoid. A transition video is born inside the wallpaper layer, parked at
    // opacity 0, and the effect animation runs on the element itself.
    // Keyframes live OUTSIDE the animate branch: applyKb at the tail needs
    // -kb on instant switches too (first apply, transition "none").
    if (!document.getElementById(MARKER + '-fade-style')) {
      var fs = document.createElement('style');
      fs.id = MARKER + '-fade-style';
      fs.textContent = ''
        + '@keyframes ' + MARKER + '-fx-fade { from { opacity: 0; } to { opacity: 1; } }'
        + '@keyframes ' + MARKER + '-fx-slide { from { transform: translateX(100%); } to { transform: translateX(0); } }'
        + '@keyframes ' + MARKER + '-fx-zoom { from { opacity: 0; transform: scale(1.15); } to { opacity: 1; transform: scale(1); } }'
        + '@keyframes ' + MARKER + '-fx-blur { from { opacity: 0; filter: blur(24px); } to { opacity: 1; filter: blur(0px); } }'
        + '@keyframes ' + MARKER + '-kb { from { transform: scale(1) translate(0%, 0%); } to { transform: scale(1.08) translate(-1.6%, -1.1%); } }';
      (document.head || document.documentElement).appendChild(fs);
    }
    var holder = null;
    var vidBase = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;';
    var vidFx = '';
    // blur(24px) is a per-frame GPU filter over the FULL screen — on a video
    // target it costs far more than the crossfade look justifies. Filter-type
    // effects downgrade to the compositor-cheap fade; transform/opacity ones
    // (slide/zoom) stay.
    var EFFECT = VIDEO_SRC && TRANSITION === 'blur' ? 'fade' : TRANSITION;
    if (animate) {
      cssDeferred = true; // theme swap moves to promote(); see CSS_TEXT above
      if (EFFECT === 'slide') {
        vidFx = 'animation:' + MARKER + '-fx-slide 650ms cubic-bezier(.22,.61,.36,1) forwards;';
      } else if (EFFECT === 'zoom') {
        vidFx = 'opacity:0;animation:' + MARKER + '-fx-zoom 650ms ease forwards;';
      } else if (EFFECT === 'blur') {
        vidFx = 'opacity:0;animation:' + MARKER + '-fx-blur 650ms ease forwards;';
      } else {
        vidFx = 'opacity:0;animation:' + MARKER + '-fx-fade 650ms ease forwards;';
      }
      if (!VIDEO_SRC) {
        holder = document.createElement('div');
        holder.id = MARKER + '-fade';
        // Parked invisible at first; the animation css (below) is applied only
        // once the new content has decoded, so decoder spin-up long tasks land
        // while the screen is still static instead of stuttering the motion.
        // CSS animations (compositor-driven for opacity/transform) instead of
        // JS-started transitions: throttled/occluded renderers never fire rAF
        // and delay timers past 1s — animations keep running.
        var fxBase = 'position:absolute;inset:0;background-size:inherit;background-position:inherit;background-repeat:inherit;';
        var fxAnim = vidFx;
        holder.style.cssText = fxBase + 'opacity:0;';
        wp.appendChild(holder);
      }
    }

    var newVid = null;
    if (VIDEO_SRC) {
      var nv = document.createElement('video');
      // NO autoplay attribute: the element must stay parked until the
      // transition arms (autoplay would start playback on attach and defeat
      // the single-decoder warm-up).
      nv.setAttribute('loop', '');
      nv.setAttribute('playsinline', '');
      // Born in the wallpaper layer — its final home. NOT playing yet: the
      // warm-up only needs the FIRST frame (preload decodes it), so the old
      // wallpaper keeps the only active decoder until the animation starts.
      // Two parallel 1080p decodes during warm-up was a real GPU spike.
      nv.setAttribute('preload', 'auto');
      nv.muted = VOL === 0;
      nv.volume = VOL / 100;
      nv.style.cssText = vidBase + (animate ? 'opacity:0;' : '');
      nv.setAttribute('src', VIDEO_SRC);
      nv.load();
      wp.appendChild(nv);
      newVid = nv;
      if (!animate) {
        retireVideo(document.getElementById(MARKER + '-video'));
        nv.id = MARKER + '-video';
        nv.play().catch(function() {});
        applyKb(false);
      }
    } else if (${JSON.stringify(Boolean(payload.wallpaperDataUri))}) {
      if (!holder) holder = wp; // instant image switch paints the main layer directly
      holder.style.backgroundImage = 'url(' + ${JSON.stringify(payload.wallpaperDataUri ?? "")} + ')';
    }

    if (animate) {
      var overlay = holder; // null for video switches: the video animates itself
      var done = false;
      var started = false;
      var promote = function() {
        if (done) return;
        done = true;
        window.__zcodeBeautify.finishFade = null;
        style.textContent = CSS_TEXT; // deferred theme swap — motion is over
        // The outgoing video is retired, not removed — see retireVideo.
        retireVideo(document.getElementById(MARKER + '-video'));
        if (VIDEO_SRC) {
          wp.style.backgroundImage = 'none';
          applyKb(false);
          if (newVid) {
            newVid.id = MARKER + '-video';
            // Settle in place (opacity 1, animation styles dropped). No DOM
            // move: reparenting would rebuild the video surface.
            newVid.style.cssText = vidBase;
            newVid.play().catch(function() {});
          }
        } else if (overlay && overlay.parentNode) {
          wp.style.backgroundImage = overlay.style.backgroundImage;
          overlay.remove();
          applyKb(KB_ON);
        }
      };
      window.__zcodeBeautify.finishFade = promote;
      var startAnim = function() {
        if (started || done) return;
        started = true;
        if (overlay) {
          // cssText is replaced wholesale to arm the animation — the parked
          // background image (set before parking) must survive that swap, or
          // the effect animates an empty layer and promote clears the wallpaper
          // (every other image click failed exactly this way).
          var parkedBg = overlay.style.backgroundImage;
          overlay.style.cssText = fxBase + fxAnim;
          overlay.style.backgroundImage = parkedBg;
          overlay.addEventListener('animationend', promote);
        } else if (newVid) {
          newVid.style.cssText = vidBase + vidFx;
          // Playback starts WITH the animation — the parked element held no
          // decoder session until this exact moment.
          newVid.play().catch(function() {});
          newVid.addEventListener('animationend', promote);
        }
        setTimeout(promote, 780);
      };
      // Warm the new content first: a parked (paused) video needs
      // readyState >= 2 — the first frame decoded and renderable — before the
      // animation exposes it (requestVideoFrameCallback is playback-driven
      // and never fires while parked). Images wait for decode(). A timeout
      // keeps the switch landing even if the event never fires.
      if (newVid) {
        if (newVid.readyState >= 2) startAnim();
        else {
          newVid.addEventListener('loadeddata', startAnim);
          setTimeout(startAnim, 900);
        }
      } else {
        var im = new Image();
        var imSrc = overlay.style.backgroundImage.replace(/^url\\(["']?/, '').replace(/["']?\\)$/, '');
        var warm = function() { if (im.decode) im.decode().then(startAnim, startAnim); else startAnim(); };
        im.onload = warm;
        im.onerror = startAnim;
        im.src = imSrc;
        setTimeout(startAnim, 600);
      }
    }
  }

  if (!cssDeferred) style.textContent = CSS_TEXT;
  // Instant switches (and option-only pushes) settle Ken Burns right away.
  if (HAS_NEW) applyKb(KB_ON);

  var FIT = ${JSON.stringify(payload.fit ?? "cover")};
  var bp = document.getElementById(MARKER + '-backdrop');
  if (FIT === 'contain' && ${JSON.stringify(Boolean(payload.wallpaperDataUri))}) {
    if (!bp) {
      bp = document.createElement('div');
      bp.id = MARKER + '-backdrop';
      document.documentElement.appendChild(bp);
    }
    bp.style.backgroundImage = 'url(' + ${JSON.stringify(payload.wallpaperDataUri ?? "")} + ')';
    bp.dataset.on = '1';
  } else if (bp) {
    bp.dataset.on = '0';
  }

  // --- chat-area zone look (聊天界面) ----------------------------------------
  // Four independent masks layered OVER the wallpaper but UNDER the UI (same
  // stacking model as the dim ::after): a white frost sheet, a top/bottom
  // edge gradient, and an extra darkening behind the conversation column —
  // set as the scroller's own background so messages stay readable above it.
  // All are static composited layers; no per-frame cost.
  window.__zcodeBeautify.chatKey = CHAT;
  applyChatLook();

  function applyChatLook() {
    var C;
    try { C = JSON.parse(CHAT); } catch (e) { return; }
    var anyOn = C.chatDim > 0 || C.maskTop > 0 || C.maskBottom > 0 || C.frost > 0;
    var st = document.getElementById(MARKER + '-chatlook-style');
    var fr = document.getElementById(MARKER + '-frost');
    var zm = document.getElementById(MARKER + '-zonemask');
    if (!anyOn) {
      if (st) st.remove();
      if (fr) fr.remove();
      if (zm) zm.remove();
      if (window.__zcodeBeautify.chatObs) {
        try { window.__zcodeBeautify.chatObs.disconnect(); } catch (e) {}
        window.__zcodeBeautify.chatObs = null;
      }
      return;
    }
    if (!st) {
      st = document.createElement('style');
      st.id = MARKER + '-chatlook-style';
      (document.head || document.documentElement).appendChild(st);
    }
    st.textContent = ':root{--zb-chat-dim:' + (C.chatDim / 100) + ';--zb-mask-top:' + (C.maskTop / 100)
      + ';--zb-mask-bot:' + (C.maskBottom / 100) + ';--zb-frost:' + (C.frost / 100) + '}'
      + '#' + MARKER + '-frost{position:fixed;inset:0;z-index:-2147483645;pointer-events:none;background:rgb(255 255 255 / var(--zb-frost))}'
      + '#' + MARKER + '-zonemask{position:fixed;inset:0;z-index:-2147483644;pointer-events:none;'
      + 'background:linear-gradient(to bottom,rgb(0 0 0 / var(--zb-mask-top)),rgb(0 0 0 / 0) 30%,rgb(0 0 0 / 0) 70%,rgb(0 0 0 / var(--zb-mask-bot)))}'
      // The conversation scroller carries distinctive Tailwind arbitrary
      // classes; .zb-chat-col is the version-proof fallback (markChatCol).
      + 'div[class*="scrollbar-gutter:stable"][class*="overflow-y-auto"],.zb-chat-col'
      + '{background-color:rgb(0 0 0 / var(--zb-chat-dim)) !important}';
    if (!fr) { fr = document.createElement('div'); fr.id = MARKER + '-frost'; }
    if (!zm) { zm = document.createElement('div'); zm.id = MARKER + '-zonemask'; }
    document.documentElement.appendChild(fr);
    document.documentElement.appendChild(zm);
    // Route changes (chat <-> settings) recreate the column, so keep tagging
    // it while the darkening is on. rAF-coalesced: streaming mutates a lot.
    if (C.chatDim > 0 && !window.__zcodeBeautify.chatObs) {
      markChatCol();
      var chatPend = false;
      var obs = new MutationObserver(function() {
        if (chatPend) return;
        chatPend = true;
        requestAnimationFrame(function() { chatPend = false; markChatCol(); });
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      window.__zcodeBeautify.chatObs = obs;
    }
  }
  // The composer's first TALL scroll ancestor is the conversation column.
  // (Not the composer itself — it is a small overflow-y-auto editor.)
  function markChatCol() {
    var el = document.querySelector('[contenteditable="true"]');
    el = el && el.parentElement;
    while (el && el !== document.body) {
      var oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.getBoundingClientRect().height > 300) {
        if (!el.classList.contains('zb-chat-col')) el.classList.add('zb-chat-col');
        return;
      }
      el = el.parentElement;
    }
  }

  // Keep the loop alive. Chromium's media suspension can freeze a nominally
  // playing wallpaper video (paused:false but the clock stops — occlusion
  // misdetection is common with transparent Electron windows), so a watchdog
  // samples currentTime and kicks the element whenever the page is visible
  // but the clock is frozen, paused, or ended.
  if (!window.__zcodeBeautify.visBound) {
    window.__zcodeBeautify.visBound = true;
    document.addEventListener('visibilitychange', function() {
      var v = document.getElementById(MARKER + '-video');
      if (!v) return;
      if (document.hidden) { v.pause(); } else { v.play().catch(function() {}); }
    });
    window.addEventListener('focus', function() {
      var v = document.getElementById(MARKER + '-video');
      if (v) v.play().catch(function() {});
    });
    window.addEventListener('pageshow', function() {
      var v = document.getElementById(MARKER + '-video');
      if (v) v.play().catch(function() {});
    });
  }
  if (!window.__zcodeBeautify.watchdog) {
    window.__zcodeBeautify.stallCount = 0;
    window.__zcodeBeautify.lastClock = -1;
    window.__zcodeBeautify.watchdog = setInterval(function() {
      var v = document.getElementById(MARKER + '-video');
      if (!v) return;
      var S = window.__zcodeBeautify;
      if (document.hidden) { S.lastClock = -1; return; }
      if (v.ended || v.paused) {
        S.stallCount = 0;
        v.play().catch(function() {});
      } else if (!v.paused && v.readyState >= 2 && S.lastClock === v.currentTime) {
        // nominally playing but the media clock is frozen
        S.stallCount++;
        if (S.stallCount >= 2) { v.load(); }
        v.play().catch(function() {});
      } else {
        S.stallCount = 0;
      }
      S.lastClock = v.currentTime;
    }, 2000);
  }

  // Persist for the panel's self-heal path (best effort; large wallpapers may
  // exceed the localStorage quota, in which case only the CSS is saved).
  // Scene videos are never persisted: the src is a serve URL and the loop
  // file itself would blow the quota.
  try {
    localStorage.setItem(MARKER + ':css', ${JSON.stringify(payload.css)});
    localStorage.setItem(MARKER + ':wallpaper', ${JSON.stringify(payload.wallpaperDataUri ?? "")});
  } catch (e) {}
  };
  var runBootstrap = function() {
    if (!STARTUP_CLEAN || !inStartupScreen()) { runBootstrapBody(); return; }
    if (window.__zcodeBeautify.startupMO) return; // a waiter is already armed
    var mo = new MutationObserver(function() {
      if (!inStartupScreen()) {
        mo.disconnect();
        window.__zcodeBeautify.startupMO = null;
        runBootstrapBody();
      }
    });
    window.__zcodeBeautify.startupMO = mo;
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  };
  // The addScriptToEvaluateOnNewDocument registration replays at document
  // creation, where documentElement is still null — appending the style or
  // wallpaper there throws and kills the run before anything mounts. Wait
  // for the parser to produce a root element (a few ms at most).
  if (document.documentElement) runBootstrap();
  else {
    var zbWaitMount = function() {
      if (document.documentElement) runBootstrap();
      else setTimeout(zbWaitMount, 10);
    };
    zbWaitMount();
  }
})();`;
}

/** Removes everything the bootstrap script created. */
export function buildResetScript(marker = "zcode-beautify"): string {
  return `(function(){
  document.getElementById(${JSON.stringify(marker)} + '-style')?.remove();
  document.getElementById(${JSON.stringify(marker)} + '-fade-style')?.remove();
  document.getElementById(${JSON.stringify(marker)} + '-wallpaper')?.remove();
  document.getElementById(${JSON.stringify(marker)} + '-backdrop')?.remove();
  document.getElementById(${JSON.stringify(marker)} + '-chatlook-style')?.remove();
  document.getElementById(${JSON.stringify(marker)} + '-frost')?.remove();
  document.getElementById(${JSON.stringify(marker)} + '-zonemask')?.remove();
  if (window.__zcodeBeautify) {
    window.__zcodeBeautify.cssText = null; window.__zcodeBeautify.videoSrc = null;
    window.__zcodeBeautify.wpImg = null; window.__zcodeBeautify.finishFade = null;
    window.__zcodeBeautify.chatKey = null;
    if (window.__zcodeBeautify.chatObs) {
      try { window.__zcodeBeautify.chatObs.disconnect(); } catch (e) {}
      window.__zcodeBeautify.chatObs = null;
    }
  }
})();`;
}
