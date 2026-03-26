import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMemo } from 'react';
import { useAuth } from '../context/useAuth';
import {
  PieChart, LayoutDashboard, FolderOpen, CheckCircle,
  FileText, UserCircle, Receipt, LogOut, Wallet, ClipboardList, BarChart3,
  Activity, Grid, FilePlus, Calendar,
} from 'lucide-react';

const MODULE_ROUTES = {
  rendiciones: ['/admin/projects', '/admin/approvals', '/admin/balances'],
  operaciones: ['/admin/calendar', '/admin/tasks', '/admin/reports'],
  financiero: ['/admin/invoicing', '/admin/analytics', '/admin'],
};

export default function Sidebar({ isOpen, setIsOpen }) {
  const { currentUser, userRole, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const activeModule = useMemo(() => {
    const path = location.pathname;
    if (path.startsWith('/admin/projects') || path.startsWith('/admin/approvals') || path.startsWith('/admin/balances')) return 'rendiciones';
    if (path.startsWith('/admin/calendar') || path.startsWith('/admin/tasks') || path.startsWith('/admin/reports')) return 'operaciones';
    if (path.startsWith('/admin/invoicing') || path.startsWith('/admin/analytics')) return 'financiero';
    if (path === '/admin') return 'financiero';
    return 'rendiciones';
  }, [location.pathname]);

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

        {/* Mi Espacio – professional nav */}
        {userRole !== 'admin' && (
          <>
            <p className={groupTitleClass}>Mi Espacio</p>
            <Link to="/mi-calendario" className={linkClass('/mi-calendario')} onClick={() => setIsOpen(false)}>
                <Calendar className="w-4 h-4 mr-3" />
                Mi Calendario
            </Link>
            <Link to="/mis-tareas" className={linkClass('/mis-tareas')} onClick={() => setIsOpen(false)}>
                <ClipboardList className="w-4 h-4 mr-3" />
                Mis Tareas
            </Link>
            <Link to="/dashboard/expenses" className={linkClass('/dashboard/expenses')} onClick={() => setIsOpen(false)}>
                <Receipt className="w-4 h-4 mr-3" />
                Mis Rendiciones
            </Link>
            <Link to="/dashboard/reports" className={linkClass('/dashboard/reports')} onClick={() => setIsOpen(false)}>
                <FileText className="w-4 h-4 mr-3" />
                Mis Mediciones
            </Link>
          </>
        )}

        {userRole === 'admin' && (
          <>
            {/* Mi Espacio */}
            <p className={groupTitleClass}>Mi Espacio</p>
            <Link to="/mi-calendario" className={linkClass('/mi-calendario')} onClick={() => setIsOpen(false)}>
                <Calendar className="w-4 h-4 mr-3" />
                Mi Calendario
            </Link>
            <Link to="/mis-tareas" className={linkClass('/mis-tareas')} onClick={() => setIsOpen(false)}>
                <ClipboardList className="w-4 h-4 mr-3" />
                Mis Tareas
            </Link>
            <Link to="/dashboard/expenses" className={linkClass('/dashboard/expenses')} onClick={() => setIsOpen(false)}>
                <Receipt className="w-4 h-4 mr-3" />
                Mis Rendiciones
            </Link>

            {/* Module selector */}
            <p className={groupTitleClass}>Módulo</p>
            <div className="flex flex-wrap gap-1.5 px-4 mb-4">
              {[
                { key: 'rendiciones', label: 'Rendiciones', to: '/admin/projects' },
                { key: 'operaciones', label: 'Operaciones', to: '/admin/calendar' },
                { key: 'financiero', label: 'Financiero', to: '/admin' },
              ].map(({ key, label, to }) => (
                <button
                  key={key}
                  onClick={() => { navigate(to); setIsOpen(false); }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors whitespace-nowrap ${
                    activeModule === key
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Rendiciones links */}
            {activeModule === 'rendiciones' && (
              <>
                <Link to="/admin/projects/new" className={linkClass('/admin/projects/new')} onClick={() => setIsOpen(false)}>
                    <FilePlus className="w-4 h-4 mr-3" />
                    Nuevo Proyecto
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
                    Saldos
                </Link>
              </>
            )}

            {/* Operaciones links */}
            {activeModule === 'operaciones' && (
              <>
                <Link to="/admin/calendar" className={linkClass('/admin/calendar')} onClick={() => setIsOpen(false)}>
                    <Calendar className="w-4 h-4 mr-3" />
                    Calendario
                </Link>
                <Link to="/admin/tasks" className={linkClass('/admin/tasks')} onClick={() => setIsOpen(false)}>
                    <ClipboardList className="w-4 h-4 mr-3" />
                    Planner
                </Link>
                <Link to="/admin/reports" className={linkClass('/admin/reports')} onClick={() => setIsOpen(false)}>
                    <FileText className="w-4 h-4 mr-3" />
                    Informes
                </Link>
              </>
            )}

            {/* Financiero links */}
            {activeModule === 'financiero' && (
              <>
                <Link to="/admin" className={linkClass('/admin')} onClick={() => setIsOpen(false)}>
                    <LayoutDashboard className="w-4 h-4 mr-3" />
                    Kanban
                </Link>
                <Link to="/admin/invoicing/generate" className={linkClass('/admin/invoicing/generate')} onClick={() => setIsOpen(false)}>
                    <FilePlus className="w-4 h-4 mr-3" />
                    Registro Factura
                </Link>
                <Link to="/admin/invoicing/reconciliation" className={linkClass('/admin/invoicing/reconciliation')} onClick={() => setIsOpen(false)}>
                    <Wallet className="w-4 h-4 mr-3" />
                    Conciliación
                </Link>
                <Link to="/admin/invoicing/history" className={linkClass('/admin/invoicing/history')} onClick={() => setIsOpen(false)}>
                    <FolderOpen className="w-4 h-4 mr-3" />
                    Historial Facturas
                </Link>
                <Link to="/admin/analytics" className={linkClass('/admin/analytics')} onClick={() => setIsOpen(false)}>
                    <BarChart3 className="w-4 h-4 mr-3" />
                    Analítica
                </Link>
              </>
            )}
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
