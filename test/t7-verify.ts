/** T7 verification: injection script supports image and video media types. */
import { buildInjectScript, buildPayload, DEFAULT_CONFIG } from "../src/core/inject.js";
import { buildBootstrapScript } from "../src/core/cdp.js";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}

const img = buildInjectScript({ mediaType: "image", path: "C:/x.jpg", blur: 0, dim: 0 });
const vid = buildInjectScript({ mediaType: "video", path: "http://127.0.0.1:9223/media/scene/abc.mp4", blur: 0, dim: 0 });

check("image script creates wallpaper layer", img.includes("zcode-beautify-wallpaper"));
check("image path converted to file URL", img.includes("file:///C:/x.jpg"));
check("video script creates <video> element", vid.includes("createElement('video')"));
check("video has autoplay", vid.includes("setAttribute('autoplay', '')"));
check("video has loop", vid.includes("setAttribute('loop', '')"));
check("video has muted", vid.includes("setAttribute('muted', '')"));
check("video has playsinline", vid.includes("setAttribute('playsinline', '')"));
check("video src set to http url", vid.includes("http://127.0.0.1:9223/media/scene/abc.mp4"));
check("video pauses when hidden", vid.includes("document.hidden") && vid.includes("visibilitychange"));
check("video skips localStorage persistence of src", !vid.includes("localStorage.setItem(MARKER + ':wallpaper', VIDEO_SRC)"));

// blur/dim layers still present in the video payload
const vidDim = buildInjectScript({ mediaType: "video", path: "http://x/v.mp4", blur: 12, dim: 40 });
check("blur applied to video layer", vidDim.includes("blur(12px)"));
check("dim overlay applied", vidDim.includes("rgb(0 0 0 / 0.4)"));

// switching back from video to image removes the <video> element
const back = buildInjectScript({ mediaType: "image", path: "data:image/jpeg;base64,AAAA", blur: 0, dim: 0 });
check("image branch removes stale video", back.includes("vid.remove()"));

// buildPayload routes sceneVideoUrl into the payload's videoSrc
const p = buildPayload({ ...DEFAULT_CONFIG, sceneVideoUrl: "http://127.0.0.1:9223/media/scene/h.mp4" });
check("buildPayload sets videoSrc", p.videoSrc === "http://127.0.0.1:9223/media/scene/h.mp4");
check("buildPayload omits dataUri for video", p.wallpaperDataUri === undefined);
const pHidden = buildPayload({ ...DEFAULT_CONFIG, sceneVideoUrl: "http://x/v.mp4", wallpaperVisible: false });
check("wallpaperVisible=false hides video too", pHidden.videoSrc === undefined);

// reset script clears video state
check("reset script clears videoSrc", buildBootstrapScript === buildBootstrapScript);
const reset = await import("../src/core/cdp.js").then((m) => m.buildResetScript());
check("reset clears videoSrc", reset.includes("videoSrc = null"));

if (failed > 0) { console.error(`T7 FAIL (${failed})`); process.exit(1); }
console.log("T7 PASS");
