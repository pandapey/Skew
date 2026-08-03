import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FiPercent, FiTrendingUp, FiTrendingDown, FiDollarSign, FiFileText } from 'react-icons/fi'
import { financeApi } from '@/api/services'
import { PageHeader, Card, CardHeader, StatCard, DataTable, Loader, Badge } from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { BarsChart } from '@/components/charts/Charts'
import { formatCurrency } from '@/utils'

export default function TaxReports() {
  const { data: report, isLoading } = useQuery({ queryKey: ['finance-tax'], queryFn: financeApi.taxReport })

  const merged = useMemo(() => {
    if (!report) return []
    const rates = [...new Set([...report.outputRows.map((r) => r.rate), ...report.inputRows.map((r) => r.rate)])].sort((a, b) => a - b)
    return rates.map((rate) => {
      const out = report.outputRows.find((r) => r.rate === rate)
      const inp = report.inputRows.find((r) => r.rate === rate)
      const outputTax = out?.tax || 0
      const inputTax = inp?.tax || 0
      return { rate, taxable: (out?.taxable || 0) + (inp?.taxable || 0), outputTax, inputTax, net: outputTax - inputTax }
    })
  }, [report])

  if (isLoading || !report) return <Loader label="Calculating tax report…" />

  const outputCols = [
    { key: 'rate', header: 'Rate', render: (r) => <Badge tone="success">{r.rate}%</Badge> },
    { key: 'taxable', header: 'Taxable', render: (r) => formatCurrency(r.taxable) },
    { key: 'tax', header: 'Tax', render: (r) => formatCurrency(r.tax) },
    { key: 'count', header: 'Entries', render: (r) => r.count },
  ]
  const inputCols = [
    { key: 'rate', header: 'Rate', render: (r) => <Badge tone="danger">{r.rate}%</Badge> },
    { key: 'taxable', header: 'Taxable', render: (r) => formatCurrency(r.taxable) },
    { key: 'tax', header: 'Tax', render: (r) => formatCurrency(r.tax) },
    { key: 'count', header: 'Entries', render: (r) => r.count },
  ]

  return (
    <div>
      <PageHeader
        title="Tax Reports"
        subtitle="GST-style output & input tax summary by rate."
        actions={
          <ExportMenu
            rows={merged} filename="tax-report" title="Tax Report"
            columns={[
              { header: 'Rate %', accessor: 'rate' }, { header: 'Taxable', accessor: 'taxable' },
              { header: 'Output Tax', accessor: 'outputTax' }, { header: 'Input Tax', accessor: 'inputTax' },
              { header: 'Net', accessor: 'net' },
            ]}
          />
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Output Tax" value={formatCurrency(report.totalOutput)} icon={FiTrendingUp} tone="success" />
        <StatCard label="Input Tax" value={formatCurrency(report.totalInput)} icon={FiTrendingDown} tone="danger" />
        <StatCard label="Net Payable" value={formatCurrency(report.netPayable)} icon={FiPercent} tone="primary" />
        <StatCard label="Invoice Tax" value={formatCurrency(report.invoiceTax)} icon={FiFileText} tone="accent" />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Tax by Rate" subtitle="Output vs Input" />
          <BarsChart data={merged.map((r) => ({ rate: `${r.rate}%`, outputTax: r.outputTax, inputTax: r.inputTax }))}
            xKey="rate" bars={[{ key: 'outputTax', color: '#10B981' }, { key: 'inputTax', color: '#EF4444' }]} />
        </Card>
        <Card>
          <CardHeader title="Net Tax Liability" subtitle="Output − Input per rate" />
          <BarsChart data={merged.map((r) => ({ rate: `${r.rate}%`, net: r.net }))}
            xKey="rate" bars={[{ key: 'net', color: '#2563EB' }]} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Output Tax (collected)" />
          <DataTable columns={outputCols} data={report.outputRows} empty="No output tax" />
        </Card>
        <Card>
          <CardHeader title="Input Tax (paid)" />
          <DataTable columns={inputCols} data={report.inputRows} empty="No input tax" />
        </Card>
      </div>

      <Card className="mt-4">
        <div className="flex items-center justify-between border-t border-app p-4 text-sm">
          <span className="text-muted"><FiDollarSign className="mr-1 inline" /> Net GST payable for the period</span>
          <span className="text-lg font-semibold">{formatCurrency(report.netPayable)}</span>
        </div>
      </Card>
    </div>
  )
}
