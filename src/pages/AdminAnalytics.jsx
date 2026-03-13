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
    PieChart as PieIcon, Activity
} from 'lucide-react';
import { formatCurrency } from '../utils/format';
import { sortProjects } from '../utils/sort';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

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
        recurrence: 'all',
        dateRange: 'all' // all, last_30, last_90, this_year
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
                if (typeof val.toDate === 'function') return val.toDate();
                return new Date(val);
            };

            const invoices = invSnap.docs.map(d => ({ id: d.id, ...d.data(), date: parseDocDate(d.data().createdAt) }));
            const expenses = expSnap.docs.map(d => ({ id: d.id, ...d.data(), date: parseDocDate(d.data().createdAt || d.data().date) }));
            const projects = projSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.status !== "deleted");

            setData({ invoices, expenses, projects: sortProjects(projects) });
            
            // Unique clients for filter
            const uniqueClients = [...new Set(projects.map(p => p.client).filter(Boolean))];
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
            if (!date) return true;
            if (filters.dateRange === 'last_30') return (now - date) / (1000 * 60 * 60 * 24) <= 30;
            if (filters.dateRange === 'last_90') return (now - date) / (1000 * 60 * 60 * 24) <= 90;
            if (filters.dateRange === 'this_year') return date.getFullYear() === now.getFullYear();
            return true;
        };

        const filteredInvoices = invoices.filter(inv => {
            const proj = projects.find(p => p.id === inv.projectId);
            if (!proj) return false;
            if (filters.client !== 'all' && proj.client !== filters.client) return false;
            if (filters.project !== 'all' && inv.projectId !== filters.project) return false;
            if (filters.recurrence !== 'all' && proj.recurrence !== filters.recurrence) return false;
            return filterByDate(inv.date);
        });

        const filteredExpenses = expenses.filter(exp => {
            const proj = projects.find(p => p.id === exp.projectId);
            if (!proj) return false;
            if (filters.client !== 'all' && proj.client !== filters.client) return false;
            if (filters.project !== 'all' && exp.projectId !== filters.project) return false;
            if (filters.recurrence !== 'all' && proj.recurrence !== filters.recurrence) return false;
            return filterByDate(exp.date);
        });

        return { filteredInvoices, filteredExpenses };
    };

    const { filteredInvoices, filteredExpenses } = getFilteredData();

    // Metric Calculations
    const totalBilled = filteredInvoices.reduce((acc, inv) => acc + (Number(inv.totalAmount) || 0), 0);
    const totalCollected = filteredInvoices.filter(inv => inv.paymentStatus === 'paid').reduce((acc, inv) => acc + (Number(inv.totalAmount) || 0), 0);
    const totalExpenses = filteredExpenses.reduce((acc, exp) => acc + (Number(exp.amount) || 0), 0);
    
    const parseDate = (val) => {
        if (!val) return null;
        if (val.toDate) return val.toDate();
        if (val instanceof Date) return val;
        try { return new Date(val); } catch { return null; }
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

    // Chart Data: Monthly Revenue
    const monthlyRevenue = filteredInvoices.reduce((acc, inv) => {
        if (!inv.date) return acc;
        const month = inv.date.toLocaleString('es-ES', { month: 'short', year: 'numeric' });
        if (!acc[month]) acc[month] = { name: month, billed: 0, collected: 0 };
        acc[month].billed += (Number(inv.totalAmount) || 0);
        if (inv.paymentStatus === 'paid') acc[month].collected += (Number(inv.totalAmount) || 0);
        return acc;
    }, {});

    const revenueData = Object.values(monthlyRevenue).sort((a,b) => {
        // Simple sort by string representation (good enough for short spans)
        return new Date(a.name) - new Date(b.name);
    });

    // Chart Data: Expenses by Category
    const expensesByCategory = filteredExpenses.reduce((acc, exp) => {
        const cat = exp.category || 'Otros';
        acc[cat] = (acc[cat] || 0) + (Number(exp.amount) || 0);
        return acc;
    }, {});

    const categoryData = Object.entries(expensesByCategory).map(([name, value]) => ({ name, value }));

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
                            <Filter className="w-4 h-4" /> Filtros Dinámicos
                        </div>
                        
                        <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-4">
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
                                    .map(p => <option key={p.id} value={p.id}>{p.name}</option>)
                                }
                            </select>

                            <select 
                                className="bg-white border-transparent focus:ring-2 focus:ring-indigo-500 rounded-xl p-2.5 text-sm font-medium shadow-sm transition-all"
                                value={filters.recurrence}
                                onChange={e => setFilters({...filters, recurrence: e.target.value})}
                            >
                                <option value="all">Recurrencia (Todas)</option>
                                <option value="unico">Único</option>
                                <option value="mensual">Mensual</option>
                                <option value="trimestral">Trimestral</option>
                                <option value="anual">Anual</option>
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
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
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
                    />
                    <KPICard 
                        title="Gastos (OPEX)" 
                        value={formatCurrency(totalExpenses)} 
                        icon={<Activity className="w-6 h-6" />}
                        color="rose"
                    />
                    <KPICard 
                        title="Tiempo Pago Prom." 
                        value={`${Math.round(avgPaymentDays)} días`} 
                        icon={<Clock className="w-6 h-6" />}
                        color="amber"
                    />
                </div>

                {/* Charts Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    
                    {/* Revenue Evolution */}
                    <ChartContainer title="Evolución de Ingresos (Mensual)" icon={<BarChart3 className="w-5 h-5" />}>
                        {revenueData.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-[300px] text-slate-400">
                                <BarChart3 className="w-12 h-12 mb-4 opacity-20" />
                                <p className="font-medium text-sm border border-slate-200 px-4 py-2 rounded-xl bg-slate-50">No hay datos de ingresos para los filtros seleccionados</p>
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height={300}>
                                <AreaChart data={revenueData}>
                                    <defs>
                                        <linearGradient id="colorBilled" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.1}/>
                                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                                        </linearGradient>
                                        <linearGradient id="colorCollected" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} dy={10} />
                                    <YAxis hide />
                                    <Tooltip 
                                        contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                                        formatter={(val) => formatCurrency(val)}
                                    />
                                    <Area type="monotone" dataKey="billed" name="Facturado" stroke="#6366f1" strokeWidth={3} fillOpacity={1} fill="url(#colorBilled)" />
                                    <Area type="monotone" dataKey="collected" name="Recaudado" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorCollected)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </ChartContainer>

                    {/* Expenses by Category */}
                    <ChartContainer title="Distribución de Gastos por Categoría" icon={<PieIcon className="w-5 h-5" />}>
                        {categoryData.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-[300px] text-slate-400">
                                <PieIcon className="w-12 h-12 mb-4 opacity-20" />
                                <p className="font-medium text-sm border border-slate-200 px-4 py-2 rounded-xl bg-slate-50">No hay datos de gastos para los filtros seleccionados</p>
                            </div>
                        ) : (
                            <div className="flex flex-col md:flex-row items-center h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={categoryData}
                                            innerRadius={60}
                                            outerRadius={80}
                                            paddingAngle={5}
                                            dataKey="value"
                                        >
                                            {categoryData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip formatter={(val) => formatCurrency(val)} />
                                    </PieChart>
                                </ResponsiveContainer>
                                <div className="w-full md:w-1/2 space-y-2 overflow-y-auto max-h-full pr-4">
                                    {categoryData.map((item, idx) => (
                                        <div key={idx} className="flex items-center justify-between group">
                                            <div className="flex items-center gap-2">
                                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }}></div>
                                                <span className="text-xs font-semibold text-slate-600 truncate max-w-[120px]">{item.name}</span>
                                            </div>
                                            <span className="text-xs font-bold text-slate-900">{formatCurrency(item.value)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </ChartContainer>

                </div>
            </div>
        </Layout>
    );
}

function KPICard({ title, value, icon, color }) {
    const colors = {
        indigo: 'text-indigo-600 bg-indigo-50 border-indigo-100',
        emerald: 'text-emerald-600 bg-emerald-50 border-emerald-100',
        rose: 'text-rose-600 bg-rose-50 border-rose-100',
        amber: 'text-amber-600 bg-amber-50 border-amber-100'
    };

    return (
        <div className="group relative bg-white/60 backdrop-blur-md border border-white/20 p-6 rounded-[2rem] shadow-lg hover:shadow-2xl transition-all duration-500 overflow-hidden">
            <div className={`absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform duration-500`}>
                {icon}
            </div>
            <div className="relative z-10">
                <div className={`w-12 h-12 rounded-2xl ${colors[color]} flex items-center justify-center mb-4 transition-transform group-hover:scale-110`}>
                    {icon}
                </div>
                <p className="text-slate-500 font-bold text-xs uppercase tracking-widest mb-1">{title}</p>
                <h3 className="text-3xl font-black text-slate-900 tracking-tight">{value}</h3>
            </div>
        </div>
    );
}

function ChartContainer({ title, icon, children }) {
    return (
        <div className="bg-white/60 backdrop-blur-md border border-white/20 p-8 rounded-[2.5rem] shadow-xl">
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
