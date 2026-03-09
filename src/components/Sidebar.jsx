import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { 
  PieChart, LayoutDashboard, FolderOpen, CheckCircle, 
  FileText, UserCircle, Receipt, LogOut, Wallet, ClipboardList, BarChart3, 
  Activity, Grid, FilePlus
} from 'lucide-react';

export default function Sidebar({ isOpen, setIsOpen }) {
  const { userRole, logout, currentUser } = useAuth();
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
      <div className="flex items-center justify-center px-6 mb-2 mt-6 shrink-0">
        <div className="bg-white p-3 rounded-2xl shadow-xl shadow-blue-900/40 w-full flex justify-center items-center overflow-hidden h-24">
            <img src="/logo.png" alt="ETFA Ruido" className="h-20 w-auto object-contain scale-110" />
        </div>
      </div>

      <div className="px-4 mb-6 pt-4 text-center shrink-0">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-0.5">Usuario Activo</p>
        <p className="text-sm font-bold text-white tracking-wide truncate">{currentUser?.displayName || 'Usuario'}</p>
        <p className="text-[9px] bg-indigo-500/10 text-indigo-400 inline-block px-3 py-0.5 rounded-full mt-2 uppercase font-black tracking-tighter border border-indigo-500/20">
            {userRole === 'admin' ? 'Administrador' : 'Profesional'}
        </p>
      </div>

      <nav className="flex-1 space-y-1 pb-10">
        {userRole === 'admin' && (
            <>
                <div className="px-4 mb-8">
                    <Link 
                        to="/admin/select-module" 
                        className="flex items-center justify-center w-full py-3 px-4 bg-slate-800/50 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl border border-slate-700 transition-all text-xs font-bold group"
                        onClick={() => setIsOpen(false)}
                    >
                        <Grid className="w-4 h-4 mr-2 group-hover:rotate-90 transition-transform duration-300" />
                        Seleccionar Módulo
                    </Link>
                </div>

                <div className="px-4 mb-2 space-y-1.5">
                    <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-2 pl-1">Módulos</p>
                    
                    <Link 
                        to="/admin/expenses" 
                        className={`w-full py-2 px-3.5 flex items-center rounded-xl transition-all border ${
                            location.pathname.startsWith('/admin/expenses') || location.pathname.startsWith('/admin/approvals') || location.pathname.startsWith('/admin/projects') || location.pathname.startsWith('/admin/balances')
                            ? 'bg-indigo-600 text-white border-indigo-500 shadow-lg shadow-indigo-900/20' 
                            : 'bg-slate-800/20 text-slate-400 border-slate-800/50 hover:text-white hover:bg-slate-800'
                        }`}
                    >
                        <Receipt className="w-3.5 h-3.5 mr-3 opacity-60"/>
                        <span className="text-[11px] font-bold tracking-tight">Rendición</span>
                    </Link>

                    <Link 
                        to="/admin/reports" 
                        className={`w-full py-2 px-3.5 flex items-center rounded-xl transition-all border ${
                            location.pathname.startsWith('/admin/reports')
                            ? 'bg-teal-600 text-white border-teal-500 shadow-lg shadow-teal-900/20' 
                            : 'bg-slate-800/20 text-slate-400 border-slate-800/50 hover:text-white hover:bg-slate-800'
                        }`}
                    >
                        <ClipboardList className="w-3.5 h-3.5 mr-3 opacity-60"/>
                        <span className="text-[11px] font-bold tracking-tight">Informes</span>
                    </Link>

                    <Link 
                        to="/admin" 
                        className={`w-full py-2 px-3.5 flex items-center rounded-xl transition-all border ${
                            !location.pathname.startsWith('/admin/expenses') && !location.pathname.startsWith('/admin/approvals') && !location.pathname.startsWith('/admin/projects') && !location.pathname.startsWith('/admin/balances') && !location.pathname.startsWith('/admin/reports') && !location.pathname.startsWith('/dashboard')
                            ? 'bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-900/20' 
                            : 'bg-slate-800/20 text-slate-400 border-slate-800/50 hover:text-white hover:bg-slate-800'
                        }`}
                    >
                        <FileText className="w-3.5 h-3.5 mr-3 opacity-60"/>
                        <span className="text-[11px] font-bold tracking-tight">Financiero</span>
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
                            Analítica BI
                        </Link>
                    </>
                ) : null}
            </>
        )}

        {/* User Space available everywhere except Invoicing */}
        {!location.pathname.startsWith('/admin/invoicing') && !location.pathname.startsWith('/admin/reports') && (
            <>
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
