// Post editor — create / edit with category, body, tags, pin, location and
// media (images / videos / file attachments). Attachments may be gradient
// placeholders (mock) or real uploaded files (held in `_file` for the backend).
import { useEffect, useState } from 'react'
import { FiX, FiImage, FiFilm, FiPaperclip, FiUpload } from 'react-icons/fi'
import { Modal, Button, Input, Select, Textarea } from '@/components/ui'
import { cn } from '@/utils'
import { POST_TYPES, TYPE_ORDER } from './constants'

const GRADIENTS = [
  'from-blue-500 to-cyan-400', 'from-violet-500 to-fuchsia-500', 'from-amber-500 to-orange-500',
  'from-emerald-500 to-teal-400', 'from-rose-500 to-pink-500', 'from-indigo-500 to-sky-400',
]

let _att = 0
const newAtt = (type) => ({ id: `att-${Date.now()}-${_att++}`, type, name: type === 'image' ? 'Image' : type === 'video' ? 'Video' : 'document.pdf', url: null, size: 0, color: GRADIENTS[_att % GRADIENTS.length] })

export default function PostComposer({ open, onClose, post, currentUser, onSave, onDelete }) {
  const isEdit = Boolean(post)
  const [type, setType] = useState('announcement')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [author, setAuthor] = useState('')
  const [authorRole, setAuthorRole] = useState('')
  const [pinned, setPinned] = useState(false)
  const [tags, setTags] = useState('')
  const [location, setLocation] = useState('')
  const [attachments, setAttachments] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    if (post) {
      setType(post.type)
      setTitle(post.title)
      setBody(post.body)
      setAuthor(post.author)
      setAuthorRole(post.authorRole || '')
      setPinned(Boolean(post.pinned))
      setTags((post.tags || []).join(', '))
      setLocation(post.location || '')
      setAttachments(post.attachments?.map((a) => ({ ...a })) || [])
    } else {
      setType('announcement')
      setTitle('')
      setBody('')
      setAuthor(currentUser?.name || 'You')
      setAuthorRole(currentUser?.role || 'Employee')
      setPinned(false)
      setTags('')
      setLocation('')
      setAttachments([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, post])

  const addPlaceholder = (t) => setAttachments((prev) => [...prev, newAtt(t)])
  const addFile = (e) => {
    const files = Array.from(e.target.files || [])
    const next = files.map((f) => {
      const isImg = f.type.startsWith('image/')
      const isVid = f.type.startsWith('video/')
      return {
        id: `att-${Date.now()}-${_att++}`,
        type: isImg ? 'image' : isVid ? 'video' : 'file',
        name: f.name,
        size: f.size,
        url: URL.createObjectURL(f),
        color: GRADIENTS[_att % GRADIENTS.length],
        _file: f,
      }
    })
    setAttachments((prev) => [...prev, ...next])
    e.target.value = ''
  }
  const removeAtt = (id) => setAttachments((prev) => prev.filter((a) => a.id !== id))

  const handleSave = () => {
    if (!title.trim()) {
      setError('Please enter a title.')
      return
    }
    const payload = {
      type,
      title: title.trim(),
      body: body.trim(),
      author,
      authorRole,
      pinned,
      location: location.trim(),
      tags: tags.split(',').map((s) => s.trim()).filter(Boolean),
      attachments: attachments.map(({ _file, ...rest }) => rest),
    }
    onSave(payload)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Post' : 'New Post'}
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between">
          {isEdit ? (
            <Button variant="ghost" className="text-danger hover:bg-danger/10" icon={FiX} onClick={() => onDelete?.(post.id)}>
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave}>Publish</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Category" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPE_ORDER.map((t) => (
              <option key={t} value={t}>{POST_TYPES[t].singular}</option>
            ))}
          </Select>
          <Input label="Author" value={author} onChange={(e) => setAuthor(e.target.value)} />
        </div>

        <Input
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a headline"
          error={error}
          autoFocus
        />

        <Textarea
          label="Message"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Share the details…"
          rows={5}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Author role" value={authorRole} onChange={(e) => setAuthorRole(e.target.value)} placeholder="e.g. HR Lead" />
          <Input label="Location (events)" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Townhall Hall" />
        </div>

        <Input label="Tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="comma, separated, tags" />

        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-app px-3 py-2 text-sm">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="h-4 w-4" />
          Pin this post
        </label>

        {/* Media */}
        <div>
          <p className="label">Media &amp; Attachments</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => addPlaceholder('image')} className="btn-ghost px-3 py-1.5 text-sm">
              <FiImage className="h-4 w-4" /> Image
            </button>
            <button type="button" onClick={() => addPlaceholder('video')} className="btn-ghost px-3 py-1.5 text-sm">
              <FiFilm className="h-4 w-4" /> Video
            </button>
            <button type="button" onClick={() => addPlaceholder('file')} className="btn-ghost px-3 py-1.5 text-sm">
              <FiPaperclip className="h-4 w-4" /> File
            </button>
            <label className="btn-ghost cursor-pointer px-3 py-1.5 text-sm">
              <FiUpload className="h-4 w-4" /> Upload
              <input type="file" accept="image/*,video/*" multiple className="hidden" onChange={addFile} />
            </label>
          </div>

          {attachments.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {attachments.map((a) => (
                <div key={a.id} className="flex items-center gap-2 rounded-xl border border-app px-2.5 py-1.5 text-xs">
                  <span className={cn('flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br text-white', a.color || 'from-slate-400 to-slate-500')}>
                    {a.type === 'image' ? <FiImage className="h-3 w-3" /> : a.type === 'video' ? <FiFilm className="h-3 w-3" /> : <FiPaperclip className="h-3 w-3" />}
                  </span>
                  <span className="max-w-[120px] truncate">{a.name}</span>
                  <button onClick={() => removeAtt(a.id)} className="text-muted hover:text-danger" aria-label="Remove">
                    <FiX className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
