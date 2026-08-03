import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FiFileText, FiDownload, FiCheck, FiX } from 'react-icons/fi'
import { hrApi } from '@/api/services'
import { EntityManager } from '@/features/hr/EntityManager'
import { Badge, Button } from '@/components/ui'
import { offerSchema } from '@/features/hr/schemas'
import { DEPARTMENTS, OFFER_STATUS, HR_WRITE_ROLES } from '@/features/hr/constants'
import { formatCurrency, formatDate } from '@/utils'
import { exportToPdf } from '@/utils/export'
import { COMPANY_NAME } from '@/constants'

// Generate an offer-letter PDF for a candidate.
function downloadOffer(o) {
  exportToPdf(
    `offer-letter-${o.candidate.replace(/\s/g, '-')}.pdf`,
    [
      { k: 'Candidate', v: o.candidate },
      { k: 'Position', v: o.position },
      { k: 'Department', v: o.department },
      { k: 'Annual CTC', v: formatCurrency(o.ctc) },
      { k: 'Joining Date', v: formatDate(o.joiningDate) },
      { k: 'Status', v: o.status },
    ],
    [{ header: 'Field', accessor: 'k' }, { header: 'Details', accessor: 'v' }],
    { title: `Offer Letter — ${o.candidate}`, subtitle: COMPANY_NAME }
  )
  toast.success('Offer letter downloaded')
}

export default function Offers() {
  const qc = useQueryClient()
  const setStatus = useMutation({
    mutationFn: ({ id, status }) => hrApi.offers.update(id, { status }),
    onSuccess: (_r, v) => { toast.success(`Offer ${v.status.toLowerCase()}`); qc.invalidateQueries({ queryKey: ['hr-offers'] }) },
  })

  const columns = [
    { key: 'candidate', header: 'Candidate', render: (r) => <span className="font-medium">{r.candidate}</span> },
    { key: 'position', header: 'Position' },
    { key: 'department', header: 'Department' },
    { key: 'ctc', header: 'CTC', render: (r) => formatCurrency(r.ctc) },
    { key: 'joiningDate', header: 'Joining', render: (r) => formatDate(r.joiningDate) },
    { key: 'status', header: 'Status', render: (r) => <Badge>{r.status}</Badge> },
    { key: '_offer', header: '', className: 'text-right', render: (r) => (
      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => downloadOffer(r)} className="rounded-lg p-2 hover:bg-primary/10 hover:text-primary" title="Download offer letter"><FiDownload /></button>
        {r.status !== 'Accepted' && <button onClick={() => setStatus.mutate({ id: r.id, status: 'Accepted' })} className="rounded-lg p-2 text-success hover:bg-success/10" title="Mark accepted"><FiCheck /></button>}
        {r.status !== 'Declined' && <button onClick={() => setStatus.mutate({ id: r.id, status: 'Declined' })} className="rounded-lg p-2 text-danger hover:bg-danger/10" title="Mark declined"><FiX /></button>}
      </div>
    ) },
  ]

  return (
    <EntityManager
      title="Offer Letters"
      // Phase 5.9 (Task 7): explicit instead of relying on EntityManager's
      // implicit HR_WRITE_ROLES default. Same effective permission.
      writeRoles={HR_WRITE_ROLES}
      subtitle="Generate, send and track candidate offers."
      addLabel="Create Offer"
      api={hrApi.offers}
      queryKey="hr-offers"
      columns={columns}
      schema={offerSchema}
      defaultValues={{ candidate: '', position: '', department: 'Engineering', ctc: 600000, joiningDate: '', status: 'Pending' }}
      filters={[{ name: 'status', label: 'All Status', options: OFFER_STATUS }]}
      fields={[
        { name: 'candidate', label: 'Candidate' },
        { name: 'position', label: 'Position' },
        { name: 'department', label: 'Department', type: 'select', options: DEPARTMENTS },
        { name: 'ctc', label: 'Annual CTC (₹)', type: 'number' },
        { name: 'joiningDate', label: 'Joining Date', type: 'date' },
        { name: 'status', label: 'Status', type: 'select', options: OFFER_STATUS },
      ]}
      exportColumns={[
        { header: 'Candidate', accessor: 'candidate' }, { header: 'Position', accessor: 'position' },
        { header: 'CTC', accessor: (r) => formatCurrency(r.ctc) }, { header: 'Joining', accessor: 'joiningDate' }, { header: 'Status', accessor: 'status' },
      ]}
      filename="offer-letters"
    />
  )
}
