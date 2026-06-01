import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Clock, FolderOpen, ArrowRight, Github, Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../components/ui/card"
import { Button } from "../components/ui/button"
import { useStore } from '../store'

export const Dashboard = () => {
    const { recentProjects, setProjectName, deleteRecentProject } = useStore()
    const navigate = useNavigate()

    const handleOpenProject = async (project) => {
        // Set project context
        setProjectName(project.name)

        // Restore model settings in backend
        if (project.path) {
            try {
                await fetch(`http://localhost:8000/settings/model/yolo?model_path=${encodeURIComponent(project.path)}`, {
                    method: 'POST'
                })
            } catch (err) {
                console.error("Failed to restore model settings", err)
            }
        }

        navigate('/workspace')
    }

    const handleDeleteRecentProject = (event, project) => {
        event.stopPropagation()

        if (!confirm(`Remove "${project.name}" from recent work?`)) return
        deleteRecentProject(project.id)
    }

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 p-8">
            <div className="max-w-6xl mx-auto space-y-8">
                {/* Header */}
                <header className="flex items-center justify-between mb-12">
                    <div>
                        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-600">
                            YOLO-SAM2 Annotator
                        </h1>
                        <p className="text-slate-400 mt-2">AI-Assisted Segmentation & Detection Pipeline</p>
                    </div>
                    <div className="flex gap-4">
                        <Link to="/projects">
                            <Button variant="outline" className="gap-2">
                                <FolderOpen className="h-5 w-5" />
                                Projects
                            </Button>
                        </Link>
                        <Button variant="outline" size="icon">
                            <Github className="h-5 w-5" />
                        </Button>
                    </div>
                </header>

                {/* Hero / Create Section */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Create New Project Card */}
                    <Card className="md:col-span-2 bg-gradient-to-br from-slate-900 to-slate-900/50 border-cyan-500/20 hover:border-cyan-500/50 transition-all group relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-32 bg-cyan-500/10 blur-[100px] rounded-full group-hover:bg-cyan-500/20 transition-all"></div>
                        <CardHeader>
                            <CardTitle className="text-2xl">New Project</CardTitle>
                            <CardDescription>Start a new annotation workflow with custom configurations.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="flex gap-4 items-center text-sm text-slate-400 mb-6">
                                <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-cyan-500"></div>YOLOv8/v11 Support</div>
                                <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-purple-500"></div>SAM2 Segmentation</div>
                                <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>Batch Processing</div>
                            </div>
                            <Link to="/create-project">
                                <Button size="lg" className="w-full sm:w-auto gap-2 text-base shadow-xl shadow-cyan-900/20">
                                    <Plus size={18} strokeWidth={3} />
                                    Create Project
                                </Button>
                            </Link>
                        </CardContent>
                    </Card>

                    {/* Quick Resume Card */}
                    <Card className="bg-slate-900/30 border-slate-800">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Clock size={16} className="text-slate-400" />
                                Recent Work
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {recentProjects.length === 0 ? (
                                <div className="text-center py-8 text-slate-500 text-sm">
                                    No recent projects found
                                </div>
                            ) : (
                                recentProjects.map(project => (
                                    <div
                                        key={project.id}
                                        onClick={() => handleOpenProject(project)}
                                        className="flex items-center justify-between group cursor-pointer hover:bg-slate-800/50 p-2 rounded-lg transition-colors"
                                    >
                                        <div className="min-w-0 flex flex-col">
                                            <span className="truncate font-medium group-hover:text-cyan-400 transition-colors" title={project.name}>{project.name}</span>
                                            <span className="text-xs text-slate-500">
                                                {new Date(project.lastEdited).toLocaleDateString()} - {project.model}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button
                                                type="button"
                                                onClick={(event) => handleDeleteRecentProject(event, project)}
                                                className="rounded-md p-1.5 text-slate-500 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                                                title="Delete recent work"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                            <ArrowRight size={14} className="opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all text-cyan-400" />
                                        </div>
                                    </div>
                                ))
                            )}
                        </CardContent>
                        <CardFooter>
                            <Link to="/projects" className="w-full">
                                <Button variant="ghost" size="sm" className="w-full text-slate-500 hover:text-slate-300">View All History</Button>
                            </Link>
                        </CardFooter>
                    </Card>
                </div>

                {/* Getting Started / Features */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
                    <Card className="bg-slate-900/20 border-slate-800/50">
                        <CardHeader>
                            <FolderOpen size={32} className="text-purple-500 mb-2" />
                            <CardTitle>1. Import Data</CardTitle>
                            <CardDescription>Upload images locally or link a dataset folder.</CardDescription>
                        </CardHeader>
                    </Card>
                    <Card className="bg-slate-900/20 border-slate-800/50">
                        <CardHeader>
                            <div className="relative w-8 h-8 mb-2">
                                <div className="absolute inset-0 bg-cyan-500 rounded animate-ping opacity-20"></div>
                                <div className="absolute inset-0 border-2 border-cyan-500 rounded flex items-center justify-center">
                                    <div className="w-2 h-2 bg-cyan-500 rounded-full"></div>
                                </div>
                            </div>
                            <CardTitle>2. Auto-Detect</CardTitle>
                            <CardDescription>Use YOLO models to pre-annotate objects in batch.</CardDescription>
                        </CardHeader>
                    </Card>
                    <Card className="bg-slate-900/20 border-slate-800/50">
                        <CardHeader>
                            <div className="relative w-8 h-8 mb-2 flex items-center justify-center">
                                <div className="w-6 h-6 border-2 border-green-500 rounded-full flex items-center justify-center">⚡</div>
                            </div>
                            <CardTitle>3. Refine & Segment</CardTitle>
                            <CardDescription>Use SAM2 to convert boxes to pixel-perfect masks.</CardDescription>
                        </CardHeader>
                    </Card>
                </div>
            </div>
        </div>
    )
}
