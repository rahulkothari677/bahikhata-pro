'use client'

import { useState } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity, Users, Zap, Brain, LogOut, RefreshCw, TrendingUp,
  DollarSign, Package, UserCheck, Star, ShoppingCart,
  ArrowUpRight, ArrowDownRight, Settings, ToggleLeft, ToggleRight,
  Megaphone, Search, Ban, CheckCircle, Crown, Plus, Trash2,
  FileText, AlertTriangle, Database, HardDrive, IndianRupee,
  Calendar, XCircle, Gift, Save,
} from 'lucide-react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'

const COLORS = ['#d97706', '#059669', '#2563eb', '#7c3aed', '#dc2626']

export default function AdminDashboard() {
  const { data: session, status } = useSession()
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'features' | 'ai' | 'controls' | 'subscriptions' | 'system' | 'revenue' | 'content'>('overview')

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!session) {
    window.location.href = '/login'
    return null
  }

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur-md border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-saffron flex items-center justify-center">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Admin Dashboard</h1>
              <p className="text-xs text-muted-foreground">BahiKhata Pro · Business Intelligence</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Live</span>
            </div>
            <span className="text-sm text-muted-foreground hidden sm:block">{session.user?.email}</span>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-border bg-background">
        <div className="max-w-7xl mx-auto px-6">
          <nav className="flex gap-1 -mb-px overflow-x-auto">
            {[
              { id: 'overview', label: 'Overview', icon: Activity },
              { id: 'users', label: 'Users', icon: Users },
              { id: 'features', label: 'Features', icon: Zap },
              { id: 'ai', label: 'AI Usage', icon: Brain },
              { id: 'controls', label: 'Controls', icon: Settings },
              { id: 'subscriptions', label: 'Subscriptions', icon: Crown },
              { id: 'revenue', label: 'Revenue', icon: DollarSign },
              { id: 'system', label: 'System', icon: Package },
              { id: 'content', label: 'Content', icon: FileText },
            ].map(tab => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition whitespace-nowrap ${
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
        {activeTab === 'controls' && <ControlsTab />}
        {activeTab === 'subscriptions' && <SubscriptionsTab />}
        {activeTab === 'revenue' && <RevenueTab />}
        {activeTab === 'system' && <SystemTab />}
        {activeTab === 'content' && <ContentTab />}
      </main>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// API fetcher
// ═══════════════════════════════════════════════════════════════════════════

async function fetchAPI(path: string) {
  const r = await fetch(path)
  if (!r.ok) {
    if (r.status === 401) window.location.href = '/login'
    throw new Error(`API error: ${r.status}`)
  }
  return r.json()
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════════════════════════════

function OverviewTab() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-overview'],
    queryFn: () => fetchAPI('/api/admin/overview'),
    refetchInterval: 30000,
  })

  if (isLoading || !data) return <SkeletonGrid count={8} />

  const { users, engagement, business, ai, revenue, recentSignups } = data

  return (
    <div className="space-y-6">
      {/* KPI Row 1 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Total Users" value={users.total} subtitle={`+${users.newToday} today`} icon={Users} color="text-blue-600" bg="bg-blue-100" />
        <KPICard title="Active Today (DAU)" value={engagement.DAU} subtitle={`${engagement.stickiness.toFixed(1)}% sticky`} icon={Activity} color="text-emerald-600" bg="bg-emerald-100" />
        <KPICard title="Total GMV" value={`₹${(business.totalGMV / 100000).toFixed(1)}L`} subtitle={`${business.totalTransactions} txns`} icon={DollarSign} color="text-amber-600" bg="bg-amber-100" />
        <KPICard title="AI Scans" value={ai.totalScans} subtitle={`${ai.successRate.toFixed(0)}% success`} icon={Brain} color="text-violet-600" bg="bg-violet-100" />
      </div>

      {/* KPI Row 2 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Weekly Active" value={engagement.WAU} subtitle={`+${users.newThisWeek} this week`} icon={UserCheck} color="text-teal-600" bg="bg-teal-100" />
        <KPICard title="Monthly Active" value={engagement.MAU} subtitle={`+${users.newThisMonth} this month`} icon={TrendingUp} color="text-indigo-600" bg="bg-indigo-100" />
        <KPICard title="Products" value={business.totalProducts} subtitle={`${business.avgTransactionsPerUser.toFixed(1)} txn/user`} icon={Package} color="text-rose-600" bg="bg-rose-100" />
        <KPICard title="MRR" value={`₹${revenue.MRR.toLocaleString('en-IN')}`} subtitle={`${revenue.payingUsers} paying`} icon={Star} color="text-yellow-600" bg="bg-yellow-100" />
      </div>

      {/* Recent Signups */}
      <Card title="Recent Signups" action={<button onClick={() => refetch()} className="text-muted-foreground hover:text-foreground"><RefreshCw className="w-4 h-4" /></button>}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="pb-2 font-medium">User</th>
              <th className="pb-2 font-medium">Role</th>
              <th className="pb-2 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody>
            {recentSignups.map((user: any) => (
              <tr key={user.id} className="border-b border-border/40">
                <td className="py-3">
                  <p className="font-medium">{user.name || 'No name'}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </td>
                <td className="py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${user.role === 'owner' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                    {user.role}
                  </span>
                </td>
                <td className="py-3 text-xs text-muted-foreground">
                  {new Date(user.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// USERS TAB
// ═══════════════════════════════════════════════════════════════════════════

function UsersTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => fetchAPI('/api/admin/users'),
  })

  if (isLoading || !data) return <SkeletonGrid count={2} />

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Signup Trend (30 days)">
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={data.signupsByDay}>
              <defs>
                <linearGradient id="grad1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#d97706" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#d97706" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={4} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Area type="monotone" dataKey="count" stroke="#d97706" fill="url(#grad1)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
          <div className="flex justify-between text-xs text-muted-foreground mt-2">
            <span>Total: <b>{data.totalNewUsers30Days}</b></span>
            <span>Avg/day: <b>{data.avgSignupsPerDay.toFixed(1)}</b></span>
          </div>
        </Card>

        <Card title="Geographic Distribution">
          {data.geographicDistribution.length === 0 ? (
            <div className="text-center text-muted-foreground py-12 text-sm">No geographic data yet</div>
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
        </Card>
      </div>

      <Card title="Recent Users (Last 50)">
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
                  <td className="py-2"><span className="text-xs px-2 py-0.5 rounded-full bg-muted">{user.state}</span></td>
                  <td className="py-2 text-muted-foreground text-xs">{new Date(user.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
    queryFn: () => fetchAPI('/api/admin/features'),
  })

  if (isLoading || !data) return <SkeletonGrid count={3} />

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <StatCard value={data.totalEvents.toLocaleString()} label="Events (30d)" color="text-primary" />
        <StatCard value={data.totalActiveUsers} label="Active Users" color="text-emerald-600" />
        <StatCard value={data.featureUsage.length} label="Features Tracked" color="text-blue-600" />
      </div>

      <Card title="Feature Usage Breakdown">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="pb-2 font-medium">Feature</th>
              <th className="pb-2 font-medium text-right">Uses</th>
              <th className="pb-2 font-medium text-right">Users</th>
              <th className="pb-2 font-medium text-right">Avg/User</th>
              <th className="pb-2 font-medium text-right">Adoption</th>
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
      </Card>

      {data.usageByDay.length > 0 && (
        <Card title="Feature Usage Trend (Top 5)">
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={data.usageByDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={4} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              {data.featureUsage.slice(0, 5).map((f: any, i: number) => (
                <Area key={f.action} type="monotone" dataKey={f.action} stackId="1" stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.3} strokeWidth={2} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
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
    queryKey: ['admin-ai'],
    queryFn: () => fetchAPI('/api/admin/ai-usage'),
  })

  if (isLoading || !data) return <SkeletonGrid count={4} />

  const { summary, costs, trends, pricingAnalysis } = data

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Scans (30d)" value={summary.totalScansAttempted} subtitle={`${summary.successRate.toFixed(1)}% success`} icon={Brain} color="text-violet-600" bg="bg-violet-100" />
        <KPICard title="AI Users" value={summary.uniqueAIScanners} subtitle={`${summary.avgScansPerUser.toFixed(1)} scans/user`} icon={Users} color="text-blue-600" bg="bg-blue-100" />
        <KPICard title="AI Cost" value={`₹${costs.totalCostInr.toFixed(2)}`} subtitle={`₹${costs.avgCostPerUser.toFixed(2)}/user`} icon={DollarSign} color="text-rose-600" bg="bg-rose-100" />
        <KPICard title="Voice Parses" value={summary.totalVoiceAttempts} subtitle={`${summary.voiceSuccessRate.toFixed(0)}% success`} icon={Zap} color="text-amber-600" bg="bg-amber-100" />
      </div>

      <Card title="AI Scans Trend (30 days)">
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
      </Card>

      <Card title="Pricing Profitability Analysis">
        <p className="text-xs text-muted-foreground mb-4">Per-user economics at ₹{costs.costPerScanInr}/scan</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-emerald-200 dark:border-emerald-900 rounded-xl p-4 bg-emerald-50 dark:bg-emerald-950/20">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-emerald-900 dark:text-emerald-400">Pro Tier</h3>
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-600 text-white">₹{pricingAnalysis.proTierPrice}/mo</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Includes</span><span>{pricingAnalysis.proTierScanLimit} scans</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Cost/user</span><span className="text-rose-600">₹{pricingAnalysis.proTierCostPerUser.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Profit/user</span><span className="text-emerald-600 font-bold">₹{pricingAnalysis.proTierProfitPerUser.toFixed(2)}</span></div>
              <div className="flex justify-between border-t border-border pt-2 mt-2"><span className="font-medium">Margin</span><span className="font-bold text-emerald-600">{pricingAnalysis.proTierMargin.toFixed(1)}%</span></div>
            </div>
          </div>

          <div className="border border-amber-200 dark:border-amber-900 rounded-xl p-4 bg-amber-50 dark:bg-amber-950/20">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-amber-900 dark:text-amber-400">Business Tier</h3>
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-600 text-white">₹{pricingAnalysis.businessTierPrice}/mo</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Avg usage</span><span>{pricingAnalysis.businessTierAvgScans} scans</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Cost/user</span><span className="text-rose-600">₹{pricingAnalysis.businessTierCostPerUser.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Profit/user</span><span className="text-amber-600 font-bold">₹{pricingAnalysis.businessTierProfitPerUser.toFixed(2)}</span></div>
              <div className="flex justify-between border-t border-border pt-2 mt-2"><span className="font-medium">Margin</span><span className="font-bold text-amber-600">{pricingAnalysis.businessTierMargin.toFixed(1)}%</span></div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function KPICard({ title, value, subtitle, icon: Icon, color, bg }: any) {
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${bg} mb-2`}>
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{title}</p>
      <p className="text-xs text-muted-foreground/70 mt-0.5">{subtitle}</p>
    </div>
  )
}

function StatCard({ value, label, color }: any) {
  return (
    <div className="bg-card rounded-xl border border-border p-4 text-center">
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  )
}

function Card({ title, action, children }: any) {
  return (
    <div className="bg-card rounded-xl border border-border">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="font-semibold text-sm">{title}</h3>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function SkeletonGrid({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {[...Array(count)].map((_, i) => (
        <div key={i} className="bg-card rounded-xl border border-border p-4 h-32 animate-pulse">
          <div className="w-10 h-10 rounded-xl bg-muted mb-2" />
          <div className="h-6 w-20 bg-muted rounded mb-2" />
          <div className="h-3 w-16 bg-muted rounded" />
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTROLS TAB — Feature Flags + User Management + Announcements
// ═══════════════════════════════════════════════════════════════════════════

function ControlsTab() {
  return (
    <div className="space-y-6">
      <FeatureFlagsSection />
      <UserManagementSection />
      <AnnouncementsSection />
    </div>
  )
}

function FeatureFlagsSection() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-feature-flags'],
    queryFn: () => fetchAPI('/api/admin/feature-flags'),
  })

  const toggleFlag = async (key: string, enabled: boolean) => {
    await fetch('/api/admin/feature-flags', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, enabled: !enabled }),
    })
    refetch()
  }

  if (isLoading || !data) return <div className="h-40 bg-card rounded-xl border border-border animate-pulse" />

  return (
    <Card title="Feature Flags — Remote Control" subtitle="Toggle features on/off without deploying new code">
      <div className="space-y-2">
        {data.flags.map((flag: any) => (
          <div key={flag.key} className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/30 transition">
            <div className="flex-1">
              <p className="text-sm font-medium">{flag.label}</p>
              <p className="text-xs text-muted-foreground">{flag.description}</p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">Key: {flag.key}</p>
            </div>
            <button
              onClick={() => toggleFlag(flag.key, flag.enabled)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                flag.enabled
                  ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                  : 'bg-rose-100 text-rose-700 hover:bg-rose-200'
              }`}
            >
              {flag.enabled ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
              {flag.enabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        ))}
      </div>
    </Card>
  )
}

function UserManagementSection() {
  const [search, setSearch] = useState('')
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-users-manage', search],
    queryFn: () => fetchAPI(`/api/admin/users-manage?search=${encodeURIComponent(search)}`),
  })

  const changePlan = async (userId: string, plan: string) => {
    await fetch('/api/admin/users-manage', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, action: 'change_plan', plan }),
    })
    refetch()
  }

  const toggleBlock = async (userId: string, isBlocked: boolean) => {
    await fetch('/api/admin/users-manage', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, action: isBlocked ? 'unblock' : 'block' }),
    })
    refetch()
  }

  return (
    <Card title="User Management" subtitle="Change plans, block/unblock users">
      <div className="mb-4 flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email or name..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      {isLoading || !data ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="pb-2 font-medium">User</th>
                <th className="pb-2 font-medium">Plan</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((user: any) => (
                <tr key={user.id} className="border-b border-border/40">
                  <td className="py-2">
                    <p className="font-medium">{user.name || 'No name'}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </td>
                  <td className="py-2">
                    <select
                      value={user.plan}
                      onChange={(e) => changePlan(user.id, e.target.value)}
                      className="text-xs border border-border rounded-lg px-2 py-1 bg-background"
                    >
                      <option value="free">Free</option>
                      <option value="pro">Pro</option>
                      <option value="business">Business</option>
                      <option value="enterprise">Enterprise</option>
                    </select>
                  </td>
                  <td className="py-2">
                    {user.role === 'blocked' ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">Blocked</span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Active</span>
                    )}
                  </td>
                  <td className="py-2">
                    <button
                      onClick={() => toggleBlock(user.id, user.role === 'blocked')}
                      className={`text-xs px-2 py-1 rounded-lg ${
                        user.role === 'blocked'
                          ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                          : 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                      }`}
                    >
                      {user.role === 'blocked' ? 'Unblock' : 'Block'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground mt-3">Showing {data.users.length} of {data.total} users</p>
        </div>
      )}
    </Card>
  )
}

