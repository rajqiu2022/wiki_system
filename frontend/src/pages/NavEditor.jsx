import React, { useState, useEffect, useCallback } from 'react'
import {
  Button, Space, Input, Select, Modal, Form, message, Tree, Popconfirm, Empty, Tag, Tooltip,
} from 'antd'
import {
  PlusOutlined, DeleteOutlined, EditOutlined, FolderOutlined, FileTextOutlined,
  SaveOutlined, DragOutlined,
} from '@ant-design/icons'
import { getNavTree, createNavNode, updateNavNode, deleteNavNode, batchUpdateNav, getDocs } from '../api'

export default function NavEditor({ currentUser }) {
  const [tree, setTree] = useState([])
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editingNode, setEditingNode] = useState(null)
  const [addParentId, setAddParentId] = useState(null)
  const [form] = Form.useForm()
  const [editForm] = Form.useForm()
  const [hasChanges, setHasChanges] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [navData, docsData] = await Promise.all([getNavTree(), getDocs()])
      setTree(navData)
      setDocs(docsData)
      setHasChanges(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const flattenTree = (nodes, parentId = null) => {
    const result = []
    nodes.forEach((node, index) => {
      result.push({ id: node.id, parent_id: parentId, sort_order: index, title: node.title })
      if (node.children?.length) result.push(...flattenTree(node.children, node.id))
    })
    return result
  }

  const toTreeData = (nodes) => {
    return nodes.map((node) => ({
      key: node.id,
      title: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
          <div style={{
            width: 26, height: 26, borderRadius: 6, flexShrink: 0,
            background: node.doc_id ? '#CCFBF1' : '#FEF3C7',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {node.doc_id
              ? <FileTextOutlined style={{ color: '#0D9488', fontSize: 12 }} />
              : <FolderOutlined style={{ color: '#D97706', fontSize: 12 }} />
            }
          </div>
          <span style={{ flex: 1, fontWeight: 500, color: '#44403C', fontSize: 13 }}>{node.title}</span>
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 5,
            background: node.doc_id ? '#CCFBF1' : '#FEF3C7',
            color: node.doc_id ? '#0D9488' : '#D97706',
          }}>
            {node.doc_id ? '文档' : '分组'}
          </span>
          <Space size={1} onClick={e => e.stopPropagation()}>
            <Tooltip title="编辑">
              <Button type="text" size="small" icon={<EditOutlined />}
                style={{ color: '#A8A29E', borderRadius: 6 }}
                onClick={(e) => { e.stopPropagation(); openEdit(node) }}
              />
            </Tooltip>
            <Tooltip title="添加子节点">
              <Button type="text" size="small" icon={<PlusOutlined />}
                style={{ color: '#A8A29E', borderRadius: 6 }}
                onClick={(e) => { e.stopPropagation(); openAdd(node.id) }}
              />
            </Tooltip>
            <Popconfirm
              title="确认删除？"
              onConfirm={(e) => { e?.stopPropagation(); handleDeleteNode(node.id) }}
              onCancel={(e) => e?.stopPropagation()}
              okButtonProps={{ danger: true, style: { borderRadius: 6 } }}
              cancelButtonProps={{ style: { borderRadius: 6 } }}
            >
              <Tooltip title="删除">
                <Button type="text" size="small" danger icon={<DeleteOutlined />}
                  style={{ borderRadius: 6 }}
                  onClick={(e) => e.stopPropagation()}
                />
              </Tooltip>
            </Popconfirm>
          </Space>
        </div>
      ),
      children: node.children?.length ? toTreeData(node.children) : [],
    }))
  }

  const openAdd = (parentId = null) => {
    setAddParentId(parentId)
    form.resetFields()
    setAddOpen(true)
  }

  const openEdit = (node) => {
    setEditingNode(node)
    editForm.setFieldsValue({ title: node.title, doc_id: node.doc_id || undefined })
    setEditOpen(true)
  }

  const handleAdd = async () => {
    try {
      const values = await form.validateFields()
      await createNavNode({ title: values.title, parent_id: addParentId, doc_id: values.doc_id || null, sort_order: 0 })
      message.success('节点已添加')
      setAddOpen(false)
      fetchData()
    } catch (e) {
      if (e.response) message.error(e.response.data?.detail || '添加失败')
    }
  }

  const handleEdit = async () => {
    try {
      const values = await editForm.validateFields()
      await updateNavNode(editingNode.id, { title: values.title, doc_id: values.doc_id || null })
      message.success('节点已更新')
      setEditOpen(false)
      fetchData()
    } catch (e) {
      if (e.response) message.error(e.response.data?.detail || '更新失败')
    }
  }

  const handleDeleteNode = async (nodeId) => {
    try {
      await deleteNavNode(nodeId)
      message.success('节点已删除')
      fetchData()
    } catch (e) {
      message.error(e.response?.data?.detail || '删除失败')
    }
  }

  const onDrop = (info) => {
    const dropKey = info.node.key
    const dragKey = info.dragNode.key
    const dropPos = info.node.pos.split('-')
    const dropPosition = info.dropPosition - Number(dropPos[dropPos.length - 1])
    const loop = (data, key, callback) => {
      for (let i = 0; i < data.length; i++) {
        if (data[i].id === key) return callback(data[i], i, data)
        if (data[i].children) loop(data[i].children, key, callback)
      }
    }
    const data = JSON.parse(JSON.stringify(tree))
    let dragObj
    loop(data, dragKey, (item, index, arr) => { arr.splice(index, 1); dragObj = item })
    if (!info.dropToGap) {
      loop(data, dropKey, (item) => { item.children = item.children || []; item.children.unshift(dragObj) })
    } else if (dropPosition === -1) {
      loop(data, dropKey, (_, index, arr) => arr.splice(index, 0, dragObj))
    } else {
      loop(data, dropKey, (_, index, arr) => arr.splice(index + 1, 0, dragObj))
    }
    setTree(data)
    setHasChanges(true)
  }

  const handleSaveOrder = async () => {
    try {
      const nodes = flattenTree(tree)
      await batchUpdateNav(nodes)
      message.success('菜单顺序已保存')
      setHasChanges(false)
      fetchData()
    } catch (e) {
      message.error('保存失败')
    }
  }

  const countNodes = (nodes) => nodes.reduce((acc, n) => acc + 1 + (n.children ? countNodes(n.children) : 0), 0)
  const totalNodes = countNodes(tree)

  const modalFormContent = (formInstance) => (
    <Form form={formInstance} layout="vertical" style={{ marginTop: 16 }}>
      <Form.Item
        name="title"
        label={<span style={{ fontWeight: 600, color: '#44403C' }}>节点标题</span>}
        rules={[{ required: true, message: '请输入标题' }]}
      >
        <Input placeholder="输入菜单标题" style={{ borderRadius: 8, height: 40 }} autoFocus />
      </Form.Item>
      <Form.Item
        name="doc_id"
        label={<span style={{ fontWeight: 600, color: '#44403C' }}>关联文档 <span style={{ fontWeight: 400, color: '#A8A29E' }}>（不选则为分组）</span></span>}
      >
        <Select placeholder="选择文档（可选）" allowClear showSearch optionFilterProp="label" style={{ borderRadius: 8 }}>
          {docs.map((d) => (
            <Select.Option key={d.id} value={d.id} label={d.title}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileTextOutlined style={{ color: '#0D9488', fontSize: 12 }} />
                <span>{d.title}</span>
                <span style={{
                  marginLeft: 'auto', fontSize: 11, padding: '1px 6px', borderRadius: 4,
                  background: d.status === 'published' ? '#F0FDF4' : '#F5F5F3',
                  color: d.status === 'published' ? '#16A34A' : '#78716C',
                }}>
                  {d.status === 'published' ? '已发布' : '草稿'}
                </span>
              </div>
            </Select.Option>
          ))}
        </Select>
      </Form.Item>
    </Form>
  )

  return (
    <div className="fade-in" style={{ flex: 1 }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 13, color: '#A8A29E', marginBottom: 4 }}>
            共 {totalNodes} 个节点 · 拖拽调整顺序
          </div>
        </div>
        <Space>
          <Button icon={<PlusOutlined />} onClick={() => openAdd(null)} style={{ borderRadius: 8 }}>
            添加节点
          </Button>
          {hasChanges && (
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSaveOrder}
              style={{ borderRadius: 8, background: '#0D9488', border: 'none', fontWeight: 600 }}
            >
              保存变更
            </Button>
          )}
        </Space>
      </div>

      {/* Tree */}
      <div style={{
        background: '#FFFFFF', borderRadius: 14, border: '1px solid #E7E5E4',
        padding: '16px 20px', minHeight: 300,
      }}>
        {tree.length > 0 ? (
          <Tree
            treeData={toTreeData(tree)}
            draggable
            blockNode
            defaultExpandAll
            onDrop={onDrop}
            style={{ background: 'transparent' }}
          />
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <div>
                <div style={{ color: '#A8A29E', marginBottom: 12 }}>暂无菜单节点</div>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => openAdd(null)}
                  style={{ borderRadius: 8, background: '#0D9488', border: 'none' }}>
                  添加第一个节点
                </Button>
              </div>
            }
          />
        )}
      </div>

      {/* Add Modal */}
      <Modal
        title={
          <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontWeight: 700, fontSize: 18, color: '#1C1917' }}>
            {addParentId ? '添加子节点' : '添加节点'}
          </div>
        }
        open={addOpen}
        onOk={handleAdd}
        onCancel={() => setAddOpen(false)}
        okText="添加"
        cancelText="取消"
        okButtonProps={{ style: { background: '#0D9488', borderColor: '#0D9488', borderRadius: 8 } }}
        cancelButtonProps={{ style: { borderRadius: 8 } }}
      >
        {modalFormContent(form)}
      </Modal>

      {/* Edit Modal */}
      <Modal
        title={
          <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontWeight: 700, fontSize: 18, color: '#1C1917' }}>
            编辑节点
          </div>
        }
        open={editOpen}
        onOk={handleEdit}
        onCancel={() => setEditOpen(false)}
        okText="保存"
        cancelText="取消"
        okButtonProps={{ style: { background: '#0D9488', borderColor: '#0D9488', borderRadius: 8 } }}
        cancelButtonProps={{ style: { borderRadius: 8 } }}
      >
        {modalFormContent(editForm)}
      </Modal>
    </div>
  )
}
