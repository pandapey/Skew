import { useCallback, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useDropzone } from 'react-dropzone'
import toast from 'react-hot-toast'
import {
  FiUploadCloud, FiFile, FiImage, FiVideo, FiFileText, FiTrash2, FiDownload, FiFolder,
  FiHardDrive, FiStar, FiShare2, FiEye, FiLock, FiUsers, FiPlus,
  FiGrid, FiList, FiClock, FiRotateCcw, FiX, FiEdit2, FiArrowUp,
} from 'react-icons/fi'
import { fileService } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'
import {
  PageHeader, Card, CardHeader, Badge, SearchInput, StatCard, EmptyState, Loader,
  Button, Input, Select, Modal, ConfirmDialog, Dropdown, DropdownItem,
} from '@/components/ui'
import {
  FILE_TYPE_ICON, FILE_TYPE_TONE, FILE_TYPE_LABEL, PERMISSION_META, PERMISSIONS,
  detectType, fileUrl,
} from '@/features/files/constants'
import { fetchFileBlob } from '@/features/files/preview'
// Phase 6.20 (TASK 3): the ONE document viewer, extracted from this file.
import { FilePreview, ItemGlyph } from '@/features/files/FilePreview'
import { cn, formatBytes, formatDate } from '@/utils'

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function Files() {
  const { user } = useAuth()
  const [currentFolder, setCurrentFolder] = useState('root')
  const [pathStack, setPathStack] = useState([]) // [{id,name}]
  const [search, setSearch] = useState('')
  const [view, setView] = useState('grid')
  const [showTrash, setShowTrash] = useState(false)

  const [previewFile, setPreviewFile] = useState(null)
  const [shareFile, setShareFile] = useState(null)
  const [versionFile, setVersionFile] = useState(null)
  const [permFile, setPermFile] = useState(null)
  const [renameTarget, setRenameTarget] = useState(null)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadQueue, setUploadQueue] = useState([])
  const [deleting, setDeleting] = useState(null)
  const [hardDeleting, setHardDeleting] = useState(null)

  const query = useQuery({
    queryKey: ['files', currentFolder, search, showTrash],
    queryFn: () => (showTrash
      ? fileService.trash({ search })
      : fileService.list({ folder: currentFolder, search, trashed: showTrash })),
  })
  const storage = useQuery({ queryKey: ['file-storage'], queryFn: fileService.storage })

  const refresh = useCallback(() => { query.refetch(); storage.refetch() }, [query, storage])

  const { folders = [], files = [] } = query.data || {}
  const isLoading = query.isLoading

  // --- Navigation ---
  const openFolder = (f) => {
    setCurrentFolder(f.id)
    setPathStack((s) => [...s, { id: f.id, name: f.name }])
    setSearch('')
  }
  const goCrumb = (idx) => {
    if (idx < 0) { setCurrentFolder('root'); setPathStack([]) }
    else { setCurrentFolder(pathStack[idx].id); setPathStack(pathStack.slice(0, idx + 1)) }
    setSearch('')
  }

  // --- Upload flow ---
  const openUploadWith = useCallback((accepted) => {
    if (accepted?.length) {
      setUploadQueue(accepted.map((file) => ({ file, progress: 0, done: false, error: null })))
    }
    setUploadOpen(true)
  }, [])

  const mainDropzone = useDropzone({ noClick: true, noKeyboard: true, onDrop: openUploadWith })
  const bannerDropzone = useDropzone({ onDrop: openUploadWith })

  const runUploads = async () => {
    for (let i = 0; i < uploadQueue.length; i++) {
      const item = uploadQueue[i]
      if (item.done || item.error) continue
      try {
        await fileService.upload(item.file, {
          folder: currentFolder,
          onProgress: (p) => setUploadQueue((q) => q.map((x, j) => (j === i ? { ...x, progress: p } : x))),
        })
        setUploadQueue((q) => q.map((x, j) => (j === i ? { ...x, done: true, progress: 100 } : x)))
      } catch {
        setUploadQueue((q) => q.map((x, j) => (j === i ? { ...x, error: true } : x)))
      }
    }
    toast.success('Upload complete')
    refresh()
    setTimeout(() => setUploadOpen(false), 600)
  }

  // --- Mutations ---
  const createFolderMutation = useMutation({
    mutationFn: ({ name, parent }) => fileService.createFolder({ name, parent }),
    onSuccess: () => { toast.success('Folder created'); setNewFolderOpen(false); refresh() },
    onError: () => toast.error('Could not create folder'),
  })
  const renameMutation = useMutation({
    mutationFn: ({ id, name }) => fileService.update(id, { name }),
    onSuccess: () => { toast.success('Renamed'); setRenameTarget(null); refresh() },
    onError: () => toast.error('Rename failed'),
  })
  const renameFolderMutation = useMutation({
    mutationFn: ({ id, name }) => fileService.renameFolder(id, name),
    onSuccess: () => { toast.success('Folder renamed'); setRenameTarget(null); refresh() },
    onError: () => toast.error('Rename failed'),
  })
  const removeMutation = useMutation({
    mutationFn: (id) => fileService.remove(id),
    onSuccess: () => { toast.success('Moved to recycle bin'); setDeleting(null); refresh() },
    onError: () => toast.error('Delete failed'),
  })
  const hardRemoveMutation = useMutation({
    mutationFn: (id) => fileService.hardRemove(id),
    onSuccess: () => { toast.success('Permanently deleted'); setHardDeleting(null); refresh() },
    onError: () => toast.error('Delete failed'),
  })
  const restoreMutation = useMutation({
    mutationFn: (id) => fileService.restore(id),
    onSuccess: () => { toast.success('Restored'); refresh() },
    onError: () => toast.error('Restore failed'),
  })
  const restoreFolderMutation = useMutation({
    mutationFn: (id) => fileService.restoreFolder(id),
    onSuccess: () => { toast.success('Restored'); refresh() },
    onError: () => toast.error('Restore failed'),
  })
  const removeFolderMutation = useMutation({
    mutationFn: (id) => fileService.removeFolder(id),
    onSuccess: () => { toast.success('Folder moved to recycle bin'); setDeleting(null); refresh() },
    onError: () => toast.error('Delete failed'),
  })
  const starMutation = useMutation({
    mutationFn: ({ id, starred }) => fileService.update(id, { starred }),
    onSuccess: refresh, onError: () => {},
  })
  const permMutation = useMutation({
    mutationFn: ({ id, permission }) => fileService.update(id, { permission }),
    onSuccess: () => { toast.success('Permissions updated'); setPermFile(null); refresh() },
    onError: () => toast.error('Update failed'),
  })
  const restoreVersionMutation = useMutation({
    mutationFn: ({ id, versionId }) => fileService.restoreVersion(id, versionId),
    onSuccess: () => { toast.success('Version restored'); setVersionFile(null); refresh() },
    onError: () => toast.error('Restore failed'),
  })

  const downloadFile = async (file) => {
    const res = await fileService.download(file.id)
    if (res && res instanceof Blob) saveBlob(res, file.name)
  }

  // --- Stats ---
  const used = storage.data?.used || 0
  const limit = storage.data?.limit || 1024 * 1024 * 1024
  const usedPct = Math.min(100, Math.round((used / limit) * 100))
  const sharedCount = files.filter((f) => (f.sharedWith?.length || 0) > 0 || f.permission !== 'private').length
  const starredCount = files.filter((f) => f.starred).length

  // BUGFIX - <MoreMenu> used to be declared HERE, inside the Files component.
  // A component declared inside another component is a BRAND NEW COMPONENT TYPE
  // on every single render, so React cannot reconcile it: it unmounts the old
  // tree and mounts a fresh one, throwing away the Dropdown's internal `open`
  // state. This page re-renders constantly (react-query `isFetching`, the star
  // mutation, the realtime socket invalidations, every `setState`), so the menu
  // opened and then vanished on its own a moment later. It now lives at module
  // scope (bottom of this file) with a stable identity and takes its handlers
  // as props.

  if (isLoading) return <Loader label="Loading files…" />

  return (
    <div>
      <PageHeader
        title="File Management"
        subtitle="Upload, organize, preview and share files across your workspace."
        actions={
          <>
            {!showTrash && (
              <>
                <Button variant="ghost" icon={FiPlus} onClick={() => setNewFolderOpen(true)}>New Folder</Button>
                <Button icon={FiUploadCloud} onClick={() => { setUploadQueue([]); setUploadOpen(true) }}>Upload</Button>
              </>
            )}
            <Button
              variant={showTrash ? 'primary' : 'ghost'}
              icon={FiTrash2}
              onClick={() => { setShowTrash((v) => !v); setCurrentFolder('root'); setPathStack([]) }}
            >
              {showTrash ? 'Exit Bin' : 'Recycle Bin'}
            </Button>
          </>
        }
      />

      {/* Stat + storage */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={showTrash ? 'In Bin' : 'Files'} value={files.length} icon={FiFile} />
        <StatCard label="Storage Used" value={formatBytes(used)} icon={FiHardDrive} tone="accent" />
        <StatCard label="Folders" value={folders.length} icon={FiFolder} tone="warning" />
        <StatCard label={showTrash ? 'Folders in Bin' : 'Shared / Starred'} value={showTrash ? folders.length : `${sharedCount} / ${starredCount}`} icon={FiShare2} tone="success" />
      </div>

      {/* Storage usage bar */}
      <Card className="mb-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium">Storage Usage</span>
          <span className="text-muted">{formatBytes(used)} / {formatBytes(limit)}</span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
          <div className={cn('h-full rounded-full', usedPct > 90 ? 'bg-danger' : usedPct > 70 ? 'bg-warning' : 'bg-primary')} style={{ width: `${usedPct}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
          {Object.entries(storage.data?.byType || {}).map(([t, sz]) => (
            <span key={t} className="inline-flex items-center gap-1">
              <ItemGlyph type={t} className="h-4 w-4" /> {FILE_TYPE_LABEL[t] || t}: {formatBytes(sz)}
            </span>
          ))}
        </div>
      </Card>

      {/* Breadcrumb + toolbar */}
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center">
        <nav className="flex min-w-0 items-center gap-1 overflow-x-auto text-sm">
          <button onClick={() => goCrumb(-1)} className={cn('shrink-0 rounded-lg px-2 py-1', !currentFolder || currentFolder === 'root' ? 'font-semibold text-primary' : 'text-muted hover:text-primary')}>Root</button>
          {pathStack.map((c, i) => (
            <span key={c.id} className="flex shrink-0 items-center gap-1">
              <span className="text-muted">/</span>
              <button onClick={() => goCrumb(i)} className={cn('rounded-lg px-2 py-1', i === pathStack.length - 1 ? 'font-semibold text-primary' : 'text-muted hover:text-primary')}>{c.name}</button>
            </span>
          ))}
        </nav>
        <div className="flex flex-1 items-center gap-2 lg:justify-end">
          <SearchInput value={search} onChange={setSearch} className="max-w-xs" placeholder="Search files…" />
          <button onClick={() => setView('grid')} className={cn('rounded-lg p-2', view === 'grid' ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-black/5 dark:hover:bg-white/10')} aria-label="Grid view"><FiGrid /></button>
          <button onClick={() => setView('list')} className={cn('rounded-lg p-2', view === 'list' ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-black/5 dark:hover:bg-white/10')} aria-label="List view"><FiList /></button>
        </div>
      </div>

      {/* Drop target wrapping the file area (drop only, no click) */}
      <div {...mainDropzone.getRootProps()} className={cn(mainDropzone.isDragActive && 'rounded-card ring-2 ring-primary')}>
        {/* Drag & drop banner */}
        <div {...bannerDropzone.getRootProps()}
          className={cn('mb-4 flex cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed p-6 text-center transition',
            bannerDropzone.isDragActive ? 'border-primary bg-primary/5' : 'border-app hover:border-primary/60')}>
          <input {...bannerDropzone.getInputProps()} />
          <FiUploadCloud className="mb-2 h-8 w-8 text-primary" />
          <p className="text-sm font-medium">{bannerDropzone.isDragActive ? 'Drop files to upload…' : 'Drag & drop files here, or click to browse'}</p>
          <p className="text-xs text-muted">Images, videos, PDF, Word & Excel · up to 10 MB each</p>
        </div>

        {query.isFetching && !isLoading && (
          <div className="mb-2"><span className="block h-1 w-full animate-pulse rounded-full bg-primary/30" /></div>
        )}

        {!folders.length && !files.length ? (
          <EmptyState title={showTrash ? 'Recycle bin is empty' : 'No files here'} subtitle={showTrash ? '' : 'Upload a file or create a folder to get started.'} />
        ) : view === 'grid' ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {folders.map((f) => (
              <div key={f.id} className="group relative rounded-xl border border-app p-4 transition hover:border-primary hover:shadow-soft">
                <button className="flex w-full flex-col items-start text-left" onClick={() => openFolder(f)}>
                  <FiFolder className="h-9 w-9 text-warning" />
                  <p className="mt-3 truncate text-sm font-medium" title={f.name}>{f.name}</p>
                  <p className="text-xs text-muted">Folder</p>
                </button>
                <div className="mt-2 flex gap-1">
                  {showTrash ? (
                    <>
                      <button onClick={() => restoreFolderMutation.mutate(f.id)} className="rounded-lg p-1.5 hover:bg-success/10 hover:text-success" aria-label="Restore"><FiRotateCcw className="h-4 w-4" /></button>
                      <button onClick={() => setHardDeleting({ ...f, _folder: true })} className="rounded-lg p-1.5 hover:bg-danger/10 hover:text-danger ml-auto" aria-label="Delete forever"><FiTrash2 className="h-4 w-4" /></button>
                    </>
                  ) : (
                    <button onClick={() => setDeleting({ ...f, _folder: true })} className="rounded-lg p-1.5 hover:bg-danger/10 hover:text-danger ml-auto" aria-label="Delete"><FiTrash2 className="h-4 w-4" /></button>
                  )}
                </div>
              </div>
            ))}
            {files.map((f) => (
              <div key={f.id} className="group relative rounded-xl border border-app p-4 transition hover:border-primary hover:shadow-soft">
                <button className="flex w-full flex-col items-start text-left" onClick={() => setPreviewFile(f)}>
                  <ItemGlyph type={f.type} className="h-9 w-9" />
                  <p className="mt-3 w-full truncate text-sm font-medium" title={f.name}>{f.name}</p>
                  <p className="text-xs text-muted">{formatBytes(f.size)} · {formatDate(f.modified, 'DD MMM')}</p>
                </button>
                <button onClick={() => starMutation.mutate({ id: f.id, starred: !f.starred })}
                  className={cn('absolute right-2 top-2 rounded-lg p-1.5', f.starred ? 'text-warning' : 'text-muted opacity-0 hover:text-warning group-hover:opacity-100')} aria-label="Star">
                  <FiStar className={cn('h-4 w-4', f.starred && 'fill-current')} />
                </button>
                <div className="mt-2 flex items-center gap-1">
                  <button onClick={() => setPreviewFile(f)} className="rounded-lg p-1.5 hover:bg-primary/10 hover:text-primary" aria-label="Preview"><FiEye className="h-4 w-4" /></button>
                  <button onClick={() => downloadFile(f)} className="rounded-lg p-1.5 hover:bg-success/10 hover:text-success" aria-label="Download"><FiDownload className="h-4 w-4" /></button>
                  {showTrash ? (
                    <>
                      <button onClick={() => restoreMutation.mutate(f.id)} className="rounded-lg p-1.5 hover:bg-success/10 hover:text-success" aria-label="Restore"><FiRotateCcw className="h-4 w-4" /></button>
                      <button onClick={() => setHardDeleting(f)} className="rounded-lg p-1.5 hover:bg-danger/10 hover:text-danger ml-auto" aria-label="Delete forever"><FiTrash2 className="h-4 w-4" /></button>
                    </>
                  ) : (
                    <span className="ml-auto"><MoreMenu item={f} onShare={setShareFile} onPermissions={setPermFile} onVersions={setVersionFile} onRename={setRenameTarget} onDelete={setDeleting} /></span>
                  )}
                </div>
                {f.sharedWith?.length > 0 && <FiShare2 className="absolute left-2 top-2 h-3.5 w-3.5 text-accent" />}
              </div>
            ))}
          </div>
        ) : (
          <Card>
            <div className="divide-y divide-app">
              {folders.map((f) => (
                <div key={f.id} className="flex items-center gap-3 p-3">
                  <FiFolder className="h-6 w-6 text-warning" />
                  <button onClick={() => openFolder(f)} className="flex-1 text-left font-medium hover:text-primary">{f.name}</button>
                  <span className="text-sm text-muted">Folder</span>
                  {showTrash && (
                    <div className="flex gap-1">
                      <button onClick={() => restoreFolderMutation.mutate(f.id)} className="rounded-lg p-1.5 hover:bg-success/10 hover:text-success" aria-label="Restore"><FiRotateCcw className="h-4 w-4" /></button>
                      <button onClick={() => setHardDeleting({ ...f, _folder: true })} className="rounded-lg p-1.5 hover:bg-danger/10 hover:text-danger" aria-label="Delete forever"><FiTrash2 className="h-4 w-4" /></button>
                    </div>
                  )}
                </div>
              ))}
              {files.map((f) => (
                <div key={f.id} className="flex items-center gap-3 p-3">
                  <ItemGlyph type={f.type} className="h-6 w-6" />
                  <button onClick={() => setPreviewFile(f)} className="flex-1 text-left">
                    <p className="font-medium hover:text-primary">{f.name}</p>
                    <p className="text-xs text-muted">{formatBytes(f.size)} · {formatDate(f.modified, 'DD MMM')}</p>
                  </button>
                  {f.sharedWith?.length > 0 && <FiShare2 className="h-4 w-4 text-accent" />}
                  <button onClick={() => downloadFile(f)} className="rounded-lg p-1.5 hover:bg-success/10 hover:text-success" aria-label="Download"><FiDownload className="h-4 w-4" /></button>
                  {showTrash ? (
                    <button onClick={() => restoreMutation.mutate(f.id)} className="rounded-lg p-1.5 hover:bg-success/10 hover:text-success" aria-label="Restore"><FiRotateCcw className="h-4 w-4" /></button>
                  ) : <MoreMenu item={f} onShare={setShareFile} onPermissions={setPermFile} onVersions={setVersionFile} onRename={setRenameTarget} onDelete={setDeleting} />}
                  {showTrash && <button onClick={() => setHardDeleting(f)} className="rounded-lg p-1.5 hover:bg-danger/10 hover:text-danger" aria-label="Delete forever"><FiTrash2 className="h-4 w-4" /></button>}
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* ---- Modals ---- */}
      <NewFolderModal open={newFolderOpen} onClose={() => setNewFolderOpen(false)}
        currentFolder={currentFolder} defaultName="" onSubmit={(name) => createFolderMutation.mutate({ name, parent: currentFolder })} />

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} queue={uploadQueue} setQueue={setUploadQueue}
        onUpload={runUploads} />

      <PreviewModal file={previewFile} onClose={() => setPreviewFile(null)} onDownload={downloadFile} />

      <ShareModal file={shareFile} onClose={() => setShareFile(null)} onChanged={refresh} />
      <VersionModal file={versionFile} onClose={() => setVersionFile(null)}
        onRestore={(versionId) => restoreVersionMutation.mutate({ id: versionFile?.id, versionId })} />

      <PermissionsModal file={permFile} onClose={() => setPermFile(null)}
        onSubmit={(permission) => permMutation.mutate({ id: permFile?.id, permission })} />

      <RenameModal
        target={renameTarget}
        onClose={() => setRenameTarget(null)}
        onSubmit={(name) => (renameTarget?._folder
          ? renameFolderMutation.mutate({ id: renameTarget.id, name })
          : renameMutation.mutate({ id: renameTarget.id, name }))}
      />

      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)}
        onConfirm={() => (deleting?._folder ? removeFolderMutation.mutate(deleting.id) : removeMutation.mutate(deleting.id))}
        title="Move to Recycle Bin?" message="You can restore it later from the recycle bin." confirmLabel="Move to Bin" loading={removeMutation.isPending || removeFolderMutation.isPending} />

      <ConfirmDialog open={!!hardDeleting} onClose={() => setHardDeleting(null)} onConfirm={() => hardRemoveMutation.mutate(hardDeleting.id)}
        title="Delete permanently?" message="This cannot be undone." confirmLabel="Delete Forever" loading={hardRemoveMutation.isPending} />
    </div>
  )
}

/* ---------------- New Folder ---------------- */
function NewFolderModal({ open, onClose, currentFolder, onSubmit }) {
  const [name, setName] = useState('')
  return (
    <Modal open={open} onClose={onClose} title="New Folder" size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!name.trim()} onClick={() => onSubmit(name.trim())}>Create</Button></>}>
      <Input label="Folder name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q3 Reports" autoFocus />
      <p className="mt-2 text-xs text-muted">Created in: {currentFolder === 'root' ? 'Root' : 'current folder'}</p>
    </Modal>
  )
}

/* ---------------- Upload (with progress) ---------------- */
function UploadModal({ open, onClose, queue, setQueue, onUpload }) {
  const dropzone = useDropzone({
    onDrop: (accepted) => setQueue((q) => [...q, ...accepted.map((file) => ({ file, progress: 0, done: false, error: null }))]),
  })
  const removeItem = (i) => setQueue((q) => q.filter((_, idx) => idx !== i))
  return (
    <Modal open={open} onClose={onClose} title="Upload Files" size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon={FiUploadCloud} disabled={!queue.length} onClick={onUpload}>Upload {queue.length || ''}</Button></>}>
      <div {...dropzone.getRootProps()} className="mb-3 flex cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed p-6 text-center hover:border-primary/60">
        <input {...dropzone.getInputProps()} />
        <FiUploadCloud className="mb-2 h-8 w-8 text-primary" />
        <p className="text-sm font-medium">Drop files or click to add</p>
      </div>
      <div className="space-y-2">
        {queue.map((item, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border border-app p-2">
            <ItemGlyph type={detectType(item.file)} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{item.file.name}</p>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                <div className={cn('h-full rounded-full', item.error ? 'bg-danger' : 'bg-primary')} style={{ width: `${item.progress}%` }} />
              </div>
            </div>
            <span className="w-12 text-right text-xs text-muted">{item.done ? 'Done' : item.error ? 'Error' : `${item.progress}%`}</span>
            <button onClick={() => removeItem(i)} className="rounded-lg p-1.5 text-muted hover:text-danger" aria-label="Remove"><FiX className="h-4 w-4" /></button>
          </div>
        ))}
        {!queue.length && <p className="text-center text-sm text-muted">No files selected.</p>}
      </div>
    </Modal>
  )
}

/* ---------------- Preview ---------------- */
// Phase 6.20 (TASK 3): the renderer that used to live here (ItemGlyph + the
// local FilePreview, plus the inline image/video/pdf branch below) has MOVED to
// features/files/FilePreview.jsx so the client portal can render documents with
// the same viewer instead of gaining a second one. This modal keeps its own
// File-Manager metadata row (type/size/owner/modified) and tag list - only the
// rendering is now shared. Nothing here was reimplemented.
function PreviewModal({ file, onClose, onDownload }) {
  if (!file) return null
  return (
    <Modal open={!!file} onClose={onClose} title={file.name} size="xl"
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button icon={FiDownload} onClick={() => onDownload(file)}>Download</Button></>}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
          <span>Type: {FILE_TYPE_LABEL[file.type] || 'File'}</span>
          <span>Size: {formatBytes(file.size)}</span>
          <span>Owner: {file.owner}</span>
          <span>Modified: {formatDate(file.modified)}</span>
        </div>
        <FilePreview
          name={file.name}
          type={file.type}
          url={fileUrl(file.url)}
          getBlob={() => fetchFileBlob(file.id)}
        />
        {file.tags?.length > 0 && (
          <div className="flex flex-wrap gap-2">{file.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>
        )}
      </div>
    </Modal>
  )
}

/* ---------------- Share ---------------- */
function ShareModal({ file, onClose, onChanged }) {
  const [user, setUser] = useState('')
  const [permission, setPermission] = useState('view')
  const [list, setList] = useState(file?.sharedWith || [])
  if (!file) return null

  const add = async () => {
    if (!user.trim()) return toast.error('Enter a user')
    await fileService.share(file.id, { user: user.trim(), permission })
    setList((l) => { const i = l.findIndex((s) => s.user === user.trim()); const n = [...l]; if (i > -1) n[i] = { user: user.trim(), permission }; else n.push({ user: user.trim(), permission }); return n })
    setUser(''); onChanged()
  }
  const remove = async (u) => {
    await fileService.unshare(file.id, u)
    setList((l) => l.filter((s) => s.user !== u)); onChanged()
  }
  return (
    <Modal open={!!file} onClose={onClose} title={`Share · ${file.name}`} size="md"
      footer={<Button variant="ghost" onClick={onClose}>Done</Button>}>
      <div className="flex gap-2">
        <Input value={user} onChange={(e) => setUser(e.target.value)} placeholder="user@skew.com" className="flex-1" />
        <Select value={permission} onChange={(e) => setPermission(e.target.value)}
          options={[{ value: 'view', label: 'Can view' }, { value: 'edit', label: 'Can edit' }]} />
        <Button onClick={add}>Add</Button>
      </div>
      <div className="mt-4 space-y-2">
        {list.length === 0 && <p className="text-sm text-muted">Not shared with anyone yet.</p>}
        {list.map((s) => (
          <div key={s.user} className="flex items-center gap-2 rounded-xl border border-app p-2">
            <FiUsers className="h-4 w-4 text-accent" />
            <span className="flex-1 text-sm">{s.user}</span>
            <Badge tone={s.permission === 'edit' ? 'primary' : 'default'}>{s.permission}</Badge>
            <button onClick={() => remove(s.user)} className="rounded-lg p-1.5 text-muted hover:text-danger" aria-label="Remove"><FiX className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </Modal>
  )
}

/* ---------------- Version History ---------------- */
function VersionModal({ file, onClose, onRestore }) {
  if (!file) return null
  const versions = [...(file.versions || [])].sort((a, b) => b.version - a.version)
  return (
    <Modal open={!!file} onClose={onClose} title={`Version History · ${file.name}`} size="md"
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <div className="space-y-2">
        {versions.length === 0 && <p className="text-sm text-muted">No versions recorded.</p>}
        {versions.map((v) => (
          <div key={v.id} className="flex items-center gap-3 rounded-xl border border-app p-3">
            <FiClock className="h-4 w-4 text-muted" />
            <div className="flex-1">
              <p className="text-sm font-medium">Version {v.version}</p>
              <p className="text-xs text-muted">{formatBytes(v.size)} · {v.by} · {formatDate(v.uploadedAt)}</p>
            </div>
            <Button variant="ghost" icon={FiRotateCcw} onClick={() => onRestore(v.id)}>Restore</Button>
          </div>
        ))}
      </div>
    </Modal>
  )
}

/* ---------------- Permissions ---------------- */
function PermissionsModal({ file, onClose, onSubmit }) {
  if (!file) return null
  const [perm, setPerm] = useState(file.permission || 'private')
  return (
    <Modal open={!!file} onClose={onClose} title={`Permissions · ${file.name}`} size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => onSubmit(perm)}>Save</Button></>}>
      <p className="mb-3 text-sm text-muted">Control who can see this file.</p>
      <div className="space-y-2">
        {PERMISSIONS.map((p) => {
          const Icon = PERMISSION_META[p].icon
          return (
            <button key={p} onClick={() => setPerm(p)}
              className={cn('flex w-full items-center gap-3 rounded-xl border p-3 text-left transition',
                perm === p ? 'border-primary bg-primary/5' : 'border-app hover:border-primary/50')}>
              <Icon className={cn('h-5 w-5', PERMISSION_META[p].tone === 'success' ? 'text-success' : PERMISSION_META[p].tone === 'primary' ? 'text-primary' : 'text-muted')} />
              <div>
                <p className="text-sm font-medium">{PERMISSION_META[p].label}</p>
                <p className="text-xs text-muted">{p === 'private' ? 'Only you' : p === 'team' ? 'All team members' : 'Anyone with the link'}</p>
              </div>
              {perm === p && <FiArrowUp className="ml-auto h-4 w-4 rotate-45 text-primary" />}
            </button>
          )
        })}
      </div>
    </Modal>
  )
}

/* ---------------- Rename ---------------- */
function RenameModal({ target, onClose, onSubmit }) {
  const [name, setName] = useState(target?.name || '')
  if (!target) return null
  return (
    <Modal open={!!target} onClose={onClose} title={target._folder ? 'Rename Folder' : 'Rename File'} size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!name.trim()} onClick={() => onSubmit(name.trim())}>Rename</Button></>}>
      <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
    </Modal>
  )
}

// =============================================================================
// BUGFIX - stable, module-scope <MoreMenu>.
//
// This component used to be declared INSIDE <Files>. React identifies a
// component by its function reference, so a function that is re-created on
// every render is a different component type every render: React unmounts the
// previous subtree and mounts a new one instead of updating it. The shared
// <Dropdown> keeps its `open` flag in local state, so that state was destroyed
// on the very next render of the page - which happens constantly here
// (react-query background refetch, the star/permission mutations, the realtime
// socket invalidations, any setState). The result was exactly the reported
// symptom: the menu opened on click and closed again by itself.
//
// Declared at module scope its identity is stable, so the menu now stays open
// until the user picks an item, clicks outside, or presses Escape.
// =============================================================================
function MoreMenu({ item, onShare, onPermissions, onVersions, onRename, onDelete }) {
  return (
    <Dropdown
      align="right"
      trigger={<span className="rounded-lg p-1.5 hover:bg-black/5 dark:hover:bg-white/10" aria-label="More"><FiEdit2 className="h-4 w-4" /></span>}
    >
      <DropdownItem icon={FiShare2} onClick={() => onShare(item)}>Share</DropdownItem>
      <DropdownItem icon={FiLock} onClick={() => onPermissions(item)}>Permissions</DropdownItem>
      <DropdownItem icon={FiClock} onClick={() => onVersions(item)}>Version History</DropdownItem>
      <DropdownItem icon={FiEdit2} onClick={() => onRename(item)}>Rename</DropdownItem>
      <DropdownItem icon={FiTrash2} onClick={() => onDelete(item)}>Move to Bin</DropdownItem>
    </Dropdown>
  )
}
