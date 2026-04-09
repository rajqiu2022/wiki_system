import React, { useEffect, useRef, useCallback } from 'react'
import Cherry from 'cherry-markdown'
import 'cherry-markdown/dist/cherry-markdown.css'

/**
 * CherryEditor - React wrapper for Cherry Markdown
 *
 * Props:
 *   value        - markdown string
 *   onChange      - (val: string) => void
 *   mode          - 'edit&preview' | 'previewOnly' | 'editOnly' (default: 'edit&preview')
 *   height        - CSS height string (default: '100%')
 *   readOnly      - boolean, if true forces previewOnly mode
 *   hideToolbar   - boolean
 *   onImageUpload - async (file: File) => string (returns image URL)
 *   style         - container style
 *   className     - container className
 */
export default function CherryEditor({
  value = '',
  onChange,
  mode = 'edit&preview',
  height = '100%',
  readOnly = false,
  hideToolbar = false,
  onImageUpload,
  style,
  className,
}) {
  const containerRef = useRef(null)
  const cherryRef = useRef(null)
  const onChangeRef = useRef(onChange)
  const onImageUploadRef = useRef(onImageUpload)
  const isInternalChange = useRef(false)
  const lastSetValue = useRef(value)

  // Keep callback refs up to date
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { onImageUploadRef.current = onImageUpload }, [onImageUpload])

  /**
   * Disable scroll-event-based sync between editor and previewer,
   * while keeping click-to-scroll (autoScrollByCursor / onMouseDown) working.
   *
   * Cherry's scroll sync flow:
   *   Editor scroll event -> checks editor.disableScrollListener
   *     -> if false, calls previewer.scrollToLineNum(lineNum) to sync preview
   *
   * Cherry's click-to-scroll flow:
   *   Editor mousedown -> calls previewer.scrollToLineNumWithOffset(lineNum, offset)
   *   (This is independent of disableScrollListener)
   *
   * Strategy: Lock editor.disableScrollListener to always be true via
   * Object.defineProperty, so the scroll event handler always bails out.
   * Do NOT override previewer.scrollToLineNum or scrollToLineNumWithOffset,
   * because scrollToLineNumWithOffset is needed for click-to-scroll.
   */
  const disableScrollSync = useCallback((cherry) => {
    try {
      // Lock editor.disableScrollListener to always be true
      // This makes the scroll event handler always return early
      if (cherry.editor) {
        Object.defineProperty(cherry.editor, 'disableScrollListener', {
          get: () => true,
          set: () => {}, // ignore any writes from Cherry internals
          configurable: true,
        })
        console.log('[CherryEditor] Editor scroll-sync disabled (disableScrollListener locked to true)')
      }

      // Lock previewer.disableScrollListener to always be true
      // This prevents preview scroll from syncing back to editor
      if (cherry.previewer) {
        Object.defineProperty(cherry.previewer, 'disableScrollListener', {
          get: () => true,
          set: () => {}, // ignore any writes from Cherry internals
          configurable: true,
        })
        console.log('[CherryEditor] Previewer scroll-sync disabled (disableScrollListener locked to true)')
      }

      console.log('[CherryEditor] Scroll sync disabled. Click-to-scroll (scrollToLineNumWithOffset) still works.')
    } catch (e) {
      console.warn('[CherryEditor] Failed to disable scroll sync:', e)
    }
  }, [])

  // Initialize Cherry instance
  useEffect(() => {
    if (!containerRef.current) return

    const effectiveMode = readOnly ? 'previewOnly' : mode

    const toolbars = hideToolbar || readOnly
      ? { showToolbar: false, toolbar: false, bubble: false, float: false }
      : {
          showToolbar: true,
          toolbar: [
            'bold', 'italic', 'strikethrough', '|',
            'color', 'header', '|',
            'list', 'panel', 'detail', '|',
            { insert: ['image', 'link', 'code', 'table', 'hr'] },
            'togglePreview',
          ],
        }

    const config = {
      el: containerRef.current,
      value: value || '',
      editor: {
        defaultModel: effectiveMode === 'previewOnly' ? 'previewOnly'
          : effectiveMode === 'editOnly' ? 'editOnly'
          : 'edit&preview',
        height: '100%',
      },
      toolbars,
      previewer: {
        dom: false,
        enablePreviewerBubble: true,
      },
      callback: {
        afterChange: (md) => {
          isInternalChange.current = true
          lastSetValue.current = md
          if (onChangeRef.current) {
            onChangeRef.current(md)
          }
        },
      },
      fileUpload: onImageUploadRef.current
        ? (file, callback) => {
            if (file.type && file.type.startsWith('image/')) {
              // Remember cursor position before upload
              const cmEditor = cherryRef.current?.editor?.editor
              const cursorBefore = cmEditor ? cmEditor.getCursor() : null

              onImageUploadRef.current(file).then((url) => {
                // Convert relative URL to absolute URL so images display correctly
                const absoluteUrl = url.startsWith('http') ? url : `${window.location.origin}${url}`
                callback(absoluteUrl)

                // After image is inserted, scroll editor back to cursor position
                if (cmEditor && cursorBefore) {
                  setTimeout(() => {
                    cmEditor.setCursor(cursorBefore)
                    cmEditor.scrollIntoView(null, 100)
                    cmEditor.focus()
                  }, 100)
                }
              }).catch(() => {
                // Upload failed, do nothing
              })
            }
          }
        : undefined,
      isPreviewOnly: effectiveMode === 'previewOnly',
      // Keep autoScrollByCursor enabled so clicking in editor scrolls preview to matching position
      autoScrollByCursor: true,
    }

    const cherry = new Cherry(config)
    cherryRef.current = cherry

    // Disable scroll sync immediately and also after a delay
    // (in case Cherry re-binds during initialization)
    disableScrollSync(cherry)
    setTimeout(() => disableScrollSync(cherry), 300)
    setTimeout(() => disableScrollSync(cherry), 1000)

    return () => {
      if (cherryRef.current) {
        cherryRef.current.destroy()
        cherryRef.current = null
      }
    }
    // Only run on mount/unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync external value changes into Cherry
  useEffect(() => {
    if (!cherryRef.current) return
    // Skip if this change originated from Cherry itself
    if (isInternalChange.current) {
      isInternalChange.current = false
      return
    }
    // Only update if value actually differs from what Cherry has
    if (value !== lastSetValue.current) {
      lastSetValue.current = value
      cherryRef.current.setValue(value || '')
    }
  }, [value])

  // Handle mode/readOnly changes by switching Cherry's mode
  useEffect(() => {
    if (!cherryRef.current) return
    const effectiveMode = readOnly ? 'previewOnly' : mode
    cherryRef.current.switchModel(effectiveMode)
    // Re-apply scroll sync disable after mode switch
    setTimeout(() => disableScrollSync(cherryRef.current), 100)
  }, [mode, readOnly, disableScrollSync])

  return (
    <div
      ref={containerRef}
      className={`cherry-editor-wrapper ${className || ''}`}
      style={{
        height,
        width: '100%',
        overflow: 'hidden',
        ...style,
      }}
    />
  )
}
