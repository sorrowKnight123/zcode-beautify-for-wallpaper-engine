# CHANGES.md — 动态壁纸（Wallpaper Engine 场景 / 视频壁纸）支持

> 基于 fork 上游 0.2.1（27d8699）。所有改动均为增量，静态壁纸原有链路保持不变。
> 0.3.0：场景壁纸 + 视频壁纸（.mp4/.webm 直接导入）+ 循环冻结看门狗 + ZCode 启动自动拉起 serve。
> 0.4.0：定时播放（多方案轮播）、WE 壁纸库浏览器、导入管线稳定性大修、面板三标签与界面遮罩（见下）。

## 0.4.0

> 相对 0.3.1 共 82 个提交；静态壁纸与 0.3.x 既有链路保持兼容。配套 Release 附预构建 zip。

### 定时播放（多方案轮播）

- 面板「定时播放」标签：多个命名播放方案（新建/改名/两段式删除即存）；每方案独立的模式（**顺序 / 随机不连播同张 / 每日定点**）、条目与**切换特效**（fade/slide/zoom/blur/none，方案级生效）。
- 条目引用壁纸库场景（hash）或图片（路径）；壁纸下拉带缩略图并预选当前壁纸；「启用」开关即时生效；「▶ 播放」一键保存并从第一张开始；「⏭」立即切下一张。
- 支持**恢复播放位置**（resumeIndex）与**按时段生效**（每方案时间窗口，支持跨夜）；**手动切换壁纸自动暂停轮播**，重新启用时从上次位置继续。
- API：`GET/POST /api/rotation`（坏条目静默剔除、上限 20 条、时长 ≥10s）、`POST /api/rotation-next`；serve 重启后启用中的轮播自动续播。

### Wallpaper Engine 壁纸库浏览器

- 面板内浏览本机 WE 壁纸：创意工坊（`steamapps/workshop/content/431960`）与自建项目（`myprojects`），多 Steam 库扫描（含注册表 SteamPath）；**类型 / 文件夹两种视图**（文件夹视图与 WE 内部分组一致：root 只显示文件夹卡、进入后平铺、← 返回）、3 列网格、搜索、**多选批量导入**（串行队列 + 进度）、已导入角标、显示 WE 真实标题。
- 悬停预览按"各自素材优先"取最佳活媒介：视频壁纸播自己的源片；场景按需**真渲染预览**（640×360 小样，永久缓存）；其余显示 WE 自带预览图/封面；预览按自然比例定位、不越出视口。

### 导入管线（稳定性大修）

- **根因修复**：传给 WE 的必须是 `.pkg` **文件**而非壁纸目录（本机 WE 对目录输入永久黑窗）——管线自动解析并传文件。
- **黑帧门禁**：发布前检测成片亮度，黑帧永不入库（删临时件 + 明确报错）；黑帧自动重试/重开窗，最多三轮；开窗前还有窗口预检。
- **后台录制**：PrintWindow 客户区捕获（`PW_CLIENTONLY|PW_RENDERFULLCONTENT`）——渲染窗口沉底、被 ZCode 完全遮挡也能录到正确画面；帧序列 BMP→PNG（体积 ~1/10）；无任何置顶/z-order 技巧；不重启 WE 核心；settle 8s。
- 批量导入显示"第 i/N 个"；新增**录制分辨率**设置（跟随壁纸 / 1080p / 720p / 自定义）。
- 导入不再触碰用户的 WE 界面：检测到 UI 开启时明确报错并指引先关闭。
- **修复中文路径导入失败**（面板文件对话框强制 UTF-8 输出，ACP-936 系统）；`POST /api/import-scene` 支持 `maxSeconds`(5..60) 规避低内存机器 60s 循环 OOM；`/api/config` 暴露 `wallpaperPath`（仅 image 模式）供面板预选当前壁纸。

### 面板与外观

