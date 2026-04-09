import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button, Input, Select, Modal, Form, message, Tooltip, Empty, Spin,
} from 'antd'
import {
  PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined,
  FileTextOutlined, FolderOutlined, FolderOpenOutlined,
  ReloadOutlined, RightOutlined, DisconnectOutlined,
  EyeOutlined, EyeInvisibleOutlined, ArrowLeftOutlined, CloudUploadOutlined, CheckCircleOutlined,
} from '@ant-design/icons'
import CherryEditor from '../components/CherryEditor'
import { getDocs, getNavTree, createDoc, deleteDoc, updateDoc, getDoc } from '../api'
import { TreeSelect } from 'antd'

// Status config: 0=normal, 1=deleted, 4=editing
const STATUS_CONFIG = {
  0: { color: '#16A34A', bg: '#F0FDF4', label: '正常' },
  1: { color: '#9CA3AF', bg: '#F5F5F5', label: '已删除' },
  2: { color: '#9CA3AF', bg: '#F5F5F5', label: '未知' },
  3: { color: '#D97706', bg: '#FFFBEB', label: '修改中' },
  4: { color: '#D97706', bg: '#FFFBEB', label: '修改中' },
}

const LIST_STATUS_OPTIONS = [
  { value: 0, label: '正常' },
  { value: 1, label: '已删除' },
  { value: 4, label: '修改中' },
]

// Publish status config
const PUBLISH_STATUS_CONFIG = {
  0: { color: '#16A34A', bg: '#F0FDF4', label: '已发布', icon: '✓' },
  1: { color: '#E67E22', bg: '#FFF7ED', label: '待发布', icon: '●' },
}

// Normalize status value to integer (DB may store as string)
function normalizeStatus(val) {
  if (val === null || val === undefined) return 0
  const n = Number(val)
  return isNaN(n) ? 0 : n
}

function formatTime(t) {
  if (!t) return '-'
  return t
}

// Collect all doc IDs (mark field) from a directory node and its descendants
function collectDocIds(node) {
  const ids = []
  if (node.mark) {
    const docId = parseInt(node.mark, 10)
    if (!isNaN(docId)) ids.push(docId)
  }
  if (node.children && node.children.length > 0) {
    node.children.forEach((c) => ids.push(...collectDocIds(c)))
  }
  return ids
}

// Find a node by id in the tree
function findNodeById(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n
    const found = findNodeById(n.children || [], id)
    if (found) return found
  }
  return null
}

// Count all doc nodes (leaf nodes with mark or file_ref) under a tree node recursively
function countDocs(node) {
  if (!node) return 0
  let count = 0
  if (node.mark || (!node.children?.length && node.file_ref)) {
    count = 1
  }
  if (node.children && node.children.length > 0) {
    node.children.forEach((c) => { count += countDocs(c) })
  }
  return count
}

