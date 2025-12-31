import { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import { Menu } from 'lucide-react';
import { useAuth } from '../context/useAuth';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import ForcePasswordChange from './ForcePasswordChange';

export default function Layout({ children, title }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { currentUser } = useAuth();
  const [mustChangePass, setMustChangePass] = useState(false);

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
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      {mustChangePass && currentUser && <ForcePasswordChange user={currentUser} />}
      
      <Sidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
      
      <div className="flex-1 flex flex-col overflow-hidden relative">
        <header className="flex justify-between items-center p-4 bg-white border-b shadow-sm z-10">
            <div className="flex items-center">
                <button onClick={() => setSidebarOpen(!sidebarOpen)} className="md:hidden mr-4 text-gray-600">
                    <Menu className="w-6 h-6" />
                </button>
                <h1 className="text-xl md:text-2xl font-semibold text-gray-800">{title}</h1>
            </div>
            <div>
                {/* Notification Icon or future user menu */}
            </div>
        </header>

        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-gray-50 p-6">
            {children}
        </main>
        
        {/* Mobile Overlay */}
        {sidebarOpen && (
            <div 
                className="fixed inset-0 bg-black bg-opacity-50 z-10 md:hidden" 
                onClick={() => setSidebarOpen(false)}
            ></div>
        )}
      </div>
    </div>
  );
}
