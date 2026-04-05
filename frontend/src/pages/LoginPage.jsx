import React, { useState } from 'react'
import { Form, Input, Button } from 'antd'
import { UserOutlined, LockOutlined, ArrowRightOutlined } from '@ant-design/icons'
import { login } from '../api'


export default function LoginPage({ onLogin }) {
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (values) => {
    setLoading(true)
    try {
      const res = await login(values)
      localStorage.setItem('wiki_token', res.access_token)
      localStorage.setItem('wiki_user', JSON.stringify(res.user))
      onLogin(res.user)
    } catch (err) {
      const detail = err.response?.data?.detail
      // 使用 antd message 提示错误（这里没有导入，用原生alert代替）
      window.alert(typeof detail === 'string' ? detail : '用户名或密码错误')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', fontFamily: "'DM Sans', sans-serif",
    }}>
      {/* Left Brand Panel */}
      <div style={{
        flex: '0 0 45%',
        background: '#18181B',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '72px 64px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Subtle geometric background */}
        <div style={{
          position: 'absolute', top: '-15%', right: '-10%', width: '70%', height: '70%',
          borderRadius: '50%', background: 'radial-gradient(circle, rgba(13,148,136,0.12) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: '10%', left: '-5%', width: '40%', height: '40%',
          borderRadius: '50%', background: 'radial-gradient(circle, rgba(13,148,136,0.08) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        {/* Brand mark */}
        <div style={{ marginBottom: 48 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: '#0D9488',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 8px 24px rgba(13,148,136,0.4)',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span style={{ color: '#FFFFFF', fontWeight: 700, fontSize: 18, letterSpacing: '-0.01em' }}>Wiki</span>
          </div>
        </div>

        {/* Headline */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h1 style={{
            fontFamily: "'Newsreader', Georgia, serif",
            color: '#FFFFFF', fontSize: '3rem', fontWeight: 700, lineHeight: 1.1,
            margin: '0 0 24px', letterSpacing: '-0.02em',
          }}>
            知识，
            <br />
            <span style={{ color: '#0D9488', fontStyle: 'italic' }}>有条不紊。</span>
          </h1>
          <p style={{
            color: 'rgba(255,255,255,0.45)', fontSize: 16, lineHeight: 1.7,
            margin: '0 0 48px', maxWidth: 360,
          }}>
            优雅的文档管理与发布平台。Markdown 写作，结构化导航，一键生成静态站点。
          </p>

          {/* Feature pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {['Markdown 编辑', '树形导航', '一键发布', '多用户协作'].map((tag) => (
              <span key={tag} style={{
                padding: '5px 14px', borderRadius: 999,
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)',
                color: 'rgba(255,255,255,0.60)', fontSize: 13, fontWeight: 500,
              }}>
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Right Form Panel */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '60px 80px',
        background: '#FAFAF8',
      }}>
        <div style={{ width: '100%', maxWidth: 360, animation: 'slideUp 0.35s ease forwards' }}>
          {/* Form Header */}
          <div style={{ marginBottom: 36 }}>
            <h2 style={{
              fontFamily: "'Newsreader', Georgia, serif",
              fontSize: 28, fontWeight: 700, color: '#1C1917',
              margin: '0 0 6px', letterSpacing: '-0.01em',
            }}>
              登入账号
            </h2>
            <p style={{ color: '#78716C', fontSize: 14, margin: 0 }}>
              开始管理您的文档知识库
            </p>
          </div>

          <Form onFinish={handleSubmit} size="large" layout="vertical">
            <Form.Item
              name="username"
              rules={[{ required: true, message: '请输入用户名' }]}
            >
              <Input
                prefix={<UserOutlined style={{ color: '#A8A29E', fontSize: 15 }} />}
                placeholder="用户名"
                autoFocus
                style={{ height: 48, borderRadius: 10, fontSize: 15 }}
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: '#A8A29E', fontSize: 15 }} />}
                placeholder="密码"
                style={{ height: 48, borderRadius: 10, fontSize: 15 }}
              />
            </Form.Item>

            <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                block
                style={{
                  height: 48, borderRadius: 10, fontSize: 15, fontWeight: 600,
                  background: '#0D9488', border: 'none',
                  boxShadow: '0 4px 16px rgba(13,148,136,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  fontFamily: "'DM Sans', sans-serif",
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => {
                  if (!loading) {
                    e.currentTarget.style.background = '#0F766E'
                    e.currentTarget.style.transform = 'translateY(-1px)'
                    e.currentTarget.style.boxShadow = '0 6px 20px rgba(13,148,136,0.35)'
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = '#0D9488'
                  e.currentTarget.style.transform = 'translateY(0)'
                  e.currentTarget.style.boxShadow = '0 4px 16px rgba(13,148,136,0.3)'
                }}
              >
                {loading ? '登录中...' : '登 录'}
                {!loading && <ArrowRightOutlined style={{ fontSize: 13 }} />}
              </Button>
            </Form.Item>
          </Form>


        </div>
      </div>
    </div>
  )
}
