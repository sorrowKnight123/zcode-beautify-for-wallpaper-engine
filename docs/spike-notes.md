# T0 Spike Notes — 动态壁纸捕获技术验证（已全部完成）

> 日期：2026-09-15 ｜ 机器：Windows 2560×1600 ｜ 本文件作为 T1–T10 的既定事实
> fork 已克隆至 `repo/`（Logocceai/zcode-beautify @ 0.2.1），建好后本文件移入 `repo/docs/`

## 环境（本机实测）

| 项 | 状态 |
|---|---|
| Wallpaper Engine | **已安装**：`D:\SteamLibrary\steamapps\common\wallpaper_engine\wallpaper64.exe`（Steam 库在 D 盘！首次检测漏掉即因只查 C 盘默认路径） |
| WE 壁纸库 | `D:\SteamLibrary\steamapps\workshop\content\431960\<id>\`，共 8 个，scene 型含 `.pkg`（3498185307）与散装 `scene.json`（2902406982）两种布局 |
| ffmpeg | 无全局安装；spike 用便携版 9.0.1 essentials（`spike/tools/`，含 ddagrab/blackdetect/h264_mf） |
| Node | v24.14.1（原生 WebSocket/fetch，CDP 客户端零依赖） |
| ZCode | v3.11.2 (Electron 41)，`--remote-debugging-port=9222` 运行中 |
| 显示器 | 2560×1600 |

## 结论 ①：捕获链路 — **ddagrab + 置顶窗口，实测通过**

最终可用命令（对真实 WE 场景壁纸 `3498185307` 实测，画面完整、blackdetect 零黑段）：

```
ffmpeg -f lavfi -i "ddagrab=output_idx=0:framerate=30" -t 5 \
  -vf "hwdownload,format=bgra,crop=W:H:X:Y,scale=1920:1080" \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p out.mp4
```

实测确认的硬性约束：

1. **crop 必须在 `hwdownload,format=bgra` 之后**——d3d11 硬件帧上 crop 被静默忽略
   （不报错，输出未裁剪整屏；spike 实测踩坑）。
2. **ddagrab 抓合成屏幕，不抓窗口内容**——WE_Render 被 ZCode 挡住时录到的是 ZCode。
   录制期间必须 `SetWindowPos(HWND_TOPMOST)` 把 WE_Render 置顶（已实测有效）。
3. **窗口定位顺序**：先 `SetWindowPos` 摆窗口（外框坐标/尺寸），再 `GetClientRect` +
   `ClientToScreen` 取录制矩形。直接用摆位前的客户区坐标会把标题栏录进画面（实测踩坑）。
4. `-playInWindow` 开出的窗口默认 1280×720（即使传了 `-width 1920 -height 1080`），
   窗口尺寸以 SetWindowPos 实测为准，不要信任 -width/-height。
5. 硬编 `h264_mf` 可用但需 `hwdownload,format=yuv420p`（不吃 d3d11 bgra 直入）；
   软编 libx264 ultrafast 本机流畅，默认软编。
6. gdigrab 对 SDL 窗口碰巧能抓（BitBlt 兼容路径），对 WE 场景不可信，仅作降级。
7. blackdetect 自检在深色壁纸上不误报（夜景壁纸 mean YAVG≈93，默认 pix_th=0.05 无触发）；
   自检建议用宽松阈值 + 仅作警示，不作为硬失败依据（纯黑壁纸会误伤）。

## 结论 ②：WE 控制命令 — **全部实测确认**

| 命令 | 实测结果 |
|---|---|
| `wallpaper64.exe -control openWallpaper -file <scene.pkg> -playInWindow WE_Render -width 1920 -height 1080` | 窗口标题**精确等于** `-playInWindow` 参数值 `WE_Render`（HWND 枚举确认） |
| 进程归属 | 窗口属于**已运行**的 wallpaper64.exe（PID 16204）——新 spawn 的进程仅转发 IPC 即退出，`ChildProcess` 句柄不可用于关闭（证实缺陷②） |
| `wallpaper64.exe -control closeWallpaper -playInWindow WE_Render` | 3s 内窗口干净关闭，桌面壁纸不受影响 |
| 窗口枚举 | PowerShell EnumWindows 按标题精确匹配 `WE_Render` 即可（比 tasklist /FI 可靠） |

**T3 设计定案**：open/close 都走 `-control` 命令行；等待与定位用 PowerShell EnumWindows +
SetWindowPos；spawn 的句柄只用于错误检测，不用于生命周期。

## 结论 ③：ZCode 渲染器播放 http 视频 — **PASS**

`spike/test_http_video.mjs`（零依赖，可移植进 serve 模式）：

- 临时 HTTP server（含 **Range 206** 分段）`127.0.0.1:18923` + CDP 注入
  `<video autoplay loop muted playsinline>`（非持久、测后即删）
- 结果：canplay ✓ playing ✓ currentTime 0→1.50s（1.5s 内）1920×1440 硬解正常
- **T7 定案**：serve 模式新增 `GET /media/scene/<hash>.mp4`（Range 支持），
  注入层 video 走 http 源、跳过 localStorage；data URI 与 `file:///` 均不可行。

## 对 T1–T10 的增量修正

- **T2**：WE 检测必须覆盖多盘 Steam 库（本机即 D:\SteamLibrary）——注册表
  `SteamPath`（本次 reg query 未命中，不可依赖）→ `libraryfolders.vdf` 枚举 →
  常见库路径扫描（`<盘>:\SteamLibrary`）。ffmpeg ≥5.0（ddagrab）。
- **T3**：如上；开窗后额外 SetWindowPos 到目标尺寸/位置（-width/-height 不可靠）。
- **T4**：录制前置顶 WE_Render，录完恢复/关闭；crop 在 hwdownload 后；
  录制矩形 = 定位后的客户区；blackdetect 宽松自检；默认 30fps。
- **T7/T8**：如结论③。

## 产物

- `spike/out/we_scene_ddagrab2.mp4` — 真实 WE 场景 5s 捕获（1920×1080）
- `spike/out/` — 各对比测试产物与帧
- `spike/test_http_video.mjs` — CDP 播放验证 + Range HTTP server 参考实现
- `spike/tools/ffmpeg-9.0.1-essentials_build/` — 便携 ffmpeg（T3/T4/T8 复用）

## 后补充（T9 集成期实测发现的另外两个坑）

8. **PowerShell 必须 SetProcessDPIAware**：非 DPI 感知进程的 ClientToScreen 返回逻辑坐标，
   与 ddagrab 的物理像素帧不匹配，crop 会错位。
9. **SWP flags 记错会静默坏事**：SWP_NOMOVE 是 0x2（不是 0x4=SWP_NOZORDER）。
   置顶用 `SWP_NOMOVE|SWP_NOSIZE = 0x3`；写错成 0x15 会把窗口挪到 (0,0) 且不置顶。
   另外录制客户区必须在「置顶之后、ffmpeg 启动之前」实时测量——WE 会异步挪动/改形自己的播放窗口。
