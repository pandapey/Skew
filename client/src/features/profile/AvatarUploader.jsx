import { useRef, useState } from 'react'
import { FiCamera, FiUpload, FiX, FiTrash2 } from 'react-icons/fi'
import toast from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { authService } from '@/api/services'
import { Avatar, Button } from '@/components/ui'

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp']
const MAX_BYTES = 5 * 1024 * 1024

export function AvatarUploader({ name, size = 96, className = '' }) {
  const { user, patchUser } = useAuth()
  const fileRef = useRef(null)
  const [preview, setPreview] = useState(null)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)

  const pickFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!ACCEPTED.includes(file.type)) {
      toast.error('Please choose a PNG, JPG, JPEG or WEBP image.')
      return
    }
    if (file.size > MAX_BYTES) {
      toast.error('Image must be 5MB or smaller.')
      return
    }
    setPreview({ url: URL.createObjectURL(file), file })
  }

  const cancelPreview = () => {
    if (preview?.url) URL.revokeObjectURL(preview.url)
    setPreview(null)
  }

  const savePicture = async () => {
    if (!preview?.file) return
    setSaving(true)
    try {
      const res = await authService.uploadAvatar(preview.file)
      patchUser({ avatar: res.avatar })
      cancelPreview()
      toast.success('Profile picture updated')
    } catch (err) {
      const status = err?.response?.status
      const serverMsg = err?.response?.data?.message
      if (!err?.response) {
        // CORS blocked, backend down, or 60s timeout (Drive cold-start).
        // err.message is "Network Error" / "timeout of 60000ms exceeded".
        toast.error(
          err?.code === 'ECONNABORTED' || /timeout/i.test(err?.message || '')
            ? 'Upload timed out — file may be large or server is slow. Try again.'
            : 'Network error — cannot reach API. Check VITE_API_BASE_URL and backend CORS (CLIENT_URL).'
        )
      } else if (status === 413 || /too large|file size/i.test(serverMsg || '')) {
        toast.error('Image is too large (max 5MB).')
      } else {
        toast.error(serverMsg || 'Could not upload picture')
      }
    } finally {
      setSaving(false)
    }
  }

  const removePicture = async () => {
    setRemoving(true)
    try {
      await authService.deleteAvatar()
      patchUser({ avatar: '' })
      toast.success('Profile picture removed')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not remove picture')
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className={className}>
      <div className="relative w-fit">
        <Avatar
          name={name || user?.name}
          src={preview?.url || user?.avatar}
          size={size}
          className="ring-4 ring-[var(--surface)]"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white shadow-floating-sm transition hover:brightness-110"
          aria-label="Change profile picture"
        >
          <FiCamera className="h-4 w-4" />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={pickFile}
        />
      </div>

      {preview ? (
        <>
          <div className="mt-3 flex gap-2">
            <Button variant="ghost" size="sm" icon={FiX} onClick={cancelPreview}>Cancel</Button>
            <Button size="sm" icon={FiUpload} loading={saving} onClick={savePicture}>Save Picture</Button>
          </div>
          <p className="mt-2 text-xs text-muted">
            Preview shown above — click “Save Picture” to upload. Allowed: PNG, JPG, JPEG, WEBP · max 5MB.
          </p>
        </>
      ) : user?.avatar ? (
        <div className="mt-3">
          <Button variant="ghost" size="sm" icon={FiTrash2} loading={removing} onClick={removePicture}>
            Remove Picture
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export default AvatarUploader
