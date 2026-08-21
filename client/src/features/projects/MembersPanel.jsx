import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FiPlus, FiTrash2, FiStar } from 'react-icons/fi'
import { projectApi, employeeService } from '@/api/services'
import { EMPLOYEE_OPTION_PARAMS } from '@/features/employees/constants'
import { Avatar, Badge, Button, Input, Select } from '@/components/ui'
import { MEMBER_ROLES } from './constants'

// Manage a project's member roster. Persists by patching the project's members.
export function MembersPanel({ project, canWrite }) {
  const qc = useQueryClient()
  const members = project.members || []
  const [name, setName] = useState('')
  const [role, setRole] = useState('Member')

  // Suggest existing employee names for the member roster (live backend source).
  const { data: employees = [] } = useQuery({
    queryKey: ['employees'],
    queryFn: () => employeeService.list(EMPLOYEE_OPTION_PARAMS),
    select: (res) => res?.data || [],
  })
  const memberSuggestions = employees.map((e) => e.name).filter(Boolean)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['project-detail', project.id] })
    qc.invalidateQueries({ queryKey: ['projects-all'] })
  }
  const saveMut = useMutation({
    mutationFn: (next) => projectApi.update(project.id, { members: next, lead: next.find((m) => m.role === 'Lead')?.name || project.lead }),
    onSuccess: invalidate,
    onError: () => toast.error('Could not update members'),
  })

  const add = () => {
    if (!name.trim() || members.some((m) => m.name === name)) return
    saveMut.mutate([...members, { name, role }])
    setName(''); toast.success(`${name} added`)
  }
  const remove = (n) => { saveMut.mutate(members.filter((m) => m.name !== n)); toast.success('Member removed') }
  const makeLead = (n) => saveMut.mutate(members.map((m) => ({ ...m, role: m.name === n ? 'Lead' : m.role === 'Lead' ? 'Member' : m.role })))

  return (
    <div>
      {canWrite && (
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <Input list="member-roster-names" placeholder="Member name" value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
          <datalist id="member-roster-names">{memberSuggestions.map((n) => <option key={n} value={n} />)}</datalist>
          <Select value={role} onChange={(e) => setRole(e.target.value)} className="sm:w-40" options={MEMBER_ROLES.map((r) => ({ value: r, label: r }))} />
          <Button icon={FiPlus} onClick={add} loading={saveMut.isPending}>Add Member</Button>
        </div>
      )}

      {members.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">No members on this project yet</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((m) => (
            <div key={m.name} className="flex items-center gap-3 rounded-xl border border-app p-3">
              <Avatar name={m.name} size={38} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.name}</p>
                <Badge tone={m.role === 'Lead' ? 'primary' : 'default'}>{m.role}</Badge>
              </div>
              {canWrite && (
                <div className="flex items-center gap-1">
                  {m.role !== 'Lead' && <button onClick={() => makeLead(m.name)} className="rounded-lg p-1.5 text-muted hover:text-primary" title="Make lead"><FiStar className="h-4 w-4" /></button>}
                  <button onClick={() => remove(m.name)} className="rounded-lg p-1.5 text-muted hover:text-danger" title="Remove"><FiTrash2 className="h-4 w-4" /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
