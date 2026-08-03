// Client-side export helpers: CSV (no dep), Excel (xlsx), PDF (jspdf + autotable).
import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

export function exportToCsv(filename, rows, columns) {
  if (!rows?.length) return
  let headers, body
  if (columns) {
    const m = toMatrix(rows, columns)
    headers = m.headers
    body = m.body
  } else {
    headers = Object.keys(rows[0]).filter((k) => typeof rows[0][k] !== 'object')
    body = rows.map((row) => headers.map((h) => String(row[h] ?? '')))
  }
  const escape = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`
  const csv = [
    headers.join(','),
    ...body.map((row) => row.map(escape).join(',')),
  ].join('\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

// Map an array of records to rows using a column spec: [{ header, accessor }].
// accessor is a key string or a (row) => value function.
const toMatrix = (rows, columns) => {
  const headers = columns.map((c) => c.header)
  const body = rows.map((row) =>
    columns.map((c) => {
      const val = typeof c.accessor === 'function' ? c.accessor(row) : row[c.accessor]
      return val ?? ''
    })
  )
  return { headers, body }
}

// Excel export via SheetJS. `columns` optional; falls back to flat keys.
export function exportToExcel(filename, rows, columns, sheetName = 'Sheet1') {
  if (!rows?.length) return
  let worksheet
  if (columns) {
    const { headers, body } = toMatrix(rows, columns)
    worksheet = XLSX.utils.aoa_to_sheet([headers, ...body])
  } else {
    worksheet = XLSX.utils.json_to_sheet(rows)
  }
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
  XLSX.writeFile(workbook, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`)
}

// PDF export via jsPDF + autotable, with a branded header.
export function exportToPdf(filename, rows, columns, { title = 'Report', subtitle } = {}) {
  if (!rows?.length) return
  const doc = new jsPDF({ orientation: 'landscape' })
  const { headers, body } = toMatrix(rows, columns)

  // Branded header band
  doc.setFillColor(37, 99, 235) // #2563EB
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 22, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(14)
  doc.text('Skew Infotech Pvt. Ltd.', 14, 10)
  doc.setFontSize(10)
  doc.text(title, 14, 17)
  if (subtitle) {
    doc.setTextColor(120)
    doc.setFontSize(9)
    doc.text(subtitle, doc.internal.pageSize.getWidth() - 14, 17, { align: 'right' })
  }

  autoTable(doc, {
    head: [headers],
    body,
    startY: 28,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  })

  doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`)
}

const fmt = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0)
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')

// Branded, printable invoice document (download). Mirrors the on-screen invoice view.
export function exportInvoicePdf(invoice) {
  if (!invoice) return
  const doc = new jsPDF({ orientation: 'portrait' })
  const W = doc.internal.pageSize.getWidth()

  // Header band
  doc.setFillColor(37, 99, 235)
  doc.rect(0, 0, W, 26, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(16)
  doc.text('Skew Infotech Pvt. Ltd.', 14, 12)
  doc.setFontSize(9)
  doc.text('Enterprise Office Management — Invoice', 14, 19)
  doc.setTextColor(120)
  doc.text(`# ${invoice.invoiceNumber}`, W - 14, 19, { align: 'right' })

  // Party + dates
  doc.setTextColor(30)
  doc.setFontSize(11)
  doc.text('Bill To:', 14, 40)
  doc.setFontSize(12)
  doc.text(invoice.client || '—', 14, 47)
  if (invoice.clientEmail) {
    doc.setFontSize(9)
    doc.setTextColor(120)
    doc.text(invoice.clientEmail, 14, 53)
  }

  doc.setTextColor(30)
  doc.setFontSize(10)
  doc.text('Issue Date', W - 90, 40)
  doc.text('Due Date', W - 90, 50)
  doc.text('Status', W - 90, 60)
  doc.setTextColor(80)
  doc.setFontSize(10)
  doc.text(day(invoice.issueDate), W - 14, 40, { align: 'right' })
  doc.text(day(invoice.dueDate), W - 14, 50, { align: 'right' })
  doc.text(invoice.status || 'Draft', W - 14, 60, { align: 'right' })

  // Line items
  autoTable(doc, {
    startY: 72,
    head: [['#', 'Description', 'Qty', 'Rate', 'Amount']],
    body: (invoice.items || []).map((it, i) => [
      i + 1, it.description || '—', it.quantity, fmt(it.rate), fmt((it.quantity || 0) * (it.rate || 0)),
    ]),
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { cellWidth: 12 }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  })

  // Totals block (right aligned)
  const after = doc.lastAutoTable.finalY + 10
  const right = W - 14
  doc.text('Subtotal', W - 90, after)
  doc.text(fmt(invoice.subtotal), right, after, { align: 'right' })
  const y1 = after + 7
  doc.setTextColor(90); doc.setFont(undefined, 'normal')
  doc.text(`Tax (${invoice.taxRate || 0}%)`, W - 90, y1)
  doc.text(fmt(invoice.tax), right, y1, { align: 'right' })
  const y2 = y1 + 7
  doc.setFont(undefined, 'bold'); doc.setFontSize(12); doc.setTextColor(15)
  doc.text('Total', W - 90, y2)
  doc.text(fmt(invoice.total), right, y2, { align: 'right' })
  const y3 = y2 + 7
  doc.setFont(undefined, 'normal'); doc.setFontSize(10); doc.setTextColor(90)
  doc.text('Paid', W - 90, y3)
  doc.text(fmt(invoice.amountPaid || 0), right, y3, { align: 'right' })
  const y4 = y3 + 7
  doc.setFont(undefined, 'bold'); doc.setFontSize(11)
  doc.setTextColor(invoice.total - (invoice.amountPaid || 0) > 0 ? '#B91C1C' : '#047857')
  doc.text('Balance Due', W - 90, y4)
  doc.text(fmt(Math.max(0, (invoice.total || 0) - (invoice.amountPaid || 0))), right, y4, { align: 'right' })

  if (invoice.notes) {
    doc.setFont(undefined, 'normal'); doc.setFontSize(9); doc.setTextColor(120)
    doc.text(`Notes: ${invoice.notes}`, 14, y4 + 14)
  }

  doc.setFontSize(8)
  doc.setTextColor(150)
  doc.text('Generated by Skew Enterprise Hub', 14, doc.internal.pageSize.getHeight() - 12)

  doc.save(`${invoice.invoiceNumber}.pdf`)
}
