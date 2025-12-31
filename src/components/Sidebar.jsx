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
    flex items-center py-2.5 px-4 rounded transition duration-200 
    ${isActive(path) ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700 hover:text-white'}
  `;

  return (
    <div className={`
      bg-gray-800 text-white w-64 space-y-6 py-7 px-2 absolute inset-y-0 left-0 transform 
      ${isOpen ? 'translate-x-0' : '-translate-x-full'} 
      md:relative md:translate-x-0 transition duration-200 ease-in-out z-20
    `}>
      <div className="flex items-center justify-center px-4 mb-8 mt-2">
        <img src="/logo.png" alt="ETFA Ruido" className="h-12 w-auto bg-white p-1 rounded" />
      </div>

      <div className="px-4 mb-6 border-b border-gray-700 pb-4">
        <p className="text-sm text-gray-400">Bienvenido,</p>
        <p className="text-lg font-semibold truncate">{currentUser?.displayName || 'Usuario'}</p>
        <p className="text-xs text-blue-400 uppercase mt-1 tracking-wider">{userRole === 'admin' ? 'Administrador' : 'Profesional'}</p>
      </div>

      <nav>
        {userRole === 'admin' ? (
          <>
            <Link to="/admin" className={linkClass('/admin')} onClick={() => setIsOpen(false)}>
              <LayoutDashboard className="w-5 h-5 mr-3" />
              Dashboard
            </Link>
            <Link to="/admin/projects" className={linkClass('/admin/projects')} onClick={() => setIsOpen(false)}>
              <FolderOpen className="w-5 h-5 mr-3" />
              Proyectos
            </Link>
            <Link to="/admin/approvals" className={linkClass('/admin/approvals')} onClick={() => setIsOpen(false)}>
              <CheckCircle className="w-5 h-5 mr-3" />
              Aprobaciones
            </Link>
            <Link to="/admin/balances" className={linkClass('/admin/balances')} onClick={() => setIsOpen(false)}>
              <Wallet className="w-5 h-5 mr-3" />
              Balances de Profesionales
            </Link>
            
            <div className="border-t border-gray-700 my-4 pt-4">
                <p className="px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Personal</p>
                <Link to="/dashboard" className={linkClass('/dashboard')} onClick={() => setIsOpen(false)}>
                <UserCircle className="w-5 h-5 mr-3" />
                Mi Panel
                </Link>
                <Link to="/dashboard/expenses" className={linkClass('/dashboard/expenses')} onClick={() => setIsOpen(false)}>
                <Receipt className="w-5 h-5 mr-3" />
                Mis Rendiciones
                </Link>
            </div>
          </>
        ) : (
          <>
            <Link to="/dashboard" className={linkClass('/dashboard')} onClick={() => setIsOpen(false)}>
              <UserCircle className="w-5 h-5 mr-3" />
              Mi Panel
            </Link>
            <Link to="/dashboard/expenses" className={linkClass('/dashboard/expenses')} onClick={() => setIsOpen(false)}>
              <Receipt className="w-5 h-5 mr-3" />
              Mis Rendiciones
            </Link>
          </>
        )}
        
        <button onClick={logout} className="w-full flex items-center py-2.5 px-4 rounded text-gray-400 hover:bg-red-600 hover:text-white transition duration-200 mt-8">
            <LogOut className="w-5 h-5 mr-3" />
            Cerrar Sesión
        </button>
      </nav>
    </div>
  );
}
