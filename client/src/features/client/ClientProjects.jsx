import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { FiArrowRight } from 'react-icons/fi'
import { useAuth } from '@/hooks/useAuth'
import { clientService } from './clientService'
import { PageHeader, Card, Badge, ProgressBar, Loader, EmptyState } from '@/components/ui'
import { PROJECT_STATUS_TONE, fmtDate } from './constants'

export default function ClientProjects() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { data: projects = [], isLoading } = useQuery({ queryKey: ['client-projects'], queryFn: () => clientService.getProjects(user) })

  if (isLoading) return <Loader label="Loading your projects…" />

  return (
    <div>
      <PageHeader title="My Projects" subtitle="All projects assigned to your organization." />

      {projects.length === 0 ? (
        <EmptyState title="No projects assigned" description="Your account manager will assign projects here." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p, i) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              <Card className="flex h-full cursor-pointer flex-col transition hover:border-primary/50" onClick={() => navigate(`/client/projects/${p.id}`)}>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{p.name}</p>
                    <p className="text-xs text-muted">{p.code} · {p.projectManager}</p>
                  </div>
                  <Badge tone={PROJECT_STATUS_TONE[p.status]}>{p.status}</Badge>
                </div>
                <div className="mb-3 flex items-center justify-between text-xs text-muted">
                  <span>{fmtDate(p.startDate)} → {fmtDate(p.deliveryDate)}</span>
                  <Badge>{p.priority}</Badge>
                </div>
                <ProgressBar value={p.progress} showLabel className="mt-auto" />
                <button className="mt-3 flex items-center justify-end gap-1 text-sm text-primary hover:underline" onClick={(e) => { e.stopPropagation(); navigate(`/client/projects/${p.id}`) }}>
                  Open project <FiArrowRight />
                </button>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
