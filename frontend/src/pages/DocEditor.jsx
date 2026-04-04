import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button, Space, Tag, Input, message, Spin, Modal, Dropdown, Tooltip, Typography } from 'antd'
import {
  SaveOutlined, ArrowLeftOutlined, LockOutlined, UnlockOutlined,
  CheckCircleOutlined, InboxOutlined, DownOutlined, EditOutlined,
  EyeOutlined, FileTextOutlined,
} from '@ant-design/icons'
import MDEditor from '@uiw/react-md-editor'
import { getDoc, updateDoc, updateDocContent, lockDoc, unlockDoc, uploadImage } from '../api'

const { Text } = Typography

const STATUS_OPTIONS = [
  { key: 0, label: '正常', color: '#16A34A', bg: '#F0FDF4' },
  { key: 1, label: '已删除', color: '#78716C', bg: '#F5F5F5' },
]

export default function DocEditor({ currentUser }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [doc, setDoc] = useState(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isLocked, setIsLocked] = useState(false)
  const [lockedByMe, setLockedByMe] = useState(false)
  const lockInterval = useRef(null)
  const editorRef = useRef(null)
  const userId = currentUser?.id
  const [savedTitle, setSavedTitle] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [autoLockAttempted, setAutoLockAttempted] = useState(false)

  // Track whether there are unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    if (!doc) return false
    return title !== savedTitle || content !== savedContent
  }, [doc, title, content, savedTitle, savedContent])

  const fetchDoc = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getDoc(id)
      setDoc(data)
      setTitle(data.name || '')
      setContent(data.content || '')
      setSavedTitle(data.name || '')
      setSavedContent(data.content || '')
      setIsLocked(!!data.current_editor)
      setLockedByMe(data.current_editor === currentUser?.username)
    } finally {
      setLoading(false)
    }
  }, [id, currentUser])

  useEffect(() => {
    fetchDoc()
    return () => { if (lockInterval.current) clearInterval(lockInterval.current) }
  }, [fetchDoc])

  const handleLock = async (silent = false) => {
    try {
      await lockDoc(id, userId)
      setIsLocked(true)
      setLockedByMe(true)
      if (!silent) message.success('已获取编辑锁')
      lockInterval.current = setInterval(async () => {
        try { await lockDoc(id, userId) } catch {}
      }, 10 * 60 * 1000)
    } catch (e) {
      if (!silent) message.error(e.response?.data?.detail || '锁定失败')
    }
  }

  // Auto-lock: automatically acquire edit lock when entering the page
  useEffect(() => {
    if (!loading && doc && !autoLockAttempted && !isLocked && userId) {
      setAutoLockAttempted(true)
      handleLock(true)
    }
  }, [loading, doc, autoLockAttempted, isLocked, userId])

  const handleUnlock = async () => {
    try {
      await unlockDoc(id, userId)
      setIsLocked(false)
      setLockedByMe(false)
      if (lockInterval.current) clearInterval(lockInterval.current)
      message.success('已释放编辑锁')
    } catch (e) {
      message.error(e.response?.data?.detail || '解锁失败')
    }
  }

  const handleSave = async () => {
    if (!lockedByMe) { message.warning('请先锁定文档'); return }
    setSaving(true)
    try {
      // 保存标题
      if (title !== doc.name) {
        await updateDoc(id, { name: title }, userId)
      }
      // 保存内容
      await updateDocContent(id, { content, modifier: currentUser?.username })
      message.success('保存成功')
      // 更新本地状态
      setSavedTitle(title)
      setSavedContent(content)
      setDoc((d) => ({ ...d, name: title, content }))
    } catch (e) {
      message.error(e.response?.data?.detail || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleStatusChange = async ({ key }) => {
    try {
      await updateDoc(id, { status: parseInt(key, 10) }, userId)
      setDoc((d) => ({ ...d, status: parseInt(key, 10) }))
      const label = STATUS_OPTIONS.find((s) => s.key === parseInt(key, 10))?.label
      message.success(`状态已更新为「${label}」`)
    } catch (e) {
      message.error(e.response?.data?.detail || '更新状态失败')
    }
  }

  const handleBack = () => {
    if (hasUnsavedChanges) {
      Modal.confirm({
        title: '未保存的修改',
        content: '您有未保存的修改，确定要离开吗？离开后修改将丢失。',
        okText: '保存并离开',
        cancelText: '不保存，直接离开',
        okButtonProps: { style: { borderRadius: 8, background: '#0D9488', border: 'none' } },
        cancelButtonProps: { style: { borderRadius: 8 } },
        onOk: async () => {
          await handleSave()
          await unlockDoc(id, userId)
          if (lockInterval.current) clearInterval(lockInterval.current)
          navigate('/docs')
        },
        onCancel: async () => {
          if (lockedByMe) {
            await unlockDoc(id, userId)
            if (lockInterval.current) clearInterval(lockInterval.current)
          }
          navigate('/docs')
        },
      })
    } else if (lockedByMe) {
      Modal.confirm({
        title: '离开编辑',
        content: '是否释放编辑锁后返回？',
        okText: '释放并返回',
        cancelText: '保持锁定',
        okButtonProps: { style: { borderRadius: 8 } },
        cancelButtonProps: { style: { borderRadius: 8 } },
        onOk: async () => {
          await unlockDoc(id, userId)
          if (lockInterval.current) clearInterval(lockInterval.current)
          navigate('/docs')
        },
        onCancel: () => navigate('/docs'),
      })
    } else {
      navigate('/docs')
    }
  }

  // Ctrl+S
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (lockedByMe) handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [lockedByMe, title, content, userId])

  // Block browser close/refresh when there are unsaved changes
  useEffect(() => {
    const handler = (e) => {
      if (hasUnsavedChanges) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasUnsavedChanges])

  // Expose unsaved state to window so App sidebar navigation can check it
  useEffect(() => {
    window.__wikiEditorUnsaved = {
      hasUnsavedChanges,
      handleSave: () => handleSave(),
      handleUnlock: async () => {
        if (lockedByMe) {
          try {
            await unlockDoc(id, userId)
            if (lockInterval.current) clearInterval(lockInterval.current)
          } catch {}
        }
      },
    }
    return () => { delete window.__wikiEditorUnsaved }
  }, [hasUnsavedChanges, lockedByMe, id, userId, title, content])



  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '60vh', flexDirection: 'column', gap: 16,
      }}>
        <Spin size="large" />
        <Text style={{ color: '#A8A29E' }}>加载文档中...</Text>
      </div>
    )
  }

  const canEdit = lockedByMe
  const statusConf = STATUS_OPTIONS.find((s) => s.key === doc?.status) || STATUS_OPTIONS[0]

  return (
    <div
      className="fade-in"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 12 }}
    >
      {/* Top Bar */}
      <div style={{
        background: '#FFFFFF', borderRadius: 12, border: '1px solid #E7E5E4',
        padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        flexShrink: 0,
      }}>
        {/* Left: back + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={handleBack}
            style={{ borderRadius: 8, fontWeight: 500, color: '#78716C' }}
          />
          <div style={{ width: 1, height: 20, background: '#E7E5E4' }} />
          <div>
            <div style={{
              fontWeight: 700, fontSize: 14, color: '#1C1917',
              maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              fontFamily: "'DM Sans', sans-serif",
            }}>
              {title || '未命名文档'}
            </div>
            <div style={{ fontSize: 11, color: '#A8A29E', marginTop: 1 }}>
              {doc?.author ? `${doc.author} · 创建` : ''}
            </div>
          </div>
        </div>

        {/* Center: status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600,
            background: statusConf.bg, color: statusConf.color,
          }}>
            {statusConf.label}
          </span>
          {isLocked && !lockedByMe && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
              background: '#FFFBEB', color: '#D97706',
            }}>
              <LockOutlined style={{ fontSize: 10 }} />
              {doc?.current_editor || '他人'} 编辑中
            </span>
          )}
          {lockedByMe && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
              background: '#CCFBF1', color: '#0D9488',
            }}>
              <LockOutlined style={{ fontSize: 10 }} />
              我的编辑锁
            </span>
          )}
        </div>

        {/* Right: actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!isLocked && (
            <Button
              type="primary"
              icon={<EditOutlined />}
              onClick={handleLock}
              style={{
                borderRadius: 8, background: '#0D9488', border: 'none', fontWeight: 600,
                boxShadow: '0 2px 8px rgba(13,148,136,0.25)',
              }}
            >
              开始编辑
            </Button>
          )}
          {lockedByMe && (
            <>
              <Button
                icon={<SaveOutlined />}
                type="primary"
                loading={saving}
                onClick={handleSave}
                style={{
                  borderRadius: 8, background: '#0D9488', border: 'none', fontWeight: 600,
                  boxShadow: '0 2px 8px rgba(13,148,136,0.25)',
                }}
              >
                保存
              </Button>
              <Dropdown
                menu={{
                  items: STATUS_OPTIONS.map((s) => ({
                    key: s.key,
                    label: s.label,
                    disabled: s.key === doc?.status,
                  })),
                  onClick: handleStatusChange,
                }}
              >
                <Button style={{ borderRadius: 8, fontWeight: 500 }}>
                  {statusConf.label} <DownOutlined style={{ fontSize: 10 }} />
                </Button>
              </Dropdown>
              <Tooltip title="释放编辑锁">
                <Button
                  icon={<UnlockOutlined />}
                  onClick={handleUnlock}
                  style={{ borderRadius: 8, color: '#78716C' }}
                />
              </Tooltip>
            </>
          )}
        </div>
      </div>

      {/* Title Input */}
      <div style={{
        background: '#FFFFFF', borderRadius: 12, border: '1px solid #E7E5E4',
        padding: '14px 20px', flexShrink: 0,
      }}>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="文档标题"
          disabled={!canEdit}
          bordered={false}
          style={{
            fontSize: 22, fontWeight: 700, color: '#1C1917', padding: 0,
            boxShadow: 'none', fontFamily: "'Newsreader', Georgia, serif",
            letterSpacing: '-0.01em',
          }}
        />
        {!canEdit && (
          <div style={{ marginTop: 4, fontSize: 12, color: '#A8A29E', display: 'flex', alignItems: 'center', gap: 4 }}>
            <EyeOutlined />
            只读模式 · 点击「开始编辑」获取权限
          </div>
        )}
        {canEdit && (
          <div style={{ marginTop: 4, fontSize: 12, color: '#0D9488', display: 'flex', alignItems: 'center', gap: 4 }}>
            <EditOutlined />
            编辑模式 · Ctrl+S 快速保存
          </div>
        )}
      </div>

      {/* Editor */}
      <div
        style={{ flex: 1, minHeight: 0, borderRadius: 12, overflow: 'hidden' }}
        onPaste={async (e) => {
          if (!canEdit) return
          const items = e.clipboardData?.items
          if (!items) return
          for (const item of items) {
            if (item.type.startsWith('image/')) {
              e.preventDefault()
              const file = item.getAsFile()
              if (!file) return
              message.loading({ content: '正在上传图片...', key: 'img-upload' })
              try {
                const result = await uploadImage(file)
                const imgMarkdown = `![image](${result.url})`
                // Insert via textarea's native input so Ctrl+Z undo works
                const textarea = editorRef.current?.querySelector('textarea')
                if (textarea) {
                  textarea.focus()
                  // Use native InputEvent to keep undo stack intact
                  const nativeInputEvent = new InputEvent('beforeinput', {
                    inputType: 'insertText',
                    data: imgMarkdown,
                    bubbles: true,
                    cancelable: true,
                  })
                  // Try execCommand first (widely supported for undo)
                  document.execCommand('insertText', false, imgMarkdown)
                } else {
                  setContent((prev) => prev + '\n' + imgMarkdown)
                }
                message.success({ content: '图片上传成功', key: 'img-upload' })
              } catch (err) {
                message.error({ content: err.response?.data?.detail || '图片上传失败', key: 'img-upload' })
              }
              return
            }
          }
        }}
        onDrop={async (e) => {
          if (!canEdit) return
          const files = e.dataTransfer?.files
          if (!files || files.length === 0) return
          const file = files[0]
          if (!file.type.startsWith('image/')) return
          e.preventDefault()
          message.loading({ content: '正在上传图片...', key: 'img-upload' })
          try {
            const result = await uploadImage(file)
            const imgMarkdown = `\n![image](${result.url})`
            const textarea = editorRef.current?.querySelector('textarea')
            if (textarea) {
              textarea.focus()
              // Move cursor to end for drop
              textarea.selectionStart = textarea.selectionEnd = textarea.value.length
              document.execCommand('insertText', false, imgMarkdown)
            } else {
              setContent((prev) => prev + imgMarkdown)
            }
            message.success({ content: '图片上传成功', key: 'img-upload' })
          } catch (err) {
            message.error({ content: err.response?.data?.detail || '图片上传失败', key: 'img-upload' })
          }
        }}
        onDragOver={(e) => { if (canEdit) e.preventDefault() }}
        ref={editorRef}
      >
        <div data-color-mode="light" style={{ height: '100%' }}>
          <MDEditor
            value={content}
            onChange={(val) => setContent(val || '')}
            preview={canEdit ? 'live' : 'preview'}
            hideToolbar={!canEdit}
            height="100%"
          />
        </div>
      </div>
    </div>
  )
}
