import { useQuery } from '@tanstack/react-query'
import { FiDatabase, FiActivity, FiCpu, FiHardDrive, FiZap } from 'react-icons/fi'
import { PageHeader, Card, CardHeader, StatCard, Badge, Loader } from '@/components/ui'
import { adminApi } from '@/api/adminApi'
import { cn, formatBytes, formatNumber } from '@/utils'

const fmtUptime = (s) => {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${d}d ${h}h ${m}m`
}

export default function DatabaseHealth() {
  const { data, isLoading } = useQuery({ queryKey: ['admin-db-health'], queryFn: adminApi.dbHealth })

  if (isLoading || !data) return <Loader label="Checking database health…" />

  const maxSize = Math.max(...data.collections.map((c) => c.sizeBytes || 0), 1)
  const storagePct = data.storageTotal ? Math.round((data.storageUsed / data.storageTotal) * 100) : 0
  const connPct = data.connections?.max ? Math.round((data.connections.current / data.connections.max) * 100) : 0

  return (
    <div>
      <PageHeader
        title="Database Health"
        subtitle="MongoDB connection, storage and collection stats."
        actions={<Badge tone={data.status === 'Healthy' ? 'success' : 'warning'}>{data.status}</Badge>}
      />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Uptime" value={fmtUptime(data.uptimeSeconds)} icon={FiActivity} tone="success" />
        <StatCard label="Latency" value={`${data.latencyMs}ms`} icon={FiZap} tone="accent" />
        <StatCard label="Connections" value={`${data.connections.current}/${data.connections.max}`} icon={FiCpu} tone="warning" />
        <StatCard label="Version" value={data.version.replace('MongoDB ', '')} icon={FiDatabase} />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Connection Pool" />
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex justify-between text-sm"><span className="text-muted">In use</span><span>{data.connections.current} of {data.connections.max}</span></div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                <div className="h-full rounded-full bg-warning" style={{ width: `${connPct}%` }} />
              </div>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-sm"><span className="text-muted">Available</span><span>{data.connections.available}</span></div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                <div className="h-full rounded-full bg-success" style={{ width: `${data.connections?.max ? (data.connections.available / data.connections.max) * 100 : 0}%` }} />
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Storage" icon={FiHardDrive} />
          <div className="space-y-3">
            <div className="flex items-end justify-between">
              <p className="text-2xl font-bold">{formatBytes(data.storageUsed)}</p>
              <p className="text-sm text-muted">of {formatBytes(data.storageTotal)}</p>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
              <div className="h-full rounded-full bg-primary" style={{ width: `${storagePct}%` }} />
            </div>
            <p className="text-sm text-muted">{storagePct}% utilized</p>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Collections" subtitle={`${data.collections.length} collections`} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-app text-left text-muted">
                <th className="px-4 py-3 font-medium">Collection</th>
                <th className="px-4 py-3 text-right font-medium">Documents</th>
                <th className="px-4 py-3 text-right font-medium">Indexes</th>
                <th className="px-4 py-3 font-medium">Size</th>
                <th className="px-4 py-3 font-medium">Distribution</th>
              </tr>
            </thead>
            <tbody>
              {data.collections.map((c) => (
                <tr key={c.name} className="border-b border-app/60">
                  <td className="px-4 py-3 font-mono text-xs">{c.name}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatNumber(c.count)}</td>
                  <td className="px-4 py-3 text-right">{c.indexes}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{formatBytes(c.sizeBytes)}</td>
                  <td className="px-4 py-3">
                    <div className="h-2 w-40 max-w-full rounded-full bg-black/5 dark:bg-white/10">
                      <div className={cn('h-full rounded-full', c.sizeBytes > maxSize * 0.5 ? 'bg-primary' : 'bg-accent')} style={{ width: `${Math.max(4, (c.sizeBytes / maxSize) * 100)}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
