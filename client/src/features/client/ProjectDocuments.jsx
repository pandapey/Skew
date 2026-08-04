// =============================================================================
// Phase 6.3 (TASK 5) — SHARED CLIENT PROJECT DOCUMENTS PANEL
//
// ROOT CAUSE of the original problem:
//   The client portal had TWO document surfaces with very different power:
//     1. features/client/ClientDocuments.jsx (the "Documents" page) already had
//        a REAL upload (multer -> disk), a REAL download (res.download) and an
//        ownership-checked delete.
//     2. features/client/ClientProjectDetail.jsx -> "Documents" tab rendered the
//        exact same `ClientProject.documents[]` array as a READ-ONLY list: name,
//        type, size, uploadedAt and an uploadedBy badge, and nothing else. No
//        upload control, no download button, no delete, no preview.
//   So "each Client Project should support upload/download/delete/preview" was
//   false specifically on the project page. The backend was never the problem -
//   it was already complete and real.
//
// FIX (this file):
//   The panel is extracted ONCE, here, and consumed by BOTH callers. This is an
//   extraction, not a rewrite: the query key, the FormData shape, the mutations,
//   the blob download and the `d.uploadedBy === user.name` delete rule are the
//   same lines that already worked on the Documents page. Nothing was
//   reimplemented and no second code path exists.
//
// REUSED (nothing new was created):
//   • clientService.uploadProjectDocument / deleteProjectDocument /
//     downloadProjectDocumentUrl / getProject  — existing service methods
//   • POST/DELETE/GET /client/projects/:id/documents[...]  — existing routes
//   • ClientProject.documents[] (documentSchema)           — existing storage
//   • Card / CardHeader / Badge / Loader / EmptyState / Select / Button — existing UI
//   • useAuth, TanStack Query, react-hot-toast              — existing hooks
//
// UPLOAD LIMITS: enforced server-side by the existing multer `upload` middleware
// (10MB). The client-side guard below mirrors that number so the user gets an
// instant message instead of a 413; it does NOT replace the server check.
//
// RBAC: every call goes through /client/* which is mounted behind
// `protect, authorize('Client')`, and each handler re-derives the caller's own
// clientId via requireClientId(req) and scopes the ClientProject lookup by it.
// A client therefore cannot read or write another client's documents. Staff
// permissions are untouched — this component is client-portal only.
// =============================================================================
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
// Phase 6.20 (TASK 3): the SAME viewer pages/Files.jsx renders. Not a copy -
// see features/files/FilePreview.jsx for why it was extracted there.
import { FilePreview } from '@/features/files/FilePreview'
import { detectType } from '@/features/files/constants'
import { fmtDate } from './constants'

// Mirrors the server-side multer limit (middleware/upload.js). Server remains
// the authority; this only avoids a pointless round-trip.
const MAX_BYTES = 10 * 1024 * 1024

const DOC_CATEGORIES = ['Proposal', 'Quotation', 'Requirement', 'Design', 'Manual', 'Other']

// =============================================================================
// Phase 6.20 (TASK 3) - PREVIEW TYPE RESOLUTION.
//
// The local PREVIEWABLE regex that stood here was a THIRD, portal-specific
// notion of "what can be previewed", sitting alongside detectType() in
// features/files/constants.js and wordStrategy() in features/files/preview.js.
// It is deleted: the shared detectType() already classifies by extension AND
// mime and is what the shared viewer dispatches on, so using it here means the
// button offered and the renderer that runs can never disagree.
//
// NOTE the stored `documentSchema.type` is the user-chosen CATEGORY
// ('Proposal', 'Design', ...), not a mime type - so the file NAME is what gets
// classified, exactly as the File Manager does for its own rows.
// =============================================================================
const docType = (d) => detectType({ name: String(d?.name || '') })

