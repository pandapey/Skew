import { FiImage, FiVideo, FiFileText, FiFile, FiFolder, FiLock, FiUsers, FiGlobe } from 'react-icons/fi'

export const FILE_TYPE_ICON = {
  folder: FiFolder, image: FiImage, video: FiVideo, pdf: FiFileText,
  excel: FiFile, word: FiFileText, other: FiFile,
}
export const FILE_TYPE_TONE = {
  folder: 'text-warning', image: 'text-accent', video: 'text-primary',
  pdf: 'text-danger', excel: 'text-success', word: 'text-blue-500', other: 'text-muted',
}
export const FILE_TYPE_LABEL = {
  image: 'Image', video: 'Video', pdf: 'PDF', excel: 'Excel', word: 'Word', other: 'File',
}

export const PREVIEWABLE = { image: true, video: true, pdf: true }

export const PERMISSION_META = {
  private: { label: 'Private', icon: FiLock, tone: 'default' },
  team: { label: 'Team', icon: FiUsers, tone: 'primary' },
  public: { label: 'Public', icon: FiGlobe, tone: 'success' },
}
export const PERMISSIONS = ['private', 'team', 'public']

export function detectType(file) {
  const name = file?.name || ''
  const mime = file?.type || ''
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) return 'pdf'
  if (/\.(xlsx?|csv)$/i.test(name) || mime.includes('excel') || mime.includes('spreadsheet')) return 'excel'
  if (/\.(docx?|txt|rtf)$/i.test(name) || mime.includes('word') || mime.includes('document') || mime.includes('text/')) return 'word'
  return 'other'
}
export function fileUrl(url) {
  if (!url || typeof url !== 'string') return url
  if (/^(https?:|data:|blob:)/i.test(url)) return url
  if (url.startsWith('/uploads') || url.startsWith('/chat-uploads') || url.startsWith('/profile-uploads')) {
    const base = (import.meta.env.VITE_API_BASE_URL || 'https://skew-server-317n.onrender.com/api').replace(/\/api$/, '')
    return `${base}${url}`
  }
  if (/^[a-zA-Z0-9_-]{20,}$/.test(url) && !url.includes('.')) {
    return `https://drive.google.com/uc?export=view&id=${url}`
  }
  const base = (import.meta.env.VITE_API_BASE_URL || 'https://skew-server-317n.onrender.com/api').replace(/\/api$/, '')
  return `${base}${url}`
}
