import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
// Phase 6.11 (TASK 1): FiClock dropped with the Recent Activity card (its only
// consumer). FiUser was already dead - imported since Phase 6.2 but never
// referenced in this file - and is removed in the same pass.
import {
  FiBriefcase, FiCalendar, FiDollarSign, FiArrowRight,
  FiCheckCircle, FiAlertCircle,
} from 'react-icons/fi'
import { useAuth } from '@/hooks/useAuth'
import { clientService } from './clientService'
import { cn, formatCurrency } from '@/utils'
// Phase 6.23 (CLEANUP): PageHeader was imported but never rendered on this
// screen (the welcome hero replaced it), so it was a dead import.
import { Card, CardHeader, StatCard, Badge, ProgressBar, Avatar, Loader, EmptyState } from '@/components/ui'
import { GlassWidget } from '@/components/glass'
// Phase 6.3 (Task 11): `stageTone` dropped from this import - it was imported
// but never referenced in this file (only ClientProjectDetail and ClientTimeline
// actually use it).
// Phase 6.11 (TASK 1): fmtTimeAgo dropped - it was only used to render the
// removed Recent Activity feed.
import { TIMELINE_STAGES, PROJECT_STATUS_TONE, fmtDate, stageState, summarizeBilling } from './constants'

const fade = (d = 0) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, delay: d, ease: [0.22, 1, 0.36, 1] },
})

