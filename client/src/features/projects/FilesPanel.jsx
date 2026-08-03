import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FiUploadCloud, FiDownload } from 'react-icons/fi'
import { projectApi } from '@/api/services'
import { Loader } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { fileMeta } from './constants'
import { formatBytes, formatDate, cn } from '@/utils'

const TONE_BG = {
  primary: 'bg-primary/10 text-primary', accent: 'bg-accent/10 text-accent',
  success: 'bg-success/10 text-success', warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger', default: 'bg-black/5 text-muted dark:bg-white/10',
}

// Infer a stored `type` string from a filename.
const inferType = (name = '') => {
  const ext = name.split('.').pop().toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (['doc', 'docx'].includes(ext)) return 'word'
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'excel'
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'zip'
  if (['fig', 'sketch', 'xd', 'psd'].includes(ext)) return 'design'
  if (['js', 'ts', 'json', 'html', 'css', 'py', 'java'].includes(ext)) return 'code'
  return 'file'
}

// Project file attachments with drag-and-drop upload.
export function FilesPanel({ projectId, canWrite }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const key = ['project-files', projectId]
  const { data: files = [], isLoading } = useQuery({ queryKey: key, queryFn: () => projectApi.files({ project: projectId }), enabled: !!projectId })

  const addMut = useMutation({
    mutationFn: (payload) => projectApi.addFile(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key })
      qc.invalidateQueries({ queryKey: ['project-activity', projectId] })
    },
    onError: () => toast.error('Upload failed'),
  })

  const onDrop = useCallback((accepted) => {
    accepted.forEach((f) => addMut.mutate({
      project: projectId, name: f.name, type: inferType(f.name), size: f.size,
      url: URL.createObjectURL(f), uploadedBy: user?.name,
    }))
    if (accepted.length) toast.success(`${accepted.length} file(s) uploaded`)
  }, [projectId, user]) // eslint-disable-line react-hooks/exhaustive-deps

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, disabled: !canWrite })

  return (
    <div>
      {canWrite && (
        <div
          {...getRootProps()}
          className={cn(
            'mb-4 flex cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed border-app p-8 text-center transition',
            isDragActive && 'border-primary bg-primary/5'
          )}
        >
          <input {...getInputProps()} />
          <FiUploadCloud className="mb-2 h-8 w-8 text-primary" />
          <p className="text-sm font-medium">{isDragActive ? 'Drop files here' : 'Drag files here or click to upload'}</p>
          <p className="text-xs text-muted">Any file type · attachments are shared with the team</p>
        </div>
      )}

      {isLoading ? <Loader label="Loading files…" /> : files.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">No files uploaded yet</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {files.map((f) => {
            const meta = fileMeta(f.type)
            return (
              <div key={f.id} className="flex items-center gap-3 rounded-xl border border-app p-3">
                <div className={cn('flex h-10 w-10 flex-none items-center justify-center rounded-lg', TONE_BG[meta.tone])}>
                  <meta.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{f.name}</p>
                  <p className="text-xs text-muted">{formatBytes(f.size)} · {f.uploadedBy} · {formatDate(f.createdAt, 'DD MMM')}</p>
                </div>
                {f.url && <a href={f.url} download={f.name} className="rounded-lg p-2 text-muted hover:text-primary" aria-label={`Download ${f.name}`}><FiDownload /></a>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
