import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Dashboard } from './pages/Dashboard'
import { CreateProject } from './pages/CreateProject'
import { Workspace } from './pages/Workspace'

function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/create-project" element={<CreateProject />} />
                <Route path="/workspace" element={<Workspace />} />
            </Routes>
        </BrowserRouter>
    )
}

export default App