export default function ClientDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const { data: profile, isLoading: lp } = useQuery({ queryKey: ['client-profile'], queryFn: () => clientService.getProfile(user) })
  const { data: projects = [], isLoading: lj } = useQuery({ queryKey: ['client-projects'], queryFn: () => clientService.getProjects(user) })
  // Phase 6.11 (TASK 1): the ['client-activity'] query is REMOVED. It existed
  // solely to feed the Recent Activity card deleted below, so keeping it would
  // have left a fetch firing on every dashboard mount for data nothing renders.
  // clientService.getActivity() and GET /client/activity are intentionally kept
  // - the per-project Activity is still assembled server-side and the endpoint
  // is a public part of the portal API; only this dead call site is gone.
  const { data: team = [], isLoading: lt } = useQuery({ queryKey: ['client-team'], queryFn: () => clientService.getTeam(user) })
  // Phase 6.10 (TASK 3): GET /client/payments returns { rows, advancePayment,
  // monthlyDue } (Phase 6.9, Task 18). clientService.getPayments() now returns
  // that object in a stable shape, so the rows are read from `.rows` here
  // instead of treating the payload as an array.
  const { data: billing, isLoading: lpay } = useQuery({ queryKey: ['client-payments'], queryFn: () => clientService.getPayments(user) })
  const payments = billing?.rows || []

  if (lp || lj) return <Loader label="Loading your portal…" />

  const active = projects.filter((p) => p.status !== 'Completed' && p.status !== 'On Hold')
  // PHASE SALARY/PROJECT AUDIT (WIDGET NAV): the milestone now carries the id of
  // the project it belongs to, so the "Next Milestone" chip can open THAT
  // project instead of being a dead label. The id is already on `p` — nothing
  // extra is fetched.
  const nextMilestone = projects
    .flatMap((p) => p.timeline.filter((s) => s.status === 'In Progress').map((s) => ({ ...s, projectName: p.name, projectId: p.id })))
    .slice(0, 1)[0]
  // Phase 6.11 (TASK 3) ROOT CAUSE FIX - the dashboard and the Billing page
  // disagreed about money.
  //
  // These two cards used to be computed here, independently of Billing:
  //     totalPaid = Σ project.payments[].paid
  //     balance   = Σ project.budget − totalPaid
  // Two separate defects followed from that:
  //   1. It read ONLY the payment rows embedded on ClientProject documents, so
  //      Finance Invoices and Income Transactions - which is where real billing
  //      has lived since Phase 6.9 - were invisible. "Amount Paid" read ₹0 on
  //      the dashboard while Billing showed the true figure for the same client.
  //   2. It equated BUDGET with BILLED, so "Outstanding" reported money owing on
  //      work that had never been invoiced.
  //
  // Both cards now read the SAME summarizeBilling() result the Billing page
  // uses, over the SAME ['client-payments'] query that was already being
  // fetched here - no new query, no new endpoint, and the calculation exists in
  // exactly one place. `totalBudget` is kept because the "Total Budget" row
  // below genuinely is the sum of project budgets, which is a different figure
  // and is labelled as such.
  // PHASE CLIENT PAY/BALANCE (TASK 5): the summary is now computed SERVER-side
  // (the same routine the Admin/HR "Client Pay/Balance" module reads) and
  // arrives as `billing.summary`; the client-side summarizeBilling() remains
  // only as a read-compat fallback for a stale cached response.
  const { paid: totalPaid, balance } = billing.summary ?? summarizeBilling(billing)
  const totalBudget = projects.reduce((s, p) => s + (p.budget || 0), 0)
  const lastUpdated = payments[0]?.date ? fmtDate(payments[0].date) : fmtDate(new Date().toISOString())

  return (
    <div className="space-y-4">
      {/* Welcome card */}
      <GlassWidget className="!p-0">
        <div className="relative overflow-hidden rounded-card bg-gradient-to-br from-primary via-primary to-accent p-6 text-white shadow-glow-primary">
          <div className="absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/20 blur-2xl" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-white/80">Welcome back,</p>
              <h2 className="text-2xl font-bold">{profile?.contactPerson}</h2>
              <p className="mt-1 text-white/80">{profile?.company} · {profile?.plan} Plan</p>
            </div>
            {/* PHASE SALARY/PROJECT AUDIT (WIDGET NAV): both chips carry real,
                navigable data and had no destination. "Active Projects" opens
                My Projects; "Next Milestone" opens the specific project that
                milestone belongs to (falling back to the list when no milestone
                is in progress). Both are existing Client-portal routes and the
                server scopes /client/projects/:id to the caller's own clientId,
                so neither can reach another client's project. */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => navigate('/client/projects')}
                className="rounded-xl bg-white/10 px-3 py-2 text-center transition hover:bg-white/20"
              >
                <p className="text-xs text-white/70">Active Projects</p>
                <p className="text-lg font-bold">{active.length}</p>
              </button>
              <button
                type="button"
                disabled={!nextMilestone}
                onClick={() => navigate(nextMilestone?.projectId ? `/client/projects/${nextMilestone.projectId}` : '/client/projects')}
                className="rounded-xl bg-white/10 px-3 py-2 text-center transition enabled:hover:bg-white/20 disabled:cursor-default"
              >
                <p className="text-xs text-white/70">Next Milestone</p>
                <p className="text-sm font-bold">{nextMilestone ? nextMilestone.name : '—'}</p>
              </button>
            </div>
          </div>
          <p className="relative mt-3 text-xs text-white/70">Last updated {lastUpdated}</p>
        </div>
      </GlassWidget>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Phase 6.9 (Task 20): these 4 KPI cards already showed real, computed
            data (from the SAME 'client-projects' / 'client-payments' queries
            used everywhere else on this page — no duplicate fetch), but like
            the Admin/HR/Manager dashboard's StatCards, none of them had an
            onClick, so "clicking every card" silently did nothing. Wired to
            the client's own existing routes; no new route or query added. */}
        <StatCard label="Active Projects" value={active.length} icon={FiBriefcase} tone="primary" onClick={() => navigate('/client/projects')} />
        <StatCard label="Total Projects" value={projects.length} icon={FiCalendar} tone="accent" onClick={() => navigate('/client/projects')} />
        {/* Phase 6.23 (TASK 3) fixed a DIFFERENT defect here - AnimatedNumber
            string-stripping a pre-formatted value - and correctly preserved the
            lakh shorthand these two cards used at the time; it was not asked to
            remove the abbreviation itself. This pass does that: format={lakhs}
            -> format={formatCurrency}, the SAME shared en-IN Intl formatter
            ClientBilling.jsx already uses for the identical figures, so both
            surfaces render money the same way. Still a raw number in, formatted
            string out - the AnimatedNumber contract fixed in 6.23 is unchanged. */}
        <StatCard label="Amount Paid" value={totalPaid} format={formatCurrency} icon={FiDollarSign} tone="success" onClick={() => navigate('/client/billing')} />
        <StatCard label="Outstanding" value={balance} format={formatCurrency} icon={FiAlertCircle} tone={balance > 0 ? 'warning' : 'success'} onClick={() => navigate('/client/billing')} />
      </div>

      {/* Phase 6.11 (TASK 1): the Messages and Documents shortcut cards that
          occupied this row are REMOVED, together with the whole two-column grid
          that held them - deleting the cards alone would have left an empty
          flex row between the KPI strip and Your Projects. Neither card carried
          data of its own: both were link tiles into /client/projects, which the
          "Your Projects" section immediately below already links to per project,
          and Messages/Documents are tabs inside Project Details since Phase
          6.10. Nothing else consumed them, so no widget was relocated. */}

      {/* Project overview */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Your Projects</h3>
          <button onClick={() => navigate('/client/projects')} className="flex items-center gap-1 text-sm text-primary hover:underline">View all <FiArrowRight /></button>
        </div>
        {projects.length === 0 ? (
          <EmptyState title="No projects yet" description="Your assigned projects will appear here." />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((p, i) => (
              <motion.div key={p.id} {...fade(i * 0.04)}>
                <Card className="h-full cursor-pointer transition hover:border-primary/50" onClick={() => navigate(`/client/projects/${p.id}`)}>
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{p.name}</p>
                      <p className="text-xs text-muted">{p.code} · {p.projectManager}</p>
                    </div>
                    <Badge tone={PROJECT_STATUS_TONE[p.status]}>{p.status}</Badge>
                  </div>
                  <div className="mb-2 flex items-center justify-between text-xs text-muted">
                    <span>{fmtDate(p.startDate)} → {fmtDate(p.deliveryDate)}</span>
                    <Badge>{p.priority}</Badge>
                  </div>
                  <ProgressBar value={p.progress} showLabel />
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Timeline / progress */}
        <Card className="lg:col-span-2">
          <CardHeader title="Project Progress" subtitle="Across your active projects" />
          {active.length === 0 ? (
            <EmptyState title="Nothing in progress" description="Completed / on-hold projects are hidden here." />
          ) : (
            <div className="space-y-4">
              {active.map((p) => (
                <div key={p.id}>
                  {/* WIDGET NAV: the project name in this progress strip is the
                      obvious click target for "open this project" and was inert.
                      Same '/client/projects/:id' route the cards above use. */}
                  <button
                    type="button"
                    onClick={() => navigate(`/client/projects/${p.id}`)}
                    className="mb-2 text-sm font-medium hover:text-primary hover:underline"
                  >
                    {p.name}
                  </button>
                  <div className="flex items-center">
                    {TIMELINE_STAGES.map((stage, idx) => {
                      const st = p.timeline.find((s) => s.name === stage)
                      const state = stageState(st?.status)
                      return (
                        <div key={stage} className="flex flex-1 items-center">
                          <div className="flex flex-col items-center gap-1">
                            <div className={cn(
                              'flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold',
                              state === 'done' ? 'bg-success text-white' : state === 'active' ? 'bg-primary text-white ring-4 ring-primary/20' : 'bg-black/10 text-muted dark:bg-white/10',
                            )}>
                              {state === 'done' ? <FiCheckCircle className="h-4 w-4" /> : idx + 1}
                            </div>
                            <span className="hidden text-[9px] text-muted sm:block">{stage}</span>
                          </div>
                          {idx < TIMELINE_STAGES.length - 1 && (
                            <div className={cn('h-1 flex-1', st && p.timeline[idx + 1] && p.timeline[idx + 1].status === 'Completed' ? 'bg-success' : 'bg-black/10 dark:bg-white/10')} />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Payment summary */}
        <Card>
          <CardHeader title="Billing Summary" action={<FiDollarSign className="text-success" />} />
          {lpay ? <Loader /> : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm"><span className="text-muted">Total Budget</span><span className="font-semibold">{formatCurrency(totalBudget)}</span></div>
              <div className="flex items-center justify-between text-sm"><span className="text-muted">Paid</span><span className="font-semibold text-success">{formatCurrency(totalPaid)}</span></div>
              <div className="flex items-center justify-between text-sm"><span className="text-muted">Outstanding</span><span className="font-semibold text-warning">{formatCurrency(balance)}</span></div>
              <button onClick={() => navigate('/client/billing')} className="mt-1 w-full rounded-xl bg-primary/10 py-2 text-sm font-medium text-primary transition hover:bg-primary/20">View billing & invoices</button>
            </div>
          )}
        </Card>
      </div>

      {/* Phase 6.11 (TASK 1): Recent Activity is REMOVED. It shared a
          two-column row with Your Team, so deleting it would have left Your
          Team stranded in a half-width column with a permanent blank column
          beside it. The wrapper grid is therefore dropped and Your Team becomes
          a full-width card whose members lay out in the EXISTING responsive
          grid pattern used elsewhere on this page (1 / 2 / 3 columns), so the
          row is completely filled at every breakpoint and no widget was
          duplicated or invented to plug the gap. */}
      <Card>
        <CardHeader title="Your Team" subtitle="People working on your projects" />
        {lt ? <Loader /> : team.length === 0 ? (
          <EmptyState title="No team assigned" />
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {team.slice(0, 6).map((m) => (
              // Phase 6.23 (TASK 2): keyed on name+project+role so two genuinely
              // distinct people are never collapsed by React and a repeated name
              // can no longer produce a duplicate-key warning.
              <div key={`${m.name}|${m.projectId || ''}|${m.roleInProject || ''}`} className="flex items-center gap-3 rounded-xl border border-app p-3">
                <Avatar name={m.name} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.name}</p>
                  <p className="text-xs text-muted">{m.roleInProject} · {m.department}</p>
                </div>
                <Badge tone={m.availability === 'Available' ? 'success' : 'warning'}>{m.availability}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