function AnnouncementsSection() {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ title: '', message: '', type: 'info', link: '' })
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-announcements'],
    queryFn: () => fetchAPI('/api/admin/announcements'),
  })

  const createAnnouncement = async () => {
    if (!form.title || !form.message) return
    await fetch('/api/admin/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setForm({ title: '', message: '', type: 'info', link: '' })
    setShowForm(false)
    refetch()
  }

  const toggleAnnouncement = async (id: string, isActive: boolean) => {
    await fetch('/api/admin/announcements', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, isActive: !isActive }),
    })
    refetch()
  }

  const deleteAnnouncement = async (id: string) => {
    if (!confirm('Delete this announcement?')) return
    await fetch(`/api/admin/announcements?id=${id}`, { method: 'DELETE' })
    refetch()
  }

  return (
    <Card title="Announcements" subtitle="Broadcast messages to all users (shown as banner in app)">
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          <Plus className="w-4 h-4" /> New Announcement
        </button>
      ) : (
        <div className="space-y-3 p-4 border border-border rounded-xl bg-muted/30">
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Title (e.g. 'New Feature: Barcode Scanner!')"
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          />
          <textarea
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
            placeholder="Message (e.g. 'We just launched barcode scanning. Try it now!')"
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            rows={3}
          />
          <div className="flex gap-2">
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="px-3 py-2 rounded-lg border border-border bg-background text-sm"
            >
              <option value="info">Info (blue)</option>
              <option value="success">Success (green)</option>
              <option value="warning">Warning (amber)</option>
              <option value="error">Error (red)</option>
            </select>
            <input
              type="text"
              value={form.link}
              onChange={(e) => setForm({ ...form, link: e.target.value })}
              placeholder="Optional link (e.g. /#pricing)"
              className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowForm(false)} className="px-3 py-2 rounded-lg border border-border text-sm">Cancel</button>
            <button onClick={createAnnouncement} className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">Publish</button>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {isLoading || !data ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : data.announcements.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-4">No announcements yet.</div>
        ) : (
          data.announcements.map((a: any) => (
            <div key={a.id} className="p-3 rounded-lg border border-border flex items-start gap-3">
              <Megaphone className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{a.title}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    a.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'
                  }`}>{a.isActive ? 'Active' : 'Inactive'}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{a.message}</p>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => toggleAnnouncement(a.id, a.isActive)}
                  className="text-xs px-2 py-1 rounded-lg bg-muted hover:bg-muted/70"
                >
                  {a.isActive ? 'Deactivate' : 'Activate'}
                </button>
                <button
                  onClick={() => deleteAnnouncement(a.id)}
                  className="p-1 rounded-lg text-rose-600 hover:bg-rose-100"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// SUBSCRIPTIONS TAB
// ═══════════════════════════════════════════════════════════════════════════

function SubscriptionsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-subscriptions'],
    queryFn: () => fetchAPI('/api/admin/subscriptions'),
  })

  if (isLoading || !data) return <SkeletonGrid count={4} />

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard value={data.activeCount} label="Active Subs" color="text-emerald-600" />
        <StatCard value={`₹${data.totalRevenue.toLocaleString('en-IN')}`} label="Total Revenue" color="text-amber-600" />
        <StatCard value={data.churnedCount} label="Churned" color="text-rose-600" />
        <StatCard value={data.total} label="Total (all time)" color="text-blue-600" />
      </div>

      <Card title="Active Subscriptions + Payment History">
        {data.subscriptions.length === 0 ? (
          <div className="text-center text-muted-foreground py-8 text-sm">No subscriptions yet. They'll appear here when users upgrade.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="pb-2 font-medium">User</th>
                <th className="pb-2 font-medium">Plan</th>
                <th className="pb-2 font-medium">Amount</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {data.subscriptions.map((sub: any) => (
                <tr key={sub.id} className="border-b border-border/40">
                  <td className="py-2"><p className="font-medium">{sub.userName || 'Unknown'}</p><p className="text-xs text-muted-foreground">{sub.userEmail}</p></td>
                  <td className="py-2"><span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{sub.plan}</span></td>
                  <td className="py-2">₹{sub.amount}</td>
                  <td className="py-2"><span className={`text-xs px-2 py-0.5 rounded-full ${sub.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{sub.status}</span></td>
                  <td className="py-2 text-xs text-muted-foreground">{new Date(sub.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {data.recentChurned.length > 0 && (
        <Card title="Recently Churned (Last 30 Days)">
          <div className="space-y-2">
            {data.recentChurned.map((user: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-rose-50 dark:bg-rose-950/20">
                <div><p className="text-sm font-medium">{user.name}</p><p className="text-xs text-muted-foreground">{user.email}</p></div>
                <div className="text-right"><p className="text-xs text-rose-600">Cancelled {new Date(user.cancelledAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</p><p className="text-xs text-muted-foreground">Was on {user.plan}</p></div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Coupon Codes">
        <CouponManager />
      </Card>
    </div>
  )
}

function CouponManager() {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ code: '', discountPercent: 50, maxUses: 100 })
  const { data, refetch } = useQuery({
    queryKey: ['admin-coupons'],
    queryFn: () => fetchAPI('/api/admin/coupons'),
  })

  const createCoupon = async () => {
    if (!form.code) return
    await fetch('/api/admin/coupons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setForm({ code: '', discountPercent: 50, maxUses: 100 })
    setShowForm(false)
    refetch()
  }

  const deleteCoupon = async (code: string) => {
    await fetch(`/api/admin/coupons?id=${code}`, { method: 'DELETE' })
    refetch()
  }

  return (
    <div>
      {!showForm ? (
        <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90">
          <Plus className="w-4 h-4" /> Create Coupon
        </button>
      ) : (
        <div className="space-y-2 p-3 border border-border rounded-xl bg-muted/30">
          <input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="Code (e.g. DIWALI50)" className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
          <div className="flex gap-2">
            <input type="number" value={form.discountPercent} onChange={(e) => setForm({ ...form, discountPercent: parseInt(e.target.value) })} placeholder="Discount %" className="w-32 px-3 py-2 rounded-lg border border-border bg-background text-sm" />
            <input type="number" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: parseInt(e.target.value) })} placeholder="Max uses" className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowForm(false)} className="px-3 py-2 rounded-lg border border-border text-sm">Cancel</button>
            <button onClick={createCoupon} className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">Create</button>
          </div>
        </div>
      )}
      <div className="mt-3 space-y-2">
        {(data?.coupons || []).map((c: any) => (
          <div key={c.code} className="flex items-center justify-between p-2 rounded-lg border border-border">
            <div className="flex items-center gap-2">
              <Gift className="w-4 h-4 text-primary" />
              <div><p className="text-sm font-mono font-bold">{c.code}</p><p className="text-xs text-muted-foreground">{c.discountPercent}% off · {c.uses}/{c.maxUses} used</p></div>
            </div>
            <button onClick={() => deleteCoupon(c.code)} className="text-rose-600 hover:bg-rose-100 p-1 rounded-lg"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
        {(!data?.coupons || data.coupons.length === 0) && <p className="text-sm text-muted-foreground text-center py-2">No coupons yet.</p>}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// REVENUE TAB
// ═══════════════════════════════════════════════════════════════════════════

function RevenueTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-revenue'],
    queryFn: () => fetchAPI('/api/admin/revenue'),
  })

  if (isLoading || !data) return <SkeletonGrid count={4} />

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard value={`₹${data.summary.totalRevenue.toLocaleString('en-IN')}`} label="Total Revenue" color="text-emerald-600" />
        <StatCard value={`₹${data.summary.mrr.toLocaleString('en-IN')}`} label="MRR" color="text-amber-600" />
        <StatCard value={`₹${data.summary.arpu.toFixed(0)}`} label="ARPU" color="text-blue-600" />
        <StatCard value={data.summary.activeSubscriptions} label="Active Subs" color="text-violet-600" />
      </div>

      <Card title="Revenue Trend (12 months)">
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={data.monthlyTrend}>
            <defs>
              <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#059669" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#059669" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Area type="monotone" dataKey="revenue" stroke="#059669" fill="url(#revGrad)" strokeWidth={2} name="Revenue (₹)" />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Revenue by Plan">
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-4 rounded-xl bg-amber-50 dark:bg-amber-950/20">
            <Crown className="w-6 h-6 text-amber-600 mx-auto mb-2" />
            <p className="text-2xl font-bold text-amber-600">₹{data.byPlan.pro.revenue.toLocaleString('en-IN')}</p>
            <p className="text-xs text-muted-foreground">Pro ({data.byPlan.pro.count} users)</p>
          </div>
          <div className="text-center p-4 rounded-xl bg-violet-50 dark:bg-violet-950/20">
            <Package className="w-6 h-6 text-violet-600 mx-auto mb-2" />
            <p className="text-2xl font-bold text-violet-600">₹{data.byPlan.business.revenue.toLocaleString('en-IN')}</p>
            <p className="text-xs text-muted-foreground">Business ({data.byPlan.business.count} users)</p>
          </div>
          <div className="text-center p-4 rounded-xl bg-blue-50 dark:bg-blue-950/20">
            <Star className="w-6 h-6 text-blue-600 mx-auto mb-2" />
            <p className="text-2xl font-bold text-blue-600">₹{data.byPlan.enterprise.revenue.toLocaleString('en-IN')}</p>
            <p className="text-xs text-muted-foreground">Enterprise ({data.byPlan.enterprise.count} users)</p>
          </div>
        </div>
      </Card>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM HEALTH TAB
// ═══════════════════════════════════════════════════════════════════════════

function SystemTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-system-health'],
    queryFn: () => fetchAPI('/api/admin/system-health'),
  })

  if (isLoading || !data) return <SkeletonGrid count={4} />

  const aiStatus = data.ai.status
  const aiColor = aiStatus === 'critical' ? 'text-rose-600' : aiStatus === 'warning' ? 'text-amber-600' : 'text-emerald-600'
  const aiBg = aiStatus === 'critical' ? 'bg-rose-50 dark:bg-rose-950/20' : aiStatus === 'warning' ? 'bg-amber-50 dark:bg-amber-950/20' : 'bg-emerald-50 dark:bg-emerald-950/20'

  return (
    <div className="space-y-6">
      {/* AI Budget */}
      <Card title="AI Usage vs Budget (This Month)">
        <div className={`p-4 rounded-xl ${aiBg} mb-4`}>
          <div className="flex items-center justify-between mb-2">
            <p className={`font-bold ${aiColor}`}>₹{data.ai.costThisMonth.toFixed(2)} / ₹{data.ai.monthlyBudget}</p>
            <span className={`text-sm font-medium ${aiColor}`}>{data.ai.budgetUsedPercent.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div className={`h-2 rounded-full ${aiStatus === 'critical' ? 'bg-rose-500' : aiStatus === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(data.ai.budgetUsedPercent, 100)}%` }} />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-2">
            <span>{data.ai.scansThisMonth} scans × ₹{data.ai.costPerScan} + {data.ai.voiceParsesThisMonth} voice × ₹{data.ai.costPerVoice}</span>
            <span>₹{data.ai.budgetRemaining.toFixed(2)} remaining</span>
          </div>
        </div>
      </Card>

      {/* Database Stats */}
      <Card title="Database Stats">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {data.database.tables.map((t: any) => (
            <div key={t.name} className="p-3 rounded-lg border border-border">
              <p className="text-xl font-bold">{t.count.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">{t.name}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <HardDrive className="w-4 h-4" />
          <span>Total: {data.database.totalRows.toLocaleString()} rows · ~{data.database.estimatedStorageReadable}</span>
        </div>
      </Card>

      {/* Recent Errors */}
      <Card title={`Recent Errors (Last 24h: ${data.errors.last24h})`}>
        {data.errors.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No errors in the last 24 hours! 🎉</p>
        ) : (
          <div className="space-y-1">
            {data.errors.recent.slice(0, 10).map((e: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-rose-50 dark:bg-rose-950/20 text-sm">
                <div className="flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                  <span className="font-mono text-xs">{e.action}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{e.ip || 'unknown IP'}</span>
                  <span>{new Date(e.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Cleanup */}
      <Card title="Data Cleanup">
        <div className="flex items-center justify-between p-3 rounded-lg border border-border">
          <div>
            <p className="text-sm font-medium">Old Audit Logs ({'>'}1 year)</p>
            <p className="text-xs text-muted-foreground">{data.cleanup.oldAuditLogs.toLocaleString()} logs can be cleaned up</p>
          </div>
          {data.cleanup.oldAuditLogs > 1000 ? (
            <span className="text-xs px-3 py-1.5 rounded-lg bg-amber-100 text-amber-700">{data.cleanup.suggestion}</span>
          ) : (
            <span className="text-xs px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-700">No cleanup needed</span>
          )}
        </div>
      </Card>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTENT MANAGEMENT TAB
// ═══════════════════════════════════════════════════════════════════════════

function ContentTab() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-content'],
    queryFn: () => fetchAPI('/api/admin/content'),
  })
  const [editing, setEditing] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')

  if (isLoading || !data) return <SkeletonGrid count={2} />

  const startEdit = (page: any) => {
    setEditing(page.key)
    setEditTitle(page.title)
    setEditContent(page.content)
  }

  const saveContent = async () => {
    await fetch('/api/admin/content', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: editing, title: editTitle, content: editContent }),
    })
    setEditing(null)
    refetch()
  }

  return (
    <div className="space-y-6">
      <Card title="Content Management" subtitle="Edit help articles, terms, and legal pages">
        <div className="space-y-4">
          {data.pages.map((page: any) => (
            <div key={page.key} className="border border-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between p-3 bg-muted/30 border-b border-border">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  <p className="font-medium text-sm">{page.title}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Updated: {new Date(page.updatedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
                  {editing === page.key ? (
                    <button onClick={saveContent} className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-emerald-600 text-white"><Save className="w-3 h-3" /> Save</button>
                  ) : (
                    <button onClick={() => startEdit(page)} className="text-xs px-2 py-1 rounded-lg border border-border hover:bg-muted">Edit</button>
                  )}
                </div>
              </div>
              {editing === page.key ? (
                <div className="p-3 space-y-2">
                  <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
                  <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono" rows={15} />
                  <button onClick={() => setEditing(null)} className="text-xs px-2 py-1 rounded-lg border border-border">Cancel</button>
                </div>
              ) : (
                <div className="p-3">
                  <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-sans max-h-32 overflow-y-auto">{page.content}</pre>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
