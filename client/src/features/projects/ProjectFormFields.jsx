import { useQuery } from '@tanstack/react-query'
import { Input, Select, MultiSelect, Textarea, Button } from '@/components/ui'
import { PROJECT_STATUSES } from './constants'
import { employeeService } from '@/api/services'
import { EMPLOYEE_OPTION_PARAMS } from '@/features/employees/constants'
import { clientService } from '@/features/client/clientService'
import { usePlanOptions } from '@/features/client/planForm'

export const PROJECT_COLORS = ['#2563EB', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#EF4444', '#06B6D4', '#0EA5E9']

export const PROJECT_FORM_DEFAULTS = {
  name: '', client: '', description: '', lead: '',
  status: 'Planning', color: PROJECT_COLORS[0],
  website: '', plan: '',
}

export function ProjectFormFields({
  form, editing, enabled = true,
  memberNames, setMemberNames, memberError, setMemberError,
  color, setColor,
  clientMode, setClientMode, onCreateClient,
}) {
  const { data: clients = [], isLoading: clientsLoading } = useQuery({
    queryKey: ['admin-clients'],
    queryFn: () => clientService.listClients(),
    enabled,
    select: (res) => (Array.isArray(res) ? res : res?.data || []),
  })
  const activeClients = clients.filter((c) => !c.status || c.status === 'Active')
  const clientOptions = activeClients.map((c) => ({ value: c.company, label: c.company }))
  // Preserve a currently-selected client even if it is now inactive/renamed.
  const currentClient = editing?.client
  if (currentClient && !clientOptions.some((o) => o.value === currentClient)) {
    clientOptions.unshift({ value: currentClient, label: currentClient })
  }

  // Live employees for the member picker (auto-updates when employees change).
  const { data: employees = [], isLoading: empLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: () => employeeService.list(EMPLOYEE_OPTION_PARAMS),
    enabled,
    select: (res) => res?.data || [],
  })
  const employeeOptions = employees.map((e) => ({
    value: e.name,
    label: e.name,
    meta: [e.empCode, e.department, e.designation].filter(Boolean).join(' · '),
  }))

  const planOptions = usePlanOptions(form.watch('plan'), { enabled })

  return (
    <>
      <div className="sm:col-span-2"><Input label="Project Name" error={form.formState.errors.name?.message} {...form.register('name')} /></div>

      <div className="sm:col-span-2">
        <label className="mb-1.5 block text-sm font-medium">Project ID</label>
        <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-muted">
          Auto-generated on creation (PRJ001, PRJ002, …)
        </p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium">Client</label>
        {!editing && onCreateClient && (
          <div className="mb-2 flex flex-wrap items-center gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="projectClientMode"
                className="h-4 w-4 accent-[var(--primary)]"
                checked={clientMode === 'existing'}
                onChange={() => setClientMode('existing')}
              />
              Existing Client
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="projectClientMode"
                className="h-4 w-4 accent-[var(--primary)]"
                checked={clientMode === 'new'}
                onChange={() => setClientMode('new')}
              />
              New Client
            </label>
          </div>
        )}
        <Select
          searchable
          loading={clientsLoading}
          emptyText="No clients found"
          placeholder={clientsLoading ? 'Loading clients…' : (clientOptions.length ? 'Select a client' : 'No clients found')}
          options={clientOptions}
          error={form.formState.errors.client?.message}
          {...form.register('client')}
        />

        {!editing && onCreateClient && clientMode === 'new' && (
          <div className="mt-2 rounded-xl border border-[var(--border)] p-3 space-y-2">
            <p className="text-xs text-muted">
              Opens the full Client Creation page (company, commercial terms and optional
              portal login). Your project details are saved and restored automatically.
            </p>
            <Button type="button" variant="ghost" onClick={onCreateClient}>
              Open Create Client Form →
            </Button>
          </div>
        )}
      </div>

      <div className="sm:col-span-2"><Textarea label="Description" rows={2} {...form.register('description')} /></div>
      <Select label="Status" options={PROJECT_STATUSES.map((s) => ({ value: s, label: s }))} {...form.register('status')} />
      <Select label="Lead" options={[{ value: '', label: 'Auto (first member)' }, ...memberNames.map((n) => ({ value: n, label: n }))]} {...form.register('lead')} />

      <Input
        label="Website"
        placeholder="acme.com"
        error={form.formState.errors.website?.message}
        {...form.register('website')}
      />

      <Select
        label="Plan"
        options={[{ value: '', label: 'Select a plan…' }, ...planOptions.options]}
        loading={planOptions.loading}
        placeholder={planOptions.loading ? 'Loading plans…' : 'Select a plan…'}
        emptyText="No plans available — create one in Admin → Plans"
        error={form.formState.errors.plan?.message}
        {...form.register('plan')}
      />

      {/* Colour */}
      <div className="sm:col-span-2">
        <label className="mb-1.5 block text-sm font-medium">Colour</label>
        <div className="flex flex-wrap gap-2">
          {PROJECT_COLORS.map((c) => (
            <button key={c} type="button" onClick={() => setColor(c)}
              className={`h-8 w-8 rounded-full ring-2 ring-offset-2 ring-offset-[var(--surface)] transition ${color === c ? 'ring-current' : 'ring-transparent'}`}
              style={{ backgroundColor: c }} aria-label={`Colour ${c}`} />
          ))}
        </div>
      </div>

      {/* Members — searchable multi-select of real employees */}
      <div className="sm:col-span-2">
        <MultiSelect
          label="Members"
          options={employeeOptions}
          value={memberNames}
          onChange={(next) => { setMemberNames(next); if (next.length) setMemberError('') }}
          loading={empLoading}
          placeholder="Search & select employees…"
          emptyText="No employees found"
        />
        {memberError
          ? <p className="mt-1.5 text-xs text-danger" aria-live="polite">{memberError}</p>
          : <p className="mt-1.5 text-xs text-muted">Search by name, employee ID, department or designation. The Lead is chosen above.</p>}
      </div>
    </>
  )
}
