import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import DashboardLayout from './components/layout/DashboardLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('accessToken');
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/campaigns" element={<div className="p-6">Campaigns (Sprint 5)</div>} />
                  <Route path="/contacts" element={<div className="p-6">Contacts (Sprint 3)</div>} />
                  <Route path="/lists" element={<div className="p-6">Lists (Sprint 3)</div>} />
                  <Route path="/templates" element={<div className="p-6">Templates (Sprint 4)</div>} />
                  <Route path="/analytics" element={<div className="p-6">Analytics (Sprint 7)</div>} />
                  <Route path="/settings" element={<div className="p-6">Settings (Sprint 2)</div>} />
                </Routes>
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
