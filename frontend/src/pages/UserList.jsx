import React, { useState, useEffect, useCallback } from 'react'
import { Table, Button, Input, Modal, Form, Select, Space, message, Popconfirm, Typography, Avatar } from 'antd'
import { PlusOutlined, SearchOutlined, DeleteOutlined, UserOutlined } from '@ant-design/icons'
import { getUsersPaged, createUser, deleteUser } from '../api'
import dayjs from 'dayjs'

const { Text } = Typography

const ROLE_CONFIG = {
  admin: { color: '#DC2626', bg: '#FEF2F2', label: '管理员' },
  editor: { color: '#0D9488', bg: '#CCFBF1', label: '编辑者' },
  viewer: { color: '#78716C', bg: '#F5F5F3', label: '查看者' },
}

function getInitials(name = '') {
  return name.slice(0, 2).toUpperCase()
}

const AVATAR_COLORS = ['#0D9488', '#7C3AED', '#DC2626', '#D97706', '#2563EB']
function getAvatarColor(str = '') {
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

export default function UserList({ currentUser }) {
  const [data, setData] = useState({ items: [], total: 0 })
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [keyword, setKeyword] = useState('')
  const [searchText, setSearchText] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm()
  const [creating, setCreating] = useState(false)

  const isAdmin = currentUser?.role === 'admin'

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getUsersPaged({ page, page_size: pageSize, keyword })
      setData(res)
    } catch {
      message.error('获取用户列表失败')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, keyword])

  useEffect(() => { fetchData() }, [fetchData])

  const handleSearch = () => { setPage(1); setKeyword(searchText) }

  const handleCreate = async () => {
    try {
      const values = await form.validateFields()
      setCreating(true)
      await createUser(values)
      message.success('用户创建成功')
      setModalOpen(false)
      form.resetFields()
      fetchData()
    } catch (err) {
      if (err.response?.data?.detail) message.error(err.response.data.detail)
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id) => {
    try {
      await deleteUser(id)
      message.success('用户已删除')
      fetchData()
    } catch (err) {
      const detail = err.response?.data?.detail
      message.error(typeof detail === 'string' ? detail : '删除失败')
    }
  }

  const columns = [
    {
      title: '用户',
      key: 'user',
      render: (_, record) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar
            size={38}
            style={{ background: getAvatarColor(record.username), fontSize: 13, fontWeight: 700, fontFamily: "'DM Sans', sans-serif" }}
          >
            {getInitials(record.display_name)}
          </Avatar>
          <div>
            <div style={{ fontWeight: 600, color: '#1C1917', fontSize: 14 }}>{record.display_name}</div>
            <div style={{ fontSize: 12, color: '#A8A29E' }}>@{record.username}</div>
          </div>
        </div>
      ),
    },
    {
      title: '角色',
      dataIndex: 'role',
      width: 110,
      render: (role) => {
        const conf = ROLE_CONFIG[role] || ROLE_CONFIG.viewer
        return (
          <span style={{
            display: 'inline-flex', alignItems: 'center',
            padding: '4px 12px', borderRadius: 999,
            background: conf.bg, color: conf.color,
            fontSize: 12, fontWeight: 600,
          }}>
            {conf.label}
          </span>
        )
      },
    },
    {
      title: '注册时间',
      dataIndex: 'created_at',
      width: 160,
      render: (t) => (
        <span style={{ color: '#A8A29E', fontSize: 13 }}>
          {dayjs(t).format('YYYY-MM-DD HH:mm')}
        </span>
      ),
    },
    ...(isAdmin ? [{
      title: '操作',
      width: 90,
      render: (_, record) =>
        record.username === 'admin' ? (
          <span style={{ fontSize: 12, color: '#A8A29E', padding: '3px 8px', background: '#F5F5F3', borderRadius: 6 }}>
            不可删除
          </span>
        ) : (
          <Popconfirm
            title="确定删除该用户？"
            description="此操作不可撤销"
            onConfirm={() => handleDelete(record.id)}
            okText="确定删除"
            cancelText="取消"
            okButtonProps={{ danger: true, style: { borderRadius: 6 } }}
            cancelButtonProps={{ style: { borderRadius: 6 } }}
          >
            <Button type="text" danger size="small" icon={<DeleteOutlined />} style={{ borderRadius: 6 }}>
              删除
            </Button>
          </Popconfirm>
        ),
    }] : []),
  ]

  const adminCount = data.items.filter(u => u.role === 'admin').length
  const editorCount = data.items.filter(u => u.role === 'editor').length

  return (
    <div className="fade-in" style={{ flex: 1 }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Input
            placeholder="搜索用户..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onPressEnter={handleSearch}
            prefix={<SearchOutlined style={{ color: '#A8A29E' }} />}
            allowClear
            style={{ width: 240, borderRadius: 10, height: 38 }}
          />
          <Button onClick={handleSearch} style={{ borderRadius: 10, height: 38 }}>搜索</Button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#1C1917', fontFamily: "'Newsreader', serif", lineHeight: 1 }}>{data.total}</div>
            <div style={{ fontSize: 11, color: '#A8A29E', marginTop: 2 }}>位用户</div>
          </div>
          {isAdmin && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setModalOpen(true)}
              style={{ height: 38, borderRadius: 10, fontWeight: 600, background: '#0D9488', border: 'none' }}
            >
              新建用户
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E7E5E4', overflow: 'hidden' }}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data.items}
          loading={loading}
          pagination={{
            current: page,
            pageSize,
            total: data.total,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 位用户`,
            pageSizeOptions: ['5', '10', '20', '50'],
            onChange: (p, ps) => { setPage(p); setPageSize(ps) },
            style: { padding: '12px 20px' },
          }}
          style={{ border: 'none' }}
        />
      </div>

      {/* Create Modal */}
      <Modal
        title={
          <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontWeight: 700, fontSize: 18, color: '#1C1917' }}>
            新建用户
          </div>
        }
        open={modalOpen}
        onOk={handleCreate}
        onCancel={() => { setModalOpen(false); form.resetFields() }}
        confirmLoading={creating}
        okText="创建用户"
        cancelText="取消"
        okButtonProps={{ style: { background: '#0D9488', borderColor: '#0D9488', borderRadius: 8 } }}
        cancelButtonProps={{ style: { borderRadius: 8 } }}
      >
        <Form form={form} layout="vertical" initialValues={{ role: 'editor' }} style={{ marginTop: 16 }}>
          <Form.Item
            name="username"
            label={<span style={{ fontWeight: 600, color: '#44403C' }}>用户名</span>}
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="英文用户名（登录用）" style={{ borderRadius: 8, height: 40 }} />
          </Form.Item>
          <Form.Item
            name="display_name"
            label={<span style={{ fontWeight: 600, color: '#44403C' }}>显示名称</span>}
            rules={[{ required: true, message: '请输入显示名称' }]}
          >
            <Input placeholder="界面显示的名称" style={{ borderRadius: 8, height: 40 }} />
          </Form.Item>
          <Form.Item
            name="password"
            label={<span style={{ fontWeight: 600, color: '#44403C' }}>密码</span>}
            rules={[{ required: true, message: '请输入密码' }, { min: 6, message: '密码至少 6 位' }]}
          >
            <Input.Password placeholder="至少 6 位字符" style={{ borderRadius: 8, height: 40 }} />
          </Form.Item>
          <Form.Item
            name="role"
            label={<span style={{ fontWeight: 600, color: '#44403C' }}>角色</span>}
          >
            <Select style={{ borderRadius: 8 }}>
              <Select.Option value="admin">管理员 — 全部权限</Select.Option>
              <Select.Option value="editor">编辑者 — 可编辑文档</Select.Option>
              <Select.Option value="viewer">查看者 — 只读权限</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
