import { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { FiUpload, FiX } from 'react-icons/fi'
import { Avatar, Button } from '@/components/ui'

// Profile image uploader with type/size validation + preview.
// Shared by the Admin Users form and the Employee form.
export function ProfileImageField({ value, onChange }) {
  const [preview, setPreview] = useState(value)
  const fileRef = useRef(null)

  useEffect(() => setPreview(value), [value])

  const onFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('Use a JPG, PNG or WEBP image')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Image must be under 2 MB')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setPreview(reader.result)
      onChange(reader.result)
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar name="" src={preview || undefined} size={56} ring={false} />
      <div className="flex flex-wrap gap-2">
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onFile} />
        <Button type="button" variant="ghost" size="sm" icon={FiUpload} onClick={() => fileRef.current?.click()}>
          Upload
        </Button>
        {preview && (
          <Button type="button" variant="ghost" size="sm" icon={FiX} onClick={() => { setPreview(undefined); onChange('') }}>
            Remove
          </Button>
        )}
      </div>
      <p className="text-xs text-muted">JPG, PNG or WEBP · max 2 MB</p>
    </div>
  )
}