- 三标签页（**壁纸 / 定时播放 / 设置**）+ 卡片化布局；每卡独立折叠并记忆；悬停大图预览；缩略图壁纸选择器（每组独立 5 行滚动窗）；定时播放列表滚动窗。
- 设置页：显示调节（模糊 / 压暗 / 取景 cover·contain·smart / 图片缓动 Ken Burns）、**聊天界面分区遮罩**（整体压暗 / 上下端渐变蒙版 / 白纱）、昼夜护眼、显示壁纸开关、每库显示行数（3-20）、录制分辨率、配置导出/导入、最近使用 + 历史记录（20 条）。
- 启动画面选项（等 ZCode 启动完成再显示壁纸）；**ZCode 更新窗口默认保持原样**，可在设置中改为"更新界面显示壁纸"（无面板）。

### 稳定性与安全

- 控制 API 与媒体端点 **token 鉴权**（每次启动随机 token，媒体走 `?t=`）；配置**原子写入**（磁盘满不损坏旧配置）；所有子进程 `windowsHide`；导入可取消（AbortController）；并发导入唯一临时名；场景缓存 LRU 10GB。
- **切换黑闪修复**（视频合成器黑块 / 缩略图闪烁）；**8K 图片切换 5s → 13ms**（ffmpeg 预生成取色缩略图 + `/media/lib` URL 缓存 + 素材 LRU）。
- 特效偶发"像直接切换"修复：`launch` 自动禁用 Chromium 遮挡判定；媒体流错误不再崩 serve。

## 0.3.1

- **快捷方式 CDP 标志自动持久化**：新增 `src/core/shortcuts.ts`，扫描桌面（含一层子文件夹、OneDrive 重定向）、用户/全局开始菜单、任务栏固定区的 `ZCode*.lnk`，自动补 `--remote-debugging-port`；接入 `launch` 命令与 MCP bootstrap（每次 ZCode 启动自愈）。上游同名提交只有文档，此为实现。
- **serve 数据目录统一**：MCP 启动的 serve 不再继承插件级 `ZCODE_BEAUTIFY_DATA_DIR`（`<plugin>@<marketplace>` 目录），手动/自动启动共用默认数据目录——修复"重启后面板壁纸库为空"。
- **壁纸库重命名/删除**：场景条目改名存 `name.json` 附属文件（不影响缓存身份），两段式删除，正在使用的条目拒绝删除；库列表不再按 `wallpaper*` 前缀过滤（修复"重命名后图片消失"）。
- **子进程不再弹终端窗**：统一 `windowsHide`（`src/core/exec.ts` 共享 helper，替换 5 处重复包装器）。

## 功能概述

- 支持导入 Wallpaper Engine **场景壁纸**（`.pkg` 或含 `project.json` 的工坊目录）：
  WE 专属窗口渲染 → ffmpeg ddagrab 录制 → 交叉淡化无缝循环 → 本地缓存 → 注入 `<video>` 动态背景。
- 静态图片壁纸流程、面板、CLI、MCP 行为不变；场景壁纸复用同一注入层（增量字段）。

## 新增模块（src/core/）

| 文件 | 职责 |
|---|---|
| `wallpaperType.ts` | 输入类型检测（image/scene/video/web/unknown），覆盖真实工坊目录的多种 project.json 布局（含无 type/file 字段、资产在 files/ 子目录的情况） |
| `dependencyCheck.ts` | WE 检测（运行进程 → 注册表 → libraryfolders.vdf → 多盘扫描 → PATH）；ffmpeg 检测（PATH 或 `ZCODE_BEAUTIFY_FFMPEG` 环境变量覆盖，版本 ≥5.0 校验，ddagrab 需要）；安装引导文案 |
| `weLauncher.ts` | WE 专属窗口开关：`-control openWallpaper -playInWindow`；窗口等待/定位（EnumWindows 精确匹配 + SetWindowPos，实测客户区）；关闭走 `-control closeWallpaper`（spawn 句柄不可靠，仅诊断用） |
| `recorder.ts` | ddagrab 捕获（置顶窗口 → `hwdownload,format=bgra → crop → scale` → libx264）；blackdetect/signalstats 黑屏自检 |
| `loopProcessor.ts` | 无缝循环：`crossfade(尾部淡出, 开头淡入) ++ 主体` 构造，首尾帧严格相等（SSIM 实测 0.999996）；`-movflags +faststart -an` |
| `cacheManager.ts` | 内容寻址缓存（MD5 of 内容/清单 + opts），`~/.zcode/cli/plugins/data/zcode-beautify/scenes/<hash>/loop.mp4`；LRU（mtime 记账，NTFS atime 默认禁用不可依赖）10GB 上限 |
| `media.ts` | serve 模式媒体端点实现（HTTP Range 206，全区间/后缀/开区间） |
| `scenePipeline.ts` | 端到端流水线 importScene()：detect → deps → cache → open → record → loop → poster → save → LRU；每步 onProgress |

