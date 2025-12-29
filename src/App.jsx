import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import AdminProjects from './pages/AdminProjects';
import AdminApprovals from './pages/AdminApprovals';
import AdminInvoicing from './pages/AdminInvoicing';
import UserDashboard from './pages/UserDashboard';
import UserExpenses from './pages/UserExpenses';
import ExpenseForm from './pages/ExpenseForm';
import ProtectedRoute from './components/ProtectedRoute';
import { useAuth } from './context/useAuth';

function RootRedirect() {
  const { currentUser, userRole } = useAuth();
  if (!currentUser) return <Navigate to="/login" />;
  if (userRole === 'admin') return <Navigate to="/admin" />;
  return <Navigate to="/dashboard" />;
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        {/* Admin Routes */}
        <Route path="/admin" element={<ProtectedRoute requiredRole="admin"><AdminDashboard /></ProtectedRoute>} />
        <Route path="/admin/projects" element={<ProtectedRoute requiredRole="admin"><AdminProjects /></ProtectedRoute>} />
        <Route path="/admin/approvals" element={<ProtectedRoute requiredRole="admin"><AdminApprovals /></ProtectedRoute>} />
        <Route path="/admin/balances" element={<ProtectedRoute requiredRole="admin"><AdminBalances /></ProtectedRoute>} />
        
        {/* User Routes */}
        <Route path="/dashboard" element={<ProtectedRoute requiredRole="professional"><UserDashboard /></ProtectedRoute>} />
        <Route path="/dashboard/expenses" element={<ProtectedRoute requiredRole="professional"><UserExpenses /></ProtectedRoute>} />
        <Route path="/dashboard/new-expense" element={<ProtectedRoute requiredRole="professional"><ExpenseForm /></ProtectedRoute>} />

        <Route path="/" element={<RootRedirect />} />
      </Routes>
    </Router>
  );
}

export default App;
