import React from 'react'
import ReactDOM from 'react-dom/client'
import LibRaw from 'libraw-wasm'
import './styles.css'

type ItemStatus = 'queued' | 'ready' | 'processing' | 'error'

type Item = {
  id: string
  file: File
  url: string
  name: string
  sizeLabel: string
  status: ItemStatus
  error?: string
  isRaw: boolean
  thumbLoaded: boolean
}

const RAW_EXTENSIONS = new Set([
  '3fr', 'arw', 'cr2', 'cr3', 'dcr', 'dng', 'erf', 'kdc', 'mrw', 'nef', 'nrw', 'orf', 'pef', 'raf', 'raw', 'rw2', 'sr2', 'srf', 'x3f',
])
const MAX_VISIBLE_THUMBS = 120
const RAW_CONCURRENCY = 2

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = units[0]
  for (let i = 1; i < units.length && value >= 1024; i++) {
    value /= 1024
    unit = units[i]
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`
}

const getExtension = (name: string) => name.split('.').pop()?.toLowerCase() ?? ''
const isRawFile = (file: File) => RAW_EXTENSIONS.has(getExtension(file.name))
const isRegularImage = (file: File) => file.type.startsWith('image/') && !isRawFile(file)
const makeId = (file: File) => `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`
const readFileBuffer = async (file: File) => new Uint8Array(await file.arrayBuffer())

const decodeRawToObjectUrl = async (file: File) => {
  const raw = new LibRaw()
  await raw.open(await readFileBuffer(file), {
    useCameraWb: true,
    outputColor: 1,
    outputBps: 8,
    noAutoBright: false,
    autoBrightThr: 0.01,
    halfSize: false,
  })

  const image = await raw.imageData()
  const metadata = await raw.metadata(false)
  const width = metadata?.width || metadata?.raw_width || metadata?.iwidth
  const height = metadata?.height || metadata?.raw_height || metadata?.iheight

  if (!width || !height || !image?.length) {
    throw new Error('RAW decode returned no visible image data')
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas context unavailable')

  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0, j = 0; i < image.length; i += 3, j += 4) {
    rgba[j] = image[i]
    rgba[j + 1] = image[i + 1]
    rgba[j + 2] = image[i + 2]
    rgba[j + 3] = 255
  }

  ctx.putImageData(new ImageData(rgba, width, height), 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value)
      else reject(new Error('Failed to export decoded RAW preview'))
    }, 'image/jpeg', 0.9)
  })

  return URL.createObjectURL(blob)
}

type ThumbItemProps = {
  item: Item
  active: boolean
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onLoadThumb: (id: string) => void
}

const ThumbItem = React.memo(function ThumbItem({ item, active, onSelect, onRemove, onLoadThumb }: ThumbItemProps) {
  const showPreview = item.url && (item.thumbLoaded || active)

  return (
    <button className={`thumb ${active ? 'active' : ''}`} onClick={() => onSelect(item.id)}>
      <div className="thumb-preview">
        {showPreview ? (
          <img src={item.url} alt={item.name} loading="lazy" onLoad={() => onLoadThumb(item.id)} />
        ) : (
          <div className="thumb-placeholder">{item.isRaw ? 'RAW' : 'IMG'}</div>
        )}
      </div>
      <div className="thumb-meta">
        <strong title={item.name}>{item.name}</strong>
        <span>{item.sizeLabel}</span>
        <span className={`pill ${item.status}`}>{item.status === 'processing' ? 'decoding…' : item.status === 'queued' ? 'queued' : item.status === 'error' ? 'failed' : item.isRaw ? 'raw' : 'image'}</span>
        {item.error ? <span className="error-text">{item.error}</span> : null}
      </div>
      <span className="remove" onClick={(event) => {
        event.stopPropagation()
        onRemove(item.id)
      }}>×</span>
    </button>
  )
})

function App() {
  const [items, setItems] = React.useState<Item[]>([])
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [zoom, setZoom] = React.useState(1)
  const [brightness, setBrightness] = React.useState(100)
  const [pan, setPan] = React.useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = React.useState(false)
  const [isDropActive, setIsDropActive] = React.useState(false)
  const dragStateRef = React.useRef<{ x: number; y: number; startX: number; startY: number } | null>(null)
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const folderInputRef = React.useRef<HTMLInputElement | null>(null)
  const stageRef = React.useRef<HTMLDivElement | null>(null)
  const decodeQueueRef = React.useRef<Item[]>([])
  const activeDecodersRef = React.useRef(0)

  React.useEffect(() => () => {
    items.forEach((item) => {
      if (item.url) URL.revokeObjectURL(item.url)
    })
  }, [items])

  React.useEffect(() => {
    setZoom(1)
    setBrightness(100)
    setPan({ x: 0, y: 0 })
  }, [selectedId])

  const processQueue = React.useCallback(() => {
    while (activeDecodersRef.current < RAW_CONCURRENCY && decodeQueueRef.current.length > 0) {
      const next = decodeQueueRef.current.shift()
      if (!next) return
      activeDecodersRef.current += 1

      setItems((prev) => prev.map((entry) => entry.id === next.id ? { ...entry, status: 'processing' } : entry))

      decodeRawToObjectUrl(next.file)
        .then((url) => {
          setItems((prev) => prev.map((entry) => entry.id === next.id ? { ...entry, url, status: 'ready' } : entry))
        })
        .catch((error) => {
          setItems((prev) => prev.map((entry) => entry.id === next.id ? {
            ...entry,
            status: 'error',
            error: error instanceof Error ? error.message : 'RAW decode failed',
          } : entry))
        })
        .finally(() => {
          activeDecodersRef.current -= 1
          processQueue()
        })
    }
  }, [])

  const addFiles = React.useCallback((fileList: FileList | File[] | null) => {
    const files = fileList ? Array.from(fileList) : []
    if (!files.length) return

    const candidates = files.filter((file) => isRegularImage(file) || isRawFile(file))
    if (!candidates.length) return

    const currentCount = items.length
    const initialItems: Item[] = candidates.map((file, index) => {
      const raw = isRawFile(file)
      const eagerThumb = currentCount + index < MAX_VISIBLE_THUMBS
      return {
        id: makeId(file),
        file,
        url: !raw && eagerThumb ? URL.createObjectURL(file) : '',
        name: file.webkitRelativePath || file.name,
        sizeLabel: formatBytes(file.size),
        status: raw ? 'queued' : 'ready',
        isRaw: raw,
        thumbLoaded: eagerThumb,
      }
    })

    setItems((prev) => {
      const merged = [...prev, ...initialItems]
      setSelectedId((current) => current ?? merged[0]?.id ?? null)
      return merged
    })

    const queuedRaws = initialItems.filter((item) => item.isRaw)
    if (queuedRaws.length) {
      decodeQueueRef.current.push(...queuedRaws)
      processQueue()
    }
  }, [items.length, processQueue])

  const selected = items.find((item) => item.id === selectedId) ?? null
  const visibleItems = React.useMemo(() => {
    if (items.length <= MAX_VISIBLE_THUMBS) return items
    const selectedIndex = items.findIndex((item) => item.id === selectedId)
    if (selectedIndex === -1) return items.slice(0, MAX_VISIBLE_THUMBS)
    const half = Math.floor(MAX_VISIBLE_THUMBS / 2)
    const start = Math.max(0, Math.min(selectedIndex - half, items.length - MAX_VISIBLE_THUMBS))
    return items.slice(start, start + MAX_VISIBLE_THUMBS)
  }, [items, selectedId])

  const ensureThumbLoaded = React.useCallback((id: string) => {
    setItems((prev) => prev.map((item) => {
      if (item.id !== id || item.thumbLoaded || item.isRaw) return item
      return { ...item, thumbLoaded: true, url: URL.createObjectURL(item.file) }
    }))
  }, [])

  const removeItem = (id: string) => {
    decodeQueueRef.current = decodeQueueRef.current.filter((item) => item.id !== id)
    setItems((prev) => {
      const target = prev.find((item) => item.id === id)
      if (target?.url) URL.revokeObjectURL(target.url)
      const filtered = prev.filter((item) => item.id !== id)
      setSelectedId((current) => current === id ? filtered[0]?.id ?? null : current)
      return filtered
    })
  }

  const clearAll = () => {
    decodeQueueRef.current = []
    items.forEach((item) => item.url && URL.revokeObjectURL(item.url))
    setItems([])
    setSelectedId(null)
    setZoom(1)
    setBrightness(100)
    setPan({ x: 0, y: 0 })
    if (inputRef.current) inputRef.current.value = ''
    if (folderInputRef.current) folderInputRef.current.value = ''
  }

  React.useEffect(() => {
    if (!selected || selected.url || selected.isRaw) return
    setItems((prev) => prev.map((item) => item.id === selected.id ? { ...item, url: URL.createObjectURL(item.file), thumbLoaded: true } : item))
  }, [selected])

  const zoomBy = (delta: number) => setZoom((current) => Math.min(8, Math.max(0.25, Number((current + delta).toFixed(2)))))
  const resetView = () => {
    setZoom(1)
    setBrightness(100)
    setPan({ x: 0, y: 0 })
  }

  const onWheel: React.WheelEventHandler<HTMLDivElement> = (event) => {
    if (!selected || selected.status !== 'ready') return
    event.preventDefault()
    zoomBy(event.deltaY < 0 ? 0.2 : -0.2)
  }

  const onPointerDown: React.PointerEventHandler<HTMLImageElement> = (event) => {
    if (zoom <= 1) return
    setIsDragging(true)
    dragStateRef.current = { x: pan.x, y: pan.y, startX: event.clientX, startY: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove: React.PointerEventHandler<HTMLImageElement> = (event) => {
    if (!dragStateRef.current) return
    const { x, y, startX, startY } = dragStateRef.current
    setPan({ x: x + (event.clientX - startX), y: y + (event.clientY - startY) })
  }

  const onPointerUp: React.PointerEventHandler<HTMLImageElement> = (event) => {
    dragStateRef.current = null
    setIsDragging(false)
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const openFullscreen = async () => {
    if (!stageRef.current) return
    if (document.fullscreenElement) await document.exitFullscreen()
    else await stageRef.current.requestFullscreen()
  }

  const stats = React.useMemo(() => {
    const queued = items.filter((item) => item.status === 'queued').length
    const processing = items.filter((item) => item.status === 'processing').length
    return { total: items.length, queued, processing }
  }, [items])

  return (
    <div
      className={`app-shell ${isDropActive ? 'drop-active' : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        setIsDropActive(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return
        setIsDropActive(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setIsDropActive(false)
        addFiles(event.dataTransfer.files)
      }}
    >
      <aside className="sidebar">
        <div>
          <h1>RAW Viewer</h1>
          <p className="muted">Handles large batches more carefully now: lazy thumbs, capped visible list, and throttled RAW decoding.</p>
        </div>

        <label className="upload-card">
          <input ref={inputRef} type="file" accept="image/*,.cr2,.cr3,.nef,.arw,.dng,.raf,.rw2,.orf,.pef,.sr2,.x3f,.raw" multiple onChange={(event) => addFiles(event.target.files)} />
          <span>Choose images or RAWs</span>
          <small>Multi-select, drag & drop, and folder upload supported</small>
        </label>

        <input ref={folderInputRef} type="file" multiple hidden {...({ webkitdirectory: 'true', directory: '' } as Record<string, string>)} onChange={(event) => addFiles(event.target.files)} />

        <div className="actions wrap">
          <button onClick={() => inputRef.current?.click()}>Add files</button>
          <button onClick={() => folderInputRef.current?.click()}>Add folder</button>
          <button className="ghost" onClick={clearAll} disabled={!items.length}>Clear all</button>
        </div>

        <div className="list-stats">
          <span>{stats.total} files</span>
          {stats.processing ? <span>{stats.processing} decoding</span> : null}
          {stats.queued ? <span>{stats.queued} queued</span> : null}
          {items.length > visibleItems.length ? <span>showing {visibleItems.length} around selection</span> : null}
        </div>

        <div className="thumb-list">
          {items.length === 0 ? (
            <div className="empty-state">No images yet. Drop a folder or a whole pile of files here.</div>
          ) : (
            visibleItems.map((item) => (
              <ThumbItem
                key={item.id}
                item={item}
                active={item.id === selectedId}
                onSelect={setSelectedId}
                onRemove={removeItem}
                onLoadThumb={ensureThumbLoaded}
              />
            ))
          )}
        </div>
      </aside>

      <main className="viewer">
        {selected ? (
          <>
            <div className="viewer-topbar">
              <div>
                <h2>{selected.name}</h2>
                <p>{selected.sizeLabel}{selected.isRaw ? ' • RAW source' : ''}</p>
              </div>
              <div className="actions">
                <button className="ghost" onClick={() => zoomBy(-0.2)} disabled={zoom <= 0.25}>−</button>
                <button className="ghost" onClick={resetView}>Reset</button>
                <button className="ghost" onClick={() => zoomBy(0.2)} disabled={zoom >= 8}>+</button>
                <button onClick={() => void openFullscreen()}>Fullscreen</button>
                {selected.url ? <a href={selected.url} download={selected.name.replace(/\.[^.]+$/, '') + '.jpg'}>Download preview</a> : null}
              </div>
            </div>
            <div className="viewer-subbar">
              <span>Zoom {Math.round(zoom * 100)}%</span>
              <label className="brightness-control">
                <span>Helligkeit {brightness}%</span>
                <input type="range" min="50" max="200" step="5" value={brightness} onChange={(event) => setBrightness(Number(event.target.value))} />
              </label>
              {selected.status === 'queued' ? <span>Queued for RAW decode…</span> : null}
              {selected.status === 'processing' ? <span>Decoding RAW…</span> : null}
              {selected.status === 'error' ? <span className="error-text">{selected.error}</span> : null}
            </div>
            <div ref={stageRef} className="image-stage" onWheel={onWheel}>
              {selected.status === 'ready' && selected.url ? (
                <img
                  src={selected.url}
                  alt={selected.name}
                  className={isDragging ? 'dragging' : ''}
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    filter: `brightness(${brightness}%)`,
                  }}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                />
              ) : (
                <div className="placeholder">
                  <h2>{selected.status === 'queued' ? 'Waiting in queue…' : selected.status === 'processing' ? 'Decoding…' : 'Could not preview this file'}</h2>
                  <p>{selected.status === 'queued' ? 'RAW files are decoded with limited concurrency so huge batches do not melt the browser.' : selected.status === 'processing' ? 'RAW processing happens locally in your browser.' : selected.error ?? 'This file could not be rendered.'}</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="placeholder hero">
            <h2>Ready when you are</h2>
            <p>Upload files on the left, drag in folders, or drop them anywhere on the page.</p>
          </div>
        )}
      </main>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
