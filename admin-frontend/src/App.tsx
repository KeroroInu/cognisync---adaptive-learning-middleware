import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { DataExplorer } from './pages/DataExplorer';
import { UsersManagement } from './pages/UsersManagement';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function App() {
  const [currentView, setCurrentView] = React.useState<'dashboard' | 'explorer' | 'users'>('dashboard');

  const renderContent = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard />;
      case 'explorer':
        return <DataExplorer />;
      case 'users':
        return <UsersManagement />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <QueryClientProvider client={queryClient}>
      <Layout>{renderContent()}</Layout>
    </QueryClientProvider>
  );
}

export default App;
