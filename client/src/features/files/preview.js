import { fileService } from '@/api/services'

export async function fetchFileBlob(id) {
  const res = await fileService.download(id)
  if (res && res instanceof Blob && res.size > 0) return res
  if (res && res instanceof Blob) return res // empty blob is still binary
  return null
}

// Excel / CSV → one HTML table per worksheet (SheetJS renders the markup).
export async function parseExcel(blob) {
  const XLSX = await import('xlsx')
  const buf = await blob.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  return wb.SheetNames.map((name, i) => ({
    name,
    active: i === 0,
    html: XLSX.utils.sheet_to_html(wb.Sheets[name], { editable: false }),
  }))
}

// Word (.docx) → HTML via mammoth.
export async function parseWord(blob) {
  const mammoth = await import('mammoth')
  const arrayBuffer = await blob.arrayBuffer()
  const { value } = await mammoth.convertToHtml({ arrayBuffer })
  return value
}

// Plain-text-ish files rendered as monospaced text.
export async function parseText(blob) {
  return blob.text()
}

// Decide how a Word-family file should be previewed.
export function wordStrategy(name = '') {
  const lower = name.toLowerCase()
  if (['.txt', '.csv', '.tsv', '.md', '.json', '.log', '.yml', '.yaml'].some((e) => lower.endsWith(e))) return 'text'
  if (lower.endsWith('.docx')) return 'docx'
  return 'fallback' // .doc (legacy OLE) and everything else
}

// Which types can be rendered inline once binary is available.
export function isRenderable(type) {
  return ['image', 'video', 'pdf', 'excel', 'word'].includes(type)
}
