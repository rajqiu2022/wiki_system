import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Table, Button, Modal, Form, Input, Select, DatePicker, Tag, Space,
  message, Popconfirm, Card, Row, Col, Statistic, Badge, Tooltip, Typography, Spin
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined, BugOutlined,
  BulbOutlined, ClockCircleOutlined, CheckCircleOutlined, CloseCircleOutlined,
  PictureOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { getRequirements, createRequirement, updateRequirement, deleteRequirement, uploadImage } from '../api'

const { Option } = Select
const { TextArea } = Input
const { Title } = Typography

/**
 * RichTextArea - A contentEditable div that supports rich text editing with image paste.
 * Images pasted from clipboard are uploaded and displayed inline.
 */
function RichTextArea({ value, onChange, placeholder, style }) {
  const editorRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const isInternalChange = useRef(false)

  // Sync external value to editor (only when value changes externally)
  useEffect(() => {
    if (isInternalChange.current) {
      isInternalChange.current = false
      return
    }
    if (editorRef.current && editorRef.current.innerHTML !== (value || '')) {
      editorRef.current.innerHTML = value || ''
    }
  }, [value])

  const handleInput = useCallback(() => {
    if (editorRef.current) {
      isInternalChange.current = true
      onChange?.(editorRef.current.innerHTML)
    }
  }, [onChange])

  const handlePaste = useCallback(async (e) => {
    const items = e.clipboardData?.items
    if (!items) return

    let imageFile = null
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        imageFile = items[i].getAsFile()
        break
      }
    }

    if (!imageFile) return // No image, let default paste happen

    e.preventDefault()
    setUploading(true)

    try {
      const res = await uploadImage(imageFile)
      const imageUrl = res.url
      // Insert image at cursor position
      const img = document.createElement('img')
      img.src = imageUrl
      img.alt = 'image'
      img.style.maxWidth = '100%'
      img.style.borderRadius = '4px'
      img.style.margin = '8px 0'
      img.style.display = 'block'

      const selection = window.getSelection()
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0)
        range.deleteContents()
        range.insertNode(img)
        // Move cursor after the image
        range.setStartAfter(img)
        range.setEndAfter(img)
        selection.removeAllRanges()
        selection.addRange(range)
      } else {
        editorRef.current?.appendChild(img)
      }

      // Trigger onChange
      isInternalChange.current = true
      onChange?.(editorRef.current?.innerHTML || '')
      message.success('图片上传成功')
    } catch (err) {
      message.error('图片上传失败')
    } finally {
      setUploading(false)
    }
  }, [onChange])

  return (
    <Spin spinning={uploading} tip="图片上传中...">
      <div
        ref={editorRef}
        contentEditable
        onInput={handleInput}
        onPaste={handlePaste}
        data-placeholder={placeholder || ''}
        style={{
          minHeight: 150,
          maxHeight: 400,
          overflow: 'auto',
          padding: '8px 12px',
          border: '1px solid #d9d9d9',
          borderRadius: 6,
          outline: 'none',
          lineHeight: 1.6,
          fontSize: 14,
          color: '#1C1917',
          background: '#fff',
          transition: 'border-color 0.3s',
          ...style,
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = '#0D9488'; e.currentTarget.style.boxShadow = '0 0 0 2px rgba(13,148,136,0.1)' }}
        onBlur={(e) => { e.currentTarget.style.borderColor = '#d9d9d9'; e.currentTarget.style.boxShadow = 'none' }}
      />
      <div style={{ marginTop: 4, color: '#999', fontSize: 12 }}>
        <PictureOutlined style={{ marginRight: 4 }} />
        支持直接粘贴图片（Ctrl+V），支持富文本编辑
      </div>
    </Spin>
  )
}

const TYPE_CONFIG = {
  feature: { color: 'blue', icon: <BulbOutlined />, text: '功能需求' },
  bug: { color: 'red', icon: <BugOutlined />, text: 'Bug反馈' },
}

const PRIORITY_CONFIG = {
  low: { color: 'default', text: '低' },
  medium: { color: 'orange', text: '中' },
  high: { color: 'red', text: '高' },
  urgent: { color: 'magenta', text: '紧急' },
}

