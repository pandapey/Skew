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

export async function parseWord(blob) {
  const mammoth = await import('mammoth')
  const arrayBuffer = await blob.arrayBuffer()
  const { value } = await mammoth.convertToHtml({ arrayBuffer })
  return value
}

export async function parseText(blob) {
  return blob.text()
}

export function wordStrategy(name = '') {
  const lower = name.toLowerCase()
  if (['.txt', '.csv', '.tsv', '.md', '.json', '.log', '.yml', '.yaml'].some((e) => lower.endsWith(e))) return 'text'
  if (lower.endsWith('.docx')) return 'docx'
  return 'fallback'
}

export function isRenderable(type) {
  return ['image', 'video', 'pdf', 'excel', 'word'].includes(type)
}