## 修改文件

- `src/core/cdp.ts`：`InjectionPayload` 新增 `videoSrc`；bootstrap 脚本支持 `<video>` 层（autoplay/loop/muted/playsinline，`document.hidden` 暂停/恢复，视频跳过 localStorage 持久化）；reset 清理 video 状态。**图片路径行为不变。**
- `src/core/inject.ts`：`BeautifyConfig` 新增 `sceneVideoUrl / mediaType / sceneHash / apiPort`；`buildPayload` 支持 video 源；新增 `buildInjectScript` 便捷封装。
- `src/core/session.ts`：`applyWallpaper` 自动识别场景输入并路由到新 `applySceneWallpaper`；`buildPayloadFromConfig` 视频分支（Monet 取色来自 poster.jpg，视频走 http 流）。图片应用逻辑等价重构（baseConfig 提取）。
- `src/core/scenePipeline.ts`：`resolveSceneInput` 接受 `.pkg`、壁纸目录、或目录内任意文件（文件对话框场景下向上查找 project.json）。
- `src/core/server.ts`：新增 `POST /api/pick-scene`（原生文件对话框，供面板「选择并导入」使用）、`POST /api/import-scene`（后台任务）、`GET /api/import-status`、`GET /api/library`（image/scene 分组）、`POST /api/apply-wallpaper`（按 hash 或 path）、`GET /media/scene/<hash>.mp4`（Range）；注入会话透传 videoSrc。
- `src/panel/panelScript.ts`：新增场景导入（「选择并导入…」按钮调起原生文件选择器 + 路径输入 + 进度条 + 失败依赖引导「已安装，重试」）、壁纸库分组列表。原有滑杆/开关不变。
- `src/cli.ts`：新增 `apply-scene` 子命令。
- `src/mcp/server.ts`：新增 `import_scene_wallpaper` 工具；`set_background` 自动识别场景输入；导出 `TOOL_NAMES` 注册表。
- `commands/beautify.md`：支持「导入场景壁纸」意图与依赖引导说明。
- `package.json`：devDependencies 增加 `tsx`（验证脚本运行器；构建产物不含）。

## 关键技术事实（详见 docs/spike-notes.md）

- crop 必须在 `hwdownload` 之后（d3d11 帧上 crop 被静默忽略）。
- ddagrab 抓合成屏幕：录制期间必须把 WE 窗口置顶。
- WE `-playInWindow` 窗口标题=参数值，但窗口归属已运行实例，关闭必须走控制命令。
- 原任务包的淡化滤镜链会丢弃 overlay 帧（overlay 随主输入结束），已替换为数学上首尾相等的构造。
- 渲染器 video 走 http://127.0.0.1 流（file:/// 不可靠、data URI 超配额）。

## 回滚方式

- 单文件独立，`git revert` 或按上表删除新增文件、还原修改文件即可。
- 缓存数据在 `~/.zcode/cli/plugins/data/zcode-beautify/scenes/`，删除该目录即完全清除动态壁纸缓存。
- 新增配置字段（mediaType/sceneHash/apiPort/sceneVideoUrl）均为可选，旧配置文件无需迁移。

## 验证

各任务验证脚本位于 `test/t*-verify.ts`（`npx tsx test/tX-verify.ts` 运行）。
T3/T4/T8 需要本机装有 Wallpaper Engine 与 ffmpeg（或设置 `ZCODE_BEAUTIFY_FFMPEG`）。
