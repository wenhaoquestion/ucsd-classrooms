# UCSD Classroom Explorer

[English](README.md) | **简体中文**

浏览加州大学圣地亚哥分校（UC San Diego）的教室、查询课程安排，并通过 3D 地图探索校园楼宇。

**[打开网站](https://wenhaoquestion.github.io/ucsd-classrooms/)** · **[探索 YORK 的 3D 室内图](https://wenhaoquestion.github.io/ucsd-classrooms/?building=YORK)** · **[室内地图技术文档（英文）](docs/indoor-geometry.md)**

![York Hall 的 3D 室内地图：楼层分离展示，并标注教室使用状态](static/open-graph.png)

*York Hall（YORK）：切换楼层，查看指定日期和时间的教室课程安排。*

## 功能

- **校园地图：** 按名称或楼宇代码定位建筑，并查看楼宇照片。可用双指、触控板或（桌面端）按钮缩放；缩小时标记会自动简化。
- **导航：** 在地图上显示你的位置，查看到楼宇的步行距离和时间，并在地图应用中打开步行路线。
- **空教室：** 搜索栏下方的「Free rooms」按钮列出接下来 20 分钟以上没有排课的教室；共享位置后按距离由近到远排序。在楼宇面板中，「Free now」可只显示当前空闲的教室，并显示下一节课的开始时间。
- **教室课表：** 查看已列出的课程，以及指定日期和时间的空档。
- **搜索：** 查询课程、教师、楼宇，或直接输入教室（如 `CENTR 115`）。
- **学期日历：** 浏览学期、教学周和具体日期，点击搜索栏下方的时间按钮，并用滚轮选择时间。无论浏览器处于哪个时区，时间均按太平洋时间显示。
- **可分享链接：** 直接分享楼宇、教室、课程、教师或日期的链接。
- **3D 楼宇浏览：** 查看建筑外观、周边楼宇、楼层和教室数量。有房间几何数据的楼宇还支持点选教室和查看课程状态配色。
- **室内布局：** 已发布的 Facilities 数据覆盖 77 个楼宇代码、9,697 个房间记录。只有楼层信息的教室会保留在对应楼层的列表中，不会被放到虚构的位置。
- **Geisel 图书馆自习室：** 在全部八层的 3D 模型上显示 Geisel 的 39 个可预约房间，并按所选日期和时间的 LibCal 实时预约情况着色（可预约、已预约、不可预约）。点选房间可查看当天的时间线；点击「Book」会在 LibCal 上打开该房间当天的页面，登录后即可预约。与图书馆地图一致，1–2 楼的房间以带标签的区块显示。
- **教室列表模式：** 关闭 3D 或浏览器不支持 WebGL 时，仍可访问教室列表与课表。在楼宇面板中用「List / 3D」切换；手机默认显示列表，浏览器会记住你的选择。

## 快速体验

点击地图上方的 **Plan this week**，直接在周日历上选择时段：电脑拖选，手机先选择日期，再点击开始和最后一个 15 分钟格子。
选中的时段会显示为色块，可以微调或删除；支持选择多个时段，分别查找整段时间都空闲的空间。
结果区分“课表未安排课程的教室”和“实时可预约的 Geisel 自习室”；时间以圣地亚哥时区、周一至周日为准。
缺失数据会显示无法确认，不会被算作空闲。点击结果可查看对应日期和时间的房间。

1. 打开[在线网站](https://wenhaoquestion.github.io/ucsd-classrooms/)。
2. 选择日期和时间，再从地图或搜索中选择楼宇。
3. 选择教室，查看课程安排。
4. 打开 [YORK](https://wenhaoquestion.github.io/ucsd-classrooms/?building=YORK) 体验室内地图，也可以直接查看 [2622 教室](https://wenhaoquestion.github.io/ucsd-classrooms/?building=YORK&room=2622)。

## 本地运行

需要 **Node.js 22** 和 npm。以下命令适用于 Windows、macOS 和 Linux。

```sh
git clone https://github.com/wenhaoquestion/ucsd-classrooms.git
cd ucsd-classrooms
npm ci
npm run dev
```

打开 **http://localhost:8000/**。楼宇照片托管在 Imgur；如果使用 `127.0.0.1` 无法加载照片，请改用 `localhost`。

```sh
# 构建生产版本，输出至 dist/
npm run build

# 运行部署前使用的各项检查
npm run typecheck
npm run lint -- src scripts tests
npm test
npm run validate:indoor

# 根据源数据重新生成 EBU3B 室内布局
npm run indoor:build -- EBU3B

# 将下载的公共校园地图图层转换为楼宇外观数据
npm run campus:build -- footprints.json attributes.json
```

## 部署到 GitHub Pages

本项目是静态前端，无需应用服务器或 API 密钥。课程安排和楼宇照片从外部公共数据源加载。

Geisel 实时空闲情况还需要一个小组件：LibCal 不允许其他网站直接读取，因此由一个免费的 Cloudflare Worker 代为获取。部署一次后，设置仓库变量 `LIBCAL_PROXY_URL` 即可，详见 [worker/README.md](worker/README.md)。未设置时，Geisel 的房间仍会显示并链接到 LibCal，只是不按空闲情况着色。`npm run dev` 会在本地直接提供同样的数据，无需 Worker。

[部署工作流](.github/workflows/gh-pages.yml) 会在推送到 `main` 时运行，也可以在仓库的 Actions 页面手动启动。工作流会按锁文件安装依赖、执行检查、构建 `dist/`，并将该目录发布到 GitHub Pages。

在 **Settings → Pages → Build and deployment** 中，将发布来源设为 **GitHub Actions**。部署成功后可通过以下地址访问：

**https://wenhaoquestion.github.io/ucsd-classrooms/**

如果部署到其他 fork，请更新 `scripts/build.mjs` 中的站点地址、`static/index.html` 中的预览图片地址，以及两份 README、`package.json` 和 `src/components/App.tsx` 中的仓库链接。

## 项目结构

| 路径 | 用途 |
| --- | --- |
| `src/components/` | React 界面、课表、搜索和楼宇浏览组件 |
| `src/explorer3d/` | Three.js 渲染器、室内场景和粒子效果 |
| `src/lib/indoor/` | 布局结构、加载、几何校验和课程映射 |
| `src/lib/library/`、`src/components/library/` | Geisel 自习室、LibCal 空闲数据和预约面板 |
| `worker/` | 从 LibCal 读取 Geisel 空闲情况的 Cloudflare Worker |
| `data/indoor/GEISEL/` | Geisel 楼层地图测量数据和校园地图楼层体块 |
| `data/indoor/EBU3B/` | 来源元数据、房间标签和描摹的楼层几何数据 |
| `static/indoor/` | 打开相应楼宇时按需加载的室内布局 |
| `static/indoor/facilities/` | 已发布的 Facilities 布局及楼宇索引 |
| `static/campus/` | 公共校园地图中的建筑轮廓及地面、屋顶高程 |
| `scripts/` | 跨平台构建与室内数据处理脚本 |
| `tools/indoor-trace/` | 描摹公共楼层平面图的 Python 辅助工具 |
| `tests/` | 室内几何、房间状态和导航测试 |
| `docs/indoor-geometry.md` | 数据来源、精度限制、格式和建图流程 |

前端使用 **React 19、TypeScript、Three.js 和 esbuild**。3D 场景按需加载，首次打开页面时不必下载 Three.js。

## 数据与覆盖范围

- **课程安排：** 按学期从 [SheepTester 的公共教室数据](https://sheeptester.github.io/uxdy/data/)加载。本仓库不运行课程抓取程序。界面会显示数据更新时间；可用状态依据已列出的课程，不代表实时占用或场地预约情况。
- **Geisel 自习室：** 房间名称、容量和 LibCal 编号来自[图书馆预约页面](https://ucsd.libcal.com/spaces?lid=11273)；空闲情况实时获取，每分钟刷新。楼层形状和高度来自校园地图的 Geisel 模型；房间位置来自[图书馆楼层地图](https://library.ucsd.edu/visit/library-maps/)，这些地图没有指北针和比例尺（详见布局中的来源说明）。
- **校园楼宇外观：** 公共校园地图数据包含 585 个建筑轮廓部分，对应 93 个教务楼宇代码。只有外观数据的视图会估算楼层数，并按房间编号分组教室，不会虚构房间位置。目前 TASB 尚无匹配的建筑轮廓。
- **室内覆盖范围：** 仓库和生产构建均包含 77 份 Facilities 布局，共 9,697 个房间记录，打开楼宇时才加载对应数据。Facilities 布局优先于原始 EBU3B 描摹版本，与已完成的预览一致；原始的 300 房间 CSE 描摹数据仍保留在源数据中。
- **几何数据：** Facilities 房间轮廓由楼层平面图转换，依据标注的房间面积缩放，并与校园建筑轮廓拟合。部分房间只有楼层信息。楼层分离间距和估算高度用于展示，这些模型并非实地测绘结果。每份布局均保留来源引用与转换说明。

数据来源、已知缺口和新增楼宇流程见[室内地图与 3D 楼宇浏览技术文档（英文）](docs/indoor-geometry.md)。可选的描摹工具需要 Python 3、Pillow、NumPy 和 SciPy；运行网站本身不需要这些依赖。

## 致谢与许可

本项目基于 Sean（SheepTester）创建的 [SheepTester/ucsd-classrooms](https://github.com/SheepTester/ucsd-classrooms) 扩展。更早的提交历史见 [SheepTester/uxdy/classrooms](https://github.com/SheepTester/uxdy/tree/main/classrooms)。本 fork 新增了楼宇浏览、校园外观、Facilities 布局、EBU3B 描摹数据、辅助工具、测试和部署更新。

校园地图使用 [SheepTester 的 UCSD 地图工具](https://sheeptester.github.io/words-go-here/misc/ucsd-map.html)制作。室内平面图来源见[几何数据文档](docs/indoor-geometry.md)。

代码采用 [MIT 许可证](LICENSE)，保留原始版权声明。外部地图、照片和数据集归其各自来源所有，并保留相应署名。
