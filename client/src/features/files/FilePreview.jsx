// =============================================================================
// Phase 6.20 (TASK 3) — THE ONE DOCUMENT VIEWER
//
// ROOT CAUSE of "Preview displays encoded/raw file data instead of the actual
// uploaded document" on Client Project -> Documents:
//
//   features/client/ProjectDocuments.jsx fetched the bytes correctly through
//   the existing authenticated download route, then threw the only thing that
//   makes a blob renderable away:
//
//       const res = await apiClient.get(url, { responseType: 'blob' })
//       return new Blob([res])          // <-- the defect
//
//   With `responseType: 'blob'`, axios already resolves to a real Blob whose
//   `type` is the response's Content-Type (res.download() sets it from the
//   file extension via mime lookup). Re-wrapping it as `new Blob([res])`
//   produces a NEW blob with `type: ""`, because the Blob constructor only
//   copies bytes - the MIME type comes from its (omitted) options argument.
//
//   `URL.createObjectURL()` on a typeless blob yields a `blob:` URL the browser
//   serves with no Content-Type, so `window.open()` had nothing to dispatch on
//   and fell back to rendering the octets as plain text. That is the "encoded /
//   raw file data" the user sees: a correctly downloaded PDF/PNG, displayed as
//   text because its type was erased one line before it was opened.
//
//   So this was never an encoding, storage or upload problem - nothing is
//   base64 anywhere, the file on disk is byte-identical to what was uploaded,
//   and the Download button (which passes `a.download = d.name`, so the browser
//   never needs the MIME type) has always worked for exactly that reason.
//
// WHY THIS FILE EXISTS AND IS NOT A SECOND VIEWER:
//   pages/Files.jsx already owned a complete, working renderer - image / video
//   / pdf inline, Excel + Word + text parsed through features/files/preview.js,
//   graceful fallback otherwise. Fixing the blob in ProjectDocuments alone
//   would have left the client portal opening documents in a bare browser tab
//   while the staff File Manager rendered them in-app, and any attempt to give
//   the client portal the same experience would have meant a second viewer -
//   explicitly forbidden.
//
//   The renderer is therefore MOVED here verbatim (same parsers, same states,
//   same markup, same fallback copy) and both surfaces now consume it.
//   pages/Files.jsx no longer defines a preview renderer of its own. There is
//   exactly one document viewer in the codebase.
//
// TRANSPORT IS INJECTED, NOT DUPLICATED:
//   The two portals reach the same bytes through different RBAC-scoped doors -
//   /files/:id/download for staff, /client/projects/:id/documents/:docId/download
//   for clients. That single difference is a `getBlob` prop, mirroring the
//   `api` prop ProjectDocuments already uses for its list/upload/delete calls
//   (Phase 6.12 TASK 1). No new endpoint, service, storage location or upload
//   pipeline is introduced, and RBAC is untouched: whichever door the caller
//   passes in is the one the server already guards.
// =============================================================================
import { useEffect, useState } from 'react'
import { FiFile } from 'react-icons/fi'
import { Loader } from '@/components/ui'
import { FILE_TYPE_ICON, FILE_TYPE_TONE } from './constants'
import { parseExcel, parseWord, parseText, wordStrategy } from './preview'
import { cn } from '@/utils'

// Shared glyph for the fallback states (moved here with the renderer so the
// fallback keeps the exact look it had in the File Manager).
export const ItemGlyph = ({ type, className = 'h-6 w-6' }) => {
  const Icon = FILE_TYPE_ICON[type] || FiFile
  return <Icon className={cn(className, FILE_TYPE_TONE[type])} />
}

// Types the browser renders natively from a URL, with no parsing step.
const NATIVE_INLINE = ['image', 'video', 'pdf']

/**
 * The single document renderer.
 *
 * @param name    Real stored file name (drives the .docx/.txt strategy).
 * @param type    Coarse type from features/files/constants.js detectType().
 * @param url     Optional direct URL for natively renderable types. When it is
 *                absent (client documents sit behind JWT `protect`, so a plain
 *                URL would 401) the component falls back to `getBlob` and
 *                builds an object URL from the authenticated bytes.
 * @param getBlob () => Promise<Blob|null>. The caller's EXISTING download call.
 */
