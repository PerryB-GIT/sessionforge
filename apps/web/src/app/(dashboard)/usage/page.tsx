'use client'

import { useEffect, useState } from 'react'
import { Clock, Terminal, AlertTriangle, BarChart2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { formatRelativeTime } from '@/lib/utils'
import type { UsageData } from '@/app/api/usage/route'

function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  iconColor = 'text-purple-400',
  valueColor = 'text-white',
}: {
  title: string
  value: string
  sub?: string
  icon: React.ElementType
  iconColor?: string
  valueColor?: string
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-500 mb-1">{title}</p>
            <div className={`text-2xl font-bold ${valueColor}`}>{value}</div>
            {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1e1e2e]">
            <Icon className={`h-5 w-5 ${iconColor}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function UsagePage() {
  const [data, setData] = useState<UsageData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/usage')
      .then((r) => r.json())
      .then((j) => {
        if (j.error) {
          setError(j.error.message ?? 'Failed to load usage data')
        } else {
          setData(j.data)
        }
      })
      .catch(() => setError('Failed to load usage data'))
      .finally(() => setIsLoading(false))
  }, [])

  const now = new Date()
  const monthName = now.toLocaleString('default', { month: 'long', year: 'numeric' })

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-4xl">
        <div>
          <h2 className="text-lg font-semibold text-white">Usage</h2>
          <p className="text-sm text-gray-400">{monthName}</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <div className="animate-pulse space-y-2">
                  <div className="h-3 w-20 rounded bg-[#1e1e2e]" />
                  <div className="h-7 w-16 rounded bg-[#1e1e2e]" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="space-y-6 max-w-4xl">
        <div>
          <h2 className="text-lg font-semibold text-white">Usage</h2>
        </div>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-red-400">
              Unable to load usage data. Please try again later.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const crashColor = data.crashRateThisMonth > 10 ? 'text-red-400' : 'text-gray-400'
  const crashIconColor = data.crashRateThisMonth > 10 ? 'text-red-400' : 'text-gray-500'

  const chartData = data.byMachine.map((m) => ({
    name: m.machineName.length > 12 ? m.machineName.slice(0, 12) + '…' : m.machineName,
    hours: parseFloat(m.hours.toFixed(2)),
    sessions: m.sessions,
  }))

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-lg font-semibold text-white">Usage</h2>
        <p className="text-sm text-gray-400">{monthName}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Agent Hours"
          value={data.agentHoursThisMonth.toFixed(1)}
          sub="this month"
          icon={Clock}
          iconColor="text-purple-400"
        />
        <StatCard
          title="Sessions"
          value={String(data.sessionsThisMonth)}
          sub="this month"
          icon={Terminal}
          iconColor="text-purple-400"
        />
        <StatCard
          title="Crash Rate"
          value={`${data.crashRateThisMonth.toFixed(1)}%`}
          sub={data.crashRateThisMonth > 10 ? 'above threshold' : 'within normal range'}
          icon={AlertTriangle}
          iconColor={crashIconColor}
          valueColor={crashColor}
        />
        <StatCard
          title="Avg Session"
          value={
            data.avgSessionDurationMinutes >= 60
              ? `${(data.avgSessionDurationMinutes / 60).toFixed(1)}h`
              : `${data.avgSessionDurationMinutes.toFixed(0)}m`
          }
          sub="average duration"
          icon={BarChart2}
          iconColor="text-purple-400"
        />
      </div>

      {/* Per-machine breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Per-Machine Breakdown</CardTitle>
          <CardDescription>Sessions and agent hours by machine this month</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.byMachine.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">
              No sessions recorded this month.
            </p>
          ) : (
            <>
              {/* Bar chart — hours by machine */}
              {chartData.length > 0 && (
                <div className="h-40 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                      <XAxis
                        dataKey="name"
                        tick={{ fill: '#6b7280', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: '#6b7280', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        width={32}
                      />
                      <Tooltip
                        contentStyle={{
                          background: '#0f0f14',
                          border: '1px solid #1e1e2e',
                          borderRadius: 8,
                          color: '#fff',
                          fontSize: 12,
                        }}
                        formatter={(value: number) => [`${value}h`, 'Hours']}
                        cursor={{ fill: 'rgba(139,92,246,0.08)' }}
                      />
                      <Bar dataKey="hours" radius={[4, 4, 0, 0]}>
                        {chartData.map((_, i) => (
                          <Cell key={i} fill="#8b5cf6" fillOpacity={0.8} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#1e1e2e]">
                      <th className="text-left py-2 pr-4 text-xs font-medium text-gray-500">
                        Machine
                      </th>
                      <th className="text-right py-2 px-4 text-xs font-medium text-gray-500">
                        Sessions
                      </th>
                      <th className="text-right py-2 px-4 text-xs font-medium text-gray-500">
                        Hours
                      </th>
                      <th className="text-right py-2 pl-4 text-xs font-medium text-gray-500">
                        Last Active
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byMachine.map((m) => (
                      <tr
                        key={m.machineId}
                        className="border-b border-[#1e1e2e] last:border-0 hover:bg-[#1e1e2e]/40 transition-colors"
                      >
                        <td className="py-2.5 pr-4 text-white font-medium">{m.machineName}</td>
                        <td className="py-2.5 px-4 text-right text-gray-300">{m.sessions}</td>
                        <td className="py-2.5 px-4 text-right text-gray-300">
                          {m.hours.toFixed(2)}h
                        </td>
                        <td className="py-2.5 pl-4 text-right text-gray-500">
                          {formatRelativeTime(m.lastActive)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
