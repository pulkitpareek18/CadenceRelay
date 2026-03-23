import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import DashboardLayout from './components/layout/DashboardLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import Contacts from './pages/Contacts';
import ContactDetail from './pages/ContactDetail';
import Lists from './pages/Lists';
import ListDetail from './pages/ListDetail';
import Templates from './pages/Templates';
import TemplateEditor from './pages/TemplateEditor';
import Campaigns from './pages/Campaigns';
import CampaignCreate from './pages/CampaignCreate';
import CampaignDetail from './pages/CampaignDetail';
import Analytics from './pages/Analytics';
import Import from './pages/Import';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('accessToken');
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <ErrorBoundary>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <DashboardLayout>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/campaigns" element={<Campaigns />} />
                    <Route path="/campaigns/new" element={<CampaignCreate />} />
                    <Route path="/campaigns/:id" element={<CampaignDetail />} />
                    <Route path="/contacts" element={<Contacts />} />
                    <Route path="/contacts/:id" element={<ContactDetail />} />
                    <Route path="/import" element={<Import />} />
                    <Route path="/lists" element={<Lists />} />
                    <Route path="/lists/:id" element={<ListDetail />} />
                    <Route path="/templates" element={<Templates />} />
                    <Route path="/templates/new" element={<TemplateEditor />} />
                    <Route path="/templates/:id/edit" element={<TemplateEditor />} />
                    <Route path="/analytics" element={<Analytics />} />
                    <Route path="/settings" element={<Settings />} />
                  </Routes>
                </DashboardLayout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </ErrorBoundary>
    </AuthProvider>
  );
}
