# 室内图纸获取与覆盖审计 · 2026-10-21（洛杉矶时间）

网站把课表中的楼宇代码、教室编号对应到楼层和房间轮廓。本轮既补图，也修正错楼、房号关联和坐标问题。当前已注册 **30 个补充布局**，在已保存的 **551 个课表教室键中定位 420 个，仍有 131 个位置缺口**。这不是全校所有学期的教室全集，也不表示图纸都反映最新装修。

原有 540 个键从 **295 个有位置增至 412 个**，净增 117 个；另外从当前 FA26 课表快照确认了此前没有室内文件的 **MYR-A 七个键和 BRF2 四个键**：MYR-A 七键及 BRF2 4103 已定位，BRF2 1104 和 5A03 已确证楼层但仍无位置，1102 仍未映射，因此当前为 **420/551**。必须把这次扩充分母与原有键的补齐分开报告。MCC 原来的两个错楼匹配已经撤销，随后才用正确楼宇的官方矢量补入四间。

## 来源与获取进展

已实际保存 **66 个公开 PDF/图片原件：49 份 PDF、共 912 页，以及 17 张图片**，合计 170,501,383 字节。逐文件网址、取得时间、SHA-256、页数及局部复核范围见 `data/indoor/research/acquisition-index.json`。另有 **20 张公开 FIS 楼层 PNG**，按网页明确公布的切片和原生尺寸拼接，单独登记在 `public-fis-raster-sources.json`，不重复计入上述 66 个原件。HTML、课程快照和复核叠图也不混入 PDF/图片原件计数。另存 **90 个辅助文件、89 份不重复内容**：其中 89 张项目照片为 WFH 标识照片 30 张、另一路 WFH 设计项目图片 22 张、DANCE 7 张和 GH 标识照片 30 张，另有一张 SDSC 室外方向图；DANCE DS05/DS06 内容相同。这些辅助文件不是楼层平面图，也不与原件目录或 FIS PNG 重复相加。另有一份通过已连接账户取得的 2024 年 SDSC PDF，共 24 页，单列于 `account-source-acquisition.json`，只作独立交叉核对。模型重建与运行时来源均使用较新的公开 PDF，不需要该私有副本，也不会由网站提供它。

