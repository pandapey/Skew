import { useMemo, useState } from 'react'
import { FiPlus, FiEdit2, FiTrash2, FiGrid, FiCheck, FiAlertCircle } from 'react-icons/fi'
import { financeApi } from '@/api/services'
import { PageHeader, Card, Button, DataTable, Modal, ConfirmDialog, Badge, Select, Input } from '@/components/ui'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { categorySchema } from '@/features/finance/schemas'
import { CATEGORY_TYPES, FINANCE_WRITE_ROLES } from '@/features/finance/constants'
import { useAuth } from '@/hooks/useAuth'
import toast from 'react-hot-toast'
import { ExportMenu } from '@/components/ExportMenu'

export default function Categories() {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canWrite = hasRole(FINANCE_WRITE_ROLES)

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['finance-categories'],
    queryFn: () => financeApi.categories.all(),
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['finance-categories'] })
    qc.invalidateQueries({ queryKey: ['fin-transactions'] })
    qc.invalidateQueries({ queryKey: ['fin-cat-all'] })
  }

  const rows = data ?? []

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  const form = useForm({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: '', type: 'Expense', color: '#2563EB', description: '' },
  })

  const saveMutation = useMutation({
    mutationFn: (values) => (editing ? financeApi.categories.update(editing.id, values) : financeApi.categories.create(values)),
    onSuccess: () => {
      toast.success(editing ? 'Category updated' : 'Category added')
      setModalOpen(false)
      invalidate()
    },
    onError: () => toast.error('Could not save category'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => financeApi.categories.remove(id),
    onSuccess: () => {
      toast.success('Deleted')
      setDeleting(null)
      invalidate()
    },
    onError: () => toast.error('Delete failed'),
  })

  const [deleting, setDeleting] = useState(null)

  const openAdd = () => {
    setEditing(null)
    form.reset()
    setModalOpen(true)
  }

  const openEdit = (row) => {
    setEditing(row)
    form.reset(row)
    setModalOpen(true)
  }

  const incomeRows = rows.filter((c) => c.type === 'Income')
  const expenseRows = rows.filter((c) => c.type === 'Expense')

  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'type', header: 'Type', render: (r) => <Badge tone={r.type === 'Income' ? 'success' : 'danger'}>{r.type}</Badge> },
    { key: 'color', header: 'Color', render: (r) => (
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: r.color }} />
        <span className="text-muted text-sm">#{r.color.slice(1)}</span>
      </div>
    ) },
    { key: 'description', header: 'Description', render: (r) => r.description || '—' },
    ...(canWrite ? [{
      key: '_actions',
      header: '',
      className: 'text-right',
      render: (r) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            className="rounded-lg p-2 hover:bg-primary/10 hover:text-primary"
            onClick={() => openEdit(r)}
            aria-label="Edit"
          >
            <FiEdit2 />
          </button>
          <button
            className="rounded-lg p-2 hover:bg-danger/10 hover:text-danger"
            onClick={() => setDeleting(r)}
            aria-label="Delete"
          >
            <FiTrash2 />
          </button>
        </div>
      ),
    }] : []),
  ]

  return (
    <div>
      <PageHeader
        title="Categories"
        subtitle="Manage chart of accounts for income and expense transactions."
        actions={
          <>
            <ExportMenu
              rows={rows}
              filename="categories"
              title="Finance Categories"
              columns={[
                { header: 'Name', accessor: 'name' },
                { header: 'Type', accessor: 'type' },
                { header: 'Color', accessor: 'color' },
                { header: 'Description', accessor: 'description' },
              ]}
            />
            {canWrite && <Button icon={FiPlus} onClick={openAdd}>Add Category</Button>}
          </>
        }
      />

      {/* Summary cards */}
      <div className="mb-4 grid grid-cols-2 gap-4">
        <Card>
          <div className="p-4">
            <p className="text-sm text-muted">Income Categories</p>
            <p className="text-2xl font-bold text-success">{incomeRows.length}</p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-sm text-muted">Expense Categories</p>
            <p className="text-2xl font-bold text-danger">{expenseRows.length}</p>
          </div>
        </Card>
      </div>

      {/* Income categories */}
      <Card className="mb-6">
        <div className="p-4 border-b border-app">
          <h3 className="font-medium text-success flex items-center gap-2">
            <FiCheck className="text-success" /> Income Categories
          </h3>
        </div>
        <div className="p-4">
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-10 bg-app rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <DataTable
              columns={[
                { key: 'name', header: 'Name' },
                { key: 'color', header: 'Color', render: (r) => (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: r.color }} />
                    <span className="text-sm text-muted">#{r.color.slice(1)}</span>
                  </div>
                )},
              ]}
              data={incomeRows}
              empty="No income categories found"
            />
          )}
        </div>
      </Card>

      {/* Expense categories */}
      <Card>
        <div className="p-4 border-b border-app">
          <h3 className="font-medium text-danger flex items-center gap-2">
            <FiAlertCircle className="text-danger" /> Expense Categories
          </h3>
        </div>
        <div className="p-4">
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-10 bg-app rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <DataTable
              columns={[
                { key: 'name', header: 'Name' },
                { key: 'color', header: 'Color', render: (r) => (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: r.color }} />
                    <span className="text-sm text-muted">#{r.color.slice(1)}</span>
                  </div>
                )},
              ]}
              data={expenseRows}
              empty="No expense categories found"
            />
          )}
        </div>
      </Card>

      {/* Add/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit Category' : 'Add Category'}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button loading={saveMutation.isPending} onClick={form.handleSubmit((v) => saveMutation.mutate(v))}>
              {editing ? 'Save' : 'Add'}
            </Button>
          </>
        }
      >
        <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Input
              label="Category Name"
              error={form.formState.errors.name?.message}
              {...form.register('name')}
            />
          </div>
          <Select
            label="Type"
            options={CATEGORY_TYPES.map((t) => ({ value: t, label: t }))}
            error={form.formState.errors.type?.message}
            {...form.register('type')}
          />
          <div>
            <label className="block text-sm font-medium text-muted mb-1">Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                {...form.register('color')}
                className="w-10 h-10 rounded-lg border border-app cursor-pointer"
              />
              <Input
                label="Hex Code"
                {...form.register('color')}
                value={form.watch('color')}
                onChange={(e) => form.setValue('color', e.target.value)}
              />
            </div>
          </div>
          <div className="sm:col-span-2">
            <Input
              label="Description"
              placeholder="Brief description for this category"
              {...form.register('description')}
            />
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleteMutation.mutate(deleting.id)}
        title="Delete Category?"
        message="This action cannot be undone."
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </div>
  )
}