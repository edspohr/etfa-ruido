import { useState, useEffect } from 'react';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    PieChart, Pie, Cell, AreaChart, Area
} from 'recharts';
import { collection, query, getDocs, where, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import Layout from '../components/Layout';
import { 
    TrendingUp, DollarSign, Clock, Users, Calendar,
    Filter, RefreshCcw, ArrowUpRight, ArrowDownRight,
    PieChart as PieIcon, Activity, BarChart3
} from 'lucide-react';
import { formatCurrency } from '../utils/format';
import { sortProjects } from '../utils/sort';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

export default function AdminAnalytics() {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState({
        invoices: [],
        expenses: [],
        projects: []
    });
    
    // Filters
    const [filters, setFilters] = useState({
        client: 'all',
        project: 'all',
        dateRange: 'all'
    });

    const [clients, setClients] = useState([]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [invSnap, expSnap, projSnap] = await Promise.all([
                getDocs(query(collection(db, "invoices"), orderBy("createdAt", "desc"))),
                getDocs(query(collection(db, "expenses"), where("status", "==", "approved"))),
                getDocs(collection(db, "projects"))
            ]);

            const parseDocDate = (val) => {
                if (!val) return new Date();
                if (typeof val === 'object' && typeof val.toDate === 'function') return val.toDate();
                const d = new Date(val);
                return isNaN(d.getTime()) ? new Date() : d;
            };

            const invoices = invSnap.docs.map(d => ({ id: d.id, ...d.data(), date: parseDocDate(d.data().createdAt) }));
            const expenses = expSnap.docs.map(d => ({ id: d.id, ...d.data(), date: parseDocDate(d.data().createdAt || d.data().date) }));
            const projects = projSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.status !== "deleted");

            setData({ invoices, expenses, projects: sortProjects(projects) });
            
            const uniqueClients = [...new Set(projects.map(p => p.client).filter(Boolean))].sort();
            setClients(uniqueClients);
        } catch (error) {
            console.error("Error fetching analytics data:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    // Apply filtering logic
    const getFilteredData = () => {
        let { invoices, expenses, projects } = data;
        
        const now = new Date();
        const filterByDate = (date) => {
            if (!date || !(date instanceof Date) || isNaN(date.getTime())) return true;
            if (filters.dateRange === 'last_30') return (now - date) / (1000 * 60 * 60 * 24) <= 30;
            if (filters.dateRange === 'last_90') return (now - date) / (1000 * 60 * 60 * 24) <= 90;
            if (filters.dateRange === 'this_year') return date.getFullYear() === now.getFullYear();
            return true;
        };

        const filteredInvoices = invoices.filter(inv => {
            const proj = projects.find(p => p.id === inv.projectId);
            if (filters.client !== 'all') {
                const projClient = proj?.client;
                if (projClient !== filters.client && inv.clientName !== filters.client) return false;
            }
            if (filters.project !== 'all' && inv.projectId !== filters.project) return false;
            return filterByDate(inv.date);
        });

        const filteredExpenses = expenses.filter(exp => {
            const proj = projects.find(p => p.id === exp.projectId);
            if (filters.client !== 'all' && proj?.client !== filters.client) return false;
            if (filters.project !== 'all' && exp.projectId !== filters.project) return false;
            return filterByDate(exp.date);
        });

        return { filteredInvoices, filteredExpenses };
    };

    const { filteredInvoices, filteredExpenses } = getFilteredData();

    // Metric Calculations
    const totalBilled = filteredInvoices
        .filter(inv => inv.status !== 'void')
        .reduce((acc, inv) => acc + (Number(inv.totalAmount) || 0), 0);
    const totalCollected = filteredInvoices
        .filter(inv => inv.paymentStatus === 'paid')
        .reduce((acc, inv) => acc + (Number(inv.totalAmount) || 0), 0);
    const totalExpenses = filteredExpenses.reduce((acc, exp) => acc + (Number(exp.amount) || 0), 0);
    
    const parseDate = (val) => {
        if (!val) return null;
        if (val.toDate) return val.toDate();
        if (val instanceof Date) return val;
        try { const d = new Date(val); return isNaN(d.getTime()) ? null : d; } catch { return null; }
    };

    // Average Payment Days
    const paidInvoices = filteredInvoices.filter(inv => inv.paymentStatus === 'paid' && inv.paidAt && inv.createdAt);
    const avgPaymentDays = paidInvoices.length > 0 
        ? paidInvoices.reduce((acc, inv) => {
            const created = parseDate(inv.createdAt);
            const paid = parseDate(inv.paidAt);
            if (!created || !paid) return acc;
            return acc + (paid - created) / (1000 * 60 * 60 * 24);
        }, 0) / paidInvoices.length 
        : 0;

    // Margin calculation
    const grossMargin = totalBilled > 0 ? ((totalBilled - totalExpenses) / totalBilled * 100) : 0;

    // Chart Data: Monthly Revenue
    const monthlyRevenue = filteredInvoices
        .filter(inv => inv.status !== 'void')
        .reduce((acc, inv) => {
            if (!inv.date || !(inv.date instanceof Date) || isNaN(inv.date.getTime())) return acc;
            const key = `${inv.date.getFullYear()}-${String(inv.date.getMonth() + 1).padStart(2, '0')}`;
            if (!acc[key]) acc[key] = { key, billed: 0, collected: 0 };
            acc[key].billed += (Number(inv.totalAmount) || 0);
            if (inv.paymentStatus === 'paid') acc[key].collected += (Number(inv.totalAmount) || 0);
            return acc;
        }, {});

    const revenueData = Object.values(monthlyRevenue)
        .sort((a, b) => a.key.localeCompare(b.key))
        .map(item => {
            const [y, m] = item.key.split('-');
            const date = new Date(Number(y), Number(m) - 1);
            const monthName = date.toLocaleString('es-ES', { month: 'short' });
            return { name: `${monthName} ${y}`, ...item };
        });

    // Chart Data: Expenses by Category
    const expensesByCategory = filteredExpenses.reduce((acc, exp) => {
        const cat = exp.category || 'Otros';
        acc[cat] = (acc[cat] || 0) + (Number(exp.amount) || 0);
        return acc;
    }, {});

    const categoryData = Object.entries(expensesByCategory)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);

    // Chart Data: Top Clients by billing
    const clientBilling = filteredInvoices
        .filter(inv => inv.status !== 'void')
        .reduce((acc, inv) => {
            const client = inv.clientName || 'Sin Cliente';
            acc[client] = (acc[client] || 0) + (Number(inv.totalAmount) || 0);
            return acc;
        }, {});

    const topClientsData = Object.entries(clientBilling)
        .map(([name, value]) => ({ name: name.length > 20 ? name.substring(0, 20) + '…' : name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8);

    if (loading) return (
        <Layout title="Analítica de Datos">
            <div className="flex h-96 items-center justify-center">
                <RefreshCcw className="w-8 h-8 text-indigo-600 animate-spin" />
            </div>
        </Layout>
    );

    return (
        <Layout title="Analítica de Datos" isFullWidth={true}>
            <div className="space-y-8 animate-in fade-in duration-500">
                
                {/* Filters Panel */}
                <div className="bg-white/40 backdrop-blur-md border border-white/20 p-6 rounded-[2rem] shadow-xl">
                    <div className="flex flex-wrap items-center gap-6">
                        <div className="flex items-center gap-2 text-slate-500 font-bold text-xs uppercase tracking-widest">
                            <Filter className="w-4 h-4" /> Filtros
                        </div>
                        
                        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4">
                            <select
                                className="bg-white border-transparent focus:ring-2 focus:ring-indigo-500 rounded-xl p-2.5 text-sm font-medium shadow-sm transition-all"
                                value={filters.client}
                                onChange={e => setFilters({...filters, client: e.target.value, project: 'all'})}
                            >
                                <option value="all">Todos los Clientes</option>
                                {clients.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>

                            <select
                                className="bg-white border-transparent focus:ring-2 focus:ring-indigo-500 rounded-xl p-2.5 text-sm font-medium shadow-sm transition-all"
                                value={filters.project}
                                onChange={e => setFilters({...filters, project: e.target.value})}
                            >
                                <option value="all">Todos los Proyectos</option>
                                {data.projects
                                    .filter(p => filters.client === 'all' || p.client === filters.client)
                                    .map(p => <option key={p.id} value={p.id}>{p.code ? `[${p.code}] ` : ''}{p.name}</option>)
                                }
                            </select>

                            <select
                                className="bg-white border-transparent focus:ring-2 focus:ring-indigo-500 rounded-xl p-2.5 text-sm font-medium shadow-sm transition-all"
                                value={filters.dateRange}
                                onChange={e => setFilters({...filters, dateRange: e.target.value})}
                            >
                                <option value="all">Todo el Historial</option>
                                <option value="last_30">Últimos 30 días</option>
                                <option value="last_90">Últimos 90 días</option>
                                <option value="this_year">Este Año ({new Date().getFullYear()})</option>
                            </select>
                        </div>
                        
                        <button 
                            onClick={fetchData}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white p-3 rounded-xl shadow-lg transition-transform hover:scale-105 active:scale-95"
                        >
                            <RefreshCcw className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* KPI Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                    <KPICard 
                        title="Total Facturado" 
                        value={formatCurrency(totalBilled)} 
                        icon={<TrendingUp className="w-6 h-6" />}
                        color="indigo"
                    />
                    <KPICard 
                        title="Recaudación Real" 
                        value={formatCurrency(totalCollected)} 
                        icon={<DollarSign className="w-6 h-6" />}
                        color="emerald"
                        subtitle={totalBilled > 0 ? `${Math.round(totalCollected / totalBilled * 100)}% cobrado` : null}
                    />
                    <KPICard 
                        title="Gastos (OPEX)" 
                        value={formatCurrency(totalExpenses)} 
                        icon={<Activity className="w-6 h-6" />}
                        color="rose"
                    />
                    <KPICard 
                        title="Margen Bruto" 
                        value={`${grossMargin.toFixed(1)}%`} 
                        icon={<ArrowUpRight className="w-6 h-6" />}
                        color={grossMargin >= 0 ? "emerald" : "rose"}
                        subtitle={formatCurrency(totalBilled - totalExpenses)}
                    />
                    <KPICard 
                        title="Tiempo Pago Prom." 
                        value={paidInvoices.length > 0 ? `${Math.round(avgPaymentDays)} días` : 'N/A'} 
                        icon={<Clock className="w-6 h-6" />}
                        color="amber"
                        subtitle={`${paidInvoices.length} facturas pagadas`}
                    />
                </div>

                {/* Charts Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    
                    {/* Revenue Evolution */}
                    <ChartContainer title="Evolución de Ingresos (Mensual)" icon={<BarChart3 className="w-5 h-5" />}>
                        {revenueData.length === 0 ? (
                            <EmptyChartState icon={<BarChart3 />} message="No hay datos de ingresos para los filtros seleccionados" />
                        ) : (
                            <ResponsiveContainer width="100%" height={300}>
                                <AreaChart data={revenueData}>
                                    <defs>
                                        <linearGradient id="colorBilled" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15}/>
                                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                                        </linearGradient>
                                        <linearGradient id="colorCollected" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.15}/>
                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 11}} dy={10} />
                                    <YAxis hide />
                                    <Tooltip 
                                        contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', fontSize: '12px' }}
                                        formatter={(val) => formatCurrency(val)}
                                    />
                                    <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                                    <Area type="monotone" dataKey="billed" name="Facturado" stroke="#6366f1" strokeWidth={2.5} fillOpacity={1} fill="url(#colorBilled)" />
                                    <Area type="monotone" dataKey="collected" name="Recaudado" stroke="#10b981" strokeWidth={2.5} fillOpacity={1} fill="url(#colorCollected)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </ChartContainer>

                    {/* Expenses by Category */}
                    <ChartContainer title="Distribución de Gastos por Categoría" icon={<PieIcon className="w-5 h-5" />}>
                        {categoryData.length === 0 ? (
                            <EmptyChartState icon={<PieIcon />} message="No hay datos de gastos para los filtros seleccionados" />
                        ) : (
                            <div className="flex flex-col md:flex-row items-center h-[300px]">
                                <ResponsiveContainer width="60%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={categoryData}
                                            innerRadius={55}
                                            outerRadius={85}
                                            paddingAngle={4}
                                            dataKey="value"
                                        >
                                            {categoryData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip formatter={(val) => formatCurrency(val)} contentStyle={{ borderRadius: '0.75rem', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: '12px' }} />
                                    </PieChart>
                                </ResponsiveContainer>
                                <div className="w-full md:w-[40%] space-y-2 overflow-y-auto max-h-full pr-4">
                                    {categoryData.map((item, idx) => (
                                        <div key={idx} className="flex items-center justify-between group hover:bg-slate-50 p-1.5 rounded-lg transition">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                                                <span className="text-xs font-semibold text-slate-600 truncate">{item.name}</span>
                                            </div>
                                            <span className="text-xs font-bold text-slate-900 flex-shrink-0 ml-2">{formatCurrency(item.value)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </ChartContainer>

                    {/* Top Clients - NEW */}
                    <ChartContainer title="Top Clientes por Facturación" icon={<Users className="w-5 h-5" />} className="lg:col-span-2">
                        {topClientsData.length === 0 ? (
                            <EmptyChartState icon={<Users />} message="No hay datos de clientes" />
                        ) : (
                            <ResponsiveContainer width="100%" height={280}>
                                <BarChart data={topClientsData} layout="vertical" margin={{ left: 10, right: 30 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                                    <XAxis type="number" hide />
                                    <YAxis 
                                        dataKey="name" 
                                        type="category" 
                                        width={160} 
                                        axisLine={false} 
                                        tickLine={false} 
                                        tick={{ fill: '#475569', fontSize: 11, fontWeight: 600 }} 
                                    />
                                    <Tooltip 
                                        formatter={(val) => formatCurrency(val)} 
                                        contentStyle={{ borderRadius: '0.75rem', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: '12px' }} 
                                    />
                                    <Bar dataKey="value" name="Facturado" fill="#6366f1" radius={[0, 8, 8, 0]} barSize={24} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </ChartContainer>

                </div>
            </div>
        </Layout>
    );
}

function KPICard({ title, value, icon, color, subtitle }) {
    const colors = {
        indigo:  'text-indigo-600 bg-indigo-50 border-indigo-100',
        emerald: 'text-emerald-600 bg-emerald-50 border-emerald-100',
        rose:    'text-rose-600 bg-rose-50 border-rose-100',
        amber:   'text-amber-600 bg-amber-50 border-amber-100'
    };

    return (
        <div className="group relative bg-white/60 backdrop-blur-md border border-white/20 p-6 rounded-[2rem] shadow-lg hover:shadow-2xl transition-all duration-500 overflow-hidden">
            <div className="relative z-10">
                <div className={`w-12 h-12 rounded-2xl ${colors[color] || colors.indigo} flex items-center justify-center mb-4 transition-transform group-hover:scale-110`}>
                    {icon}
                </div>
                <p className="text-slate-500 font-bold text-xs uppercase tracking-widest mb-1">{title}</p>
                <h3 className="text-2xl font-black text-slate-900 tracking-tight">{value}</h3>
                {subtitle && (
                    <p className="text-xs text-slate-400 font-medium mt-1">{subtitle}</p>
                )}
            </div>
        </div>
    );
}

function ChartContainer({ title, icon, children, className = '' }) {
    return (
        <div className={`bg-white/60 backdrop-blur-md border border-white/20 p-8 rounded-[2.5rem] shadow-xl ${className}`}>
            <div className="flex items-center gap-3 mb-8">
                <div className="p-2.5 bg-slate-900 text-white rounded-xl shadow-lg">
                    {icon}
                </div>
                <h3 className="font-black text-slate-800 tracking-tight">{title}</h3>
            </div>
            {children}
        </div>
    );
}

function EmptyChartState({ icon, message }) {
    return (
        <div className="flex flex-col items-center justify-center h-[300px] text-slate-400">
            <div className="w-12 h-12 mb-4 opacity-20">{icon}</div>
            <p className="font-medium text-sm border border-slate-200 px-4 py-2 rounded-xl bg-slate-50">{message}</p>
        </div>
    );
}
