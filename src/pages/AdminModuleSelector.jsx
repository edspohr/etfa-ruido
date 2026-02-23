import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { FileText, Receipt, ArrowRight, ClipboardList, BarChart3, Lock } from 'lucide-react';

export default function AdminModuleSelector() {
  const { currentUser, logout } = useAuth();

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 lg:p-12 relative overflow-hidden">
            
            {/* Background Decorative Elements */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
                <div className="absolute top-[-5%] left-[-5%] w-[40%] h-[40%] bg-indigo-100/50 rounded-full blur-[120px]"></div>
                <div className="absolute bottom-[-5%] right-[-5%] w-[40%] h-[40%] bg-teal-100/30 rounded-full blur-[120px]"></div>
            </div>

            <div className="w-full max-w-6xl relative z-10">
                <div className="text-center mb-16">
                    <div className="w-24 h-24 bg-white rounded-3xl mx-auto mb-8 flex items-center justify-center shadow-xl shadow-slate-200/50 transform rotate-3 hover:rotate-6 transition-transform duration-500 p-5 border border-slate-100">
                        <img src="/logo.png" alt="Logo" className="w-full h-auto" />
                    </div>
                    <h1 className="text-4xl md:text-5xl font-black text-slate-900 mb-4 tracking-tight">
                        Bienvenido, <span className="text-indigo-600">{currentUser?.displayName}</span>
                    </h1>
                    <p className="text-slate-500 text-lg font-medium opacity-80">Selecciona el módulo para comenzar a trabajar</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
                    {/* Module 1: Expenses */}
                    <Link to="/admin/expenses" className="group h-full flex">
                        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 h-full w-full transition-all duration-500 hover:shadow-2xl hover:shadow-indigo-200/50 hover:border-indigo-300 hover:-translate-y-2 relative overflow-hidden flex flex-col shadow-sm">
                            <div className="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-8 group-hover:scale-110 group-hover:bg-indigo-600 group-hover:text-white transition-all duration-500">
                                 <Receipt className="w-7 h-7" />
                            </div>
                            <h2 className="text-2xl font-bold text-slate-800 mb-3 tracking-tight">Rendición de Gastos</h2>
                            <p className="text-slate-500 mb-8 leading-relaxed text-sm flex-grow">
                                Supervisa viáticos, aprueba comprobantes y gestiona balances de proyectos.
                            </p>
                            <div className="flex items-center text-indigo-600 font-bold text-sm group-hover:gap-3 transition-all">
                                Ingresar Módulo <ArrowRight className="w-4 h-4 ml-1" />
                            </div>
                        </div>
                    </Link>

                    {/* Module 2: Reports */}
                    <Link to="/admin/reports" className="group h-full flex">
                        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 h-full w-full transition-all duration-500 hover:shadow-2xl hover:shadow-teal-200/50 hover:border-teal-300 hover:-translate-y-2 relative overflow-hidden flex flex-col shadow-sm">
                            <div className="w-14 h-14 bg-teal-50 text-teal-600 rounded-2xl flex items-center justify-center mb-8 group-hover:scale-110 group-hover:bg-teal-600 group-hover:text-white transition-all duration-500">
                                 <ClipboardList className="w-7 h-7" />
                            </div>
                            <h2 className="text-2xl font-bold text-slate-800 mb-3 tracking-tight">Informes Terreno</h2>
                            <p className="text-slate-500 mb-8 leading-relaxed text-sm flex-grow">
                                Revisa y aprueba mediciones en terreno. Activa la pre-facturación.
                            </p>
                            <div className="flex items-center text-teal-600 font-bold text-sm group-hover:gap-3 transition-all">
                                Ingresar Módulo <ArrowRight className="w-4 h-4 ml-1" />
                            </div>
                        </div>
                    </Link>

                    {/* Module 3: Invoicing */}
                    <Link to="/admin/invoicing" className="group h-full flex">
                        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 h-full w-full transition-all duration-500 hover:shadow-2xl hover:shadow-blue-200/50 hover:border-blue-300 hover:-translate-y-2 relative overflow-hidden flex flex-col shadow-sm">
                            <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-8 group-hover:scale-110 group-hover:bg-blue-600 group-hover:text-white transition-all duration-500">
                                 <FileText className="w-7 h-7" />
                            </div>
                            <h2 className="text-2xl font-bold text-slate-800 mb-3 tracking-tight">Facturación</h2>
                            <p className="text-slate-500 mb-8 leading-relaxed text-sm flex-grow">
                                Emite pre-facturas, concilia con bancos y gestiona cobranzas.
                            </p>
                            <div className="flex items-center text-blue-600 font-bold text-sm group-hover:gap-3 transition-all">
                                Ingresar Módulo <ArrowRight className="w-4 h-4 ml-1" />
                            </div>
                        </div>
                    </Link>

                    {/* Module 4: Analytics */}
                    <Link to="/admin/analytics" className="group h-full flex">
                        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 h-full w-full transition-all duration-500 hover:shadow-2xl hover:shadow-violet-200/50 hover:border-violet-300 hover:-translate-y-2 relative overflow-hidden flex flex-col shadow-sm">
                            <div className="w-14 h-14 bg-violet-50 text-violet-600 rounded-2xl flex items-center justify-center mb-8 group-hover:scale-110 group-hover:bg-violet-600 group-hover:text-white transition-all duration-500">
                                 <BarChart3 className="w-7 h-7" />
                            </div>
                            <h2 className="text-2xl font-bold text-slate-800 mb-3 tracking-tight">Analítica BI</h2>
                            <p className="text-slate-500 mb-8 leading-relaxed text-sm flex-grow">
                                Dashboards financieros, márgenes por proyecto y métricas de rendimiento.
                            </p>
                            <div className="flex items-center text-violet-600 font-bold text-sm group-hover:gap-3 transition-all">
                                Ingresar Módulo <ArrowRight className="w-4 h-4 ml-1" />
                            </div>
                        </div>
                    </Link>
                </div>

                <div className="mt-16 text-center">
                    <button onClick={logout} className="text-slate-400 hover:text-red-500 text-sm font-bold transition-all px-8 py-3 rounded-2xl border border-transparent hover:border-red-100 hover:bg-red-50">
                        Cerrar Sesión Segura
                    </button>
                </div>
            </div>
        </div>
    );
}
