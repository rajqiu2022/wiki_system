import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button, Input, Select, Modal, Form, message, Tooltip, Empty, Spin,
} from 'antd'
import {
  PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined,
  FileTextOutlined, FolderOutlined, FolderOpenOutlined,
  ReloadOutlined, RightOutlined,
} from '@ant-design/icons'
import { getDocs, getNavTree, createDoc, deleteDoc, updateDoc } from '../api'

const STATUS_CONFIG = {
  published: { color: '#16A34A', bg: '#F0FDF4', label: '已发布' },
  pending:   { color: '#2563EB', bg: '#EFF6FF', label: '待发布' },
  draft:      { color: '#D97706', bg: '#FFF7ED', label: '修改中' },
  archived:   { color: '#78716C', bg: '#F5F5F5', label: '废弃' },
}

// 列表中可选的所有状态
const LIST_STATUS_OPTIONS = [
  { value: 'published', label: '已发布' },
  { value: 'pending',   label: '待发布' },
  { value: 'draft',     label: '修改中' },
  { value: 'archived',  label: '废弃' },
]

function formatTime(t) {
  if (!t) return '-'
  const d = new Date(t + (t.endsWith('Z') ? '' : 'Z'))
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 递归收集节点及其所有子节点的 doc_id
function collectDocIds(node) {
  const ids = node.doc_id ? [node.doc_id] : []
  if (node.children && node.children.length > 0) {
    node.children.forEach((c) => ids.push(...collectDocIds(c)))
  }
  return ids
}

// 树节点组件
function TreeNode({ node, depth, selectedId, onSelect, expandedKeys, onToggle }) {
  const hasChildren = node.children && node.children.length > 0
  const isExpanded = expandedKeys.has(node.id)
  const isSelected = selectedId === node.id
  const isDoc = !!node.doc_id

  return (
    <div>
      <div
        onClick={() => {
          if (hasChildren) onToggle(node.id)
          onSelect(node.id)
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          paddingLeft: 12 + depth * 18,
          cursor: 'pointer',
          borderRadius: 6,
          background: isSelected ? '#E0F2F1' : 'transparent',
          color: isSelected ? '#0D9488' : '#44403C',
          fontSize: 13,
          fontWeight: isSelected ? 600 : 400,
          transition: 'all 0.12s',
          userSelect: 'none',
        }}
        onMouseEnter={(e) => {
          if (!isSelected) e.currentTarget.style.background = '#F5F5F3'
        }}
        onMouseLeave={(e) => {
          if (!isSelected) e.currentTarget.style.background = 'transparent'
        }}
      >
        {hasChildren ? (
          <RightOutlined
            style={{
              fontSize: 10, color: '#A8A29E',
              transition: 'transform 0.2s',
              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
              flexShrink: 0,
            }}
          />
        ) : (
          <span style={{ width: 10, display: 'inline-block', flexShrink: 0 }} />
        )}
        {isDoc ? (
          <FileTextOutlined style={{ fontSize: 13, flexShrink: 0, color: '#57534E' }} />
        ) : (
          isExpanded
            ? <FolderOpenOutlined style={{ fontSize: 13, flexShrink: 0, color: '#D97706' }} />
            : <FolderOutlined style={{ fontSize: 13, flexShrink: 0, color: '#D97706' }} />
        )}
        <span style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}>
          {node.title}
        </span>
      </div>
      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              expandedKeys={expandedKeys}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function DocList({ currentUser }) {
  const navigate = useNavigate()
  const [docs, setDocs] = useState([])
  const [navTree, setNavTree] = useState([])
  const [loading, setLoading] = useState(false)
  const [navLoading, setNavLoading] = useState(false)
  const [filters, setFilters] = useState({ status: undefined, keyword: '' })
  const [createOpen, setCreateOpen] = useState(false)
  const [form] = Form.useForm()

  // 树状态
  const [selectedNodeId, setSelectedNodeId] = useState(null)
  const [expandedKeys, setExpandedKeys] = useState(new Set())

  const fetchDocs = async () => {
    setLoading(true)
    try {
      const params = {}
      if (filters.status) params.status = filters.status
      if (filters.keyword) params.keyword = filters.keyword
      const data = await getDocs(params)
      setDocs(data)
    } finally {
      setLoading(false)
    }
  }

  const fetchNav = async () => {
    setNavLoading(true)
    try {
      const data = await getNavTree()
      setNavTree(data)
    } catch {
      setNavTree([])
    } finally {
      setNavLoading(false)
    }
  }

  useEffect(() => { fetchDocs(); fetchNav() }, [])

  // navTree 已经是后端返回的树形结构，直接使用
  // 根据选中节点过滤文档
  const filteredDocs = useMemo(() => {
    if (!selectedNodeId) return docs
    const findNode = (nodes, id) => {
      for (const n of nodes) {
        if (n.id === id) return n
        const found = findNode(n.children || [], id)
        if (found) return found
      }
      return null
    }
    const node = findNode(navTree, selectedNodeId)
    if (!node) return docs

    const docIds = new Set(collectDocIds(node))
    return docs.filter((d) => docIds.has(d.id))
  }, [docs, navTree, selectedNodeId])

  // 搜索过滤
  const displayDocs = useMemo(() => {
    let result = filteredDocs
    if (filters.keyword) {
      const kw = filters.keyword.toLowerCase()
      result = result.filter((d) => d.title.toLowerCase().includes(kw))
    }
    if (filters.status) {
      result = result.filter((d) => d.status === filters.status)
    }
    return result
  }, [filteredDocs, filters.keyword, filters.status])

  const toggleExpand = (id) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleNodeSelect = (nodeId) => {
    setSelectedNodeId((prev) => prev === nodeId ? null : nodeId)
  }

  const handleCreate = async () => {
    if (!currentUser?.id) { message.error('请先登录'); return }
    try {
      const values = await form.validateFields()
      await createDoc({ ...values, created_by: currentUser.id })
      message.success('文档创建成功')
      setCreateOpen(false)
      form.resetFields()
      fetchDocs()
      fetchNav()
    } catch (e) {
      if (e.response) {
        const detail = e.response.data?.detail
        message.error(typeof detail === 'string' ? detail : '创建失败')
      }
    }
  }

  const handleDelete = (doc) => {
    Modal.confirm({
      title: '删除文档',
      content: `确定删除「${doc.title}」？此操作不可撤销。`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      okButtonProps: { style: { borderRadius: 8 } },
      cancelButtonProps: { style: { borderRadius: 8 } },
      onOk: async () => {
        await deleteDoc(doc.id)
        message.success('文档已删除')
        fetchDocs()
        fetchNav()
      },
    })
  }

  const handleStatusChange = async (doc, newStatus) => {
    if (doc.status === newStatus) return
    try {
      await updateDoc(doc.id, { status: newStatus }, currentUser?.id)
      message.success('状态已更新')
      // 本地更新，不重新 fetch，保持排序
      setDocs((prev) => prev.map((d) => d.id === doc.id ? { ...d, status: newStatus } : d))
    } catch {
      message.error('状态更新失败')
    }
  }

  const publishedCount = docs.filter((d) => d.status === 'published').length

  return (
    <div className="fade-in" style={{ flex: 1, display: 'flex', gap: 20, minHeight: 0 }}>
      {/* 左侧目录树 */}
      <div style={{
        width: 240,
        flexShrink: 0,
        background: '#FFFFFF',
        borderRadius: 12,
        border: '1px solid #E7E5E4',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '14px 14px 10px',
          borderBottom: '1px solid #F5F5F3',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: '#1C1917' }}>目录</span>
          {selectedNodeId && (
            <Tooltip title="显示全部">
              <Button
                type="text" size="small"
                onClick={() => setSelectedNodeId(null)}
                style={{ fontSize: 12, color: '#0D9488', padding: '0 4px', height: 24 }}
              >
                全部
              </Button>
            </Tooltip>
          )}
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
          {navLoading ? (
            <div style={{ padding: 24, textAlign: 'center' }}><Spin size="small" /></div>
          ) : navTree.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: '#A8A29E' }}>暂无目录</div>
          ) : (
            <>
              {/* "全部文档"入口 */}
              <div
                onClick={() => setSelectedNodeId(null)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', cursor: 'pointer', borderRadius: 6,
                  background: !selectedNodeId ? '#E0F2F1' : 'transparent',
                  color: !selectedNodeId ? '#0D9488' : '#44403C',
                  fontSize: 13, fontWeight: !selectedNodeId ? 600 : 400,
                  transition: 'all 0.12s', marginBottom: 2,
                }}
                onMouseEnter={(e) => {
                  if (selectedNodeId) e.currentTarget.style.background = '#F5F5F3'
                }}
                onMouseLeave={(e) => {
                  if (selectedNodeId) e.currentTarget.style.background = 'transparent'
                }}
              >
                <span style={{ width: 10, display: 'inline-block', flexShrink: 0 }} />
                <FileTextOutlined style={{ fontSize: 13, flexShrink: 0, color: '#57534E' }} />
                <span>全部文档</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#A8A29E' }}>{docs.length}</span>
              </div>
              {navTree.map((node) => (
                <TreeNode
                  key={node.id}
                  node={node}
                  depth={0}
                  selectedId={selectedNodeId}
                  onSelect={handleNodeSelect}
                  expandedKeys={expandedKeys}
                  onToggle={toggleExpand}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* 右侧文档列表 */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* 顶部工具栏 */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 16, flexWrap: 'wrap', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Input
              placeholder="搜索文档..."
              prefix={<SearchOutlined style={{ color: '#A8A29E' }} />}
              value={filters.keyword}
              onChange={(e) => setFilters((f) => ({ ...f, keyword: e.target.value }))}
              style={{ borderRadius: 8, height: 36, width: 240 }}
              allowClear
            />
            <Select
              placeholder="全部状态"
              value={filters.status}
              onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
              style={{ width: 120 }}
              allowClear
              options={LIST_STATUS_OPTIONS}
            />
            <Button icon={<ReloadOutlined />} onClick={() => { fetchDocs(); fetchNav() }} style={{ borderRadius: 8, height: 36 }}>
              刷新
            </Button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 12, color: '#78716C' }}>
              共 <span style={{ fontWeight: 700, color: '#1C1917' }}>{displayDocs.length}</span> 篇
              {selectedNodeId && `（当前目录）`}
            </div>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateOpen(true)}
              style={{
                height: 36, borderRadius: 8, fontWeight: 600,
                background: '#0D9488', border: 'none',
                boxShadow: '0 2px 8px rgba(13,148,136,0.25)',
              }}
            >
              新建文档
            </Button>
          </div>
        </div>

        {/* 文档列表表格 */}
        <div style={{
          flex: 1, background: '#FFFFFF', borderRadius: 12,
          border: '1px solid #E7E5E4', overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}>
          {loading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spin />
            </div>
          ) : displayDocs.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={<span style={{ color: '#A8A29E', fontSize: 13 }}>
                  {selectedNodeId ? '当前目录下暂无文档' : '暂无文档'}
                </span>}
              />
            </div>
          ) : (
            <div style={{ overflow: 'auto', flex: 1 }}>
              {/* 表头 */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 100px 140px 120px 80px',
                gap: 0,
                padding: '0 20px',
                borderBottom: '1px solid #F5F5F3',
                fontSize: 12, fontWeight: 600, color: '#A8A29E',
                alignItems: 'center',
                height: 40,
                flexShrink: 0,
              }}>
                <span>标题</span>
                <span>状态</span>
                <span>修改时间</span>
                <span>创建人</span>
                <span style={{ textAlign: 'right' }}>操作</span>
              </div>
              {/* 行 */}
              {displayDocs.map((doc, idx) => {
                const status = STATUS_CONFIG[doc.status] || STATUS_CONFIG.draft
                return (
                  <div
                    key={doc.id}
                    onClick={() => navigate(`/docs/${doc.id}`)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 100px 140px 120px 80px',
                      gap: 0,
                      padding: '0 20px',
                      alignItems: 'center',
                      height: 48,
                      cursor: 'pointer',
                      borderTop: idx === 0 ? 'none' : '1px solid #F5F5F3',
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#FAFAF8' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  >
                    {/* 标题 */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      overflow: 'hidden',
                    }}>
                      <FileTextOutlined style={{ fontSize: 14, color: '#A8A29E', flexShrink: 0 }} />
                      <span style={{
                        fontWeight: 500, fontSize: 13, color: '#1C1917',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {doc.title}
                      </span>
                      {doc.locked_by && (
                        <span style={{ fontSize: 10, color: '#D97706', flexShrink: 0 }}>(锁定中)</span>
                      )}
                    </div>
                    {/* 状态 - 点击可切换 */}
                    <div onClick={(e) => e.stopPropagation()}>
                      <Select
                        size="small"
                        value={doc.status}
                        onChange={(v) => handleStatusChange(doc, v)}
                        style={{ width: 84 }}
                        bordered={false}
                        dropdownStyle={{ minWidth: 100 }}
                        options={LIST_STATUS_OPTIONS}
                        popupMatchSelectWidth={false}
                      />
                    </div>
                    {/* 修改时间 */}
                    <span style={{ fontSize: 12, color: '#78716C' }}>
                      {formatTime(doc.updated_at)}
                    </span>
                    {/* 创建人 */}
                    <span style={{ fontSize: 12, color: '#78716C' }}>
                      {doc.creator_name || '-'}
                    </span>
                    {/* 操作 */}
                    <div
                      style={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Tooltip title="编辑">
                        <Button
                          type="text" size="small"
                          icon={<EditOutlined />}
                          onClick={() => navigate(`/docs/${doc.id}`)}
                          style={{ color: '#0D9488', borderRadius: 6 }}
                        />
                      </Tooltip>
                      <Tooltip title="删除">
                        <Button
                          type="text" size="small" danger
                          icon={<DeleteOutlined />}
                          onClick={() => handleDelete(doc)}
                          style={{ borderRadius: 6 }}
                        />
                      </Tooltip>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* 新建文档弹窗 */}
      <Modal
        title="新建文档"
        open={createOpen}
        onOk={handleCreate}
        onCancel={() => { setCreateOpen(false); form.resetFields() }}
        okText="创建"
        cancelText="取消"
        okButtonProps={{ style: { background: '#0D9488', borderColor: '#0D9488', borderRadius: 8 } }}
        cancelButtonProps={{ style: { borderRadius: 8 } }}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="title"
            label="文档标题"
            rules={[{ required: true, message: '请输入文档标题' }]}
          >
            <Input
              placeholder="输入文档标题"
              style={{ borderRadius: 8, height: 40, fontSize: 14 }}
              autoFocus
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
