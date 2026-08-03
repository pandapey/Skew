import { useEffect, useState } from 'react'
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
// Phase 6.14 (TASK 3): the shared field renderer. It owns the password /
// select / textarea / multiselect / input branches (and therefore the REUSED
// PasswordField + PasswordStrength pair), so this file no longer imports them
// directly. One renderer, used by this component and by Client Details.
import { EntityFormFields } from './EntityFormFields'
import { useDebounce } from '@/hooks/useDebounce'
import { useAuth } from '@/hooks/useAuth'
import { HR_WRITE_ROLES } from './constants'

// Generic CRUD manager reused by every HR entity page.
// Config:
//  api        — { query, create, update, remove } (hrApi.<entity>)
//  queryKey   — react-query key base
//  columns    — DataTable columns (without the actions column)
//  fields     — [{ name, label, type, options, full, ... }] for the form
//  schema     — zod schema
//  filters    — [{ name, label, options }] select filters
//  exportColumns, filename, title, subtitle, defaultValues
export function EntityManager({
  title, subtitle, api, queryKey, columns, fields, schema, filters = [],
  exportColumns, filename, defaultValues = {}, addLabel = 'Add', renderExtra,
  // Phase 5.7 (Task 2): optional override for the Add action. When supplied the
  // built-in create modal is bypassed entirely, which lets a module redirect
  // creation elsewhere without forking this component. Omitted everywhere else,
  // so existing callers are unaffected.
  onAdd,
  // Phase 6.6 (TASK 3): deep-link support so another screen can send the user
  // straight into THIS create modal instead of building its own form.
  //   autoOpenAdd — when true, the built-in create modal opens on mount.
  //   onCreated   — called with (serverResponse, submittedValues) after a
  //                 successful CREATE only (never on update), which is how the
  //                 caller knows to navigate back and hand over the new record.
  // Both are optional and omitted by every existing caller, so no current
  // behaviour changes.
  autoOpenAdd = false, onCreated,
  // Phase 6.14 (TASK 2): async option sets for `type: 'multiselect'` fields,
  // keyed by field name -> { options, loading }. Passed in as a PROP rather
  // than fetched here because the option source differs per caller, and because
  // fetching inside the renderer's fields loop would call a hook from a loop -
  // the exact Rules-of-Hooks violation an earlier phase had to fix. The caller
  // owns the query; this component only forwards it.
  fieldOptions = {},
  // Phase 6.14 (TASK 2): an optional schema used ONLY while editing. Some create
  // forms legitimately require fields that do not exist on an update (the
  // Clients form now also collects an initial Project, all createOnly).
  // Validating an edit against the create schema would fail on those absent
  // fields and silently block Save. Defaults to `schema`, so every existing
  // caller validates exactly as before.
  editSchema,
  headerActions, writeRoles = HR_WRITE_ROLES,
}) {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canWrite = hasRole(writeRoles)

  // Phase 5.7 (Task 7): persist search / filter / page so the Back button
  // restores exactly what the user was looking at.
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
  // Mongo returns `_id`; alias to `id` so edit/delete (keyed on `id`) resolve.
  const rows = (data?.data ?? []).map((r) => ({ ...r, id: r.id || r._id }))
  const invalidate = () => qc.invalidateQueries({ queryKey: [queryKey] })

  // Phase 6.14 (TASK 2): the active schema follows the mode. `editing` is state,
  // so toggling modes re-renders and the resolver is rebuilt with the right one.
  const activeSchema = (editing && editSchema) ? editSchema : schema
  const form = useForm({ resolver: activeSchema ? zodResolver(activeSchema) : undefined, defaultValues })

  const saveMutation = useMutation({
    mutationFn: (values) => (editing ? api.update(editing.id, values) : api.create(values)),
    onSuccess: (res, values) => {
      const wasEditing = !!editing
      toast.success(wasEditing ? `${title} updated` : `${title} added`)
      setModalOpen(false)
      invalidate()
      // Phase 6.6 (TASK 3): notify the caller AFTER the cache is invalidated so
      // that a screen navigated back to (e.g. Projects) already sees the new row
      // in its client list and can auto-select it.
      if (!wasEditing) onCreated?.(res, values)
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not save'),
  })
  const deleteMutation = useMutation({
    mutationFn: (id) => api.remove(id),
    onSuccess: () => { toast.success('Deleted'); setDeleting(null); invalidate() },
    onError: () => toast.error('Delete failed'),
  })

  const openAdd = () => { setEditing(null); form.reset(defaultValues); setModalOpen(true) }

  // Phase 6.6 (TASK 3): honour the deep link once, and only for users who are
  // actually allowed to write. RBAC is NOT bypassed - a role without write
  // permission simply lands on the list, exactly as if it had typed the URL.
  useEffect(() => {
    if (!autoOpenAdd || !canWrite) return
    setEditing(null)
    form.reset(defaultValues)
    setModalOpen(true)
  }, [autoOpenAdd, canWrite]) // eslint-disable-line react-hooks/exhaustive-deps
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
          {/* Phase 6.14 (TASK 3): the field renderer that used to be inline here
              now lives in EntityFormFields, so the Client Details page can reuse
              the exact same inputs and validation instead of a second form.
              Same components, same order, same classes - only the location moved. */}
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
