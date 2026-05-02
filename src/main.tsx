import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'

type Item = {
  id: string
  file: File
  url: string
  name: string
  sizeLabel: string
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = units[0]
  for (let i = 1; i < units.length && value >= 1024; i++) {
    value /= 1024
    unit = units[i]
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`
}

function App() {
  const [items, setItems] = React.useState<Item[]>([])
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => () => {
    items.forEach((item) => URL.revokeObjectURL(item.url))
  }, [items])

  const addFiles = (fileList: FileList | null) => {
    if (!fileList?.length) return
    const next: Item[] = Array.from(fileList)
      .filter((file) => file.type.startsWith('image/'))
      .map((file) => ({
        id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        url: URL.createObjectURL(file),
        name: file.name,
        sizeLabel: formatBytes(file.size),
      }))

    if (!next.length) return

    setItems((prev) => {
      const merged = [...prev, ...next]
      if (!selectedId) setSelectedId(merged[0]?.id ?? null)
      return merged
    })
    if (!selectedId) setSelectedId(next[0].id)
  }

  const selected = items.find((item) => item.id === selectedId) ?? null

  const removeItem = (id: string) => {
    setItems((prev) => {
      const target = prev.find((item) => item.id === id)
      if (target) URL.revokeObjectURL(target.url)
      const filtered = prev.filter((item) => item.id !== id)
      if (selectedId === id) setSelectedId(filtered[0]?.id ?? null)
      return filtered
    })
  }

  const clearAll = () => {
    items.forEach((item) => URL.revokeObjectURL(item.url))
    setItems([])
    setSelectedId(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <h1>RAW Viewer</h1>
          <p className="muted">Drop a bunch of images in, then browse them comfortably in the browser.</p>
        </div>

        <label className="upload-card">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => addFiles(event.target.files)}
          />
          <span>Choose images</span>
          <small>Multiple upload supported</small>
        </label>

        <div className="actions">
          <button onClick={() => inputRef.current?.click()}>Add more</button>
          <button className="ghost" onClick={clearAll} disabled={!items.length}>Clear all</button>
        </div>

        <div className="thumb-list">
          {items.length === 0 ? (
            <div className="empty-state">No images yet.</div>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                className={`thumb ${item.id === selectedId ? 'active' : ''}`}
                onClick={() => setSelectedId(item.id)}
              >
                <img src={item.url} alt={item.name} loading="lazy" />
                <div className="thumb-meta">
                  <strong title={item.name}>{item.name}</strong>
                  <span>{item.sizeLabel}</span>
                </div>
                <span
                  className="remove"
                  onClick={(event) => {
                    event.stopPropagation()
                    removeItem(item.id)
                  }}
                >
                  ×
                </span>
              </button>
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
                <p>{selected.sizeLabel}</p>
              </div>
              <a href={selected.url} download={selected.name}>Download</a>
            </div>
            <div className="image-stage">
              <img src={selected.url} alt={selected.name} />
            </div>
          </>
        ) : (
          <div className="placeholder">
            <h2>Ready when you are</h2>
            <p>Upload images on the left and they’ll show up here.</p>
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
