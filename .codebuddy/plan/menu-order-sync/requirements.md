# 需求文档：菜单目录顺序与 mkdocs 导航同步

## 引言

当前 wiki 编辑系统的左侧菜单目录树（由后端 `/api/nav/tree` 接口提供）与 mkdocs 实际发布的导航顺序不一致。编辑器菜单从数据库 `type_list` 表的 `WIKI_MENU_JSON2` 节点解析，使用的是旧的分类结构（如 `ESP Wireless`、`LoRa & LoRaWAN`）；而 mkdocs.yml 中的导航使用的是新的分类结构（如 `Communication & IoT`、`Home Assistant`），两者在分类名称、文章归属和排列顺序上均存在差异。

本需求的目标是：**让编辑器的菜单目录结构和顺序与 mkdocs 发布的导航完全一致**，确保编辑人员看到的目录结构就是最终 wiki 站点的结构。

### 当前差异分析

| 维度 | 编辑器菜单（WIKI_MENU_JSON2） | mkdocs.yml 导航 |
|------|------|------|
| 数据源 | `type_list.WIKI_MENU_JSON2` 的 JSON | `mkdocs.yml` 的 `nav` 字段 |
| 根分类 | ESP Wireless, LoRa & LoRaWAN, Display & Touch Screen 等 | Guidance & Tutorials, Display & Touch Screen, UWB Modules, Home Assistant, Communication & IoT, Development Boards, Sensors & Accessories, Other |
| 文章匹配 | 通过 label/href 模糊匹配 wiki_list 的整数 ID | 通过 UUID 文件名直接对应 |
| 排列顺序 | 按 WIKI_MENU_JSON2 中的 JSON 数组顺序 | 按 mkdocs.yml 中 nav 的 YAML 列表顺序 |

## 需求

### 需求 1：统一数据源

**用户故事：** 作为一名 wiki 编辑人员，我希望编辑器的菜单目录结构与 mkdocs 发布的导航完全一致，以便我在编辑时能准确了解文章在 wiki 站点中的位置。

#### 验收标准

1. WHEN 编辑器加载菜单目录 THEN 系统 SHALL 使用与 mkdocs 发布相同的导航数据源来构建目录树
2. WHEN mkdocs.yml 中的导航顺序发生变化 THEN 编辑器菜单 SHALL 自动反映相同的顺序变化
3. IF mkdocs.yml 文件不存在或解析失败 THEN 系统 SHALL 回退到现有的 WIKI_MENU_JSON2 数据源

### 需求 2：分类结构一致

**用户故事：** 作为一名 wiki 编辑人员，我希望编辑器中的分类名称和层级与 wiki 站点完全相同，以便我不会因为分类不同而产生困惑。

#### 验收标准

1. WHEN 编辑器显示菜单目录 THEN 根分类名称 SHALL 与 mkdocs.yml 中的 nav 一级分类名称完全一致（如 `Guidance & Tutorials`、`Display & Touch Screen`、`UWB Modules`、`Home Assistant`、`Communication & IoT`、`Development Boards`、`Sensors & Accessories`、`Other`）
2. WHEN 编辑器显示某个分类下的文章列表 THEN 文章 SHALL 与 mkdocs.yml 中该分类下的文章完全一致，且顺序相同
3. WHEN 编辑器显示多级目录 THEN 层级结构 SHALL 与 mkdocs.yml 中的嵌套层级完全一致

### 需求 3：文章关联正确

**用户故事：** 作为一名 wiki 编辑人员，我希望点击菜单中的文章能正确跳转到对应的编辑页面，以便我能快速编辑目标文章。

#### 验收标准

1. WHEN mkdocs.yml 中的文章使用 UUID 文件名（如 `e92ff198-1710-4bb7-bf97-241c68d1c8b2.md`）THEN 系统 SHALL 通过 UUID 正确关联到 wiki_list 中的文档记录
2. WHEN mkdocs.yml 中的文章使用整数 ID 文件名（如 `123.md`）THEN 系统 SHALL 通过整数 ID 正确关联到 wiki_list 中的文档记录
3. IF 某篇文章在 mkdocs.yml 中存在但在 wiki_list 中找不到对应记录 THEN 系统 SHALL 仍然在菜单中显示该文章名称，但标记为"未关联"状态

### 需求 4：发布时保持一致性

**用户故事：** 作为一名 wiki 管理员，我希望发布操作生成的 mkdocs.yml 导航与编辑器菜单使用相同的数据源，以便发布后的站点结构与编辑器中看到的完全一致。

#### 验收标准

1. WHEN 执行发布操作 THEN 系统 SHALL 使用与编辑器菜单相同的导航数据源来生成 mkdocs.yml 的 nav 字段
2. WHEN 发布完成后 THEN mkdocs.yml 中的导航顺序 SHALL 与编辑器菜单的顺序完全一致
3. IF 编辑器中通过拖拽调整了菜单顺序 THEN 下次发布时 SHALL 使用调整后的顺序

### 需求 5：边界情况处理

**用户故事：** 作为一名系统维护人员，我希望系统能优雅地处理各种异常情况，以便系统在数据不完整时仍能正常工作。

#### 验收标准

1. IF mkdocs.yml 文件不存在 THEN 系统 SHALL 回退到 WIKI_MENU_JSON2 数据源，并在日志中记录警告
2. IF mkdocs.yml 中的 nav 字段为空 THEN 系统 SHALL 回退到 WIKI_MENU_JSON2 数据源
3. IF 文章的 UUID 在 wiki_list 中找不到匹配 THEN 系统 SHALL 在菜单中显示文章名称但不提供编辑跳转功能
4. WHEN 系统从 mkdocs.yml 解析导航 THEN 系统 SHALL 跳过 `Home: index.md` 这类首页入口，不在编辑器菜单中显示
