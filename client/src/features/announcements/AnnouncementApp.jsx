// Announcements module orchestrator: searchable, filterable company feed with
// Company News / Announcements / Events / Birthdays, pinned posts, likes,
// comments and rich media. Talks to announcementApi (mock or MongoDB backend).
// PHASE ADMIN (TASK 1): `useMemo` was imported ONLY to build the trending-tags
// list and the total-likes figure that fed the removed insights widgets. With
// that memo gone the hook has zero remaining references in this file.
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
// PHASE ADMIN (TASK 1): `FiTag` (trending-tags heading + the "Likes" StatCard)
// and `StatCard` (the three Posts / Pinned / Likes cards) were the ONLY imports
// exclusive to the removed insights block, so both are dropped here.
// DELIBERATELY KEPT: `FiBookmark` (still used by the "Pinned only" toggle, the
// pinned Badge and the "Pinned" feed heading) and `FiBell` (empty-state icon).
// `StatCard` is a SHARED UI primitive used by many other pages - it is only
// un-imported here, never deleted from @/components/ui.
import { FiFilter, FiPlus, FiBookmark, FiBell } from 'react-icons/fi'
import { PageHeader, Button, SearchInput, Select, Badge, Loader } from '@/components/ui'
import { cn } from '@/utils'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'
import { announcementApi } from '@/api/services'
import { useNotifications } from '@/features/notifications/NotificationContext'
import { POST_TYPES, TYPE_ORDER, FILTERS } from './constants'
import PostCard from './PostCard'
import PostComposer from './PostComposer'

