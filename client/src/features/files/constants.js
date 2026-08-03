import { FiImage, FiVideo, FiFileText, FiFile, FiFolder, FiLock, FiUsers, FiGlobe } from 'react-icons/fi'

// Icon + tone per file type (folders included for tree rendering).
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

// Types the browser can preview inline (others fall back to an icon + download).
export const PREVIEWABLE = { image: true, video: true, pdf: true }

// Permissions: who may see a file.
export const PERMISSION_META = {
  private: { label: 'Private', icon: FiLock, tone: 'default' },
  team: { label: 'Team', icon: FiUsers, tone: 'primary' },
  public: { label: 'Public', icon: FiGlobe, tone: 'success' },
}
export const PERMISSIONS = ['private', 'team', 'public']

// Classify a browser File into a coarse type (mirrors the backend detectType).
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

// Build an absolute URL for a stored file (static /uploads serving).
export function fileUrl(url) {
  if (!url) return null
  const base = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api').replace(/\/api$/, '')
  return `${base}${url}`
}
