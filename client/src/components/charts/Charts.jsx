import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

const COLORS = ['#2563EB', '#06B6D4', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6']

// Glass tooltip used by every chart.
function GlassTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-strong rounded-xl px-3 py-2 text-xs shadow-floating">
      {label != null && <p className="mb-1 font-semibold">{label}</p>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="text-muted">{p.name}</span>
          <span className="ml-auto pl-3 font-semibold">
            {formatter ? formatter(p.value) : p.value}
          </span>
        </div>
      ))}
    </div>
  )
}

const axisProps = {
  tick: { fontSize: 12, fill: 'var(--text-muted)' },
  axisLine: false,
  tickLine: false,
  stroke: 'var(--text-muted)',
}

// Revenue vs Expense area chart.
export function RevenueChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ left: -14, right: 10, top: 10 }}>
        <defs>
          <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#2563EB" stopOpacity={0.45} />
            <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="exp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#EF4444" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="4 4" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="month" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={(v) => `${v / 1000}k`} />
        <Tooltip cursor={{ stroke: 'var(--text-muted)', strokeOpacity: 0.3 }} content={<GlassTooltip />} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
        <Area type="monotone" dataKey="revenue" stroke="#2563EB" fill="url(#rev)" strokeWidth={2.5} activeDot={{ r: 4 }} animationDuration={1100} />
        <Area type="monotone" dataKey="expense" stroke="#EF4444" fill="url(#exp)" strokeWidth={2.5} activeDot={{ r: 4 }} animationDuration={1100} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// Generic bar chart with gradient fills.
export function BarsChart({ data, xKey, bars }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ left: -14, right: 10, top: 10 }}>
        <defs>
          {bars.map((b, i) => (
            <linearGradient key={i} id={`bar-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={b.color || COLORS[i]} stopOpacity={0.95} />
              <stop offset="100%" stopColor={b.color || COLORS[i]} stopOpacity={0.5} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="4 4" stroke="var(--border)" vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} />
        <Tooltip cursor={{ fill: 'rgba(148,163,184,0.12)' }} content={<GlassTooltip />} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
        {bars.map((b, i) => (
          <Bar
            key={b.key}
            dataKey={b.key}
            fill={`url(#bar-${i})`}
            radius={[8, 8, 0, 0]}
            maxBarSize={46}
            animationDuration={1000}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

// Donut chart.
export function DonutChart({ data, dataKey = 'value', nameKey = 'name' }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={data}
          dataKey={dataKey}
          nameKey={nameKey}
          innerRadius={62}
          outerRadius={104}
          paddingAngle={3}
          stroke="var(--surface)"
          strokeWidth={3}
          animationDuration={1000}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip content={<GlassTooltip />} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
      </PieChart>
    </ResponsiveContainer>
  )
}
