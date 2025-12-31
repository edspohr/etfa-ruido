import { useState, useEffect } from 'react';
import { useAuth } from '../context/useAuth';
import { useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';

export default function Login() {
  const { login, resetPassword, currentUser } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Fix: Navigate only when currentUser is set to avoid race conditions
  useEffect(() => {
    if (currentUser) {
       navigate('/dashboard');
    }
  }, [currentUser, navigate]);

  /* 
   * Google Login removed by request. 
   * To restore, uncomment import and this function.
   */
  // const handleGoogleLogin = ...

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    try {
      setError('');
      await login(email, password);
      // Navigation is handled by useEffect
    } catch (err) {
      setError('Error al iniciar sesión: ' + err.message);
    }
  };

  const handleResetPassword = async () => {
      if (!email) {
          setError("Por favor ingresa tu correo electrónico para recuperar la contraseña.");
          return;
      }
      try {
          setError('');
          await resetPassword(email);
          alert(`Se ha enviado un correo de recuperación a ${email}`);
      } catch (err) {
          setError("Error al enviar correo: " + err.message);
      }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md text-center">
        <div className="flex justify-center mb-8">
            <img src="/logo.png" alt="ETFA Ruido" className="h-48 w-auto" />
        </div>
        <h2 className="text-2xl font-bold mb-6 text-gray-800">Gestión de Gastos</h2>
        
        {error && <div className="bg-red-100 text-red-700 p-3 rounded mb-4 text-sm">{error}</div>}

        <form onSubmit={handleEmailLogin} className="space-y-4 mb-6 text-left">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Correo Electrónico</label>
                <input 
                    type="email" 
                    required
                    className="w-full border border-gray-300 rounded p-2"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="ejemplo@etfa.cl"
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña</label>
                <input 
                    type="password" 
                    required
                    className="w-full border border-gray-300 rounded p-2"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••"
                />
            </div>
            <div className="text-right">
                <button type="button" onClick={handleResetPassword} className="text-sm text-blue-600 hover:underline">
                    Crea o resetea tu contraseña
                </button>
            </div>
            
            <button
                type="submit"
                className="w-full bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700 transition duration-200"
            >
                Iniciar Sesión
            </button>
        </form>

        <div className="mt-6 text-center">
            <p className="text-sm text-gray-500">
                Si no tienes cuenta, contacta a un administrador.
            </p>
        </div>
        
        <p className="mt-6 text-sm text-gray-400">Acceso exclusivo para personal autorizado.</p>
      </div>
    </div>
  );
}
