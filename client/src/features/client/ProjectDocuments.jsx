import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FiDownload, FiEye, FiFileText, FiTrash2, FiUpload, FiMoreVertical } from 'react-icons/fi'
import toast from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { clientService } from './clientService'
import apiClient from '@/api/client'
import {
  Card, CardHeader, Badge, Loader, EmptyState, Select, Button, Modal,
  Dropdown, DropdownItem,
} from '@/components/ui'
import { FilePreview } from '@/features/files/FilePreview'
import { detectType } from '@/features/files/constants'
import { fmtDate } from './constants'

const MAX_BYTES = 10 * 1024 * 1024

const DOC_CATEGORIES = ['Proposal', 'Quotation', 'Requirement', 'Design', 'Manual', 'Other']

const docType = (d) => detectType({ name: String(d?.name || '') })

export const clientDocumentsApi = {
  list: (user, projectId) => clientService.getProject(user, projectId).then((p) => p.documents || []),
  upload: (projectId, formData) => clientService.uploadProjectDocument(projectId, formData),
  remove: (projectId, docId) => clientService.deleteProjectDocument(projectId, docId),
  downloadUrl: (projectId, docId) => clientService.downloadProjectDocumentUrl(projectId, docId),
  keys: (projectId) => [
    ['client-project-documents', projectId],
    ['client-project', projectId],
    ['client-projects'],
  ],
}

export default function ProjectDocuments({ projectId, title = 'Documents', api = clientDocumentsApi }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [category, setCategory] = useState('Other')
  const [previewDoc, setPreviewDoc] = useState(null)
  const fileRef = useRef(null)

  const { data: docs = [], isLoading } = useQuery({
    queryKey: api.keys(projectId)[0],
    queryFn: () => api.list(user, projectId),
    enabled: !!projectId,
  })

  const invalidate = () => {
    api.keys(projectId).forEach((queryKey) => {
      qc.invalidateQueries({ queryKey, refetchType: 'active' })
    })
  }

  const uploadMut = useMutation({
    mutationFn: (file) => {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('category', category)
      return api.upload(projectId, fd)
    },
    onSuccess: () => { invalidate(); toast.success('Document uploaded') },
    onError: (err) => toast.error(err?.response?.data?.message || err?.message || 'Upload failed'),
  })

  const deleteMut = useMutation({
    mutationFn: (docId) => api.remove(projectId, docId),
    onSuccess: () => { invalidate(); toast.success('Document deleted') },
    onError: (err) => toast.error(err?.response?.data?.message || 'You can only delete files you uploaded'),
  })

  const pickFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    if (file.size > MAX_BYTES) {
      toast.error('File must be 10MB or smaller.')
      return
    }
    uploadMut.mutate(file)
  }

  const fetchBlob = async (d) => apiClient.get(
    api.downloadUrl(projectId, d._id || d.id),
    { responseType: 'blob' },
  )

  const onDownload = async (d) => {
    try {
      const url = URL.createObjectURL(await fetchBlob(d))
      const a = document.createElement('a')
      a.href = url
      a.download = d.name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Download failed')
    }
  }

  const onPreview = (d) => setPreviewDoc(d)

  if (!projectId) return null

  return (
    <Card>

      <CardHeader
        title={title}
        action={(
          <div className="flex items-center gap-2">
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-auto"
              options={DOC_CATEGORIES.map((c) => ({ value: c, label: c }))}
            />
            <input ref={fileRef} type="file" className="hidden" onChange={pickFile} />
            <Button
              icon={FiUpload}
              loading={uploadMut.isPending}
              onClick={() => fileRef.current?.click()}
            >
              Upload Document
            </Button>
          </div>
        )}
      />
      {isLoading ? <Loader label="Loading documents…" /> : docs.length === 0 ? (
        <EmptyState title="No documents yet" description="Upload the first document for this project." />
      ) : (
        <div className="space-y-2">
          {docs.map((d) => {
            const canDelete = d.uploadedBy === user?.name
            return (
              <div key={d._id || d.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-app p-3">
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <FiFileText className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{d.name}</p>
                  <p className="text-xs text-muted">{d.type} · {d.size} · Uploaded {fmtDate(d.uploadedAt)}</p>
                </div>
                <Badge tone="accent">{d.uploadedBy}</Badge>
                <Dropdown
                  align="right"
                  trigger={(
                    <span
                      className="flex items-center gap-1 rounded-xl bg-black/5 px-3 py-2 text-sm font-medium transition hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10"
                      aria-label={`Actions for ${d.name}`}
                    >
                      Actions <FiMoreVertical className="h-4 w-4" />
                    </span>
                  )}
                >
                  <DropdownItem icon={FiEye} onClick={() => onPreview(d)}>Preview document</DropdownItem>
                  <DropdownItem icon={FiDownload} onClick={() => onDownload(d)}>Download document</DropdownItem>
                  {canDelete && (
                    <DropdownItem icon={FiTrash2} danger onClick={() => deleteMut.mutate(d._id || d.id)}>
                      Delete document
                    </DropdownItem>
                  )}
                </Dropdown>
              </div>
            )
          })}
        </div>
      )}

      <Modal
        open={!!previewDoc}
        onClose={() => setPreviewDoc(null)}
        title={previewDoc ? previewDoc.name : 'Document preview'}
        size="xl"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setPreviewDoc(null)}>Close</Button>
            <Button icon={FiDownload} onClick={() => onDownload(previewDoc)}>Download</Button>
          </>
        )}
      >
        {previewDoc && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
              <span>Category: {previewDoc.type}</span>
              <span>Size: {previewDoc.size}</span>
              <span>Uploaded by: {previewDoc.uploadedBy}</span>
              <span>Uploaded: {fmtDate(previewDoc.uploadedAt)}</span>
            </div>
            <FilePreview
              name={previewDoc.name}
              type={docType(previewDoc)}
              getBlob={() => fetchBlob(previewDoc)}
            />
          </div>
        )}
      </Modal>
    </Card>
  )
}
