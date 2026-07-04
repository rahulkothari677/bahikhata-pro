'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { offlineFetch } from '@/lib/offline-fetch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis, Cell, Pie, PieChart,
} from 'recharts'
import {
  Users, TrendingUp, DollarSign, Activity, Brain, Zap,
  RefreshCw, ArrowUpRight, ArrowDownRight, ShoppingCart,
  Package, UserCheck, Star,
} from 'lucide-react'

const COLORS = ['#d97706', '#059669', '#2563eb', '#7c3aed', '#dc2626']

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'features' | 'ai'>('overview')

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur-md border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-saffron flex items-center justify-center">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Admin Dashboard</h1>
              <p className="text-xs text-muted-foreground">BahiKhata Pro — Business Intelligence</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </Badge>
            <a href="/">
              <Button variant="outline" size="sm">Back to App</Button>
            </a>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-border bg-background">
        <div className="max-w-7xl mx-auto px-6">
          <nav className="flex gap-1 -mb-px">
            {[
              { id: 'overview', label: 'Overview', icon: Activity },
              { id: 'users', label: 'Users', icon: Users },
              { id: 'features', label: 'Features', icon: Zap },
              { id: 'ai', label: 'AI Usage', icon: Brain },
            ].map(tab => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition ${
                    activeTab === tab.id
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              )
            })}
          </nav>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'users' && <UsersTab />}
        {activeTab === 'features' && <FeaturesTab />}
        {activeTab === 'ai' && <AITab />}
      </main>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════════════════════════════

