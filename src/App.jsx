import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import AdminProjects from './pages/AdminProjects';
import AdminApprovals from './pages/AdminApprovals';
import AdminBalances from './pages/AdminBalances';
import AdminProjectDetails from './pages/AdminProjectDetails';
import AdminUserDetails from './pages/AdminUserDetails';
import AdminUserSeeder from './pages/AdminUserSeeder';
import UserDashboard from './pages/UserDashboard';
import UserExpenses from './pages/UserExpenses';
import ExpenseForm from './pages/ExpenseForm';
import ProtectedRoute from './components/ProtectedRoute';
import { useAuth } from './context/useAuth';

import AdminModuleSelector from './pages/AdminModuleSelector';
import AdminInvoicingDashboard from './pages/AdminInvoicingDashboard';
import AdminInvoicingGeneration from './pages/AdminInvoicingGeneration';
import AdminInvoicingHistory from './pages/AdminInvoicingHistory';
import AdminInvoicingReconciliation from './pages/AdminInvoicingReconciliation';


function RootRedirect() {
  const { currentUser, userRole } = useAuth();
  if (!currentUser) return <Navigate to="/login" />;
  if (userRole === 'admin') return <Navigate to="/admin/select-module" />;
  return <Navigate to="/dashboard" />;
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        {/* Admin Routes */}
        <Route path="/admin/select-module" element={<ProtectedRoute requiredRole="admin"><AdminModuleSelector /></ProtectedRoute>} />
        
        {/* Expenses Module */}
        <Route path="/admin" element={<ProtectedRoute requiredRole="admin"><AdminDashboard /></ProtectedRoute>} />
        <Route path="/admin/projects" element={<ProtectedRoute requiredRole="admin"><AdminProjects /></ProtectedRoute>} />
        <Route path="/admin/projects/:id" element={<ProtectedRoute requiredRole="admin"><AdminProjectDetails /></ProtectedRoute>} />
        <Route path="/admin/users/:id" element={<ProtectedRoute requiredRole="admin"><AdminUserDetails /></ProtectedRoute>} />
        <Route path="/admin/approvals" element={<ProtectedRoute requiredRole="admin"><AdminApprovals /></ProtectedRoute>} />
        <Route path="/admin/balances" element={<ProtectedRoute requiredRole="admin"><AdminBalances /></ProtectedRoute>} />
        <Route path="/admin/users-seeder" element={<ProtectedRoute requiredRole="admin"><AdminUserSeeder /></ProtectedRoute>} />

        {/* Invoicing Module */}
        <Route path="/admin/invoicing" element={<ProtectedRoute requiredRole="admin"><AdminInvoicingDashboard /></ProtectedRoute>} />
        <Route path="/admin/invoicing/generate" element={<ProtectedRoute requiredRole="admin"><AdminInvoicingGeneration /></ProtectedRoute>} />
        <Route path="/admin/invoicing/history" element={<ProtectedRoute requiredRole="admin"><AdminInvoicingHistory /></ProtectedRoute>} />
        <Route path="/admin/invoicing/reconciliation" element={<ProtectedRoute requiredRole="admin"><AdminInvoicingReconciliation /></ProtectedRoute>} />
        
        {/* User Routes */}
        <Route path="/dashboard" element={<ProtectedRoute requiredRole={['professional', 'admin']}><UserDashboard /></ProtectedRoute>} />
        <Route path="/dashboard/expenses" element={<ProtectedRoute requiredRole={['professional', 'admin']}><UserExpenses /></ProtectedRoute>} />
        <Route path="/dashboard/new-expense" element={<ProtectedRoute requiredRole={['professional', 'admin']}><ExpenseForm /></ProtectedRoute>} />

        <Route path="/" element={<RootRedirect />} />
      </Routes>
    </Router>
  );
}

export default App;
