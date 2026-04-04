# 实施计划：菜单目录顺序与 mkdocs 导航同步

## 背景

当前 `nav.py` 的 `/api/nav/tree` 接口从数据库 `type_list.WIKI_MENU_JSON2` 解析菜单，而 `mkdocs.yml` 使用完全不同的分类结构和 UUID 文件名。需要将编辑器菜单的数据源切换为 `mkdocs.yml`，并确保发布时双向一致。

---

- [ ] 1. 新增 mkdocs.yml 解析工具函数
   - 在 `backend/app/routers/nav.py` 中新增 `_parse_mkdocs_nav()` 函数
   - 读取项目根目录下的 `mkdocs.yml` 文件，使用 `yaml` 库解析 `nav` 字段
   - 将 mkdocs 的 nav YAML 结构（嵌套字典/列表）递归转换为编辑器所需的树形结构 `[{id, name, parent_path, mark, status, children}]`
   - 跳过 `Home: index.md` 首页入口
   - 返回解析后的树形数据
   - _需求：1.1, 1.2, 5.4_

- [ ] 2. 实现 UUID 文件名到 doc_id 的映射
   - 在 `_parse_mkdocs_nav()` 中，对每个叶子节点的文件名（如 `e92ff198-1710-4bb7-bf97-241c68d1c8b2.md`）提取 UUID 部分
   - 查询 `wiki_list` 表，通过 `uuid` 字段匹配文档记录，获取对应的整数 `id`
   - 同时支持整数 ID 文件名（如 `123.md`）的直接匹配
   - 将匹配到的 doc_id 写入节点的 `mark` 字段；未匹配到的节点 `mark` 设为空字符串
   - _需求：3.1, 3.2, 3.3_

- [ ] 3. 改造 `/api/nav/tree` 接口使用 mkdocs.yml 数据源
   - 修改 `get_nav_tree()` 函数，优先调用 `_parse_mkdocs_nav()` 获取导航树
   - 如果 mkdocs.yml 不存在、解析失败或 nav 字段为空，回退到现有的 `WIKI_MENU_JSON2` 逻辑
   - 回退时在日志中记录警告信息
   - 确保返回的树形结构格式与前端 `TreeNode` 组件兼容（保持 `id`, `name`, `mark`, `children` 等字段不变）
   - _需求：1.1, 1.3, 2.1, 2.2, 2.3, 5.1, 5.2_

- [ ] 4. 前端适配：支持未关联文章的显示
   - 修改 `DocList.jsx` 中的 `TreeNode` 组件，对 `mark` 为空的文档节点（mkdocs 中存在但 wiki_list 中未找到的文章）显示为灰色/禁用状态
   - 未关联的文章节点点击时不跳转编辑页面，可显示 tooltip 提示"未关联文档"
   - _需求：3.3, 5.3_

- [ ] 5. 改造发布接口使用 mkdocs.yml 作为导航数据源
   - 修改 `publish.py` 中的 `publish()` 函数，在正常发布模式下，读取现有 `mkdocs.yml` 的 `nav` 字段作为导航结构，而不是从 `TypeList` 重新构建
   - 保留 `nav` 中的分类结构和顺序不变，仅更新文档内容文件（`.md` 文件）
   - 确保发布后的 mkdocs.yml 导航与编辑器菜单完全一致
   - _需求：4.1, 4.2_

- [ ] 6. 清理旧的 WIKI_MENU_JSON2 相关代码
   - 将 `_convert_menu_json_to_tree()`、`_build_name_to_doc_map()` 等函数标记为 fallback 专用，添加注释说明
   - 移除 `publish.py` 中基于 `TypeList` 构建导航的 `_build_nav_yaml()` 函数（已不再使用）
   - 清理 `nav.py` 中不再需要的 `LEGACY_DOCS_BASE` 常量和 `_normalize_path()` 函数
   - _需求：1.1_

- [ ] 7. 构建 Docker 镜像并部署验证
   - 重新构建后端和前端 Docker 镜像
   - 部署到服务器，验证编辑器菜单的分类名称和文章顺序与 mkdocs.yml 完全一致
   - 验证文章点击跳转编辑页面功能正常
   - 验证未关联文章的灰色/禁用显示
   - 验证 mkdocs.yml 不存在时的回退逻辑
   - _需求：1.1, 2.1, 2.2, 3.1, 5.1_
