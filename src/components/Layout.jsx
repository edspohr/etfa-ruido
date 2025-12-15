import { useState } from 'react';
import Sidebar from './Sidebar';
import { Menu } from 'lucide-react';

export default function Layout({ children, title }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
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