// 树节点组件
function TreeNode({ node, depth, selectedId, onSelect, expandedKeys, onToggle }) {
  const docCount = useMemo(() => {
    if (node.children && node.children.length > 0) {
      return countDocs(node)
    }
    return 0
  }, [node])
  const hasChildren = node.children && node.children.length > 0
  const isExpanded = expandedKeys.has(node.id)
  const isSelected = selectedId === node.id
  const isLinkedDoc = !!node.mark // mark non-empty = linked document
  const isUnlinkedDoc = !node.mark && !hasChildren && !!node.file_ref // leaf without mark but has file_ref
  const isDoc = isLinkedDoc || isUnlinkedDoc

  return (
    <div>
      <Tooltip title={isUnlinkedDoc ? '未关联文档，无法编辑' : null} placement="right">
      <div
        onClick={() => {
          if (isUnlinkedDoc) {
            // Unlinked doc: do nothing (no doc_id to navigate to)
          } else if (hasChildren) {
            // Directory node: toggle expand and select for filtering
            onToggle(node.id)
            onSelect(node.id, null)
          } else if (isLinkedDoc && node.mark) {
            // Linked doc node: show read-only preview
            onSelect(node.id, node.mark)
          } else {
            onSelect(node.id, null)
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          paddingLeft: 12 + depth * 18,
          cursor: isUnlinkedDoc ? 'not-allowed' : 'pointer',
          borderRadius: 6,
          background: isSelected ? '#E0F2F1' : 'transparent',
          color: isUnlinkedDoc ? '#C4B5A4' : (isSelected ? '#0D9488' : '#44403C'),
          fontSize: 13,
          fontWeight: isSelected ? 600 : 400,
          opacity: isUnlinkedDoc ? 0.7 : 1,
          transition: 'all 0.12s',
          userSelect: 'none',
        }}
        onMouseEnter={(e) => {
          if (!isSelected && !isUnlinkedDoc) e.currentTarget.style.background = '#F5F5F3'
        }}
        onMouseLeave={(e) => {
          if (!isSelected && !isUnlinkedDoc) e.currentTarget.style.background = 'transparent'
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
        {isUnlinkedDoc ? (
          <DisconnectOutlined style={{ fontSize: 13, flexShrink: 0, color: '#C4B5A4' }} />
        ) : isDoc ? (
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
          {node.name}
        </span>
        {hasChildren && docCount > 0 && (
          <span style={{
            fontSize: 11,
            color: '#A8A29E',
            flexShrink: 0,
            marginLeft: 'auto',
          }}>
            {docCount}
          </span>
        )}
      </div>
      </Tooltip>
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
  const [totalDocCount, setTotalDocCount] = useState(0)
  const [navTree, setNavTree] = useState([])
  const [loading, setLoading] = useState(false)
  const [navLoading, setNavLoading] = useState(false)
  const [filters, setFilters] = useState({ status: undefined, keyword: '' })
  const [createOpen, setCreateOpen] = useState(false)
  const [form] = Form.useForm()

  // 树状态
  const [selectedNodeId, setSelectedNodeId] = useState(null)
  const [expandedKeys, setExpandedKeys] = useState(new Set())

  // Resizable sidebar state
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('wiki_sidebar_width')
    return saved ? Math.max(160, Math.min(600, Number(saved))) : 240
  })
  const isResizing = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(240)

  const handleMouseDown = useCallback((e) => {
    e.preventDefault()
    isResizing.current = true
    startX.current = e.clientX
    startWidth.current = sidebarWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (e) => {
      if (!isResizing.current) return
      const delta = e.clientX - startX.current
      const newWidth = Math.max(160, Math.min(600, startWidth.current + delta))
      setSidebarWidth(newWidth)
    }

    const handleMouseUp = () => {
      isResizing.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      // Persist width
      setSidebarWidth((w) => {
        localStorage.setItem('wiki_sidebar_width', String(w))
        return w
      })
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [sidebarWidth])

  // Article preview state: when a leaf doc node is selected, show its content
  const [previewDoc, setPreviewDoc] = useState(null) // { id, name, content }
  const [previewLoading, setPreviewLoading] = useState(false)

  // fetchDocs: supports doc_ids parameter for directory filtering
  const fetchDocs = useCallback(async (docIds) => {
    setLoading(true)
    try {
      const params = {}
      if (filters.status !== undefined) params.status = filters.status
      if (filters.keyword) params.keyword = filters.keyword
      if (docIds && docIds.length > 0) params.doc_ids = docIds.join(',')
      const data = await getDocs(params)
      setDocs(data)
    } finally {
      setLoading(false)
    }
  }, [filters.status, filters.keyword])

  // Fetch total doc count (not affected by directory filtering)
  const fetchTotalCount = useCallback(async () => {
    try {
      const data = await getDocs({})
      setTotalDocCount(data.length)
    } catch {}
  }, [])

  // 初始化加载
  useEffect(() => { fetchDocs(null) }, [fetchDocs])
  useEffect(() => { fetchTotalCount() }, [fetchTotalCount])

  // Collect doc IDs for the selected directory node
  const selectedDocIds = useMemo(() => {
    if (!selectedNodeId) return null
    const node = findNodeById(navTree, selectedNodeId)
    if (!node) return null
    // Collect all doc IDs under this directory node
    const ids = collectDocIds(node)
    return ids.length > 0 ? ids : [-1] // -1 means "no docs" so we get empty result
  }, [navTree, selectedNodeId])

  // Reload docs when selected directory changes
  useEffect(() => {
    fetchDocs(selectedDocIds)
  }, [selectedDocIds, fetchDocs])

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

  useEffect(() => { fetchNav() }, [])

  // 不再需要前端过滤，直接用选中目录获取文章
  const filteredDocs = docs

  // 搜索过滤
  const displayDocs = useMemo(() => {
    let result = filteredDocs
    if (filters.keyword) {
      const kw = filters.keyword.toLowerCase()
      result = result.filter((d) => (d.name || '').toLowerCase().includes(kw))
    }
    if (filters.status !== undefined) {
      result = result.filter((d) => normalizeStatus(d.status) === filters.status)
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

  // Handle node selection: directory nodes show doc list, article nodes show preview
  const handleNodeSelect = useCallback(async (nodeId, docMark) => {
    if (docMark) {
      // Article node: load and show read-only preview
      setSelectedNodeId(nodeId)
      setPreviewLoading(true)
      try {
        const data = await getDoc(docMark)
        setPreviewDoc({ id: data.id, name: data.name, content: data.content || '' })
      } catch {
        setPreviewDoc(null)
        message.error('加载文档内容失败')
      } finally {
        setPreviewLoading(false)
      }
    } else {
      // Directory node: clear preview, show doc list
      setSelectedNodeId((prev) => prev === nodeId ? null : nodeId)
      setPreviewDoc(null)
    }
  }, [])

  // Locate a doc in the tree by doc_id (mark field): expand all ancestors, select the node, and show preview
  const locateDocInTree = useCallback(async (docId) => {
    const docIdStr = String(docId)
    // Find the node with matching mark and collect ancestor ids to expand
    const findAndCollectPath = (nodes, ancestors = []) => {
      for (const node of nodes) {
        if (node.mark === docIdStr) {
          return { node, ancestors }
        }
        if (node.children && node.children.length > 0) {
          const result = findAndCollectPath(node.children, [...ancestors, node.id])
          if (result) return result
        }
      }
      return null
    }
    const result = findAndCollectPath(navTree)
    if (result) {
      // Expand all ancestor nodes
      setExpandedKeys((prev) => {
        const next = new Set(prev)
        result.ancestors.forEach((id) => next.add(id))
        return next
      })
      // Select the found node and load preview
      setSelectedNodeId(result.node.id)
    }
    // Always load and show preview (even if not found in tree)
    setPreviewLoading(true)
    try {
      const data = await getDoc(docId)
      setPreviewDoc({ id: data.id, name: data.name, content: data.content || '' })
    } catch {
      setPreviewDoc(null)
    } finally {
      setPreviewLoading(false)
    }
  }, [navTree])

  // Build tree select data from navTree for directory path selection
  const dirTreeData = useMemo(() => {
    const buildTreeSelectData = (nodes, parentPath = '') => {
      return nodes.filter(node => !node.mark && node.children).map((node) => {
        const currentPath = parentPath ? `${parentPath}/${node.name}` : node.name
        const item = {
          title: node.name,
          value: currentPath,
          key: node.id || currentPath,
        }
        if (node.children && node.children.length > 0) {
          const childDirs = buildTreeSelectData(node.children, currentPath)
          if (childDirs.length > 0) {
            item.children = childDirs
          }
        }
        return item
      })
    }
    return buildTreeSelectData(navTree)
  }, [navTree])

  const handleCreate = async () => {
    if (!currentUser?.id) { message.error('请先登录'); return }
    try {
      const values = await form.validateFields()
      await createDoc({ 
        name: values.title,
        path: values.path || '',
        description: values.description || '',
        author: currentUser.username,
        nav_parent_path: values.path || '',
      })
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
      content: `确定删除「${doc.name}」？此操作不可撤销。`,
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
      setDocs((prev) => prev.map((d) => d.id === doc.id ? { ...d, status: newStatus } : d))
    } catch {
      message.error('状态更新失败')
    }
  }

  return (
    <div className="fade-in" style={{ flex: 1, display: 'flex', gap: 20, minHeight: 0 }}>
      {/* 左侧目录树 */}
      <div style={{
        width: sidebarWidth,
        flexShrink: 0,
        background: '#FFFFFF',
        borderRadius: 12,
        border: '1px solid #E7E5E4',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
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
                onClick={() => { setSelectedNodeId(null); setPreviewDoc(null) }}
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
                onClick={() => { setSelectedNodeId(null); setPreviewDoc(null) }}
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
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#A8A29E' }}>{totalDocCount}</span>
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
        {/* Drag handle for resizing */}
        <div
          onMouseDown={handleMouseDown}
          style={{
            position: 'absolute',
            top: 0,
            right: -5,
            width: 10,
            height: '100%',
            cursor: 'col-resize',
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.querySelector('.resize-bar').style.opacity = '1'
            e.currentTarget.querySelector('.resize-bar').style.background = '#0D9488'
          }}
          onMouseLeave={(e) => {
            if (!isResizing.current) {
              e.currentTarget.querySelector('.resize-bar').style.opacity = '0.3'
              e.currentTarget.querySelector('.resize-bar').style.background = '#D6D3D1'
            }
          }}
        >
          <div
            className="resize-bar"
            style={{
              width: 3,
              height: 40,
              borderRadius: 3,
              background: '#D6D3D1',
              opacity: 0.3,
              transition: 'opacity 0.2s, background 0.2s',
            }}
          />
        </div>
      </div>

      {/* 右侧内容区域 */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {previewDoc || previewLoading ? (
          /* ===== Article read-only preview mode ===== */
          <>
            {/* Preview top bar */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 16,
            }}>
              <Button
                icon={<ArrowLeftOutlined />}
                onClick={() => { setPreviewDoc(null); setSelectedNodeId(null) }}
                style={{ borderRadius: 8, height: 36 }}
              >
                返回列表
              </Button>
              {previewDoc && (
                <Button
                  type="primary"
                  icon={<EditOutlined />}
                  onClick={() => navigate(`/docs/${previewDoc.id}`)}
                  style={{
                    height: 36, borderRadius: 8, fontWeight: 600,
                    background: '#0D9488', border: 'none',
                    boxShadow: '0 2px 8px rgba(13,148,136,0.25)',
                  }}
                >
                  编辑文档
                </Button>
              )}
            </div>
            {/* Preview content */}
            <div style={{
              flex: 1, background: '#FFFFFF', borderRadius: 12,
              border: '1px solid #E7E5E4', overflow: 'hidden',
              display: 'flex', flexDirection: 'column',
            }}>
              {previewLoading ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Spin />
                </div>
              ) : previewDoc ? (
                <>
                  {/* Title bar */}
                  <div style={{
                    padding: '16px 24px', borderBottom: '1px solid #F0EDEA',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <FileTextOutlined style={{ fontSize: 18, color: '#0D9488' }} />
                    <span style={{
                      fontSize: 18, fontWeight: 700, color: '#1C1917',
                      fontFamily: "'Newsreader', Georgia, serif",
                    }}>
                      {previewDoc.name}
                    </span>
                    <span style={{
                      marginLeft: 'auto', fontSize: 12, color: '#A8A29E',
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                      <EyeOutlined /> 只读预览
                    </span>
                  </div>
                  {/* Markdown preview */}
                  <div style={{ flex: 1, overflow: 'hidden', padding: 0 }}>
                    <CherryEditor
                      value={previewDoc.content}
                      mode="previewOnly"
                      readOnly
                      hideToolbar
                      height="100%"
                      style={{ border: 'none', boxShadow: 'none' }}
                    />
                  </div>
                </>
              ) : null}
            </div>
          </>
        ) : (
          /* ===== Document list mode ===== */
          <>
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
            <Button icon={<ReloadOutlined />} onClick={() => { fetchDocs(); fetchNav(); fetchTotalCount() }} style={{ borderRadius: 8, height: 36 }}>
              刷新
            </Button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#78716C' }}>
              <span>
                共 <span style={{ fontWeight: 700, color: '#1C1917' }}>{displayDocs.length}</span> 篇
                {selectedNodeId && `（当前目录）`}
              </span>
              <span style={{ color: '#E7E5E4' }}>|</span>
              {(() => {
                const normalCount = displayDocs.filter(d => normalizeStatus(d.status) === 0).length
                const editingCount = displayDocs.filter(d => [3, 4].includes(normalizeStatus(d.status))).length
                const publishedCount = displayDocs.filter(d => d.publish_status === 0).length
                const deletedCount = displayDocs.filter(d => normalizeStatus(d.status) === 1).length
                return (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16A34A', display: 'inline-block' }} />
                      正常 <span style={{ fontWeight: 600, color: '#16A34A' }}>{normalCount}</span>
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#D97706', display: 'inline-block' }} />
                      修改中 <span style={{ fontWeight: 600, color: '#D97706' }}>{editingCount}</span>
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#0D9488', display: 'inline-block' }} />
                      已发布 <span style={{ fontWeight: 600, color: '#0D9488' }}>{publishedCount}</span>
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#9CA3AF', display: 'inline-block' }} />
                      已删除 <span style={{ fontWeight: 600, color: '#9CA3AF' }}>{deletedCount}</span>
                    </span>
                  </span>
                )
              })()}
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
                gridTemplateColumns: '1fr 100px 80px 140px 120px 80px',
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
                <span>发布</span>
                <span>修改时间</span>
                <span>创建人</span>
                <span style={{ textAlign: 'right' }}>操作</span>
              </div>
              {/* 行 */}
              {displayDocs.map((doc, idx) => {
                const docStatus = normalizeStatus(doc.status)
                const status = STATUS_CONFIG[docStatus] || STATUS_CONFIG[0]
                const pubStatus = PUBLISH_STATUS_CONFIG[doc.publish_status ?? 1] || PUBLISH_STATUS_CONFIG[1]
                const isHidden = doc.hidden === 1
                return (
                  <div
                    key={doc.id}
                    onClick={() => locateDocInTree(doc.id)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 100px 80px 140px 120px 80px',
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
                        {doc.name}
                      </span>
                      {isHidden && (
                        <Tooltip title="隐藏文章：发布时生成页面但不在菜单显示">
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 3,
                            fontSize: 10, color: '#8B5CF6', flexShrink: 0,
                            padding: '1px 6px', borderRadius: 4,
                            background: '#F5F3FF', border: '1px solid #EDE9FE',
                          }}>
                            <EyeInvisibleOutlined style={{ fontSize: 10 }} />
                            隐藏
                          </span>
                        </Tooltip>
                      )}
                      {doc.current_editor && (
                        <span style={{ fontSize: 10, color: '#D97706', flexShrink: 0 }}>(锁定中)</span>
                      )}
                    </div>
                    {/* 状态 */}
                    <div onClick={(e) => e.stopPropagation()}>
                      <Select
                        size="small"
                        value={docStatus}
                        onChange={(v) => handleStatusChange(doc, v)}
                        style={{ width: 96 }}
                        bordered={false}
                        dropdownStyle={{ minWidth: 110 }}
                        popupMatchSelectWidth={false}
                        labelRender={({ value }) => {
                          const cfg = STATUS_CONFIG[value] || STATUS_CONFIG[0]
                          return (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                              <span style={{
                                width: 7, height: 7, borderRadius: '50%',
                                background: cfg.color, display: 'inline-block', flexShrink: 0,
                              }} />
                              <span style={{ color: cfg.color, fontWeight: 500, fontSize: 12 }}>{cfg.label}</span>
                            </span>
                          )
                        }}
                        optionRender={(option) => {
                          const cfg = STATUS_CONFIG[option.value] || STATUS_CONFIG[0]
                          return (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{
                                width: 8, height: 8, borderRadius: '50%',
                                background: cfg.color, display: 'inline-block', flexShrink: 0,
                              }} />
                              <span style={{ color: cfg.color }}>{cfg.label}</span>
                            </div>
                          )
                        }}
                        options={LIST_STATUS_OPTIONS.map(opt => {
                          const cfg = STATUS_CONFIG[opt.value] || STATUS_CONFIG[0]
                          return { ...opt, label: cfg.label }
                        })}
                      />
                    </div>
                    {/* 发布状态 */}
                    <div>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        fontSize: 11, fontWeight: 500,
                        padding: '2px 8px', borderRadius: 10,
                        color: pubStatus.color,
                        background: pubStatus.bg,
                      }}>
                        {doc.publish_status === 0 ? (
                          <CheckCircleOutlined style={{ fontSize: 10 }} />
                        ) : (
                          <CloudUploadOutlined style={{ fontSize: 10 }} />
                        )}
                        {pubStatus.label}
                      </span>
                    </div>
                    {/* 修改时间 */}
                    <span style={{ fontSize: 12, color: '#78716C' }}>
                      {formatTime(doc.create_time)}
                    </span>
                    {/* 创建人 */}
                    <span style={{ fontSize: 12, color: '#78716C' }}>
                      {doc.author || '-'}
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
          </>
        )}
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
          <Form.Item
            name="path"
            label="所属目录"
            rules={[{ required: true, message: '请选择所属目录' }]}
          >
            <TreeSelect
              treeData={dirTreeData}
              placeholder="选择文档所属目录"
              allowClear
              showSearch
              treeDefaultExpandAll
              style={{ borderRadius: 8, height: 40, fontSize: 14 }}
              dropdownStyle={{ maxHeight: 300, overflow: 'auto' }}
              treeLine={{ showLeafIcon: false }}
            />
          </Form.Item>
          <Form.Item
            name="description"
            label="文档描述"
          >
            <Input.TextArea
              placeholder="输入文档描述（可选）"
              rows={2}
              style={{ borderRadius: 8, fontSize: 14 }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
