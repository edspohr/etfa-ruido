import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { FileText, Receipt, ArrowRight } from 'lucide-react';

export default function AdminModuleSelector() {
  const { currentUser, logout } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
       
        <div className="w-full max-w-4xl">
            <div className="text-center mb-12">
                <div className="w-20 h-20 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl mx-auto mb-6 flex items-center justify-center shadow-xl shadow-blue-900/20 transform rotate-3">
                    <span className="text-4xl">🚀</span>
                </div>
                <h1 className="text-4xl font-extrabold text-slate-800 mb-2 tracking-tight">Bienvenido, {currentUser?.displayName}</h1>
                <p className="text-slate-500 text-lg">Selecciona el módulo al que deseas acceder</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Module 1: Expenses */}
                <Link to="/admin" className="group">
                    <div className="bg-white p-8 rounded-3xl shadow-soft border border-slate-100 h-full transition-all duration-300 hover:shadow-2xl hover:-translate-y-2 relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity duration-300">
                             <Receipt className="w-40 h-40 text-blue-600" />
                        </div>
                        
                        <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mb-6 text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors duration-300">
                             <Receipt className="w-7 h-7" />
                        </div>

                        <h2 className="text-2xl font-bold text-slate-800 mb-3 group-hover:text-blue-600 transition-colors">Rendición de Gastos</h2>
                        <p className="text-slate-500 mb-8 leading-relaxed">
                            Gestiona rendiciones, aprueba gastos, revisa balances y administra proyectos y usuarios.
                        </p>

                        <div className="flex items-center text-blue-600 font-semibold group-hover:translate-x-2 transition-transform duration-300">
                            Ingresar al Módulo <ArrowRight className="w-4 h-4 ml-2" />
                        </div>
                    </div>
                </Link>

                {/* Module 2: Invoicing */}
                <Link to="/admin/invoicing" className="group">
                     <div className="bg-white p-8 rounded-3xl shadow-soft border border-slate-100 h-full transition-all duration-300 hover:shadow-2xl hover:-translate-y-2 relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity duration-300">
                             <FileText className="w-40 h-40 text-indigo-600" />
                        </div>
                        
                        <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center mb-6 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors duration-300">
                             <FileText className="w-7 h-7" />
                        </div>

                        <h2 className="text-2xl font-bold text-slate-800 mb-3 group-hover:text-indigo-600 transition-colors">Facturación</h2>
                        <p className="text-slate-500 mb-8 leading-relaxed">
                            Genera pre-facturas, asocia gastos a cobros y gestiona el estado de facturación por cliente.
                        </p>

                        <div className="flex items-center text-indigo-600 font-semibold group-hover:translate-x-2 transition-transform duration-300">
                            Ingresar al Módulo <ArrowRight className="w-4 h-4 ml-2" />
                        </div>
                    </div>
                </Link>
            </div>

            <div className="mt-12 text-center">
                <button onClick={logout} className="text-slate-400 hover:text-red-500 text-sm font-medium transition-colors duration-200">
                    Cerrar Sesión
                </button>
            </div>
        </div>
    </div>
  );
}