export function FilePreview({ name = '', type = 'other', url = null, getBlob }) {
  const [state, setState] = useState({ status: 'loading' })
  const [sheet, setSheet] = useState(0)
  // Object URL for natively-renderable types fetched through an authenticated
  // request. Held in state so it can be revoked on unmount - not revoking is
  // what leaks a whole file's worth of memory per preview.
  const [objectUrl, setObjectUrl] = useState(null)

  useEffect(() => {
    let cancelled = false
    let created = null
    setState({ status: 'loading' })
    setSheet(0)
    setObjectUrl(null)

    const run = async () => {
      try {
        if (NATIVE_INLINE.includes(type)) {
          if (url) return setState({ status: 'native' })
          if (!getBlob) return setState({ status: 'empty' })
          const blob = await getBlob()
          if (!blob) return setState({ status: 'empty' })
          // The blob's own `type` is preserved end to end here - that is the
          // whole point of the root-cause fix - so the browser dispatches the
          // <img>/<video>/<iframe> correctly instead of showing raw octets.
          created = URL.createObjectURL(blob)
          if (cancelled) return
          setObjectUrl(created)
          return setState({ status: 'native' })
        }

        if (type === 'excel') {
          const blob = getBlob ? await getBlob() : null
          if (!blob) return setState({ status: 'empty' })
          const sheets = await parseExcel(blob)
          if (!cancelled) setState({ status: 'excel', sheets })
          return
        }

        if (type === 'word') {
          const strat = wordStrategy(name)
          if (strat === 'fallback') return setState({ status: 'fallback' })
          const blob = getBlob ? await getBlob() : null
          if (!blob) return setState({ status: 'empty' })
          if (strat === 'text') {
            const text = await parseText(blob)
            if (!cancelled) setState({ status: 'text', text })
          } else {
            const html = await parseWord(blob)
            if (!cancelled) setState({ status: 'word', html })
          }
          return
        }

        setState({ status: 'empty' })
      } catch {
        if (!cancelled) setState({ status: 'error' })
      }
    }
    run()

    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, type, url])

  if (state.status === 'loading') {
    return <div className="flex h-[40vh] items-center justify-center"><Loader label="Rendering preview…" /></div>
  }

  if (state.status === 'native') {
    const src = url || objectUrl
    return (
      <div className="flex max-h-[55vh] items-center justify-center overflow-auto rounded-xl border border-app bg-black/5 p-4 dark:bg-white/5">
        {type === 'image' ? <img src={src} alt={name} className="max-h-[50vh] rounded-lg object-contain" />
          : type === 'video' ? <video src={src} controls className="max-h-[50vh] rounded-lg" />
            : <iframe src={src} title={name} className="h-[50vh] w-full rounded-lg" />}
      </div>
    )
  }

  if (state.status === 'excel') {
    const active = state.sheets[sheet] || state.sheets[0]
    return (
      <div className="overflow-hidden rounded-xl border border-app">
        {state.sheets.length > 1 && (
          <div className="flex flex-wrap gap-1 border-b border-app p-2">
            {state.sheets.map((s, i) => (
              <button key={s.name} onClick={() => setSheet(i)}
                className={cn('rounded-lg px-3 py-1 text-xs font-medium', i === sheet ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-black/5 dark:hover:bg-white/10')}>
                {s.name}
              </button>
            ))}
          </div>
        )}
        <div className="max-h-[48vh] overflow-auto p-3">
          <div className="file-preview-table" dangerouslySetInnerHTML={{ __html: active.html }} />
        </div>
      </div>
    )
  }

  if (state.status === 'word') {
    return (
      <div className="max-h-[55vh] overflow-auto rounded-xl border border-app bg-white p-5 dark:bg-zinc-900">
        <div className="file-preview-doc" dangerouslySetInnerHTML={{ __html: state.html }} />
      </div>
    )
  }

  if (state.status === 'text') {
    return (
      <pre className="max-h-[55vh] overflow-auto rounded-xl border border-app bg-black/5 p-4 text-xs leading-relaxed dark:bg-white/5">{state.text}</pre>
    )
  }

  // empty (no binary) · fallback (.doc legacy and other unsupported types) ·
  // error. Never raw bytes - the caller pairs this with its Download action.
  const message = state.status === 'error'
    ? 'Could not render this file. Download to view its contents.'
    : state.status === 'fallback'
      ? 'Live preview is available for .docx, .txt and .csv files. Download to view this document.'
      : 'Live preview is available for uploaded files. Demo files have no binary — download to view contents.'
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <ItemGlyph type={type} className="h-16 w-16" />
      <p className="text-sm text-muted">{message}</p>
    </div>
  )
}

export default FilePreview
