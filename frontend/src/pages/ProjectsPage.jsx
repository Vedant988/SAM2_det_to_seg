import React, { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from "../components/ui/card"
import { Button } from "../components/ui/button"
import { Trash2, FolderOpen, ArrowLeft } from 'lucide-react'
import { useStore } from '../store'

export const ProjectsPage = () => {
    const [projects, setProjects] = useState([])
    const { setProjectName, addRecentProject } = useStore()
    const navigate = useNavigate()

    useEffect(() => {
        fetchProjects()
    }, [])

    const fetchProjects = async () => {
        try {
            const res = await fetch('http://localhost:8000/projects')
            const data = await res.json()
            setProjects(data)
        } catch (err) {
            console.error("Failed to fetch projects", err)
        }
    }

    const handleDelete = async (name) => {
        if (!confirm(`Are you sure you want to delete project "${name}"? This cannot be undone.`)) return

        try {
            const res = await fetch(`http://localhost:8000/projects/${name}`, { method: 'DELETE' })
            if (res.ok) {
                setProjects(projects.filter(p => p.name !== name))
                // Also remove from recent projects in local storage
                useStore.getState().removeRecentProject(name)
            } else {
                alert("Failed to delete project")
            }
        } catch (err) {
            alert("Failed to delete project")
        }
    }

    const handleOpen = (project) => {
        setProjectName(project.name)
        addRecentProject({
            name: project.name,
            model: project.model || 'YOLO-SAM2',
            path: project.path
        })
        // Optionally update recent projects if you have access to that action here, 
        // but for now just setting the active project is sufficient
        navigate('/workspace')
    }

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 p-8">
            <div className="max-w-6xl mx-auto">
                <header className="flex items-center gap-4 mb-8">
                    <Link to="/dashboard">
                        <Button variant="ghost" size="icon" className="hover:bg-slate-800 text-slate-400 hover:text-white">
                            <ArrowLeft size={24} />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-600">
                            All Projects
                        </h1>
                        <p className="text-slate-400 mt-1">Manage your datasets and annotations</p>
                    </div>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {projects.map(project => (
                        <Card key={project.name} className="bg-slate-900/40 border-slate-800 hover:border-cyan-500/30 transition-all group">
                            <CardHeader>
                                <CardTitle className="truncate text-xl group-hover:text-cyan-400 transition-colors">
                                    {project.name}
                                </CardTitle>
                                <CardDescription>
                                    Created: {new Date(project.created).toLocaleDateString()}
                                </CardDescription>
                            </CardHeader>
                            <CardFooter className="flex justify-between gap-3 pt-6">
                                <Button
                                    onClick={() => handleDelete(project.name)}
                                    variant="destructive"
                                    className="flex-1 bg-red-900/20 text-red-400 hover:bg-red-900/40 border-0"
                                >
                                    <Trash2 size={16} className="mr-2" /> Delete
                                </Button>
                                <Button
                                    onClick={() => handleOpen(project)}
                                    className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white"
                                >
                                    <FolderOpen size={16} className="mr-2" /> Open
                                </Button>
                            </CardFooter>
                        </Card>
                    ))}

                    {projects.length === 0 && (
                        <div className="col-span-full flex flex-col items-center justify-center py-20 text-slate-500 bg-slate-900/20 rounded-xl border border-dashed border-slate-800">
                            <FolderOpen size={48} className="mb-4 opacity-50" />
                            <p className="text-lg">No projects found.</p>
                            <Link to="/create-project" className="mt-4">
                                <Button variant="outline">Create New Project</Button>
                            </Link>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
