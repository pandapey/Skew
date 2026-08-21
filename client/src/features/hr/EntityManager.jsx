import { useState } from 'react'
import { useViewState } from '@/hooks/useViewState'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FiPlus, FiEdit2, FiTrash2 } from 'react-icons/fi'
import {
  PageHeader, Card, Button, DataTable, Pagination, SearchInput, Select,
  Modal, ConfirmDialog,
} from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { EntityFormFields } from './EntityFormFields'
import { useDebounce } from '@/hooks/useDebounce'
import { useAuth } from '@/hooks/useAuth'
import { HR_WRITE_ROLES } from './constants'

export function EntityManager({
  title, subtitle, api, queryKey, columns, fields, schema, filters = [],
  exportColumns, filename, defaultValues = {}, addLabel = 'Add', renderExtra,
  onAdd,
  fieldOptions = {},
  editSchema,
  headerActions, writeRoles = HR_WRITE_ROLES,
}) {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canWrite = hasRole(writeRoles)

  const [params, , , setParams] = useViewState('params', { search: '', sortBy: '', order: 'asc', page: 1, limit: 8 })
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)

  const debounced = useDebounce(params.search)
  const queryParams = { ...params, search: debounced }

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [queryKey, queryParams],
    queryFn: () => api.query(queryParams),
    placeholderData: keepPreviousData,
  })
  const rows = (data?.data ?? []).map((r) => ({ ...r, id: r.id || r._id }))
  const invalidate = () => qc.invalidateQueries({ queryKey: [queryKey] })

  const activeSchema = (editing && editSchema) ? editSchema : schema
  const form = useForm({ resolver: activeSchema ? zodResolver(activeSchema) : undefined, defaultValues })

  const saveMutation = useMutation({
    mutationFn: (values) => (editing ? api.update(editing.id, values) : api.create(values)),
    onSuccess: () => {
      toast.success(editing ? `${title} updated` : `${title} added`)
      setModalOpen(false)
      invalidate()
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not save'),
  })
  const deleteMutation = useMutation({
    mutationFn: (id) => api.remove(id),
    onSuccess: () => { toast.success('Deleted'); setDeleting(null); invalidate() },
    onError: () => toast.error('Delete failed'),
  })

  const openAdd = () => { setEditing(null); form.reset(defaultValues); setModalOpen(true) }

  const openEdit = (row) => { setEditing(row); form.reset({ ...defaultValues, ...row }); setModalOpen(true) }

  const setParam = (patch) => setParams((p) => ({ ...p, ...patch, page: 1 }))

  const actionCol = {
    key: '_actions', header: '', className: 'text-right',
    render: (r) => (
      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {canWrite && <button className="rounded-lg p-2 hover:bg-primary/10 hover:text-primary" onClick={() => openEdit(r)} aria-label="Edit"><FiEdit2 /></button>}
        {canWrite && <button className="rounded-lg p-2 hover:bg-danger/10 hover:text-danger" onClick={() => setDeleting(r)} aria-label="Delete"><FiTrash2 /></button>}
      </div>
    ),
  }

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            {headerActions}
            {exportColumns && <ExportMenu rows={rows} columns={exportColumns} filename={filename} title={title} subtitle={subtitle} />}
            {canWrite && <Button icon={FiPlus} onClick={onAdd || openAdd}>{addLabel}</Button>}
          </>
        }
      />

      {renderExtra}

      <Card>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchInput value={params.search} onChange={(v) => setParam({ search: v })} className="lg:max-w-xs" />
          {filters.map((f) => (
            <Select
              key={f.name}
              className="lg:w-44"
              value={params[f.name] || ''}
              onChange={(e) => setParam({ [f.name]: e.target.value })}
              options={[{ value: '', label: f.label }, ...f.options.map((o) => ({ value: o, label: o }))]}
            />
          ))}
          <span className="text-sm text-muted lg:ml-auto">{data?.total || 0} records</span>
        </div>

        <div className="relative">
          {isFetching && !isLoading && <div className="absolute right-2 top-2 z-10"><span className="block h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" /></div>}
          <DataTable columns={canWrite ? [...columns, actionCol] : columns} data={rows} loading={isLoading} empty={`No ${title.toLowerCase()} found`} />
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted">Page {data?.page || 1} of {data?.totalPages || 1}</p>
          <Pagination page={params.page} totalPages={data?.totalPages || 1} onChange={(p) => setParams((prev) => ({ ...prev, page: p }))} />
        </div>
      </Card>

      {/* Add / Edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`${editing ? 'Edit' : addLabel} ${title.replace(/s$/, '')}`}
        size="lg"
        footer={<><Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button><Button loading={saveMutation.isPending} onClick={form.handleSubmit((v) => saveMutation.mutate(v))}>{editing ? 'Save' : addLabel}</Button></>}
      >
        <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <EntityFormFields form={form} fields={fields} editing={editing} fieldOptions={fieldOptions} />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleteMutation.mutate(deleting.id)}
        title={`Delete ${title.replace(/s$/, '')}?`}
        message="This action cannot be undone."
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
