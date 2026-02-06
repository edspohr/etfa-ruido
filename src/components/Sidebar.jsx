import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { 
  PieChart, LayoutDashboard, FolderOpen, CheckCircle, 
  FileText, UserCircle, Receipt, LogOut, Wallet 
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
      bg-slate-900 text-white w-72 space-y-6 py-6 px-4 absolute inset-y-0 left-0 transform 
      ${isOpen ? 'translate-x-0' : '-translate-x-full'} 
      md:relative md:translate-x-0 transition duration-300 ease-in-out z-30 shadow-2xl border-r border-slate-800
    `}>
      <div className="flex items-center justify-center px-2 mb-10 mt-2">
        <div className="bg-white p-2 rounded-xl shadow-lg shadow-blue-900/20">
            <img src="/logo.png" alt="ETFA Ruido" className="h-10 w-auto" />
        </div>
      </div>

      <div className="px-4 mb-8 border-b border-slate-800 pb-6 text-center">
        <div className="w-16 h-16 bg-gradient-to-br from-slate-700 to-slate-800 rounded-full mx-auto mb-3 flex items-center justify-center shadow-inner text-2xl">
            🤖
        </div>
        <p className="text-sm font-semibold text-white tracking-wide truncate">{currentUser?.displayName || 'Usuario'}</p>
        <p className="text-[10px] bg-slate-800 text-slate-400 inline-block px-2 py-0.5 rounded-full mt-2 uppercase tracking-wider border border-slate-700">
            {userRole === 'admin' ? 'Administrador' : 'Profesional'}
        </p>
      </div>

      <nav className="space-y-1">
        {userRole === 'admin' && (
            <>
                <div className="px-4 mb-2">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Módulos</p>
                    <div className="flex gap-2">
                        <Link 
                            to="/admin" 
                            className={`flex-1 py-2 text-center text-xs font-bold rounded-lg transition border ${
                                !location.pathname.startsWith('/admin/expenses') && !location.pathname.startsWith('/admin/approvals') && !location.pathname.startsWith('/admin/projects') && !location.pathname.startsWith('/admin/balances') && !location.pathname.startsWith('/dashboard')
                                ? 'bg-indigo-600 text-white border-indigo-600' 
                                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                            }`}
                        >
                            Facturación
                        </Link>
                        <Link 
                            to="/admin/expenses" 
                            className={`flex-1 py-2 text-center text-xs font-bold rounded-lg transition border ${
                                location.pathname.startsWith('/admin/expenses') || location.pathname.startsWith('/admin/approvals') || location.pathname.startsWith('/admin/projects') || location.pathname.startsWith('/admin/balances')
                                ? 'bg-indigo-600 text-white border-indigo-600' 
                                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                            }`}
                        >
                            Gastos
                        </Link>
                    </div>
                </div>

                {/* Show different menus based on "Active Module" inferred from URL */}
                {(location.pathname.startsWith('/admin/expenses') || location.pathname.startsWith('/admin/approvals') || location.pathname.startsWith('/admin/projects') || location.pathname.startsWith('/admin/balances')) ? (
                    // --- EXPENSES MODULE MENU ---
                    <>
                        <div className="px-4 mt-6 mb-2">
                             <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Gestión Gastos</p>
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
                            Finanzas
                        </Link>
                    </>
                ) : (
                    // --- BILLING MODULE MENU (Default /admin) ---
                    <>
                         <div className="px-4 mt-6 mb-2">
                             <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Facturación</p>
                        </div>
                        <Link to="/admin" className={linkClass('/admin')} onClick={() => setIsOpen(false)}>
                            <LayoutDashboard className="w-4 h-4 mr-3" />
                            Tablero Kanban
                        </Link>
                        <Link to="/admin/invoicing/reconciliation" className={linkClass('/admin/invoicing/reconciliation')} onClick={() => setIsOpen(false)}>
                            <Wallet className="w-4 h-4 mr-3" />
                            Conciliación (Ciclo)
                        </Link>
                        <Link to="/admin/invoicing/history" className={linkClass('/admin/invoicing/history')} onClick={() => setIsOpen(false)}>
                            <FolderOpen className="w-4 h-4 mr-3" />
                            Historial
                        </Link>
                        {/* 
                        <Link to="/admin/invoicing/generate" className={linkClass('/admin/invoicing/generate')} onClick={() => setIsOpen(false)}>
                            <FileText className="w-4 h-4 mr-3" />
                            Manual (Legacy)
                        </Link> 
                        */}
                    </>
                )}
            </>
        )}

        {/* Only show "Mi Espacio" if NOT in Invoicing Module (to avoid confusion) */}
        {!location.pathname.startsWith('/admin/invoicing') && (
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
