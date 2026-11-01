import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, NavLink, Link, Route, Routes } from 'react-router-dom';
import './styles.css';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectPage } from './pages/ProjectPage';
import { PlanEditorPage } from './pages/PlanEditorPage';
import { AssetLibraryPage } from './pages/AssetLibraryPage';
import { ViewerPage } from './pages/ViewerPage';

function App() {
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">Mine plan 3D</Link>
        <nav>
          <NavLink to="/" end>Projects</NavLink>
          <NavLink to="/assets">Asset library</NavLink>
        </nav>
      </header>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Routes>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectPage />} />
          <Route path="/projects/:projectId/plans/:planId" element={<PlanEditorPage />} />
          <Route path="/projects/:projectId/view" element={<ViewerPage />} />
          <Route path="/assets" element={<AssetLibraryPage />} />
        </Routes>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
