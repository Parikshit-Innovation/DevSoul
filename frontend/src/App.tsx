import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import Requirements from './pages/Requirements';
import Architecture from './pages/Architecture';
import Agents from './pages/Agents';

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route
          path="/dashboard"
          element={<AppLayout><Dashboard /></AppLayout>}
        />
        <Route
          path="/requirements"
          element={<AppLayout><Requirements /></AppLayout>}
        />
        <Route
          path="/architecture"
          element={<AppLayout><Architecture /></AppLayout>}
        />
        <Route
          path="/agents"
          element={<AppLayout><Agents /></AppLayout>}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
