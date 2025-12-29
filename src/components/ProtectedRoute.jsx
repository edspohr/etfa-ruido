import { auth } from '../lib/firebase';
import { signOut } from 'firebase/auth';

export default function ProtectedRoute({ children, requiredRole }) {
  const { currentUser, userRole } = useAuth();

  if (!currentUser) {
    return <Navigate to="/login" />;
  }

  // If user is logged in but has no role (e.g. Firestore creation failed)
  // Prevent infinite loop by showing a logout screen instead of redirecting
  if (!userRole) {
      return (
          <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
              <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full text-center">
                  <h2 className="text-xl font-bold text-red-600 mb-4">Perfil no encontrado</h2>
                  <p className="text-gray-600 mb-6">
                      No se pudo cargar tu perfil. Esto suele pasar si las reglas de seguridad no permitieron crear tu usuario.
                  </p>
                  <p className="text-sm text-gray-500 mb-6 bg-gray-100 p-2 rounded">
                      Por favor, contacta al administrador para habilitar tu cuenta o revisa las reglas de Firebase.
                  </p>
                  <button 
                      onClick={() => signOut(auth)}
                      className="w-full bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 transition"
                  >
                      Cerrar Sesión e Intentar de Nuevo
                  </button>
              </div>
          </div>
      );
  }

  if (requiredRole && userRole !== requiredRole) {
    // If user is logged in but tries to access admin, redirect to their dashboard
    return <Navigate to={userRole === 'admin' ? '/admin' : '/dashboard'} />;
  }

  return children;
}
