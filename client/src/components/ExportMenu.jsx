import { FiDownload, FiFileText, FiFile, FiGrid } from 'react-icons/fi'
import { Dropdown, DropdownItem } from '@/components/ui'
import { exportToCsv, exportToExcel, exportToPdf } from '@/utils/export'

// Reusable export dropdown (CSV / Excel / PDF) driven by a column spec.
// columns: [{ header, accessor }] — accessor is a key or (row) => value.
export function ExportMenu({ rows, columns, filename = 'export', title = 'Report', subtitle }) {
  const disabled = !rows?.length
  return (
    <Dropdown
      trigger={
        <span className={`btn-ghost ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
          <FiDownload className="h-4 w-4" /> Export
        </span>
      }
    >
      <DropdownItem icon={FiFile} onClick={() => exportToCsv(`${filename}.csv`, rows, columns)}>Export CSV</DropdownItem>
      <DropdownItem icon={FiGrid} onClick={() => exportToExcel(`${filename}.xlsx`, rows, columns)}>Export Excel</DropdownItem>
      <DropdownItem icon={FiFileText} onClick={() => exportToPdf(`${filename}.pdf`, rows, columns, { title, subtitle })}>Export PDF</DropdownItem>
    </Dropdown>
  )
}
