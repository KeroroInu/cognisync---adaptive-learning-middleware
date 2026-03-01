import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AdminLayout } from './components/AdminLayout';
import { Dashboard } from './pages/Dashboard';
import { Users } from './pages/Users';
import { UserDetail } from './pages/UserDetail';
import { Scales } from './pages/Scales';
import { ResearchManagement } from './pages/ResearchManagement';
import { Conversations } from './pages/Conversations';
import { ConversationDetail } from './pages/ConversationDetail';
import { Exports } from './pages/Exports';
import { ModelConfig } from './pages/ModelConfig';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/admin" element={<AdminLayout><Dashboard /></AdminLayout>} />
        <Route path="/admin/users" element={<AdminLayout><Users /></AdminLayout>} />
        <Route path="/admin/users/:userId" element={<AdminLayout><UserDetail /></AdminLayout>} />
        <Route path="/admin/scales" element={<AdminLayout><Scales /></AdminLayout>} />
        <Route path="/admin/explorer" element={<AdminLayout><ResearchManagement /></AdminLayout>} />
        <Route path="/admin/conversations" element={<AdminLayout><Conversations /></AdminLayout>} />
        <Route path="/admin/conversations/:sessionId" element={<AdminLayout><ConversationDetail /></AdminLayout>} />
        <Route path="/admin/exports" element={<AdminLayout><Exports /></AdminLayout>} />
        <Route path="/admin/config" element={<AdminLayout><ModelConfig /></AdminLayout>} />
        <Route path="/" element={<Navigate to="/admin" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