// =============================================================================
// Phase 6.12 (TASK 1) — REUSED BY THE STAFF PROJECT PAGE
//
// The employee project page needs exactly this panel. Rather than fork it (a
// second document module, which is explicitly forbidden), the ONE transport
// detail that differs between the two portals is lifted into an injectable
// `api` prop: the client portal calls /client/projects/:id/documents, staff call
// /project/:id/documents. Both prefixes read and write the SAME
// ClientProject.documents[] array on the server, so this is one component over
// one storage location - only the RBAC-scoped door changes.
//
// The default value below is the pre-existing client-portal wiring verbatim, so
// every current caller (ClientProjectDetail, and anywhere else mounting this
// component) keeps working with no change at their call site.
// =============================================================================
export const clientDocumentsApi = {
  list: (user, projectId) => clientService.getProject(user, projectId).then((p) => p.documents || []),
  upload: (projectId, formData) => clientService.uploadProjectDocument(projectId, formData),
  remove: (projectId, docId) => clientService.deleteProjectDocument(projectId, docId),
  downloadUrl: (projectId, docId) => clientService.downloadProjectDocumentUrl(projectId, docId),
  // Cache keys the client portal already owns for this data.
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
  // Phase 6.20 (TASK 3): the document currently open in the shared viewer.
  const [previewDoc, setPreviewDoc] = useState(null)
  // Phase 6.10 (TASK 5): the hidden <input type="file"> is driven through a ref
  // instead of a wrapping <label>. See the CardHeader below for why.
  const fileRef = useRef(null)

  const { data: docs = [], isLoading } = useQuery({
    // The first key an adapter publishes is its canonical list key.
    queryKey: api.keys(projectId)[0],
    queryFn: () => api.list(user, projectId),
    enabled: !!projectId,
  })

  // Both mutations bust ['client-project-documents', projectId] AND
  // ['client-project', projectId]. The second matters on the project detail
  // page, whose parent query owns the same documents array — without it the tab
  // would show a stale list after an upload.
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

  // Fetches the real bytes through the authenticated axios client. A plain
  // <a href> could not be used: the download route sits behind the JWT
  // `protect` middleware, so the browser would send no Authorization header.
  //
  // Phase 6.20 (TASK 3) ROOT CAUSE FIX - one line, and it is THE bug.
  //   Previously: `return new Blob([res])`.
  //   With `responseType: 'blob'` axios already resolves to a Blob whose `type`
  //   is the response Content-Type (res.download() sets it from the file
  //   extension). The Blob constructor copies BYTES ONLY - the MIME type comes
  //   from its options argument, which was omitted - so the re-wrap produced a
  //   blob with `type: ""`. The object URL built from it was served with no
  //   Content-Type, the browser had nothing to dispatch on, and window.open()
  //   rendered the octets as plain text. That is the "encoded/raw file data"
  //   symptom: a correctly downloaded file, displayed as text because its type
  //   was erased one line before it was opened.
  //
  //   Returning the axios blob unchanged preserves the type end to end. Nothing
  //   is decoded client-side, no second transport is added, and the response is
  //   the same bytes the same route already served.
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

  // Phase 6.20 (TASK 3): preview now opens the SHARED viewer in the SHARED
  // Modal instead of window.open()-ing a blob URL in a bare tab. Besides fixing
  // the raw-data symptom, this is what makes .txt render as formatted text and
  // unsupported types fall back to an explanatory message with the Download
  // action still on the footer, rather than dumping bytes at the user. The
  // bytes themselves still come from `fetchBlob` - the existing authenticated
  // download route - so storage, RBAC and metadata are untouched.
  const onPreview = (d) => setPreviewDoc(d)

  if (!projectId) return null

  return (
    <Card>
      {/* -----------------------------------------------------------------
          Phase 6.10 (TASK 5) - "Add an Upload Document button".

          ROOT CAUSE (two real defects, not a missing feature):
           1. WRONG PROP NAME. This header passed `actions={...}` (plural), but
              CardHeader's signature is ({ title, subtitle, action, icon,
              className }) - SINGULAR. React silently ignored the unknown prop,
              so the Select and the upload control were never rendered at all.
              PageHeader is the component that takes `actions` (plural); the two
              were confused. The upload pipeline underneath (mutation, FormData,
              multer route, invalidation) has always been present and correct -
              only its trigger was invisible, which is why the tab looked
              read-only.
           2. INVALID BUTTON USAGE. `<Button as="span">` had no effect either:
              Button always renders a `motion.button` and has no `as` prop, so
              `as` fell through to the DOM as an unknown attribute and the markup
              was a <button> nested inside a <label> - invalid HTML whose click
              would not reliably reach the file input even had it rendered.

          FIX: pass `action` (the prop that exists) and open the file dialog via
          a ref, which removes the label/button nesting entirely. No new upload
          code, no second document module - the existing mutation is simply
          reachable now.
          ----------------------------------------------------------------- */}
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
            // Ownership rule preserved exactly as the server enforces it in
            // clientController.deleteDocument (`doc.uploadedBy !== req.user.name`
            // -> 403). Hiding the button is a UX affordance only; the server is
            // still the authority, so RBAC is not weakened by rendering.
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
                {/* -------------------------------------------------------
                    Phase 6.20 (TASK 2): the three hand-rolled <button>s that
                    stood here are replaced by the SHARED Dropdown/DropdownItem
                    pair (components/ui/Dropdown.jsx) already used by the
                    Navbar, ExportMenu, admin/Users and the File Manager. They
                    were never a menu at all - they were inline buttons in a
                    `flex-wrap` row, so on a narrow column the third action
                    wrapped or was pushed out of the card. Using the shared menu
                    (now content-sized, viewport-capped and z-50) gives the
                    required "width fits content / never clipped / responsive"
                    behaviour without a second dropdown implementation.

                    The handlers are unchanged: same onPreview, same onDownload,
                    same deleteMut, same ownership rule.
                    ------------------------------------------------------- */}
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

      {/* -----------------------------------------------------------------
          Phase 6.20 (TASK 3): the SHARED Modal + the SHARED FilePreview. No
          new modal, no second viewer, and no new transport - `getBlob` hands
          the viewer this component's existing authenticated download call, so
          PDF -> embedded viewer, PNG/JPG/WebP -> image, TXT/CSV -> formatted
          text, DOCX -> the existing mammoth strategy, anything else -> the
          graceful fallback, all from the one renderer.

          Document metadata is preserved and shown alongside the render, and
          Download stays exactly as it was (same onDownload, same route, same
          filename) - it is simply also reachable from the footer here.
          ----------------------------------------------------------------- */}
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
