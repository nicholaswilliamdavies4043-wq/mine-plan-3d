import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import './styles.css';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectPage } from './pages/ProjectPage';
import { PlanEditorPage } from './pages/PlanEditorPage';
import { AssetLibraryPage } from './pages/AssetLibraryPage';
import { ViewerPage } from './pages/ViewerPage';
import { HelpPage } from './pages/HelpPage';
import { Shell } from './ui/shell';
import { ThemeProvider } from './ui/theme';
import { ToastProvider } from './ui/toast';

function AnimatedRoutes() {
  const loc = useLocation();
  return (
    // keyed wrapper replays the entrance animation on every navigation
    <div key={loc.pathname} className="anim-in" style={{ height: '100%' }}>
      <Routes location={loc}>
        <Route path="/" element={<ProjectsPage />} />
        <Route path="/projects/:projectId" element={<ProjectPage />} />
        <Route path="/projects/:projectId/plans/:planId" element={<PlanEditorPage />} />
        <Route path="/projects/:projectId/view" element={<ViewerPage />} />
        <Route path="/assets" element={<AssetLibraryPage />} />
        <Route path="/help" element={<HelpPage />} />
      </Routes>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <BrowserRouter>
          <Shell>
            <AnimatedRoutes />
          </Shell>
        </BrowserRouter>
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>
);