function OverviewTab() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-overview'],
    queryFn: async () => {
      const r = await offlineFetch('/api/admin/overview')
      if (!r.ok) throw new Error('Failed')
      return r.json()
    },
    refetchInterval: 30000, // refresh every 30s
  })

  if (isLoading) return <OverviewSkeleton />

  const { users, engagement, business, ai, revenue, recentSignups } = data

  return (
    <div className="space-y-6">
      {/* KPI Cards Row 1 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Users"
          value={users.total}
          subtitle={`+${users.newToday} today`}
          icon={Users}
          color="text-blue-600"
          bg="bg-blue-100"
        />
        <KPICard
          title="Active Today (DAU)"
          value={engagement.DAU}
          subtitle={`${engagement.stickiness.toFixed(1)}% stickiness`}
          icon={Activity}
          color="text-emerald-600"
          bg="bg-emerald-100"
        />
        <KPICard
          title="Total GMV"
          value={`₹${(business.totalGMV / 100000).toFixed(1)}L`}
          subtitle={`${business.totalTransactions} transactions`}
          icon={DollarSign}
          color="text-amber-600"
          bg="bg-amber-100"
        />
        <KPICard
          title="AI Scans"
          value={ai.totalScans}
          subtitle={`${ai.successRate.toFixed(0)}% success`}
          icon={Brain}
          color="text-violet-600"
          bg="bg-violet-100"
        />
      </div>

      {/* KPI Cards Row 2 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Weekly Active"
          value={engagement.WAU}
          subtitle={`+${users.newThisWeek} new this week`}
          icon={UserCheck}
          color="text-teal-600"
          bg="bg-teal-100"
        />
        <KPICard
          title="Monthly Active"
          value={engagement.MAU}
          subtitle={`+${users.newThisMonth} new this month`}
          icon={TrendingUp}
          color="text-indigo-600"
          bg="bg-indigo-100"
        />
        <KPICard
          title="Total Products"
          value={business.totalProducts}
          subtitle={`${business.avgTransactionsPerUser.toFixed(1)} txn/user`}
          icon={Package}
          color="text-rose-600"
          bg="bg-rose-100"
        />
        <KPICard
          title="MRR"
          value={`₹${revenue.MRR.toLocaleString('en-IN')}`}
          subtitle={`${revenue.payingUsers} paying users`}
          icon={Star}
          color="text-yellow-600"
          bg="bg-yellow-100"
        />
      </div>

      {/* Recent Signups Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Recent Signups</span>
            <Button variant="ghost" size="sm" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-2 font-medium">User</th>
                  <th className="pb-2 font-medium">Shop</th>
                  <th className="pb-2 font-medium">Role</th>
                  <th className="pb-2 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody>
                {recentSignups.map((user: any) => (
                  <tr key={user.id} className="border-b border-border/40">
                    <td className="py-3">
                      <div>
                        <p className="font-medium">{user.name || 'No name'}</p>
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                      </div>
                    </td>
                    <td className="py-3 text-muted-foreground">—</td>
                    <td className="py-3">
                      <Badge variant={user.role === 'owner' ? 'default' : 'secondary'}>
                        {user.role}
                      </Badge>
                    </td>
                    <td className="py-3 text-muted-foreground text-xs">
                      {new Date(user.createdAt).toLocaleDateString('en-IN', {
                        day: '2-digit', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function KPICard({ title, value, subtitle, icon: Icon, color, bg }: any) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${bg}`}>
            <Icon className={`w-5 h-5 ${color}`} />
          </div>
        </div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{title}</p>
        <p className="text-xs text-muted-foreground/70 mt-0.5">{subtitle}</p>
      </CardContent>
    </Card>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// USERS TAB
// ═══════════════════════════════════════════════════════════════════════════

function UsersTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const r = await offlineFetch('/api/admin/users')
      if (!r.ok) throw new Error('Failed')
      return r.json()
    },
  })

  if (isLoading) return <div className="space-y-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-64 w-full" />)}</div>

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Signup Trend Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Signup Trend (Last 30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={data.signupsByDay}>
                <defs>
                  <linearGradient id="signupGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#d97706" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#d97706" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={4} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                <Area type="monotone" dataKey="count" stroke="#d97706" fill="url(#signupGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
            <div className="flex justify-between text-xs text-muted-foreground mt-2">
              <span>Total new (30d): <b>{data.totalNewUsers30Days}</b></span>
              <span>Avg/day: <b>{data.avgSignupsPerDay.toFixed(1)}</b></span>
            </div>
          </CardContent>
        </Card>

        {/* Geographic Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Geographic Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {data.geographicDistribution.length === 0 ? (
              <div className="text-center text-muted-foreground py-12 text-sm">
                No geographic data yet. Users need to set their state in Settings.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={data.geographicDistribution.slice(0, 10)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                  <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                  <YAxis dataKey="state" type="category" tick={{ fontSize: 10 }} width={80} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#2563eb" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Users (Last 50)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-2 font-medium">Name</th>
                  <th className="pb-2 font-medium">Email</th>
                  <th className="pb-2 font-medium">Shop</th>
                  <th className="pb-2 font-medium">State</th>
                  <th className="pb-2 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody>
                {data.recentUsers.map((user: any) => (
                  <tr key={user.id} className="border-b border-border/40">
                    <td className="py-2 font-medium">{user.name || 'No name'}</td>
                    <td className="py-2 text-muted-foreground">{user.email}</td>
                    <td className="py-2 text-muted-foreground">{user.shopName}</td>
                    <td className="py-2">
                      <Badge variant="outline">{user.state}</Badge>
                    </td>
                    <td className="py-2 text-muted-foreground text-xs">
                      {new Date(user.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// FEATURES TAB
// ═══════════════════════════════════════════════════════════════════════════

function FeaturesTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-features'],
    queryFn: async () => {
      const r = await offlineFetch('/api/admin/features')
      if (!r.ok) throw new Error('Failed')
      return r.json()
    },
  })

  if (isLoading) return <div className="space-y-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-64 w-full" />)}</div>

  return (
    <div className="space-y-6">
      {/* Top Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-primary">{data.totalEvents.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">Total Events (30d)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-emerald-600">{data.totalActiveUsers}</p>
            <p className="text-xs text-muted-foreground mt-1">Active Users (30d)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-blue-600">{data.featureUsage.length}</p>
            <p className="text-xs text-muted-foreground mt-1">Features Tracked</p>
          </CardContent>
        </Card>
      </div>

      {/* Feature Usage Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Feature Usage Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-2 font-medium">Feature</th>
                  <th className="pb-2 font-medium text-right">Total Uses</th>
                  <th className="pb-2 font-medium text-right">Unique Users</th>
                  <th className="pb-2 font-medium text-right">Avg/User</th>
                  <th className="pb-2 font-medium text-right">Adoption %</th>
                </tr>
              </thead>
              <tbody>
                {data.featureUsage.map((f: any, i: number) => (
                  <tr key={f.action} className="border-b border-border/40">
                    <td className="py-2 font-medium flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                      {f.action}
                    </td>
                    <td className="py-2 text-right">{f.count.toLocaleString()}</td>
                    <td className="py-2 text-right">{f.uniqueUsers}</td>
                    <td className="py-2 text-right text-muted-foreground">{f.avgPerUser.toFixed(1)}</td>
                    <td className="py-2 text-right">
                      <span className={`font-medium ${f.adoptionRate > 50 ? 'text-emerald-600' : f.adoptionRate > 20 ? 'text-amber-600' : 'text-rose-600'}`}>
                        {f.adoptionRate.toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Usage Trend Chart */}
      {data.usageByDay.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Feature Usage Trend (Top 5)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={data.usageByDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={4} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                {data.featureUsage.slice(0, 5).map((f: any, i: number) => (
                  <Area
                    key={f.action}
                    type="monotone"
                    dataKey={f.action}
                    stackId="1"
                    stroke={COLORS[i % COLORS.length]}
                    fill={COLORS[i % COLORS.length]}
                    fillOpacity={0.3}
                    strokeWidth={2}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// AI USAGE TAB
// ═══════════════════════════════════════════════════════════════════════════

function AITab() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-ai-usage'],
    queryFn: async () => {
      const r = await offlineFetch('/api/admin/ai-usage')
      if (!r.ok) throw new Error('Failed')
      return r.json()
    },
  })

  if (isLoading) return <div className="space-y-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-64 w-full" />)}</div>

  const { summary, costs, trends, pricingAnalysis } = data

  return (
    <div className="space-y-6">
      {/* AI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Scans (30d)"
          value={summary.totalScansAttempted}
          subtitle={`${summary.successRate.toFixed(1)}% success`}
          icon={Brain}
          color="text-violet-600"
          bg="bg-violet-100"
        />
        <KPICard
          title="Unique AI Users"
          value={summary.uniqueAIScanners}
          subtitle={`${summary.avgScansPerUser.toFixed(1)} scans/user`}
          icon={Users}
          color="text-blue-600"
          bg="bg-blue-100"
        />
        <KPICard
          title="Total AI Cost"
          value={`₹${costs.totalCostInr.toFixed(2)}`}
          subtitle={`₹${costs.avgCostPerUser.toFixed(2)}/user`}
          icon={DollarSign}
          color="text-rose-600"
          bg="bg-rose-100"
        />
        <KPICard
          title="Voice Parses"
          value={summary.totalVoiceAttempts}
          subtitle={`${summary.voiceSuccessRate.toFixed(0)}% success`}
          icon={Zap}
          color="text-amber-600"
          bg="bg-amber-100"
        />
      </div>

      {/* Scans Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI Scans Trend (Last 30 Days)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={trends.scansByDay}>
              <defs>
                <linearGradient id="scanGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="successGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#059669" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={4} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Area type="monotone" dataKey="scans" stroke="#7c3aed" fill="url(#scanGrad)" strokeWidth={2} name="Attempted" />
              <Area type="monotone" dataKey="success" stroke="#059669" fill="url(#successGrad)" strokeWidth={2} name="Succeeded" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Pricing Analysis */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pricing Profitability Analysis</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Per-user economics at current AI cost (₹{costs.costPerScanInr}/scan)
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Pro Tier */}
            <div className="border border-border rounded-xl p-4 bg-emerald-50 dark:bg-emerald-950/20">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-emerald-900 dark:text-emerald-400">Pro Tier</h3>
                <Badge className="bg-emerald-600">₹{pricingAnalysis.proTierPrice}/mo</Badge>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Includes</span>
                  <span>{pricingAnalysis.proTierScanLimit} scans/mo</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cost per user</span>
                  <span className="text-rose-600">₹{pricingAnalysis.proTierCostPerUser.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Profit per user</span>
                  <span className="text-emerald-600 font-bold">₹{pricingAnalysis.proTierProfitPerUser.toFixed(2)}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-2 mt-2">
                  <span className="font-medium">Margin</span>
                  <span className="font-bold text-emerald-600">{pricingAnalysis.proTierMargin.toFixed(1)}%</span>
                </div>
              </div>
            </div>

            {/* Business Tier */}
            <div className="border border-border rounded-xl p-4 bg-amber-50 dark:bg-amber-950/20">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-amber-900 dark:text-amber-400">Business Tier</h3>
                <Badge className="bg-amber-600">₹{pricingAnalysis.businessTierPrice}/mo</Badge>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Avg usage</span>
                  <span>{pricingAnalysis.businessTierAvgScans} scans/mo</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cost per user</span>
                  <span className="text-rose-600">₹{pricingAnalysis.businessTierCostPerUser.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Profit per user</span>
                  <span className="text-amber-600 font-bold">₹{pricingAnalysis.businessTierProfitPerUser.toFixed(2)}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-2 mt-2">
                  <span className="font-medium">Margin</span>
                  <span className="font-bold text-amber-600">{pricingAnalysis.businessTierMargin.toFixed(1)}%</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// SKELETONS
// ═══════════════════════════════════════════════════════════════════════════

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  )
}