const STATUS_CONFIG = {
  pending: { color: 'default', icon: <ClockCircleOutlined />, text: '待处理' },
  in_progress: { color: 'processing', icon: <EditOutlined />, text: '进行中' },
  completed: { color: 'success', icon: <CheckCircleOutlined />, text: '已完成' },
  closed: { color: 'default', icon: <CloseCircleOutlined />, text: '已关闭' },
}

export default function RequirementList({ currentUser }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [filterType, setFilterType] = useState(null)
  const [filterStatus, setFilterStatus] = useState(null)
  const [form] = Form.useForm()
  const [detailVisible, setDetailVisible] = useState(false)
  const [detailItem, setDetailItem] = useState(null)

  const isAdmin = currentUser?.role === 'admin'

  useEffect(() => {
    loadData()
  }, [filterType, filterStatus])

  const loadData = async () => {
    setLoading(true)
    try {
      const params = {}
      if (filterType) params.type = filterType
      if (filterStatus) params.status = filterStatus
      const res = await getRequirements(params)
      setData(res)
    } catch (err) {
      message.error('加载失败')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = () => {
    setEditingItem(null)
    form.resetFields()
    setModalVisible(true)
  }

  const handleEdit = (record) => {
    setEditingItem(record)
    form.setFieldsValue({
      ...record,
      expected_date: record.expected_date ? dayjs(record.expected_date) : null,
    })
    setModalVisible(true)
  }

  const handleDelete = async (id) => {
    try {
      await deleteRequirement(id)
      message.success('删除成功')
      loadData()
    } catch (err) {
      message.error('删除失败')
    }
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      const data = {
        ...values,
        expected_date: values.expected_date ? values.expected_date.toDate() : null,
      }
      
      if (editingItem) {
        await updateRequirement(editingItem.id, data)
        message.success('更新成功')
      } else {
        await createRequirement(data)
        message.success('创建成功')
      }
      setModalVisible(false)
      loadData()
    } catch (err) {
      if (err.errorFields) return
      message.error(editingItem ? '更新失败' : '创建失败')
    }
  }

  const handleViewDetail = (record) => {
    setDetailItem(record)
    setDetailVisible(true)
  }

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      width: 60,
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 100,
      render: (type) => {
        const config = TYPE_CONFIG[type] || TYPE_CONFIG.feature
        return <Tag color={config.color} icon={config.icon}>{config.text}</Tag>
      },
    },
    {
      title: '标题',
      dataIndex: 'title',
      ellipsis: true,
      render: (text, record) => (
        <a onClick={() => handleViewDetail(record)}>{text}</a>
      ),
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 80,
      render: (priority) => {
        const config = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.medium
        return <Tag color={config.color}>{config.text}</Tag>
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status) => {
        const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending
        return <Tag color={config.color} icon={config.icon}>{config.text}</Tag>
      },
    },
    {
      title: '期望完成',
      dataIndex: 'expected_date',
      width: 110,
      render: (date) => date ? dayjs(date).format('MM-DD') : '-',
    },
    {
      title: '创建人',
      dataIndex: 'created_by',
      width: 80,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 110,
      render: (date) => dayjs(date).format('MM-DD HH:mm'),
    },
    {
      title: '操作',
      width: 120,
      align: 'center',
      render: (_, record) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => handleEdit(record)}>编辑</Button>
          <Popconfirm title="确定删除?" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  // 统计数据
  const stats = {
    total: data.length,
    pending: data.filter(d => d.status === 'pending').length,
    inProgress: data.filter(d => d.status === 'in_progress').length,
    completed: data.filter(d => d.status === 'completed').length,
    bug: data.filter(d => d.type === 'bug').length,
    feature: data.filter(d => d.type === 'feature').length,
  }

  return (
    <div>
      {/* 统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={4}>
          <Card size="small">
            <Statistic title="全部" value={stats.total} />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title="待处理" value={stats.pending} valueStyle={{ color: '#8c8c8c' }} />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title="进行中" value={stats.inProgress} valueStyle={{ color: '#1890ff' }} />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title="已完成" value={stats.completed} valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title="Bug" value={stats.bug} valueStyle={{ color: '#ff4d4f' }} prefix={<BugOutlined />} />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title="功能需求" value={stats.feature} valueStyle={{ color: '#1890ff' }} prefix={<BulbOutlined />} />
          </Card>
        </Col>
      </Row>

      {/* 筛选和操作 */}
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <Space>
          <Select
            placeholder="类型筛选"
            allowClear
            style={{ width: 120 }}
            value={filterType}
            onChange={setFilterType}
          >
            <Option value="feature">功能需求</Option>
            <Option value="bug">Bug反馈</Option>
          </Select>
          <Select
            placeholder="状态筛选"
            allowClear
            style={{ width: 120 }}
            value={filterStatus}
            onChange={setFilterStatus}
          >
            <Option value="pending">待处理</Option>
            <Option value="in_progress">进行中</Option>
            <Option value="completed">已完成</Option>
            <Option value="closed">已关闭</Option>
          </Select>
        </Space>
        {isAdmin && (
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新增需求
          </Button>
        )}
      </div>

      {/* 表格 */}
      <Table
        columns={columns}
        dataSource={data}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 20, showSizeChanger: false }}
      />

      {/* 创建/编辑弹窗 */}
      <Modal
        title={editingItem ? '编辑需求' : '新增需求'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        width={700}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="type" label="类型" rules={[{ required: true }]}>
                <Select>
                  <Option value="feature">功能需求</Option>
                  <Option value="bug">Bug反馈</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="priority" label="优先级" rules={[{ required: true }]}>
                <Select>
                  <Option value="low">低</Option>
                  <Option value="medium">中</Option>
                  <Option value="high">高</Option>
                  <Option value="urgent">紧急</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="请输入需求标题" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <RichTextArea placeholder="请输入需求描述，可直接粘贴图片" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="expected_date" label="期望完成日期">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="status" label="状态">
                <Select>
                  <Option value="pending">待处理</Option>
                  <Option value="in_progress">进行中</Option>
                  <Option value="completed">已完成</Option>
                  <Option value="closed">已关闭</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="tags" label="标签">
            <Input placeholder="多个标签用逗号分隔" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 详情弹窗 */}
      <Modal
        title={
          <Space>
            {detailItem && TYPE_CONFIG[detailItem.type]?.icon}
            {detailItem?.title}
          </Space>
        }
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={null}
        width={700}
      >
        {detailItem && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <Space>
                <Tag color={TYPE_CONFIG[detailItem.type]?.color}>
                  {TYPE_CONFIG[detailItem.type]?.text}
                </Tag>
                <Tag color={PRIORITY_CONFIG[detailItem.priority]?.color}>
                  优先级: {PRIORITY_CONFIG[detailItem.priority]?.text}
                </Tag>
                <Tag color={STATUS_CONFIG[detailItem.status]?.color} icon={STATUS_CONFIG[detailItem.status]?.icon}>
                  {STATUS_CONFIG[detailItem.status]?.text}
                </Tag>
              </Space>
            </div>
            <div style={{ marginBottom: 16 }}>
              <strong>创建人：</strong>{detailItem.created_by} &nbsp;
              <strong>创建时间：</strong>{dayjs(detailItem.created_at).format('YYYY-MM-DD HH:mm')} &nbsp;
              {detailItem.expected_date && (
                <>
                  <strong>期望完成：</strong>{dayjs(detailItem.expected_date).format('YYYY-MM-DD')}
                </>
              )}
            </div>
            <div style={{ marginBottom: 16 }}>
              <strong>描述：</strong>
              <div style={{ 
                marginTop: 8, 
                padding: 16, 
                background: '#fafafa', 
                borderRadius: 8,
                maxHeight: 400,
                overflow: 'auto',
              }}>
                {detailItem.description
                  ? <div dangerouslySetInnerHTML={{ __html: detailItem.description }} style={{ lineHeight: 1.6, wordBreak: 'break-word' }} />
                  : '暂无描述'}
              </div>
            </div>
            {detailItem.tags && (
              <div>
                <strong>标签：</strong>
                {detailItem.tags.split(',').map((tag, i) => (
                  <Tag key={i}>{tag.trim()}</Tag>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
