import { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import { Menu, FolderOpen, Calendar, ClipboardList, Receipt } from 'lucide-react';
import { useAuth } from '../context/useAuth';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import ForcePasswordChange from './ForcePasswordChange';
import PageTransition from './PageTransition';
import { useLocation, Link } from 'react-router-dom';

const PROF_NAV = [
  { to: '/mis-proyectos',     icon: FolderOpen,    label: 'Proyectos' },
  { to: '/mi-calendario',     icon: Calendar,      label: 'Calendario' },
  { to: '/mis-tareas',        icon: ClipboardList, label: 'Tareas' },
  { to: '/dashboard/expenses', icon: Receipt,       label: 'Rendiciones' },
];

export default function Layout({ children, title, isFullWidth = false }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { currentUser, userRole } = useAuth();
  const [mustChangePass, setMustChangePass] = useState(false);
  const location = useLocation();
  const isProfessional = userRole && userRole !== 'admin';
  const isOnProfessionalRoute = ['/mis-proyectos', '/mi-calendario', '/mis-tareas', '/dashboard/expenses', '/dashboard/reports'].some(route => location.pathname === route || location.pathname.startsWith(route + '/'));
  const showBottomNav = isProfessional || (userRole === 'admin' && isOnProfessionalRoute);

  useEffect(() => {
    async function checkUserStatus() {
        if (!currentUser) return;
        try {
            const userRef = doc(db, "users", currentUser.uid);
            const snap = await getDoc(userRef);
            if (snap.exists() && snap.data().forcePasswordChange) {
                setMustChangePass(true);
            }
        } catch (e) {
            console.error(e);
        }
    }
    checkUserStatus();
  }, [currentUser]);

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      {mustChangePass && currentUser && <ForcePasswordChange user={currentUser} />}
      
      <Sidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
      
      <div className="flex-1 flex flex-col overflow-hidden relative">
        <header className="flex justify-between items-center px-8 py-4 glass-header z-20">
            <div className="flex items-center">
                <button onClick={() => setSidebarOpen(!sidebarOpen)} className="md:hidden mr-4 text-slate-500 hover:text-slate-800 transition">
                    <Menu className="w-6 h-6" />
                </button>
                <h1 className="text-xl md:text-2xl font-bold text-slate-800 tracking-tight">{title}</h1>
            </div>
            <div>
                {/* Notification Icon or future user menu */}
            </div>
        </header>

        <main className={`flex-1 overflow-x-hidden overflow-y-auto bg-slate-50 p-6 md:p-8 ${showBottomNav ? 'pb-24 md:pb-8' : ''}`}>
            <div className={isFullWidth ? "w-full px-2" : "max-w-7xl mx-auto"}>
                <PageTransition key={location.pathname}>
                    {children}
                </PageTransition>
            </div>
        </main>

        {/* Mobile Overlay */}
        {sidebarOpen && (
            <div
                className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-10 md:hidden transition-opacity"
                onClick={() => setSidebarOpen(false)}
            ></div>
        )}

        {/* Mobile bottom nav — professionals only */}
        {showBottomNav && (
          <nav className="fixed bottom-0 inset-x-0 bg-slate-900 border-t border-slate-800 flex md:hidden z-40">
            {PROF_NAV.map(({ to, icon: Icon, label }) => {
              const active = location.pathname === to || location.pathname.startsWith(to + '/');
              return (
                <Link
                  key={to}
                  to={to}
                  className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 text-[10px] font-semibold transition-colors ${
                    active ? 'text-indigo-400' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  {label}
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </div>
  );
}
