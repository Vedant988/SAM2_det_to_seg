import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Dashboard } from './pages/Dashboard'
import { CreateProject } from './pages/CreateProject'
import { Workspace } from './pages/Workspace'
import { ExportPage } from './pages/ExportPage'
import { TrainPage } from './pages/TrainPage'
import { ProjectsPage } from './pages/ProjectsPage'

function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/create-project" element={<CreateProject />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/workspace" element={<Workspace />} />
                <Route path="/export" element={<ExportPage />} />
                <Route path="/train" element={<TrainPage />} />
            </Routes>
        </BrowserRouter>
    )
}

export default App
