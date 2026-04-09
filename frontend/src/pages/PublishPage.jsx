import React, { useState, useEffect } from 'react'
import { Button, Space, Table, Tag, message, Modal, Typography } from 'antd'
import {
  CloudUploadOutlined, HistoryOutlined, CheckCircleOutlined, CloseCircleOutlined,
  GlobalOutlined, RocketOutlined, ReloadOutlined, FileTextOutlined,
} from '@ant-design/icons'
import { publish, getPublishLogs, getDocs } from '../api'

const { Text } = Typography

export default function PublishPage({ currentUser }) {
  const [logs, setLogs] = useState([])
  const [docs, setDocs] = useState([])
  const [publishing, setPublishing] = useState(false)
  const [loading, setLoading] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    try {
      const [logsData, docsData] = await Promise.all([getPublishLogs(), getDocs()])
      setLogs(logsData)
      setDocs(docsData)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  const pendingDocs = docs.filter((d) => d.status === 'pending')
  const lastLog = logs[0]

  const handlePublish = () => {
    Modal.confirm({
      title: '确认发布',
      content: (
        <div>
          <p style={{ color: '#78716C', marginBottom: 12 }}>
            将发布所有有效文档及当前菜单结构为静态站点。
          </p>
          {pendingDocs.length > 0 && (
            <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#1E40AF', marginBottom: 6 }}>待发布文档（{pendingDocs.length} 篇）：</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {pendingDocs.slice(0, 8).map(d => (
                  <span key={d.id} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, background: '#DBEAFE', color: '#1E40AF' }}>
                    {d.name}
                  </span>
                ))}
                {pendingDocs.length > 8 && (
                  <span style={{ fontSize: 11, color: '#78716C' }}>...等 {pendingDocs.length} 篇</span>
                )}
              </div>
            </div>
          )}
        </div>
      ),
      okText: '确认发布',
      cancelText: '取消',
      okButtonProps: { style: { background: '#0D9488', borderColor: '#0D9488', borderRadius: 8 } },
      cancelButtonProps: { style: { borderRadius: 8 } },
      onOk: async () => {
        setPublishing(true)
        try {
          const result = await publish(currentUser?.id)
          message.success('发布成功！')
          fetchData()
        } catch (e) {
          message.error(e.response?.data?.detail || '发布失败')
        } finally {
          setPublishing(false)
        }
      },
    })
  }

  const logColumns = [
    {
      title: '时间',
      dataIndex: 'published_at',
      width: 170,
      render: (t) => (
        <span style={{ color: '#44403C', fontSize: 13 }}>
          {new Date(t).toLocaleString('zh-CN')}
        </span>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (s) => s === 'success' ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 999, background: '#F0FDF4', color: '#16A34A', fontSize: 12, fontWeight: 600 }}>
          <CheckCircleOutlined style={{ fontSize: 11 }} /> 成功
        </span>
      ) : (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 999, background: '#FEF2F2', color: '#DC2626', fontSize: 12, fontWeight: 600 }}>
          <CloseCircleOutlined style={{ fontSize: 11 }} /> 失败
        </span>
      ),
    },
    {
      title: '文档数',
      dataIndex: 'doc_count',
      width: 80,
      render: (n) => <span style={{ fontWeight: 700, color: '#0D9488', fontSize: 15 }}>{n}</span>,
    },
    {
      title: '信息',
      dataIndex: 'message',
      ellipsis: true,
      render: (t) => <span style={{ color: '#78716C', fontSize: 13 }}>{t || '—'}</span>,
    },
  ]

  return (
    <div className="fade-in" style={{ flex: 1 }}>
      {/* Top actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          {lastLog && (
            <div style={{ fontSize: 13, color: '#A8A29E' }}>
              上次发布：
              <span style={{ color: lastLog.status === 'success' ? '#16A34A' : '#DC2626', fontWeight: 600, marginLeft: 4 }}>
                {new Date(lastLog.published_at).toLocaleString('zh-CN')}
              </span>
            </div>
          )}
        </div>
        <Space>
          <Button
            icon={<GlobalOutlined />}
            href="https://wiki.makerfabs.com"
            target="_blank"
            style={{ borderRadius: 8 }}
          >
            预览站点
          </Button>
          <Button
            icon={<RocketOutlined />}
            type="primary"
            loading={publishing}
            onClick={handlePublish}
            style={{
              borderRadius: 8, fontWeight: 600,
              background: '#0D9488', border: 'none',
              boxShadow: '0 4px 12px rgba(13,148,136,0.3)',
            }}
          >
            {publishing ? '发布中...' : '发布站点'}
          </Button>
        </Space>
      </div>

      {/* Publish info card */}
      <div style={{
        background: '#FFFFFF', borderRadius: 14, border: '1px solid #E7E5E4',
        padding: '20px 24px', marginBottom: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 9,
            background: '#CCFBF1',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <CloudUploadOutlined style={{ color: '#0D9488', fontSize: 16 }} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#1C1917', fontFamily: "'Newsreader', Georgia, serif" }}>发布说明</div>
            <div style={{ fontSize: 12, color: '#A8A29E', marginTop: 1 }}>静态站点将生成到 output 目录</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { icon: '📋', text: '只有「待发布」状态的文档会被构建' },
            { icon: '🗂️', text: '菜单结构取自「菜单编辑」' },
            { icon: '⚙️', text: '执行 MkDocs build 生成静态 HTML' },
            { icon: '📦', text: '发布后待发布文档自动变为已发布' },
          ].map(item => (
            <div key={item.text} style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: '10px 12px', borderRadius: 8, background: '#FAFAF8', border: '1px solid #F0EDEA',
            }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>{item.icon}</span>
              <span style={{ fontSize: 13, color: '#78716C', lineHeight: 1.5 }}>{item.text}</span>
            </div>
          ))}
        </div>

        {pendingDocs.length > 0 && (
          <div style={{ marginTop: 14, padding: '12px 16px', background: '#EFF6FF', borderRadius: 8, border: '1px solid #BFDBFE' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1E40AF', marginBottom: 8 }}>
              待发布（{pendingDocs.length} 篇）：
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {pendingDocs.map((d) => (
                <span key={d.id} style={{
                  fontSize: 12, padding: '3px 10px', borderRadius: 6,
                  background: '#DBEAFE', color: '#1E40AF', fontWeight: 500,
                }}>
                  {d.title}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Publish history */}
      <div style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E7E5E4', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #F0EDEA', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8, background: '#F5F3FF',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <HistoryOutlined style={{ color: '#7C3AED', fontSize: 14 }} />
          </div>
          <span style={{ fontWeight: 700, fontSize: 14, color: '#1C1917' }}>发布历史</span>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={fetchData}
            loading={loading}
            style={{ marginLeft: 'auto', borderRadius: 6 }}
          />
        </div>
        <Table
          dataSource={logs}
          columns={logColumns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 8, showTotal: (t) => `共 ${t} 条` }}
          style={{ border: 'none' }}
        />
      </div>
    </div>
  )
}
