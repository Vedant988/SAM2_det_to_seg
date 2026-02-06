import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ArrowLeft, CheckCircle2, HardDrive, Download, Loader2, Plus } from 'lucide-react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../components/ui/card"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { useStore } from '../store'

const steps = [
    { id: 1, title: "Project Details", description: "Name your annotation project" },
    { id: 2, title: "Model Config", description: "Select YOLO/SAM2 models" },
    { id: 3, title: "Import Data", description: "Upload images to start" }
]

export const CreateProject = () => {
    const navigate = useNavigate()
    const { setProjectName, setImages, resetProject, addRecentProject } = useStore()

    const [currentStep, setCurrentStep] = useState(1)
    const [name, setName] = useState("")
    const [availableModels, setAvailableModels] = useState({ common: [], local: [] })
    const [selectedModel, setSelectedModel] = useState(null)
    const [loadingModels, setLoadingModels] = useState(false)
    const [loadingUpload, setLoadingUpload] = useState(false)
    const [modelTab, setModelTab] = useState('pretrained')

    // Cleanup on mount
    useEffect(() => {
        resetProject()
        loadAvailableModels()
        // Load default config
        fetch('http://localhost:8000/settings/config')
            .then(r => r.json())
            .then(data => setSelectedModel(data.current.yolo_model))
    }, [])

    const loadAvailableModels = async () => {
        setLoadingModels(true)
        try {
            const res = await fetch('http://localhost:8000/settings/models/available')
            const data = await res.json()
            setAvailableModels(data)
        } catch (err) {
            console.error(err)
        } finally {
            setLoadingModels(false)
        }
    }

    const handleNext = async () => {
        if (currentStep === 1 && name) {
            setProjectName(name)
            setCurrentStep(2)
        } else if (currentStep === 2 && selectedModel) {
            // Set backend model
            try {
                await fetch(`http://localhost:8000/settings/model/yolo?model_path=${encodeURIComponent(selectedModel)}`, {
                    method: 'POST'
                })

                // Save to recent projects
                addRecentProject({
                    name: name,
                    model: selectedModel.split(/[/\\]/).pop(), // Get filename
                    path: selectedModel
                })

                setCurrentStep(3)
            } catch (err) {
                console.error("Failed to set model", err)
            }
        }
    }

    const handleUpload = async (e) => {
        const files = e.target.files
        if (!files || files.length === 0) return;

        setLoadingUpload(true)
        const formData = new FormData()
        Array.from(files).forEach(file => {
            formData.append('files', file)
        })

        try {
            const res = await fetch('http://localhost:8000/upload', {
                method: 'POST',
                body: formData
            })
            if (res.ok) {
                // Fetch updated images
                const data = await fetch('http://localhost:8000/images').then(r => r.json())
                setImages(data)
                // Navigate to workspace
                navigate('/workspace')
            }
        } catch (err) {
            console.error(err)
        } finally {
            setLoadingUpload(false)
        }
    }

    const handleModelUpload = async (e) => {
        const file = e.target.files[0]
        if (!file) return

        setLoadingModels(true)
        const formData = new FormData()
        formData.append('file', file)

        try {
            const res = await fetch('http://localhost:8000/settings/models/upload', {
                method: 'POST',
                body: formData
            })

            if (res.ok) {
                const data = await res.json()
                await loadAvailableModels() // Refresh list
                setSelectedModel(data.path) // Auto-select new model
            } else {
                console.error("Upload failed")
            }
        } catch (err) {
            console.error("Error uploading model:", err)
        } finally {
            setLoadingModels(false)
        }
    }

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
            <Card className="max-w-4xl w-full border-slate-800 bg-slate-900/50 backdrop-blur-xl">
                <CardHeader>
                    <div className="flex items-center justify-between mb-8">
                        <Button variant="ghost" onClick={() => navigate('/dashboard')} className="text-slate-500">
                            <ArrowLeft size={16} className="mr-2" /> Back to Dashboard
                        </Button>
                        <div className="flex items-center gap-2">
                            {steps.map((s) => (
                                <div key={s.id} className="flex items-center">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${currentStep >= s.id ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/30' : 'bg-slate-800 text-slate-500'
                                        }`}>
                                        {currentStep > s.id ? <CheckCircle2 size={16} /> : s.id}
                                    </div>
                                    {s.id !== 3 && <div className={`w-12 h-1 mx-2 rounded-full transition-all ${currentStep > s.id ? 'bg-cyan-500/50' : 'bg-slate-800'}`}></div>}
                                </div>
                            ))}
                        </div>
                    </div>
                    <CardTitle className="text-2xl">{steps[currentStep - 1].title}</CardTitle>
                    <CardDescription>{steps[currentStep - 1].description}</CardDescription>
                </CardHeader>

                <CardContent className="min-h-[300px]">
                    {/* STEP 1: DETAILS */}
                    {currentStep === 1 && (
                        <div className="max-w-md mx-auto py-8 space-y-4 animate-fade-in">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-300">Project Name</label>
                                <Input
                                    placeholder="e.g. Traffic Sign Detection"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="bg-slate-950 border-slate-700 focus:border-cyan-500"
                                    autoFocus
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-300">Description (Optional)</label>
                                <Input
                                    placeholder="Brief description of the dataset..."
                                    className="bg-slate-950 border-slate-700 focus:border-cyan-500"
                                />
                            </div>
                        </div>
                    )}

                    {/* STEP 2: MODEL SELECTION */}
                    {currentStep === 2 && (
                        <div className="space-y-6 animate-fade-in">
                            {/* Tab Switcher */}
                            <div className="flex bg-slate-900/50 p-1 rounded-lg border border-slate-800 w-fit mx-auto mb-6">
                                <button
                                    onClick={() => setModelTab('pretrained')}
                                    className={`px-6 py-2 rounded-md text-sm font-bold transition-all ${modelTab === 'pretrained'
                                        ? 'bg-cyan-600 text-white shadow-lg'
                                        : 'text-slate-400 hover:text-slate-200'
                                        }`}
                                >
                                    Pretrained Models
                                </button>
                                <button
                                    onClick={() => setModelTab('custom')}
                                    className={`px-6 py-2 rounded-md text-sm font-bold transition-all ${modelTab === 'custom'
                                        ? 'bg-purple-600 text-white shadow-lg'
                                        : 'text-slate-400 hover:text-slate-200'
                                        }`}
                                >
                                    Custom / Local
                                </button>
                            </div>

                            <div className="h-[350px] overflow-y-auto custom-scrollbar p-1">
                                {loadingModels ? (
                                    <div className="flex flex-col items-center justify-center h-full text-slate-500">
                                        <Loader2 className="animate-spin mb-2" size={32} />
                                        <span>Scanning models...</span>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {/* PRETRAINED TAB */}
                                        {modelTab === 'pretrained' && availableModels.common.map(model => (
                                            <div
                                                key={model.path}
                                                onClick={() => setSelectedModel(model.path)}
                                                className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${selectedModel === model.path
                                                    ? 'border-cyan-500 bg-cyan-500/10 shadow-lg shadow-cyan-900/20'
                                                    : 'border-slate-800 hover:border-slate-700 bg-slate-900'
                                                    }`}
                                            >
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className="font-bold text-slate-200">{model.name}</span>
                                                    <div className="bg-slate-800 p-1 rounded-md">
                                                        <Download size={14} className="text-cyan-400" />
                                                    </div>
                                                </div>
                                                <p className="text-xs text-slate-500 mb-2">Standard YOLOv8/v11 models optimized for general objection detection.</p>
                                                <div className="flex items-center gap-2 text-[10px] uppercase font-bold tracking-wider text-slate-500">
                                                    <span className="bg-slate-800 px-2 py-1 rounded">{model.size}</span>
                                                    <span className="bg-slate-800 px-2 py-1 rounded">Ultralytics</span>
                                                </div>
                                            </div>
                                        ))}

                                        {/* CUSTOM TAB */}
                                        {modelTab === 'custom' && (
                                            <>
                                                {/* Upload Button Card */}
                                                <div
                                                    className="p-4 rounded-xl border-2 border-dashed border-slate-700 bg-slate-900/50 hover:bg-slate-800/80 cursor-pointer transition-all flex flex-col items-center justify-center gap-2 group"
                                                    onClick={() => document.getElementById('model-upload').click()}
                                                >
                                                    <input
                                                        id="model-upload"
                                                        type="file"
                                                        accept=".pt"
                                                        className="hidden"
                                                        onChange={handleModelUpload}
                                                    />
                                                    <div className="p-3 bg-slate-800 rounded-full group-hover:scale-110 transition-transform">
                                                        {loadingModels ? <Loader2 className="animate-spin text-cyan-400" /> : <Plus className="text-cyan-400" size={24} />}
                                                    </div>
                                                    <span className="font-bold text-slate-300">Upload .pt File</span>
                                                </div>

                                                {availableModels.local.map(model => (
                                                    <div
                                                        key={model.path}
                                                        onClick={() => setSelectedModel(model.path)}
                                                        className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${selectedModel === model.path
                                                            ? 'border-purple-500 bg-purple-500/10 shadow-lg shadow-purple-900/20'
                                                            : 'border-slate-800 hover:border-slate-700 bg-slate-900'
                                                            }`}
                                                    >
                                                        <div className="flex items-center justify-between mb-2">
                                                            <span className="font-bold text-slate-200 truncate pr-4">{model.name}</span>
                                                            <div className="bg-slate-800 p-1 rounded-md">
                                                                <HardDrive size={14} className="text-purple-400" />
                                                            </div>
                                                        </div>
                                                        <div className="bg-slate-950 p-2 rounded text-[10px] font-mono text-slate-400 break-all border border-slate-800">
                                                            {model.path}
                                                        </div>
                                                    </div>
                                                ))}
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* STEP 3: IMPORT */}
                    {currentStep === 3 && (
                        <div className="flex flex-col items-center justify-center py-12 animate-fade-in text-center">
                            <div className="w-20 h-20 bg-slate-900 rounded-full flex items-center justify-center mb-6 border-2 border-dashed border-slate-700">
                                {loadingUpload ? <Loader2 size={32} className="animate-spin text-cyan-500" /> : <HardDrive size={32} className="text-slate-500" />}
                            </div>
                            <h3 className="text-xl font-bold mb-2">Upload Dataset</h3>
                            <p className="text-slate-400 mb-8 max-w-sm">
                                Select images from your computer to begin annotation.
                                Supported formats: PNG, JPG, JPEG.
                            </p>

                            <div className="relative">
                                <input
                                    type="file"
                                    multiple
                                    accept="image/*"
                                    onChange={handleUpload}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    disabled={loadingUpload}
                                />
                                <Button size="lg" disabled={loadingUpload} className="px-8">
                                    {loadingUpload ? 'Uploading...' : 'Browse Files'}
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>

                <CardFooter className="flex justify-end border-t border-slate-800 pt-6">
                    {currentStep < 3 && (
                        <Button onClick={handleNext} disabled={currentStep === 1 ? !name : !selectedModel}>
                            Next Step <ArrowRight size={16} className="ml-2" />
                        </Button>
                    )}
                </CardFooter>
            </Card>
        </div>
    )
}
