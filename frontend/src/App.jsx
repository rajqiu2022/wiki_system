import React, { useState, useEffect } from 'react'
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom'
import { Layout, Menu, Avatar, Dropdown, Spin, Tooltip, Badge } from 'antd'
import {
  FileTextOutlined,
  MenuOutlined,
  CloudUploadOutlined,
  TeamOutlined,
  LogoutOutlined,
  BookOutlined,
  UserOutlined,
  GlobalOutlined,
  MenuFoldOutlined,
} from '@ant-design/icons'
import { getMe } from './api'
import DocList from './pages/DocList'
import DocEditor from './pages/DocEditor'
import NavEditor from './pages/NavEditor'
import PublishPage from './pages/PublishPage'
import UserList from './pages/UserList'
import LoginPage from './pages/LoginPage'

const { Sider, Header, Content } = Layout

function getInitials(name = '') {
  return name.slice(0, 2).toUpperCase()
}

const MENU_ITEMS = [
  { key: '/docs', icon: FileTextOutlined, label: '文档' },
  { key: '/nav', icon: MenuOutlined, label: '菜单' },
  { key: '/publish', icon: CloudUploadOutlined, label: '发布' },
]

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const [currentUser, setCurrentUser] = useState(null)
  const [collapsed, setCollapsed] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('wiki_token')
    if (!token) { setLoading(false); return }
    getMe()
      .then((user) => setCurrentUser(user))
      .catch(() => {
        localStorage.removeItem('wiki_token')
        localStorage.removeItem('wiki_user')
      })
      .finally(() => setLoading(false))
  }, [])

  const handleLogin = (user) => {
    setCurrentUser(user)
    navigate('/docs')
  }

  const handleLogout = () => {
    localStorage.removeItem('wiki_token')
    localStorage.removeItem('wiki_user')
    setCurrentUser(null)
    navigate('/login')
  }

  const isAdmin = currentUser?.role === 'admin'
  const currentPath = '/' + (location.pathname.split('/')[1] || 'docs')

  const userMenuItems = [
    {
      key: 'profile',
      label: (
        <div style={{ padding: '4px 0', minWidth: 160 }}>
          <div style={{ fontWeight: 600, color: '#1C1917', fontSize: 14 }}>{currentUser?.display_name}</div>
          <div style={{ fontSize: 12, color: '#78716C', marginTop: 2 }}>@{currentUser?.username}</div>
        </div>
      ),
      disabled: true,
    },
    { type: 'divider' },
    ...(isAdmin ? [{
      key: 'preview',
      icon: <GlobalOutlined />,
      label: <a href="/site/" target="_blank" rel="noopener noreferrer" style={{ color: '#44403C' }}>预览站点</a>,
    }] : []),
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      danger: true,
      onClick: handleLogout,
    },
  ]

  if (loading) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#FAFAF8',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14,
            background: '#0D9488',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
            boxShadow: '0 8px 24px rgba(13,148,136,0.25)',
          }}>
            <BookOutlined style={{ fontSize: 20, color: '#fff' }} />
          </div>
          <Spin size="large" />
        </div>
      </div>
    )
  }

  if (!currentUser) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage onLogin={handleLogin} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* Sidebar */}
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={200}
        collapsedWidth={64}
        style={{
          position: 'fixed', left: 0, top: 0, bottom: 0, zIndex: 100,
          overflow: 'auto',
          transition: 'width 0.2s ease',
        }}
        trigger={null}
      >
        {/* Logo */}
        <div style={{
          height: 56, display: 'flex', alignItems: collapsed ? 'center' : 'flex-start', justifyContent: collapsed ? 'center' : 'center',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0, padding: collapsed ? 0 : '0 16px',
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: '#0D9488',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(13,148,136,0.35)',
          }}>
            <BookOutlined style={{ fontSize: 14, color: '#fff' }} />
          </div>
          {!collapsed && (
            <span style={{ marginLeft: 10, fontSize: 15, fontWeight: 700, color: '#FFFFFF', fontFamily: "'Newsreader', Georgia, serif", whiteSpace: 'nowrap' }}>Wiki System</span>
          )}
        </div>

        {/* Nav Items */}
        <div style={{ padding: '12px 0', flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {MENU_ITEMS.map((item) => {
            const isSelected = currentPath === item.key
            const Icon = item.icon
            return (
              <Tooltip key={item.key} title={collapsed ? item.label : ''} placement="right">
                <div
                  onClick={() => navigate(item.key)}
                  style={{
                    height: 40, margin: collapsed ? '0 10px' : '0 12px', borderRadius: 8, cursor: 'pointer',
                    display: 'flex', alignItems: collapsed ? 'center' : 'center', justifyContent: collapsed ? 'center' : 'flex-start',
                    gap: 10, padding: collapsed ? 0 : '0 12px',
                    background: isSelected ? 'rgba(255,255,255,0.10)' : 'transparent',
                    color: isSelected ? '#FFFFFF' : '#A1A1AA',
                    transition: 'all 0.15s ease',
                    overflow: 'hidden',
                  }}
                  onMouseEnter={e => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
                      e.currentTarget.style.color = '#FFFFFF'
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'transparent'
                      e.currentTarget.style.color = '#A1A1AA'
                    }
                  }}
                >
                  <Icon style={{ fontSize: 16, flexShrink: 0 }} />
                  {!collapsed && <span style={{ fontSize: 14, whiteSpace: 'nowrap' }}>{item.label}</span>}
                </div>
              </Tooltip>
            )
          })}

          {isAdmin && (
            <Tooltip title={collapsed ? '用户' : ''} placement="right">
              <div
                onClick={() => navigate('/users')}
                style={{
                  height: 40, margin: collapsed ? '0 10px' : '0 12px', borderRadius: 8, cursor: 'pointer',
                  display: 'flex', alignItems: collapsed ? 'center' : 'center', justifyContent: collapsed ? 'center' : 'flex-start',
                  gap: 10, padding: collapsed ? 0 : '0 12px',
                  background: currentPath === '/users' ? 'rgba(255,255,255,0.10)' : 'transparent',
                  color: currentPath === '/users' ? '#FFFFFF' : '#A1A1AA',
                  transition: 'all 0.15s ease',
                  overflow: 'hidden',
                }}
                onMouseEnter={e => {
                  if (currentPath !== '/users') {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
                    e.currentTarget.style.color = '#FFFFFF'
                  }
                }}
                onMouseLeave={e => {
                  if (currentPath !== '/users') {
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.color = '#A1A1AA'
                  }
                }}
              >
                <TeamOutlined style={{ fontSize: 16, flexShrink: 0 }} />
                {!collapsed && <span style={{ fontSize: 14, whiteSpace: 'nowrap' }}>用户</span>}
              </div>
            </Tooltip>
          )}
        </div>

        {/* Collapse toggle + User at bottom */}
        <div style={{
          padding: '8px 0',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', flexDirection: 'column', alignItems: collapsed ? 'center' : 'stretch',
          gap: 8, flexShrink: 0, paddingLeft: collapsed ? 0 : 12, paddingRight: collapsed ? 0 : 12,
          paddingTop: 8, paddingBottom: 8,
        }}>
          {/* Collapse button */}
          <div
            onClick={() => setCollapsed(!collapsed)}
            style={{
              height: 36, borderRadius: 8, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start',
              gap: 10, padding: collapsed ? 0 : '0 12px',
              color: '#A1A1AA', transition: 'all 0.15s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#FFFFFF' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#A1A1AA' }}
          >
            <MenuFoldOutlined style={{ fontSize: 14, flexShrink: 0 }} />
            {!collapsed && <span style={{ fontSize: 13 }}>收起菜单</span>}
          </div>
          {/* User */}
          <Dropdown menu={{ items: userMenuItems }} placement={collapsed ? "topRight" : "topLeft"} trigger={['click']}>
            <div style={{
              height: 36, borderRadius: 8, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start',
              gap: 10, padding: collapsed ? 0 : '0 12px',
              transition: 'all 0.15s ease',
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <Avatar size={24} style={{ background: '#0D9488', fontSize: 10, fontWeight: 700, flexShrink: 0, fontFamily: "'DM Sans', sans-serif" }}>
                {getInitials(currentUser.display_name)}
              </Avatar>
              {!collapsed && <span style={{ fontSize: 13, color: '#E7E5E4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentUser.display_name}</span>}
            </div>
          </Dropdown>
        </div>
      </Sider>

      {/* Main Area */}
      <Layout style={{ marginLeft: collapsed ? 64 : 200, transition: 'margin-left 0.2s ease' }}>
        {/* Top Header */}
        <Header style={{
          background: '#FAFAF8',
          borderBottom: '1px solid #E7E5E4',
          height: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 32px',
          position: 'sticky',
          top: 0,
          zIndex: 99,
        }}>
          {/* Page Title - derived from route */}
          <div>
            {currentPath === '/docs' && <h1 style={{ fontSize: 18, fontWeight: 700, color: '#1C1917', margin: 0, fontFamily: "'Newsreader', Georgia, serif" }}>文档</h1>}
            {currentPath === '/nav' && <h1 style={{ fontSize: 18, fontWeight: 700, color: '#1C1917', margin: 0, fontFamily: "'Newsreader', Georgia, serif" }}>菜单</h1>}
            {currentPath === '/publish' && <h1 style={{ fontSize: 18, fontWeight: 700, color: '#1C1917', margin: 0, fontFamily: "'Newsreader', Georgia, serif" }}>发布</h1>}
            {currentPath === '/users' && <h1 style={{ fontSize: 18, fontWeight: 700, color: '#1C1917', margin: 0, fontFamily: "'Newsreader', Georgia, serif" }}>用户</h1>}
            {currentPath.startsWith('/docs/') && <h1 style={{ fontSize: 18, fontWeight: 700, color: '#1C1917', margin: 0, fontFamily: "'Newsreader', Georgia, serif" }}>编辑文档</h1>}
          </div>

          {/* Right: User info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight" trigger={['click']}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                padding: '4px 10px', borderRadius: 8, transition: 'background 0.15s',
              }}
                onMouseEnter={e => e.currentTarget.style.background = '#F0EDEA'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <Avatar
                  size={28}
                  style={{ background: '#0D9488', fontSize: 11, fontWeight: 700, fontFamily: "'DM Sans', sans-serif" }}
                >
                  {getInitials(currentUser.display_name)}
                </Avatar>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#44403C' }}>{currentUser.display_name}</span>
              </div>
            </Dropdown>
          </div>
        </Header>

        {/* Content */}
        <Content style={{
          padding: '32px',
          minHeight: 'calc(100vh - 56px)',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <Routes>
            <Route path="/" element={<DocList currentUser={currentUser} />} />
            <Route path="/docs" element={<DocList currentUser={currentUser} />} />
            <Route path="/docs/:id" element={<DocEditor currentUser={currentUser} />} />
            <Route path="/nav" element={<NavEditor currentUser={currentUser} />} />
            <Route path="/publish" element={<PublishPage currentUser={currentUser} />} />
            {isAdmin && <Route path="/users" element={<UserList currentUser={currentUser} />} />}
            <Route path="/login" element={<Navigate to="/docs" replace />} />
            <Route path="*" element={<Navigate to="/docs" replace />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  )
}
