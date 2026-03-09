import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { 
  PieChart, LayoutDashboard, FolderOpen, CheckCircle, 
  FileText, UserCircle, Receipt, LogOut, Wallet, ClipboardList, BarChart3, 
  Activity, Grid, FilePlus
} from 'lucide-react';

export default function Sidebar({ isOpen, setIsOpen }) {
  const { currentUser, userRole, logout } = useAuth();
  const location = useLocation();

  const isActive = (path) => location.pathname === path;
  
  const linkClass = (path) => `
    flex items-center py-3 px-4 rounded-xl transition-all duration-200 font-medium text-sm mb-1
    ${isActive(path) 
        ? 'bg-slate-800 text-white shadow-sm border border-slate-700/50' 
        : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'}
  `;

  const groupTitleClass = "px-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 mt-6";

  return (
    <div className={`
      bg-slate-900 text-white w-72 flex flex-col absolute inset-y-0 left-0 transform 
      ${isOpen ? 'translate-x-0' : '-translate-x-full'} 
      md:relative md:translate-x-0 transition duration-300 ease-in-out z-30 shadow-2xl border-r border-slate-800
      overflow-y-auto scrollbar-hide
    `}>
      <div className="flex items-center justify-center px-5 mb-6 mt-6 shrink-0">
        <div className="bg-white p-4 rounded-2xl shadow-xl shadow-blue-900/40 w-full flex justify-center items-center overflow-hidden h-32">
            <img src="/logo.png" alt="ETFA Ruido" className="h-28 w-auto object-contain" />
        </div>
      </div>

      <nav className="flex-1 space-y-1 pb-10">
        
        {/* User Profile Block */}
        <div className="px-4 mb-6">
            <div className="bg-slate-800/50 p-4 rounded-xl flex items-center border border-slate-700/50">
                <div className="w-10 h-10 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-lg mr-3 shadow-inner">
                    {currentUser?.displayName?.substring(0, 2).toUpperCase() || 'U'}
                </div>
                <div className="overflow-hidden">
                    <p className="text-sm font-bold text-white truncate">{currentUser?.displayName || 'Usuario'}</p>
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider mt-0.5">
                        {userRole === 'admin' ? 'Administrador' : 'Profesional'}
                    </p>
                </div>
            </div>
        </div>

        {/* Mi Espacio (Always visible) */}
        <p className={groupTitleClass}>Mi Espacio</p>
        <Link to="/dashboard" className={linkClass('/dashboard')} onClick={() => setIsOpen(false)}>
            <UserCircle className="w-4 h-4 mr-3" />
            Mi Resumen
        </Link>
        <Link to="/dashboard/expenses" className={linkClass('/dashboard/expenses')} onClick={() => setIsOpen(false)}>
            <Receipt className="w-4 h-4 mr-3" />
            Mis Rendiciones
        </Link>
        <Link to="/dashboard/reports" className={linkClass('/dashboard/reports')} onClick={() => setIsOpen(false)}>
            <ClipboardList className="w-4 h-4 mr-3" />
            Mis Mediciones
        </Link>

        {userRole === 'admin' && (
            <>
                {/* Active Module Indicator */}
                <div className="px-4 mb-3 mt-8">
                    {location.pathname !== '/admin/select-module' && (
                        <div className="flex items-center justify-center py-2.5 px-3 rounded-xl bg-slate-900 border border-slate-800 shadow-inner">
                            <span className="text-xs font-black text-slate-100 uppercase tracking-widest flex items-center justify-center">
                                {(location.pathname.startsWith('/admin/expenses') || location.pathname.startsWith('/admin/approvals') || location.pathname.startsWith('/admin/projects') || location.pathname.startsWith('/admin/balances'))
                                    ? <><div className="w-2.5 h-2.5 rounded-full mr-2.5 bg-indigo-400 shadow-[0_0_12px_rgba(129,140,248,0.8)] animate-pulse"></div> RENDICIONES</>
                                    : location.pathname.startsWith('/admin/reports')
                                    ? <><div className="w-2.5 h-2.5 rounded-full mr-2.5 bg-teal-400 shadow-[0_0_12px_rgba(45,212,191,0.8)] animate-pulse"></div> INFORMES</>
                                    : (location.pathname === '/admin' || location.pathname.startsWith('/admin/invoicing') || location.pathname.startsWith('/admin/analytics'))
                                    ? <><div className="w-2.5 h-2.5 rounded-full mr-2.5 bg-blue-400 shadow-[0_0_12px_rgba(96,165,250,0.8)] animate-pulse"></div> FINANCIERO</>
                                    : 'MÓDULO'}
                            </span>
                        </div>
                    )}
                </div>

                {/* Module Selector */}
                <div className="px-4 mb-6">
                    <Link 
                        to="/admin/select-module" 
                        className="flex items-center justify-center w-full py-3 px-4 bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white rounded-xl border border-slate-700 transition-all text-sm font-bold group shadow-sm"
                        onClick={() => setIsOpen(false)}
                    >
                        <Grid className="w-4 h-4 mr-2 group-hover:rotate-90 transition-transform duration-300" />
                        Seleccionar Módulo
                    </Link>
                </div>

                {/* Show different menus based on "Active Module" inferred from URL */}
                {(location.pathname.startsWith('/admin/expenses') || location.pathname.startsWith('/admin/approvals') || location.pathname.startsWith('/admin/projects') || location.pathname.startsWith('/admin/balances')) ? (
                    // --- EXPENSES MODULE MENU ---
                    <>
                        <div className="px-4 mt-6 mb-2">
                             <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Gestión Rendiciones</p>
                        </div>
                        
                        <Link to="/admin/expenses" className={linkClass('/admin/expenses')} onClick={() => setIsOpen(false)}>
                            <PieChart className="w-4 h-4 mr-3" />
                            KPIs / Gráficos
                        </Link>
                        <Link to="/admin/projects" className={linkClass('/admin/projects')} onClick={() => setIsOpen(false)}>
                            <FolderOpen className="w-4 h-4 mr-3" />
                            Proyectos
                        </Link>
                        <Link to="/admin/approvals" className={linkClass('/admin/approvals')} onClick={() => setIsOpen(false)}>
                            <CheckCircle className="w-4 h-4 mr-3" />
                            Aprobaciones
                        </Link>
                        <Link to="/admin/balances" className={linkClass('/admin/balances')} onClick={() => setIsOpen(false)}>
                            <Wallet className="w-4 h-4 mr-3" />
                            Saldos (Viáticos)
                        </Link>
                    </>
                ) : location.pathname.startsWith('/admin/reports') ? (
                    // --- REPORTS MODULE MENU ---
                    <>
                         <div className="px-4 mt-6 mb-2">
                             <p className="text-[10px] font-bold text-teal-400 uppercase tracking-widest">Informes Terreno</p>
                        </div>
                        <Link to="/admin/reports" className={linkClass('/admin/reports')} onClick={() => setIsOpen(false)}>
                            <ClipboardList className="w-4 h-4 mr-3" />
                            Bandeja Informes
                        </Link>
                    </>
                ) : (location.pathname === '/admin' || location.pathname.startsWith('/admin/invoicing') || location.pathname.startsWith('/admin/analytics')) ? (
                    // --- FINANCIAL MODULE MENU ---
                    <>
                         <div className="px-4 mt-6 mb-2">
                             <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Módulo Financiero</p>
                        </div>
                        <Link to="/admin" className={linkClass('/admin')} onClick={() => setIsOpen(false)}>
                            <LayoutDashboard className="w-4 h-4 mr-3" />
                            Tablero Kanban
                        </Link>
                        <Link to="/admin/invoicing/generate" className={linkClass('/admin/invoicing/generate')} onClick={() => setIsOpen(false)}>
                            <FilePlus className="w-4 h-4 mr-3" />
                            Registro de Factura
                        </Link>
                        <Link to="/admin/invoicing/reconciliation" className={linkClass('/admin/invoicing/reconciliation')} onClick={() => setIsOpen(false)}>
                            <Wallet className="w-4 h-4 mr-3" />
                            Conciliación
                        </Link>
                        <Link to="/admin/invoicing/history" className={linkClass('/admin/invoicing/history')} onClick={() => setIsOpen(false)}>
                            <FolderOpen className="w-4 h-4 mr-3" />
                            Historial
                        </Link>
                        <Link to="/admin/analytics" className={linkClass('/admin/analytics')} onClick={() => setIsOpen(false)}>
                            <BarChart3 className="w-4 h-4 mr-3" />
                            Análisis de Datos
                        </Link>
                    </>
                ) : null}
            </>
        )}

        <div className="mt-auto pt-10">
            <button onClick={logout} className="w-full flex items-center py-3 px-4 rounded-xl text-slate-400 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 border border-transparent transition duration-200 group">
                <LogOut className="w-4 h-4 mr-3 group-hover:rotate-180 transition-transform duration-300" />
                <span className="font-medium text-sm">Cerrar Sesión</span>
            </button>
        </div>
      </nav>
    </div>
  );
}
