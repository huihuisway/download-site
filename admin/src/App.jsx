import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import FileManager from './pages/FileManager';
import Categories from './pages/Categories';
import ThemeSettings from './pages/ThemeSettings';
import SiteSettings from './pages/SiteSettings';
import Login from './pages/Login';

function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <Layout user={user}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/files" element={<FileManager />} />
        <Route path="/categories" element={<Categories />} />
        <Route path="/theme" element={<ThemeSettings />} />
        <Route path="/settings" element={<SiteSettings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default App;
