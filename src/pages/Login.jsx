import { useState } from 'react';
import { useAuth } from '../context/useAuth';
import { useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';

export default function Login() {
  const { loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');

  const handleGoogleLogin = async () => {
    try {
      setError('');
      await loginWithGoogle();
      navigate('/dashboard'); // Will be redirected by logic if admin
    } catch (err) {
      setError('Error initiating Google Login: ' + err.message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md text-center">
        <div className="flex justify-center mb-6">
            <img src="/logo.png" alt="ETFA Ruido" className="h-16 w-auto" />
        </div>
        <h2 className="text-2xl font-bold mb-6 text-gray-800">ETFA Ruido - Gestión de Gastos</h2>
        
        {error && <div className="bg-red-100 text-red-700 p-3 rounded mb-4 text-sm">{error}</div>}

        <button
          onClick={handleGoogleLogin}
          className="w-full bg-white text-gray-700 border border-gray-300 py-3 px-4 rounded flex items-center justify-center hover:bg-gray-50 transition duration-200"
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-6 h-6 mr-3" />
          Iniciar sesión con Google
        </button>
        
        <p className="mt-6 text-sm text-gray-400">Acceso exclusivo para personal autorizado.</p>
      </div>
    </div>
  );
}