export default function AnnouncementApp() {
  const { user } = useAuth()
  const { notify } = useNotifications()
  const currentUser = { name: user?.name || 'You', role: user?.role || user?.designation || 'Employee' }
  // Employees have a view-only feed: no create/edit/delete/pin, no trending tags (#11, #13).
  const isEmployee = user?.role === ROLES.EMPLOYEE
  // --- PHASE ADMIN (TASK 1): the sidebar "insights" block is fully removed ---
  //
  // Inspected on the actual page; the sidebar rendered in this exact order:
  //   1. "Create Post" button
  //   2. "Filter by category" card (+ the "Pinned only" toggle)
  //   3. "Trending tags" card                      <- insights block
  //   4. a `grid grid-cols-3` holding exactly three StatCards, directly BELOW
  //      Trending tags: "Posts", "Pinned", "Likes" <- insights block
  //
  // Those four sections are what this task asks to remove for Admin.
  //
  // ROOT CAUSE / WHY A FULL DELETE RATHER THAN ANOTHER ROLE GATE: the block was
  // historically gated by exclusion (`!isEmployee`), and successive phases kept
  // appending roles to a hidden-roles list (Employee, then Manager, then HR).
  // Admin was the LAST role still rendering it. Removing Admin from that list
  // would leave a conditional that can never be true for any role that reaches
  // this component (Client has no /announcements route at all), i.e. permanently
  // unreachable JSX plus a memo, two icons and a StatCard import kept alive only
  // to serve dead code. The cleanup rules require removing exactly that, so the
  // widgets, their computation, their state and their now-exclusive imports are
  // deleted outright instead of being hidden behind a dead flag.
  //
  // NO OTHER ROLE IS AFFECTED: Employee, Manager and HR already did not render
  // this block, and Client never reaches this component. Post creation, listing,
  // search, filters, sort, like, comment, pin, edit and delete are untouched for
  // every role, and no announcement API changed for this task.
  //
  // The former `INSIGHTS_HIDDEN_ROLES` array and `showInsights` flag are gone
  // with it - they existed solely to gate these four widgets.
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [pinnedOnly, setPinnedOnly] = useState(false)
  const [sort, setSort] = useState('recent')
  const [showFilters, setShowFilters] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['announcements'] })

  // PHASE: EMPLOYEE ANNOUNCEMENT READ STATE — expanding a post's comments marks
  // it read. Refetches the list (for the unread dot) and the nav badge count;
  // nothing else is invalidated, so chat/tasks/notifications stay untouched.
  const readMut = useMutation({
    mutationFn: (id) => announcementApi.markRead(id),
    onSuccess: () => {
      invalidate()
      qc.invalidateQueries({ queryKey: ['announcements', 'unread-count'], refetchType: 'active' })
    },
    onError: () => toast.error('Could not update read status'),
  })

  const { data = [], isLoading } = useQuery({
    queryKey: ['announcements', { search, type: typeFilter, pinned: pinnedOnly, sort }],
    queryFn: () => announcementApi.list({ search, type: typeFilter, pinned: pinnedOnly, sortBy: sort }),
  })

  const likeMut = useMutation({ mutationFn: (id) => announcementApi.like(id), onSuccess: invalidate })
  const commentMut = useMutation({ mutationFn: ({ id, body }) => announcementApi.comment(id, body), onSuccess: invalidate })
  const pinMut = useMutation({
    mutationFn: ({ id, pinned }) => announcementApi.update(id, { pinned }),
    onSuccess: invalidate,
  })
  const deleteMut = useMutation({
    mutationFn: (id) => announcementApi.remove(id),
    onSuccess: () => {
      invalidate()
      toast.success('Post deleted')
    },
    onError: () => toast.error('Could not delete post'),
  })

  const savePost = async (payload) => {
    const isNew = !editing
    try {
      const files = (payload.attachments || []).filter((a) => a._file).map((a) => a._file)
      const base = (payload.attachments || []).filter((a) => !a._file).map(({ _file, ...r }) => r)
      const clean = { ...payload, attachments: base }
      const saved = editing ? await announcementApi.update(editing.id, clean) : await announcementApi.create(clean)
      for (const f of files) await announcementApi.uploadMedia(saved.id, f)
      invalidate()
      setModalOpen(false)
      toast.success('Post saved')
      // Real notification only when a new post/event is published (not on edits).
      if (isNew) {
        const kind = POST_TYPES[payload.type]?.singular || 'Post'
        notify({
          type: payload.type === 'event' ? 'meeting' : 'announcement',
          title: `New ${kind.toLowerCase()}: ${payload.title || 'Untitled'}`,
          body: payload.type === 'event'
            ? `${currentUser.name} added a new event.`
            : `${currentUser.name} published a new ${kind.toLowerCase()}.`,
          sender: currentUser.name,
          link: '/announcements',
          priority: 'normal',
        })
      }
    } catch {
      toast.error('Could not save post')
    }
  }

  const openCreate = () => {
    setEditing(null)
    setModalOpen(true)
  }
  const openEdit = (p) => {
    setEditing(p)
    setModalOpen(true)
  }
  const handleDelete = (id) => {
    if (window.confirm('Delete this post?')) deleteMut.mutate(id)
  }
  const handleTogglePin = (id) => {
    const p = data.find((x) => x.id === id)
    if (p) pinMut.mutate({ id, pinned: !p.pinned })
  }

  const pinned = data.filter((p) => p.pinned)
  const rest = data.filter((p) => !p.pinned)

  // PHASE ADMIN (TASK 1): the `{ totalLikes, trending }` useMemo that lived here
  // was the sole producer of the removed widgets' data - `trending` fed the
  // Trending tags card and `totalLikes` fed the "Likes" StatCard. Nothing else
  // consumed either value, so the whole computation is removed rather than left
  // running on every render for output nobody displays. `pinned` and `rest`
  // above are UNRELATED and still drive the pinned/regular feed sections.

  const sidebar = (
    <div className="space-y-4">
      {!isEmployee && (
        <Button className="w-full" icon={FiPlus} onClick={openCreate}>
          Create Post
        </Button>
      )}

      <div className="card p-4">
        <h4 className="mb-3 text-sm font-semibold">Filter by category</h4>
        <div className="space-y-1">
          {TYPE_ORDER.map((t) => {
            const meta = POST_TYPES[t]
            const Icon = meta.icon
            const on = typeFilter === t
            return (
              <button
                key={t}
                onClick={() => setTypeFilter(on ? 'all' : t)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-black/5 dark:hover:bg-white/10',
                  on && 'bg-primary/10 font-semibold',
                )}
              >
                <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', meta.soft, meta.text)}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="flex-1">{meta.label}</span>
              </button>
            )
          })}
        </div>
        {!isEmployee && (
        <button
          onClick={() => setPinnedOnly((p) => !p)}
          className={cn(
            'mt-2 flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-sm transition',
            pinnedOnly ? 'border-warning/50 bg-warning/10 text-warning' : 'border-app text-muted',
          )}
        >
          <FiBookmark className="h-4 w-4" /> Pinned only
        </button>
        )}
      </div>

      {/* PHASE ADMIN (TASK 1): the "Trending tags" card and the
          `grid grid-cols-3` of Posts / Pinned / Likes StatCards that sat
          directly below it were removed here.

          LAYOUT / REBALANCING: no layout class needed to change, and no custom
          CSS was added. This sidebar is a plain `space-y-4` VERTICAL STACK, so
          deleting cards simply shortens the stack - `space-y-*` only puts gaps
          BETWEEN surviving siblings, so no empty gap or blank row is left where
          the widgets used to be. The removed StatCards lived inside their own
          self-contained 3-column grid which was deleted whole, so no unused grid
          column remains. The outer page layout
          (`grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]`) is intentionally
          UNCHANGED: the sidebar column still holds the Create Post button and
          the category filter, so it is not empty and must not be collapsed -
          collapsing it would delete working functionality. On mobile/tablet the
          same `sidebar` value is reused by the `lg:hidden` toggle block, so
          responsive behaviour is preserved automatically. */}
    </div>
  )

  return (
    <div>
      <PageHeader
        title="Announcements"
        subtitle="Company news, events, birthdays and notices."
        actions={!isEmployee && <Button icon={FiPlus} onClick={openCreate} className="hidden sm:inline-flex">New Post</Button>}
      />

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search posts, authors, tags…" className="flex-1 min-w-[200px]" />
        <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-auto">
          <option value="recent">Recent</option>
          <option value="likes">Most liked</option>
        </Select>
        <button className="btn-ghost px-3 py-2 lg:hidden" onClick={() => setShowFilters((s) => !s)} aria-label="Toggle filters">
          <FiFilter />
        </button>
      </div>

      {/* Type filter chips */}
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setTypeFilter(f.value)}
            className={cn(
              'rounded-full border px-3 py-1 text-sm font-medium transition',
              typeFilter === f.value ? 'border-primary bg-primary text-white' : 'border-app text-muted hover:border-primary/40',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {showFilters && <div className="mb-4 lg:hidden">{sidebar}</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="hidden lg:block">{sidebar}</aside>
        <div>
          {isLoading ? (
            <div className="card flex h-64 items-center justify-center text-muted"><Loader /></div>
          ) : data.length === 0 ? (
            <div className="card flex flex-col items-center justify-center gap-2 py-16 text-muted">
              <FiBell className="h-8 w-8 opacity-40" />
              <p className="text-sm">No posts match your filters.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {pinned.length > 0 && (
                <div>
                  <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-muted">
                    <FiBookmark className="text-warning" /> Pinned
                  </h2>
                  <div className="space-y-4">
                    {pinned.map((p) => (
                      <PostCard key={p.id} post={p} unread={!p.read} onRead={readMut.mutate} onLike={likeMut.mutate} onComment={(id, b) => commentMut.mutate({ id, body: b })} onEdit={openEdit} onDelete={handleDelete} onTogglePin={handleTogglePin} readOnly={isEmployee} />
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-4">
                {rest.map((p) => (
                  <PostCard key={p.id} post={p} unread={!p.read} onRead={readMut.mutate} onLike={likeMut.mutate} onComment={(id, b) => commentMut.mutate({ id, body: b })} onEdit={openEdit} onDelete={handleDelete} onTogglePin={handleTogglePin} readOnly={isEmployee} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <PostComposer
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        post={editing}
        currentUser={currentUser}
        onSave={savePost}
        onDelete={handleDelete}
      />
    </div>
  )
}
