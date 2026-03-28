import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import DashboardLayout from './components/layout/DashboardLayout';
import Login from './pages/Login';

// Lazy-load all pages for code splitting — only the shell loads upfront
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Settings = lazy(() => import('./pages/Settings'));
const Contacts = lazy(() => import('./pages/Contacts'));
const ContactDetail = lazy(() => import('./pages/ContactDetail'));
const Lists = lazy(() => import('./pages/Lists'));
const ListDetail = lazy(() => import('./pages/ListDetail'));
const Templates = lazy(() => import('./pages/Templates'));
const TemplateEditor = lazy(() => import('./pages/TemplateEditor'));
const Campaigns = lazy(() => import('./pages/Campaigns'));
const CampaignCreate = lazy(() => import('./pages/CampaignCreate'));
const CampaignDetail = lazy(() => import('./pages/CampaignDetail'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Import = lazy(() => import('./pages/Import'));

function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
    </div>
  );
}

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
                  <Suspense fallback={<PageLoader />}>
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/campaigns" element={<Campaigns />} />
                      <Route path="/campaigns/new" element={<CampaignCreate />} />
                      <Route path="/campaigns/:id/edit" element={<CampaignCreate />} />
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
                  </Suspense>
                </DashboardLayout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </ErrorBoundary>
    </AuthProvider>
  );
}