本轮找到的关键公开入口是 [UCSD Classroom Details 目录](https://facilities.ucsd.edu/Classrooms/Default.htm)。部分教室的楼层缩略图链接到 `/Buildings/Viewer/embed/Default.htm?bkey=…&fcode=…&zoom=…`。有些页面公开了可读的整层切片；有些切片返回登录页，但页面本身明确包含带 Facilities 房间 ID 的矢量轮廓和编号、面积列表。

- **20 张 FIS PNG**：16 张用于局部房间建模，MANDE 一层用于配准，YORK 四层因 4124 标识冲突未导入，PCYNH 二层和 PRICE 一层分辨率不足。没有一张被认证为整栋楼或整层全部建模。记录和文件校验见 `public-fis-raster-review.json`。
- **5 份公开矢量 HTML 来源**：UNEXG 一层、UNEXN 一层、MCC 一层和二层、BRF2 四层。四个楼层来源共增加 10 个课表房间映射；MCC 二层仅提供一个公共走廊，未增加教室。对应切片未取得，不能称为成功下载了这些楼层图片。见 `public-fis-vector-sources.json`。
- **历史图纸和方案**：下载成功只证明取得了原件。Gensler、Regents、建筑介绍、座位图等必须逐页检查房号、年代、完整轮廓和楼内位置，不能直接当作现状竣工模型。

只使用页面实际公开的资料。遇到登录页、缺少图纸键或仅有缩略图时，记录限制；不把登录 HTML 存成图片，不猜测未公布的高分辨率路径，也不绕过校方权限。

## 已落地的映射与修复

下表列本轮的实际接入范围。原始输入保留；有可靠房号并不必然有可靠房间边界。

| 楼宇 | 新增或修正的范围 | 仍需注意 |
| --- | --- | --- |
| EBU3B | 补入已有 CSE 地下层、一层描摹，恢复 B240/B250/B260/B270/1202 五键，增加 65 个轮廓 | 1113/1117/1124 继续未定位；一层存在装修时效问题 |
| VAF、CTL、VAUGN | 关联 VAF 218；官方课程大纲核对 CTL B108/B112 与地下层 108/112；Scripps 官方入口说明确认 VAUGN 100 在一层 | 保留原几何精度，无通用前缀猜测；VAUGN 100 只提升楼层证据，不增加位置 |
| CSB | 官方 2018 PDF 第 2–4 页描出 001–005、115/180、272/280，共 9 间 | 相对坐标，无校园配准 |
| SME | 2021 疏散图补入一至四层 13 间；地下层至四层保留来源轮廓 | 独立相对模型；旧 4 个非课表轮廓未混入，原文件保留 |
| EBU1 | 2021 PDF 第 4 页补入 2315 | 原房间与楼层保留 |
| EBU2 | 2021 PDF 第 7 页补入 584；305/330A 有三层文字确证 | 三层 7 间仍有分隔或编号冲突 |
| FAH | 2025 PDF 第 2 页补 1101/1450；公开 FIS 一层图补 1301，共 3 间，并修正旧的“两间已定位”说明 | 保留一至四层和相对房间位置；两来源北箭头与约 90° 配准冲突，`northDeg` 未知，无 `geo` |
| ASANT | 官方 I-House 图补入 AH123A/B/C/D | 改为 Asante Meeting、CAAN 7025；Asante W 公寓及其同号机械间不混用 |
| MAYER | Physics EAP 第 25/33/37 页补 2110/2130/2306/2326、4322、5301，共 6 间 | 只补具体教室和旧翼局部楼板，原 176 个房间保留 |
| MYR-A | FA26 七键：2544/2574/2702/2722/3544/4623 复用六个原生轮廓，5623 从 EAP 第 37 页描出 | 单独新增七键到统计；保留 176 个已有形状，五层仅建 5623 局部 |
| BRF2 | 公开 FIS 四层矢量补 4103（ID 73656）；原活动主办方资料确证 1104 在 L1、5A03 在 L5；1102 仍未映射 | 分母新增四键；126 个有效原生空间轮廓，无 `geo`；L1/L5 仅存来源楼层记录，`outline: []`，不补造楼板 |
| SSRB | 2018 PDF 第 4 页补 339/340/343A | 310 与 310A/310B 不直接等同 |
| GH | 完整编号尺寸图补 242；公开 FIS 三层图补 320/321 | 242 跨二、三层，仅显示一次；其余 17 间未定位 |
| COA | 2025 FIS 地下层、一层图补 14 间 | 125/127/B27 为有官方依据的可隔断组合；二层 6 间仍缺边界 |
| MALK | FIS 地下层图补 B90/B91/B92，官方 Details 明示 EB90[B90] 等别名 | 上层 6 键仍未定位 |
| MANDE | FIS B1/B2 补地下 11 间，一层图与共同楼梯、电梯位置支持配准 | 原 114 房间、镜像局部坐标保留；212 仍未定位 |
| SOLIS | FIS 一层图补 104/105/107/109/110/111 | 单一面积标定比例及近似校园配准 |
| HSS | 补 1106B/1128A/1330/2025/2152/2305A/2333B；修正低层比例及 2333A/2333B 边界对应 | 2154 门扇突出部分裁至可见共墙；上层保留，3027 未定位 |
| CENTR | FIS 二层图补 205/218 | 原房间保留，新增配准为近似 |
| MCGIL | FIS 二层图补 2342/2334/2330/2322/2315 | 保留原镜像局部框架，无 `geo`；还有 2 间未定位 |
| MOS | FIS 一、二层图补 0113/0114/0204 | 保留前导零；未从屋顶推造房间 |
| SSB | FIS 一层图补 103/106/139 | 上层保留，三层 333/353 未定位 |
| YORK | FIS 三层图补 3010 | 四层 4124 与公开图编号有冲突；保留全部相对房间，移除未获支持的校园位置和朝北方向 |
| MCC | 改正为 Communication、CAAN 6614；一层公开原生矢量补 127/133/139/140 | 二层只得到走廊，201/221/222/250 仍未定位；无校园配准 |
| UNEXG、UNEXN | 公开 HTML 的编号、ID、面积与原生矢量分别补 123/124/125 和 126/127 | 局部米制，无 `geo`；不推造完整外墙 |
| LEDDN | 编号 FIS 图、HSS2250 尺寸座位图及官方名称对应，建立 AUD 的实际礼堂轮廓 | 独立礼堂；撤下误复制的 HSS 办公楼层，跨层投影仅显示一次 |
| JEANN | 完整带尺寸座位图描出 GA0205，当前 FIS 列表确认 AUD、二层及面积 | 仅礼堂范围，无 `geo`，不推造门厅与其他房间 |
| CALIT | 官方 QI 活动布局图补入主礼堂 1511；2006 年 SEAW 第 7 页明确礼堂名称与 1511 对应，当前 FIS 提供 L1、房号和面积 | 仅礼堂范围；用单个 2,865 平方英尺面积标定比例，没有独立尺寸或面积验证；历史身份对应不能证明现状未改，无 `geo`、朝北未知 |
| WFH | 安装商实景标识照片明确 3N129、3W113 位于第三层，已从房号推断改为 `floor-listing` | 六个教室仍无可核验位置；照片没有拍摄日期或图纸修订日期，不据此描墙线 |
| SDSC | [官方公开 EAP](https://business.sdsc.edu/assets/documents/sdsc_emergency_plan.pdf) 封面标注 2025 年 9 月更新，第 24 页明确 E129 在 East E1，第 23 页另列 EB129/EB1；已描出 E129 | 纠正 2010 年 B1 通知的混名；仅单间相对轮廓，无米制尺度、北向或校园配准，楼板仅表示该房间范围；图中未见独立修订日期，原五层基底单独保存；不增加 FA26 位置覆盖 |
| PRICE、CCC | PRICE THTRE 按 2026 官方目录改到一层 1.402；CCC ARTSP 有二层来源确证 | 都仍没有可核验的房间轮廓；不增加位置覆盖 |

CSB、SME、FAH、ASANT、SDSC 使用相对单位；GH、HSS、MANDE、MCGIL、MCC、UNEXG/N、LEDDN、JEANN、YORK、BRF2、CALIT 使用局部米制但没有校园 `geo`。HSS 和 YORK 旧的朝北角度没有可靠依据，已设为未知。FAH 两来源的北箭头都朝页上，但共同房间墙线匹配需要约 90° 旋转，因此也将朝北设为未知，只保留相对房间对齐。米制尺度可以来自图上尺寸或多个官方面积的一致校验，不能据此声称已知校园位置。CALIT 则只用单个房间面积标定，所得面积一致并非独立校验。保留 `geo` 的模型也常是近似拟合，残差与面积检查都不是实地测绘精度承诺。

MCC 原错楼输入仍保存在 `static/indoor/facilities/MCC.json`；中间身份纠错外壳保存为 `data/indoor/MCC/corrected-base.json`，最终加载 `MCC-combined.json`。MYR-A 与 MAYER 是两个课表代码视图，共用部分已验证的物理轮廓，因此总轮廓数不能解读为互不重复的实体房间数量。

## 两种覆盖统计

### 已保存布局键

统计文件：`data/indoor/coverage-baseline.json`、`data/indoor/coverage-current.json`。

| 类别 | 原有基线 | 当前 |
| --- | ---: | ---: |
| 已记录课表键总数 | 540 | 551 |
| 有位置和房间轮廓 | 295 | 420 |
| 有来源证明楼层、没有位置 | 174 | 96 |
| 仅按房号推断楼层 | 63 | 28 |
| 楼层、位置均未解决 | 8 | 7 |
| 位置缺口 | 245 | 131 |

当前有 79 个室内楼宇代码、329 个楼层、9,481 个房间轮廓记录；118 层没有房间轮廓。校园目录另有 21 个代码没有室内文件，其中包括室外和历史地点。原有 540 键已定位 412 个，仍缺 128 个；新纳入的 MYR-A/BRF2 共 11 键中 8 个已定位、3 个未定位。因此当前 420/551 的 131 个缺口包含三项新记录的缺口，并非旧映射退步。分母变化有独立课表快照依据。楼层记录由此前 338 降至 329，是 CALIT 用单礼堂视图替换原八层空壳后减少 7 层、BRF2 增加两层有来源但无轮廓的记录、SDSC 用独立 East E1 单间视图替换原五层中央楼空壳后减少 4 层。SDSC 中途加入的 B1 楼层记录已由新图纠正。CALIT 原八层输入仍保存在 `static/indoor/facilities/CALIT.json`，SDSC 原五层基底保存在 `data/indoor/SDSC/original-facilities-base.json`；不同坐标框架没有混合，既有房间几何未被删去。

### 当前学期 FA26

`data/indoor/research/active-term-snapshot.json` 保存网站实际使用的课表来源、哈希及取得时间。快照来自 `classrooms-FA26.txt`，上游抓取时间为 **2026-10-15 00:29 UTC**，本地取得时间为 **2026-10-22 01:39 UTC**。这不是执行审计时重新抓取的校方实时课表。

当前学期审计使用项目的 `coursesFromFile` 和室内映射逻辑，覆盖课表中所有楼宇/房间组合，包括没有室内文件的代码；结果单独写入 `data/indoor/research/active-term-coverage.json`。它与上面跨既有布局积累的 551 键不是同一分母。审计结果为 **461 个教室键、74 个楼宇代码：361 个已定位（78.31%）、69 个仅有来源楼层、23 个按房号推断楼层、6 个在室内布局中仍未映射、2 个没有室内文件**，剩余 100 个未定位键。没有室内文件的两键为 TASB 的 W1131/W1141。原 540 键统计漏掉本期 13 键；新增 MYR-A 七键和 BRF2 四键后，还剩 TASB 两键未进入已保存布局的分母。当前学期审计没有运行时加载错误。

## 仍缺少的真实资料

可直接用于索取资料的[楼层请求清单](../data/indoor/research/remaining-floorplan-requests.csv)有 **64 行、133 个不重复缺位置键**：它是已保存布局的 131 个缺口与当前学期缺口的联合清单，其中增加 TASB 两键，覆盖范围较当前 FA26 的 100 个缺口更广，不能混用分母。

当前已保存键的主要缺口为 GH 17、PODEM 10、EBU2 7、COA/MALK/WFH 各 6、ECKRT/RBC 各 5，MCC/MCTF/MET/PACIF/VAUGN 各 4。优先取得带明确房号的现状楼层图：

| 楼宇、楼层 | 目标 | 当前限制 |
| --- | --- | --- |
| GH 一层 | 102/103/111/144/145/155/157/170/174 | 公开三层图已利用，一层仍无可用完整图 |
| PODEM 一、二层 | 7 个一层键、0273/0274/0275 | 公开入口未得到有效楼层图；Regents 设计图没有可确认的竣工房号 |
| EBU2 三层 | 305/313/L330/330A/333A/335/339 | 旧疏散图与当前分隔、命名不一致 |
| COA 二层 | 201/217/269/270/271/272 | 切片需要登录，未推测边界 |
| MALK 一至五层 | 192/287/387/487/520/530 | 上层切片需要登录；地下层三间已解决 |
| MCC 二层 | 201/221/222/250 | 原生矢量只有走廊；250 不在该旧楼层列表 |
| PCYNH 二层 | 240/245 | 公共图片只有 260×195；Gensler 旧现状图的房号不足以可靠读取，清晰的另一张是改造提案 |
| BRF2（现名 Israni） | L1 的 1104、L5 的 5A03，以及楼层未确认的 1102 | 活动资料确证前两间楼层，但没有边界；一层图未取得、五层公开列表没有 5A03，历史缩略图和三层建筑师图也不足以定位 |
| PFBH 地下层 | 003/005 | 历史边界与当前面积比例冲突，不能靠统一缩放消除 |
| HDSI | 123/336/355 | 2010 Literature 图可能早于翻修；面积和用途证据不足 |
| MANDE/HSS/YORK/SSRB | 212/3027/4124/310 | 缺目标层边界或存在具体编号冲突 |

BRF2 新取得的 168 页 Senate 文件只核验了第 63 页及其原生嵌入图片，不能称整份已审；文字中的部门面积也不是 5A03 的房间面积。建筑师图的 2025 上传路径不能当作图纸修订日期。这些旧资料未用于新增教室。另一路公开 FIS 四层原生矢量明确给出 4103 及 Facilities ID 73656；127 个原生轮廓中有一个走廊自交，被明确排除而未臆修。独立面积校验为来源 740 平方英尺、转换后 739.6959 平方英尺，仍不代表测绘精度。具体证据见 `data/indoor/BRF2/source-review.json`、`fis-vector-review.json`。

ECKRT 新取得的两张建筑师图片分别是无房号的室内轴测图和室外总平示意，不能对应 127/139/225/227/236；2022 年一层改造记录还提示旧图的时效风险。项目总面积不能当作具体教室面积，详见 `data/indoor/ECKRT/source-review.json`。

GREAT 官方布局图已有清晰礼堂边界及比例尺，但没有数字房号、明确楼层或图纸日期；FA26 快照没有 GREAT 会议记录，因此目前只保留来源，没有新增课表映射。MET 2009 低分辨率预案、SSB 1995 建筑介绍等也不因下载成功就计入覆盖。室外集合点图、建筑外壳、无房号的施工前方案和只提供房间内部布置的照片，都不能直接解决编号教室的位置。

SERF 的官方天文系空间政策第 3 页明确链接 2023-09-15 更新的第三层、第四层 PDF；第三层正对应 329/383 的缺口。普通公开访问进入 Google 登录，用户随后明确反馈 **UCSD 账号也无法打开**。因此这是已定位文件、当前账号仍不可访问的来源，不是等待登录，也未判定文件已删除。详情见 `data/indoor/SERF/second-pass-review.json`；后续需要文件持有方授予权限或提供可公开的教室部分。新取得的 2014 年 Bioengineering SERF 应急计划已逐页渲染并检查全部 8 页；第 5–6 页是室外集合点和应急区域图，没有 329/383 的室内边界，不能增加位置覆盖。

GH 新检查的 MSI 30 张标识照片中，DSCN1600 的实物目录明确把 242 同时列在二、三层，并把 247/253/254 列在二层。DSCN1591 虽拍到疏散图，图纸本体仅约 230×180 原生像素，公开页面最大版本仍无法可靠读号，因此没有增加几何。DANCE 的七张历史项目图片全部是照片，DS05/06 字节完全相同，也没有新增房间轮廓。见 `data/indoor/GH/msi-sign-review.json` 和 `data/indoor/DANCE/new-source-review.json`。

## UCSD 账号与剩余获取路径

此前用户在可见 Firefox 中完成过 SSO，并到达 Tririga 首页（初次标题 `Home - Facilities Information Management`，后一次为 `Home - IBM TRIRIGA`）。当时侧栏只有 Home，没有 Portfolio/Floors 入口。随后浏览器 MCP 重启，原 SSO 会话已失去；这里记录的是历史观察，不能声称当前仍已登录或权限状态未变。本轮没有取得授权楼层图导出。

2026-10-22 00:42 UTC 首次观察、01:54 UTC 再次刷新核实，官方 MyStuff 门户显示 **Request user account set-up for Tririga or Facilities Activity Hub** 申请，状态 **Open**。提交者未核实，不能归因为助手提交；记录不含申请编号或个人信息。这次 01:54 UTC 的历史观察不代表现在的申请状态或楼层权限；Open 当时也不代表权限已批准，见 `data/indoor/research/tririga-access-check.json`。

后续重新登录后可跟进已有申请，确认包含 **View and Print Floorplans**，再检查楼层入口；无需重复创建申请。获批后，按[官方 FAQ](https://support.ucsd.edu/its?id=kb_article_view&sysparm_article=KB0030495)进入 **Portfolio → Floors**（部分界面为 Portfolio → Locations → Floors），打开楼层的 **Graphic**，用 **Menu → Labels** 显示房号，再通过 **Menu → Export → PDF** 导出。先检查导出文件是否包含完整边界、房号、楼层名称和比例，再批量处理。首选仍是 GH 一层，其次为 PODEM、COA 二层、MALK 上层以及 EBU2 三层的现状图。

[空间管理工具说明](https://facilityservices.ucsd.edu/information/tools.html)与[官方申请表](https://support.ucsd.edu/its?id=sc_cat_item&sys_id=e3908c91db157f0006037a131f96193d)可用于确认权限和流程。旧 FIS 账号与校园 SSO 不能视为互通。已有公开 embed 资料继续可用，但不能代替尚未取得的 Tririga 权限。

没有找到可直接下载、覆盖全部编号教室的全校 IFC/Revit 模型。校园 ArcGIS/Concept3D 类资源目前主要支持外形和地点；[官方地图说明](https://facilityservices.ucsd.edu/resources/maps.html)与 [BIM 文档](https://plandesignbuild.ucsd.edu/design/bim.html)不能被当作公共室内模型下载库。可以申请课堂相关的简化 vector PDF、SVG、DWG、IFC 或楼宇/楼层/房间导出，并附课表代码与 Facilities ID 对照、修订日期和公开展示条件。

已核实的联系渠道为 `omcp@ucsd.edu`（空间数据）、`kbelles@ucsd.edu`（施工图/CAD/BIM）、`dhenderson@ucsd.edu`（GIS）、`jsoe-space@ucsd.edu`（工程楼图纸）。用户明确授权后，资料请求已于 **2026-10-22 03:00:51 UTC（洛杉矶 10 月 21 日 20:00:51）** 发往 `omcp@ucsd.edu`。Gmail 读回确认 SENT 状态、正确收件人，以及 10,944 字节的 `remaining-floorplan-requests.csv` 附件。当前等待校方回复，尚未收到新图纸，覆盖数字和缺口保持不变。请求围绕具体缺口，优先索取现状编号图和 classroom-only geometry，避免重复索取已解决的 COA 地下层/一层、MANDE 地下层等。

## 验证状态

- 包含 SDSC 新增项的[最终回归](../data/indoor/research/resumed-validation.json)已完成：`npm test` 的 3 个测试包通过；另直接执行 **64 项语义测试，全部通过**，包括 25 项补充布局、36 项室内逻辑和 3 项视图测试。`npm run typecheck`、`npm run lint -- src scripts tests`、`npm run validate:indoor` 和 `npm run build` 也全部通过。室内校验 **0 个错误、56 个继承警告**，本次增量没有引入新警告。
- 66 个公开原件、90 个辅助文件和 1 份账户取得的研究副本均与记录的哈希一致；20 张 FIS PNG 的文件与目录记录也一致。逐楼证据保存在 `data/indoor/<CODE>/`，复核叠图在 `local/indoor-sources/`。来源目录中的 `geometryReview` 只表示其中明确列出的局部范围。
- [独立集成复核](../data/indoor/research/integration-review.json)检查了 27 个补充布局的加载状态、精确课表键、来源、哈希和重建路径，发现的 7 项问题已修复。该报告明确排除当时并行开发的 BRF2；BRF2 随后另行完成原生矢量、运行时 schema、全套检查与浏览器验证。
- [实际浏览器记录](../data/indoor/research/browser-verification.json)覆盖可见 Firefox 的桌面和手机视口：COA 125 的 3D、旋转按钮、楼层切换，地下层/一层分别显示 6/8 个教室标签；MALK B91 的列表选房、3D 与课表；MYR-A 5623 的 3D 与 PHYS 251 课表；BRF2 4103 的四层轮廓、MED 264/277 课表与 List only 保留选房；CENTR 205 的加载和二层选房。记录中 **0 个页面异常**，视口变化时的 Firefox 绘制警告仍单独保留。截图哈希和路径见该记录，包括 `/tmp/ucsd-brf2-4103.png`。
- 新增可见浏览器检查已目视确认 CALIT 礼堂的桌面、手机显示，以及 BRF2 1104/5A03 的楼层证据说明；这些检查使用正常应用请求。随后旧 QA 页刷新卡在 Loading，另建 QA 页仅通过 route 重放同一份已保存的 FA26 生产课表快照，验证 BRF2 五层没有房间标签，返回四层恢复 21 个标签（含 4103），该新页记录 0 异常、0 警告。这项重放验证限定为保存快照下的交互，不证明当时实时课表网络可用；前一轮视口绘制警告仍保留。
- SDSC 最终检查使用可见 Firefox，视口为 500×842、DPR 1.2，课表通过正常网络加载，没有替换为测试快照。E129 在 East E1 的单间 3D 轮廓可见，没有 FA26 课程与实际快照一致；来源面板中的公开 2025 年 PDF 和精确 FA25 校方课表链接正确。截图 `/tmp/ucsd-sdsc-e129-public-source.png` 已目视复核，哈希在浏览器记录中；该检查为 **0 页面异常、0 控制台警告**。
- 这些是抽样交互验证和来源复核，并非每间教室的现状实测。此前后台 Firefox 无法创建 WebGL 的限制已通过可见浏览器解决。楼层高度、墙高、部分楼板及校园位置仍有估计成分，不能作为测绘、施工或当前安全疏散依据。

## 可复现命令

在仓库根目录运行。原件默认被 Git 忽略；先保留来源文件和哈希，再重建。部分脚本需要 Pillow、Poppler，节点脚本使用项目已有依赖。公开 FIS 拼接图及 HTML 见专门目录记录，不由早期 PDF 下载脚本统一获取。

```sh
# 原始公开 PDF 下载目录；下载失败时不会生成伪造哈希
python scripts/fetch-indoor-sources.py --list

# 原始修复和 PDF / 官方图片补充
python scripts/supplement-indoor.py
node scripts/enrich-indoor-metadata.mjs
python scripts/build-csb-indoor.py
node scripts/build-sme-indoor.mjs
python scripts/supplement-ebu1-2315.py
python scripts/supplement-ebu2-584.py
python scripts/supplement-mayer-physics.py
python scripts/supplement-ssrb-indoor.py
python scripts/build-asante-meeting.py

# 最终 FAH builder 自动串联1301；GH最终 builder 自动保留完整242再加320/321
node scripts/build-fah-indoor.mjs
python scripts/build-gh-fis.py

# 公开 FIS 栅格、尺寸图和目录
python scripts/supplement-coa-indoor.py
python scripts/supplement-malk-basement.py
python scripts/supplement-mande-basements.py
python scripts/build-solis-fis.py
python scripts/build-hss-fis.py
python scripts/supplement-fis-raster.py CENTR
python scripts/supplement-fis-raster.py MCGIL
python scripts/supplement-mos-indoor.py
python scripts/supplement-ssb-fis.py
python scripts/supplement-york-fis.py
python scripts/build-ledden-fis.py
python scripts/build-jeannie-seating.py
python scripts/build-calit-auditorium.py
python scripts/build-sdsc-east.py
python scripts/build-price-directory.py

# 公开原生矢量；MCC以已保留的正确楼宇base为输入
python scripts/supplement-unex-vectors.py
python scripts/supplement-mcc-vectors.py
python scripts/supplement-brf2-vectors.py --review

# 新增MYR-A课表代码视图：先用网站同一parser重现FA26键集合
node scripts/extract-myr-a-schedule.mjs
python scripts/build-myr-a-indoor.py

# 两种分母各自生成报告
python scripts/audit-indoor-coverage.py --manifest --output data/indoor/coverage-current.json
node scripts/audit-active-term-coverage.mjs

npm run validate:indoor
npm test
npm run typecheck
npm run lint -- src scripts tests
npm run build
```

`build-gh-fis.py` 是 GH 的最终重建入口；单独运行早期 `supplement-gh-242.py` 会只生成较早阶段。FAH 的最终 Node builder 已自动串联 1301 补充，并在失败时恢复原文件。GH 最终 builder 也会在失败时恢复输出与复核文件；已用中途异常检查三个文件的哈希保持不变。更多独立复核可运行 `audit-pfbh-plan.py`、`audit-hdsi-history.py`；这些审计不会把冲突候选强行写成教室。

早期全量 Facilities 转换器所需的 `local/fis-tools/`、`local/fis-cache/` 不在当前检出目录中。本轮补充脚本可从所保留的原件与证据独立重建；恢复旧转换器后仍须检查本轮楼宇身份、别名、坐标修正及补充文件的优先加载，不能让较空或错楼的数据重新覆盖它们。
