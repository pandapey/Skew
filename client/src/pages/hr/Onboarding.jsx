import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { FiCheckSquare, FiCheck, FiClock } from 'react-icons/fi'
import { hrApi } from '@/api/services'
import { PageHeader, Card, CardHeader, StatCard, Avatar, Badge, Loader } from '@/components/ui'
import { formatDate } from '@/utils'

export default function Onboarding() {
  const queryClient = useQueryClient()
  const { data = [], isLoading } = useQuery({ queryKey: ['hr-onboarding-all'], queryFn: hrApi.onboarding.all })
  const [local, setLocal] = useState(null)

  const list = local ?? data

  const saveMutation = useMutation({
    mutationFn: ({ id, patch }) => hrApi.onboarding.update(id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-onboarding-all'] })
      toast.success('Checklist saved')
    },
    onError: () => {
      setLocal(null)
      toast.error('Failed to save checklist')
    },
  })

  const toggleTask = (empId, taskIdx) => {
    const row = list.find((o) => o.id === empId)
    if (!row) return
    const tasks = row.tasks.map((t, i) => (i === taskIdx ? { ...t, done: !t.done } : t))
    const done = tasks.filter((t) => t.done).length
    const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0
    setLocal(list.map((o) => (o.id === empId ? { ...o, tasks, progress } : o)))
    saveMutation.mutate({ id: empId, patch: { tasks, progress } })
  }

  if (isLoading) return <Loader label="Loading onboarding…" />

  const completed = list.filter((o) => o.progress === 100).length

  return (
    <div>
      <PageHeader title="Employee Onboarding" subtitle="New-hire checklists and progress." />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="In Onboarding" value={list.length} icon={FiCheckSquare} />
        <StatCard label="Completed" value={completed} icon={FiCheck} tone="success" />
        <StatCard label="In Progress" value={list.length - completed} icon={FiClock} tone="warning" />
        <StatCard label="Avg Progress" value={`${Math.round(list.reduce((s, o) => s + o.progress, 0) / (list.length || 1))}%`} icon={FiCheckSquare} tone="accent" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {list.map((o, i) => (
          <motion.div key={o.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
            <Card>
              <div className="flex items-center gap-3">
                <Avatar name={o.name} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{o.name}</p>
                  <p className="text-sm text-muted">{o.position} · Joins {formatDate(o.joiningDate)}</p>
                </div>
                <Badge tone={o.progress === 100 ? 'success' : 'warning'}>{o.progress}%</Badge>
              </div>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${o.progress}%` }} />
              </div>

              <div className="mt-4 space-y-1.5">
                {o.tasks.map((t, ti) => (
                  <button key={ti} onClick={() => toggleTask(o.id, ti)}
                    className="flex w-full items-center gap-2 rounded-lg p-1.5 text-left text-sm transition hover:bg-black/5 dark:hover:bg-white/10">
                    <span className={`flex h-5 w-5 flex-none items-center justify-center rounded-md border ${t.done ? 'border-success bg-success text-white' : 'border-app'}`}>
                      {t.done && <FiCheck className="h-3 w-3" />}
                    </span>
                    <span className={t.done ? 'text-muted line-through' : ''}>{t.label}</span>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted">Buddy: {o.buddy}</p>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
