// =============================================================================
// Phase 6.3 (TASK 9) — SHARED PROFILE AVATAR UPLOADER
//
// ROOT CAUSE of the original problem:
//   The staff profile (pages/Profile.jsx) already had a complete, working
//   picture flow: type/size guard -> object-URL preview -> authService
//   .uploadAvatar -> patchUser({ avatar }) so Redux (and therefore the Navbar)
//   updated instantly, with the value persisted on User.avatar so it survived a
//   refresh.
//   The CLIENT profile (features/client/ClientProfile.jsx) rendered a bare
//   `<Avatar name={profile.contactPerson} size={80} />` — a plain read-only
//   display with no <input type="file">, no handler and no mutation. So a Client
//   could never set a picture. The backend was never the blocker: POST
//   /auth/me/avatar is mounted behind `protect` only (NOT blockClient), so a
//   Client was always authorised to call it — the UI simply never did.
//
// FIX (this file):
//   The uploader is extracted ONCE from Profile.jsx into this shared component
//   and consumed by BOTH profiles. Per "Do NOT duplicate upload code", the
//   upload path is untouched: it still calls the existing
//   authService.uploadAvatar -> POST /auth/me/avatar -> shared `uploadImage`
//   multer middleware. No second uploader, no new endpoint for upload.
//
// WHY THE NAVBAR UPDATES IMMEDIATELY:
//   `patchUser` writes the new avatar into the Redux auth slice, which is the
//   single source the Navbar/Sidebar/Dashboard read from. Because it is a store
//   update rather than a refetch, every consumer re-renders synchronously. The
//   same value is persisted on the User document, so a refresh rehydrates it.
//
// REUSED: authService.uploadAvatar, useAuth/patchUser, <Avatar/>, <Button/>,
//         react-hot-toast, the existing /uploads static serving.
// NEW (Task 9 only): authService.deleteAvatar -> DELETE /auth/me/avatar, which
//         mirrors the upload route's own `protect`-only guard.
//
// RBAC: both calls derive their target from req.user on the server. No user id
// is sent, so no role can touch another account's picture. Identical guard for
// every role — nothing is weakened.
// =============================================================================
import { useRef, useState } from 'react'
import { FiCamera, FiUpload, FiX, FiTrash2 } from 'react-icons/fi'
import toast from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { authService } from '@/api/services'
import { Avatar, Button } from '@/components/ui'

// Accept only the formats the brief allows (PNG/JPG/JPEG/WEBP). JPG and JPEG
// share the image/jpeg MIME type. Matches the server-side image filter (5MB).
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp']
const MAX_BYTES = 5 * 1024 * 1024

/**
 * @param name  Display name used for the generated initials fallback. The staff
 *              profile passes the user's name; the client profile passes the
 *              contact person, which is what it already displayed.
 * @param size  Avatar diameter in px (staff profile uses 96, client uses 80).
 */
export function AvatarUploader({ name, size = 96, className = '' }) {
  const { user, patchUser } = useAuth()
  const fileRef = useRef(null)
  const [preview, setPreview] = useState(null) // { url, file }
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)

  const pickFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
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
      // Update the Redux user so the Navbar, Dashboard and this page reflect the
      // new picture immediately; the persisted store + saved DB value keep it
      // after a refresh.
      patchUser({ avatar: res.avatar })
      cancelPreview()
      toast.success('Profile picture updated')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not upload picture')
    } finally {
      setSaving(false)
    }
  }

  const removePicture = async () => {
    setRemoving(true)
    try {
      await authService.deleteAvatar()
      // Same instant-propagation mechanism as the upload path: clearing the
      // Redux value makes every consumer fall back to generated initials at
      // once, and the cleared DB field keeps it that way after a refresh.
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
        // Only offered when there is actually a picture to remove, so the
        // control never appears as a no-op.
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
