import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';

export default function ProtectedRoute({ children, requiredRole }) {
  const { currentUser, userRole } = useAuth();

  if (!currentUser) {
    return <Navigate to="/login" />;
  }

  if (requiredRole && userRole !== requiredRole) {
    // If user is logged in but tries to access admin, redirect to their dashboard
    return <Navigate to={userRole === 'admin' ? '/admin' : '/dashboard'} />;
  }

  return children;
}
