import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Card, Input, Button, Space, message, Spin, Typography, Tag, Avatar, Empty, Upload, Tabs, Table, Tooltip, Progress, Collapse, Badge, Descriptions } from 'antd'
import {
  SendOutlined, RobotOutlined, UserOutlined, BulbOutlined, BugOutlined,
  ClearOutlined, PictureOutlined, ApartmentOutlined, ReloadOutlined,
  CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined,
  AppstoreOutlined, LinkOutlined, TagsOutlined, FileTextOutlined
} from '@ant-design/icons'
import { aiChat, uploadImage, generateKnowledgeGraph, getKgTaskStatus, getLatestKnowledgeGraph, getKnowledgeGraphHistory } from '../api'

const { TextArea } = Input
const { Text, Paragraph, Title } = Typography
const { Panel } = Collapse

// ==================== Knowledge Graph Tab Component ====================
function KnowledgeGraphTab() {
  const [graphData, setGraphData] = useState(null)
  const [graphMeta, setGraphMeta] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [progressText, setProgressText] = useState('')
  const [initialLoading, setInitialLoading] = useState(true)
  const pollTimerRef = useRef(null)

  useEffect(() => {
    loadLatestGraph()
    loadHistory()
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [])

  const loadLatestGraph = async () => {
    try {
      const res = await getLatestKnowledgeGraph()
      if (res) {
        setGraphData(res.graph_data)
        setGraphMeta(res)
      }
    } catch (err) {
      // No graph yet, that's fine
    } finally {
      setInitialLoading(false)
    }
  }

  const loadHistory = async () => {
    try {
      const res = await getKnowledgeGraphHistory()
      setHistory(res || [])
    } catch (err) {
      // ignore
    }
  }

  const pollTaskStatus = (taskId) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await getKgTaskStatus(taskId)
        setProgressText(res.progress || '')
        if (res.status === 'completed') {
          clearInterval(pollTimerRef.current)
          pollTimerRef.current = null
          setGenerating(false)
          setProgressText('')
          message.success('知识图谱生成成功！')
          loadLatestGraph()
          loadHistory()
        } else if (res.status === 'failed') {
          clearInterval(pollTimerRef.current)
          pollTimerRef.current = null
          setGenerating(false)
          setProgressText('')
          message.error(`知识图谱生成失败：${res.progress || '未知错误'}`)
        }
      } catch (err) {
        // Network error during poll, keep trying
      }
    }, 3000) // Poll every 3 seconds
  }

  const handleGenerate = async () => {
    setGenerating(true)
    setProgressText('正在启动...')
    try {
      const res = await generateKnowledgeGraph()
      if (res.task_id) {
        setProgressText(res.progress || '任务已启动...')
        pollTaskStatus(res.task_id)
      }
    } catch (err) {
      setGenerating(false)
      setProgressText('')
      message.error(err.response?.data?.detail || '知识图谱生成失败，请重试')
    }
  }

  if (initialLoading) {
    return <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" tip="加载中..." /></div>
  }

  const summary = graphData?.summary
  const categories = graphData?.categories || []
  const products = graphData?.products || []
  const relationships = graphData?.relationships || []

  // Color palette for categories
  const categoryColors = ['#1890ff', '#52c41a', '#faad14', '#f5222d', '#722ed1', '#13c2c2', '#eb2f96', '#fa8c16', '#a0d911', '#2f54eb']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflow: 'auto', padding: '0 2px' }}>
      {/* Header with generate button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <ApartmentOutlined style={{ fontSize: 20, color: '#1890ff' }} />
          <Title level={5} style={{ margin: 0 }}>文章知识图谱</Title>
          {graphMeta && (
            <Tag color="blue">{graphMeta.article_count} 篇文章</Tag>
          )}
        </Space>
        <Button
          type="primary"
          icon={generating ? <Spin size="small" /> : <ReloadOutlined />}
          onClick={handleGenerate}
          loading={generating}
          style={{ borderRadius: 8 }}
        >
          {generating ? (progressText || '生成中...') : graphData ? '重新生成' : '生成知识图谱'}
        </Button>
      </div>

      {!graphData ? (
        <Empty
          image={<ApartmentOutlined style={{ fontSize: 64, color: '#d9d9d9' }} />}
          description={
            <span>
              暂无知识图谱数据<br />
              <Text type="secondary">点击"生成知识图谱"按钮，AI将自动分析已发布文章</Text>
            </span>
          }
          style={{ padding: 60 }}
        />
      ) : (
        <>
          {/* Summary Card */}
          {summary && (
            <div style={{ borderRadius: 12, background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: 16, color: '#fff' }}>
              <div style={{ display: 'flex', gap: 24, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 'bold' }}>{summary.total_articles || 0}</div>
                  <div style={{ fontSize: 12, opacity: 0.85 }}>文章总数</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 'bold' }}>{summary.total_categories || 0}</div>
                  <div style={{ fontSize: 12, opacity: 0.85 }}>分类数</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 'bold' }}>{summary.total_products || 0}</div>
                  <div style={{ fontSize: 12, opacity: 0.85 }}>产品数</div>
                </div>
              </div>
              <div style={{ fontSize: 13, opacity: 0.9, lineHeight: 1.6 }}>
                {summary.overview}
              </div>
              {summary.top_categories && summary.top_categories.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <span style={{ fontSize: 12, opacity: 0.7 }}>热门分类：</span>
                  {summary.top_categories.map((cat, i) => (
                    <Tag key={i} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', marginLeft: 4 }}>
                      {cat}
                    </Tag>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Categories */}
          {categories.length > 0 && (
            <Card
              size="small"
              title={<Space><AppstoreOutlined style={{ color: '#1890ff' }} /><span>产品分类</span><Tag>{categories.length}</Tag></Space>}
              style={{ borderRadius: 12 }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {categories.map((cat, idx) => (
                  <Card
                    key={idx}
                    size="small"
                    style={{
                      width: 220,
                      borderRadius: 8,
                      borderLeft: `4px solid ${categoryColors[idx % categoryColors.length]}`,
                    }}
                    styles={{ body: { padding: '10px 12px' } }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 14 }}>{cat.name}</div>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>{cat.description}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Tag color={categoryColors[idx % categoryColors.length]}>{cat.article_count} 篇文章</Tag>
                    </div>
                    {cat.sub_categories && cat.sub_categories.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        {cat.sub_categories.map((sub, si) => (
                          <Tag key={si} style={{ fontSize: 11, marginBottom: 2 }}>{sub}</Tag>
                        ))}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </Card>
          )}

          {/* Products */}
          {products.length > 0 && (
            <Card
              size="small"
              title={<Space><TagsOutlined style={{ color: '#52c41a' }} /><span>产品识别</span><Tag color="green">{products.length}</Tag></Space>}
              style={{ borderRadius: 12 }}
            >
              <Collapse ghost>
                {products.map((prod, idx) => (
                  <Panel
                    key={idx}
                    header={
                      <Space>
                        <span style={{ fontWeight: 500 }}>{prod.name}</span>
                        <Tag color="blue">{prod.category}</Tag>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {prod.related_articles?.length || 0} 篇相关文章
                        </Text>
                      </Space>
                    }
                  >
                    <div style={{ paddingLeft: 8 }}>
                      {prod.description && (
                        <Paragraph style={{ fontSize: 13, color: '#666' }}>{prod.description}</Paragraph>
                      )}
                      {prod.keywords && prod.keywords.length > 0 && (
                        <div style={{ marginBottom: 8 }}>
                          <Text type="secondary" style={{ fontSize: 12 }}>关键词：</Text>
                          {prod.keywords.map((kw, ki) => (
                            <Tag key={ki} color="cyan" style={{ fontSize: 11 }}>{kw}</Tag>
                          ))}
                        </div>
                      )}
                      {prod.related_articles && prod.related_articles.length > 0 && (
                        <div>
                          <Text type="secondary" style={{ fontSize: 12 }}>相关文章：</Text>
                          <div style={{ marginTop: 4 }}>
                            {prod.related_articles.map((art, ai) => (
                              <Tag
                                key={ai}
                                icon={<FileTextOutlined />}
                                style={{ marginBottom: 4, fontSize: 11, cursor: 'pointer' }}
                                onClick={() => {
                                  const slug = art.replace(/\s+/g, '_').replace(/-/g, '_')
                                  window.open(`https://wiki.makerfabs.com/${slug}.html`, '_blank')
                                }}
                              >
                                <span style={{ borderBottom: '1px dashed currentColor' }}>{art}</span>
                              </Tag>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </Panel>
                ))}
              </Collapse>
            </Card>
          )}

          {/* Relationships */}
          {relationships.length > 0 && (
            <Card
              size="small"
              title={<Space><LinkOutlined style={{ color: '#722ed1' }} /><span>关联关系</span><Tag color="purple">{relationships.length}</Tag></Space>}
              style={{ borderRadius: 12 }}
            >
              <Table
                dataSource={relationships.map((r, i) => ({ ...r, key: i }))}
                columns={[
                  { title: '源', dataIndex: 'source', key: 'source', render: t => <Tag color="blue">{t}</Tag> },
                  { title: '关系', dataIndex: 'relation', key: 'relation', render: t => <Tag color="orange">{t}</Tag> },
                  { title: '目标', dataIndex: 'target', key: 'target', render: t => <Tag color="green">{t}</Tag> },
                ]}
                size="small"
                pagination={false}
                scroll={{ y: 300 }}
              />
            </Card>
          )}

          {/* Generation Info */}
          {graphMeta && (
            <Card size="small" style={{ borderRadius: 12, background: '#fafafa' }}>
              <Descriptions size="small" column={4}>
                <Descriptions.Item label="生成时间">
                  {graphMeta.generated_at ? new Date(graphMeta.generated_at).toLocaleString('zh-CN') : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="文章数量">{graphMeta.article_count}</Descriptions.Item>
                <Descriptions.Item label="生成者">{graphMeta.generated_by}</Descriptions.Item>
                <Descriptions.Item label="状态">
                  <Tag color={graphMeta.status === 'completed' ? 'green' : 'red'}>
                    {graphMeta.status === 'completed' ? '成功' : '失败'}
                  </Tag>
                </Descriptions.Item>
              </Descriptions>
            </Card>
          )}

          {/* History */}
          {history.length > 1 && (
            <Card
              size="small"
              title={<Space><ClockCircleOutlined /><span>生成历史</span></Space>}
              style={{ borderRadius: 12 }}
            >
              <Table
                dataSource={history.map(h => ({ ...h, key: h.id }))}
                columns={[
                  { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
                  {
                    title: '时间', dataIndex: 'generated_at', key: 'generated_at',
                    render: t => t ? new Date(t).toLocaleString('zh-CN') : '-'
                  },
                  { title: '文章数', dataIndex: 'article_count', key: 'article_count', width: 80 },
                  { title: '生成者', dataIndex: 'generated_by', key: 'generated_by', width: 80 },
                  {
                    title: '状态', dataIndex: 'status', key: 'status', width: 80,
                    render: s => (
                      <Tag
                        icon={s === 'completed' ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                        color={s === 'completed' ? 'success' : 'error'}
                      >
                        {s === 'completed' ? '成功' : '失败'}
                      </Tag>
                    )
                  },
                  {
                    title: '备注', dataIndex: 'message', key: 'message', ellipsis: true,
                    render: t => <Tooltip title={t}><Text type="secondary" style={{ fontSize: 12 }}>{t}</Text></Tooltip>
                  },
                ]}
                size="small"
                pagination={false}
              />
            </Card>
          )}
        </>
      )}
    </div>
  )
}

// ==================== Main AIChatPage Component ====================
export default function AIChatPage({ currentUser }) {
  const [activeTab, setActiveTab] = useState('chat')
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: '你好！我是需求管理助手。我可以帮助你创建和管理需求。你可以告诉我你需要什么功能，或者遇到了什么bug，我会帮你整理并创建需求记录。',
    }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [pendingImages, setPendingImages] = useState([]) // Images waiting to be sent
  const messagesEndRef = useRef(null)

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  // Extract image URLs from message content
  const extractImageUrls = (content) => {
    const urls = []
    const regex = /\[图片\]\s*(\S+)/g
    let match
    while ((match = regex.exec(content)) !== null) {
      urls.push(match[1])
    }
    return urls
  }

  // Replace image references with text description for AI (AI can't process images)
  const sanitizeForAI = (content) => {
    return content.replace(/\[图片\]\s*\S+/g, '[用户上传了一张图片]')
  }

  const handleSend = async () => {
    if ((!input.trim() && pendingImages.length === 0) || loading) return

    // Combine text and pending images into message content
    let content = input.trim()
    if (pendingImages.length > 0) {
      const imgTags = pendingImages.map(url => `[图片] ${url}`).join('\n')
      content = content ? `${content}\n${imgTags}` : imgTags
    }

    const userMessage = { role: 'user', content }
    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setInput('')
    setPendingImages([])
    setLoading(true)

    try {
      // Collect all image URLs from the conversation for requirement creation
      const allImageUrls = []
      newMessages.forEach(m => {
        if (m.role === 'user') {
          allImageUrls.push(...extractImageUrls(m.content))
        }
      })

      // Sanitize messages for AI: replace image refs with text description
      const chatMessages = newMessages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role, content: sanitizeForAI(m.content) }))

      const res = await aiChat(chatMessages, allImageUrls)
      
      setMessages([...newMessages, { role: 'assistant', content: res.content }])
      
      if (res.requirement_created) {
        message.success(`需求已创建: ${res.requirement_created.title}`)
      }
    } catch (err) {
      message.error(err.response?.data?.detail || '对话失败，请重试')
      setMessages(newMessages)
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleClear = () => {
    setMessages([
      {
        role: 'assistant',
        content: '对话已清空。有什么新需求我可以帮你整理吗？',
      }
    ])
  }

  // Handle image paste in the input area
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

    if (!imageFile) return
    e.preventDefault()

    try {
      message.loading({ content: '图片上传中...', key: 'imgUpload' })
      const res = await uploadImage(imageFile)
      const imageUrl = res.url
      setPendingImages(prev => [...prev, imageUrl])
      message.success({ content: '图片上传成功', key: 'imgUpload' })
    } catch (err) {
      message.error({ content: '图片上传失败', key: 'imgUpload' })
    }
  }, [])

  // Handle image upload via button
  const handleImageUpload = useCallback(async (file) => {
    try {
      message.loading({ content: '图片上传中...', key: 'imgUpload' })
      const res = await uploadImage(file)
      const imageUrl = res.url
      setPendingImages(prev => [...prev, imageUrl])
      message.success({ content: '图片上传成功', key: 'imgUpload' })
    } catch (err) {
      message.error({ content: '图片上传失败', key: 'imgUpload' })
    }
    return false // Prevent default upload behavior
  }, [])

  // Remove a pending image by index
  const removePendingImage = useCallback((index) => {
    setPendingImages(prev => prev.filter((_, i) => i !== index))
  }, [])

  /**
   * Render message content, converting image references to actual images.
   * Supports: [图片] /api/uploads/images/xxx.png
   */
  const renderMessageContent = (content) => {
    if (!content) return null
    const parts = content.split(/(\[图片\]\s*\S+)/g)
    return parts.map((part, index) => {
      const imgMatch = part.match(/^\[图片\]\s*(\S+)$/)
      if (imgMatch) {
        return (
          <img
            key={index}
            src={imgMatch[1]}
            alt="uploaded"
            style={{
              maxWidth: '100%',
              maxHeight: 300,
              borderRadius: 8,
              margin: '8px 0',
              display: 'block',
              border: '1px solid rgba(0,0,0,0.1)',
            }}
          />
        )
      }
      return <span key={index} style={{ whiteSpace: 'pre-wrap' }}>{part}</span>
    })
  }

  const quickPrompts = [
    { icon: <BulbOutlined />, text: '新增一个功能需求', prompt: '我想新增一个功能需求：' },
    { icon: <BugOutlined />, text: '反馈一个Bug', prompt: '我发现了一个bug：' },
    { icon: <BulbOutlined />, text: '查看待处理需求', prompt: '帮我看看当前有哪些待处理的需求？' },
  ]

  return (
    <div style={{ height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' }}>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        style={{ marginBottom: 8, flexShrink: 0 }}
        items={[
          {
            key: 'chat',
            label: <span><RobotOutlined /> AI 对话</span>,
          },
          {
            key: 'knowledge-graph',
            label: <span><ApartmentOutlined /> 知识图谱</span>,
          },
        ]}
      />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'chat' ? (
          <div style={{ height: '100%', display: 'flex', gap: 16 }}>
            {/* Main chat area */}
            <Card 
              style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
              styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', padding: 0 } }}
              title={
                <Space>
                  <RobotOutlined />
                  <span>AI 需求助手</span>
                  <Tag color="green">在线</Tag>
                </Space>
              }
              extra={
                <Button icon={<ClearOutlined />} onClick={handleClear}>清空对话</Button>
              }
            >
              {/* 消息列表 */}
              <div style={{ 
                flex: 1, 
                overflow: 'auto', 
                padding: 16,
                background: '#fafafa',
              }}>
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      gap: 12,
                      marginBottom: 16,
                      flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                    }}
                  >
                    <Avatar
                      style={{
                        background: msg.role === 'user' ? '#0D9488' : '#1890ff',
                        flexShrink: 0,
                      }}
                      icon={msg.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                    />
                    <div
                      style={{
                        maxWidth: '70%',
                        padding: '12px 16px',
                        borderRadius: 12,
                        background: msg.role === 'user' ? '#0D9488' : '#fff',
                        color: msg.role === 'user' ? '#fff' : '#1C1917',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                      }}
                    >
                      <div style={{ lineHeight: 1.6 }}>{renderMessageContent(msg.content)}</div>
                    </div>
                  </div>
                ))}
                {loading && (
                  <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                    <Avatar style={{ background: '#1890ff' }} icon={<RobotOutlined />} />
                    <div style={{ 
                      padding: '12px 16px', 
                      borderRadius: 12, 
                      background: '#fff',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                    }}>
                      <Spin size="small" /> 思考中...
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* 输入区域 */}
              <div style={{ padding: 16, borderTop: '1px solid #f0f0f0' }}>
                {/* Pending images preview */}
                {pendingImages.length > 0 && (
                  <div style={{
                    display: 'flex',
                    gap: 8,
                    flexWrap: 'wrap',
                    marginBottom: 8,
                    padding: 8,
                    background: '#f5f5f5',
                    borderRadius: 8,
                  }}>
                    {pendingImages.map((url, idx) => (
                      <div key={idx} style={{ position: 'relative', display: 'inline-block' }}>
                        <img
                          src={url}
                          alt="pending"
                          style={{
                            width: 80,
                            height: 80,
                            objectFit: 'cover',
                            borderRadius: 6,
                            border: '1px solid #d9d9d9',
                          }}
                        />
                        <span
                          onClick={() => removePendingImage(idx)}
                          style={{
                            position: 'absolute',
                            top: -6,
                            right: -6,
                            width: 18,
                            height: 18,
                            borderRadius: '50%',
                            background: '#ff4d4f',
                            color: '#fff',
                            fontSize: 12,
                            lineHeight: '18px',
                            textAlign: 'center',
                            cursor: 'pointer',
                            boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                          }}
                        >
                          ×
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <TextArea
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    placeholder="描述你的需求或bug，支持粘贴图片..."
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    style={{ flex: 1, borderRadius: 8 }}
                  />
                  <Upload
                    showUploadList={false}
                    accept="image/*"
                    beforeUpload={handleImageUpload}
                  >
                    <Button
                      icon={<PictureOutlined />}
                      style={{ borderRadius: 8, height: 'auto', minHeight: 32 }}
                      title="上传图片"
                    />
                  </Upload>
                  <Button 
                    type="primary" 
                    icon={<SendOutlined />}
                    onClick={handleSend}
                    loading={loading}
                    style={{ borderRadius: 8, height: 'auto', minHeight: 32 }}
                  >
                    发送
                  </Button>
                </div>
                <div style={{ marginTop: 4, color: '#999', fontSize: 12 }}>
                  <PictureOutlined style={{ marginRight: 4 }} />
                  支持直接粘贴图片（Ctrl+V）或点击图片按钮上传
                </div>
              </div>
            </Card>

            {/* Right sidebar quick prompts */}
            <Card 
              title="快捷操作" 
              style={{ width: 280 }}
              styles={{ body: { padding: '12px 16px' } }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {quickPrompts.map((item, idx) => (
                  <Button
                    key={idx}
                    icon={item.icon}
                    onClick={() => setInput(item.prompt)}
                    style={{ textAlign: 'left', justifyContent: 'flex-start' }}
                  >
                    {item.text}
                  </Button>
                ))}
              </div>

              <div style={{ marginTop: 24 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  <strong>使用提示：</strong>
                  <ul style={{ paddingLeft: 16, marginTop: 8, marginBottom: 0 }}>
                    <li>描述你想要的功能或遇到的问题</li>
                    <li>AI 会帮你整理成结构化的需求</li>
                    <li>确认后可直接创建需求记录</li>
                    <li>说"创建需求"来触发创建操作</li>
                    <li>支持粘贴或上传图片辅助描述</li>
                  </ul>
                </Text>
              </div>
            </Card>
          </div>
        ) : (
          <div style={{ height: '100%', overflow: 'auto', padding: '0 2px' }}>
            <KnowledgeGraphTab />
          </div>
        )}
      </div>
    </div>
  )
}
