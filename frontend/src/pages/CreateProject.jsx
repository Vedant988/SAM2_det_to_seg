import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ArrowLeft, CheckCircle2, HardDrive, Download, Loader2, Plus, Video, Sliders, Film, Clock, Monitor, RefreshCw, Layers } from 'lucide-react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../components/ui/card"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { useStore } from '../store'

const steps = [
    { id: 1, title: "Project Details", description: "Name your annotation project" },
    { id: 2, title: "Model Config", description: "Select YOLO/SAM2 models" },
    { id: 3, title: "Import Data", description: "Upload images to start" }
]

const formatDuration = (seconds) => {
    if (seconds === null || seconds === undefined || Number.isNaN(seconds)) {
        return 'Calculating'
    }

    const totalSeconds = Math.max(0, Math.round(seconds))
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const remainingSeconds = totalSeconds % 60

    if (hours > 0) {
        return `${hours}h ${minutes}m ${remainingSeconds}s`
    }

    if (minutes > 0) {
        return `${minutes}m ${remainingSeconds}s`
    }

    return `${remainingSeconds}s`
}

const formatRate = (framesPerSecond) => {
    if (!framesPerSecond || Number.isNaN(framesPerSecond)) {
        return '0.0 fps'
    }

    return `${framesPerSecond.toFixed(1)} fps`
}

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

    // Video specific states
    const [sourceType, setSourceType] = useState('image')
    const [videoMetadata, setVideoMetadata] = useState(null)
    const [analyzingVideo, setAnalyzingVideo] = useState(false)
    const [frameStep, setFrameStep] = useState(5)
    const [extractingFrames, setExtractingFrames] = useState(false)
    const [extractingProgress, setExtractingProgress] = useState(null)

    const handleVideoUpload = async (e) => {
        const file = e.target.files[0]
        if (!file) return;

        setAnalyzingVideo(true)
        setVideoMetadata(null)
        const formData = new FormData()
        formData.append('file', file)

        try {
            const res = await fetch('http://localhost:8000/video/analyze', {
                method: 'POST',
                body: formData
            })
            if (res.ok) {
                const data = await res.json()
                setVideoMetadata(data)
            } else {
                const errData = await res.json()
                alert(errData.detail || "Failed to analyze video")
            }
        } catch (err) {
            console.error("Error uploading video:", err)
            alert("Connection error while analyzing video")
        } finally {
            setAnalyzingVideo(false)
        }
    }

    const handleExtractFrames = async () => {
        if (!videoMetadata) return;

        setExtractingFrames(true)
        const projectQuery = name ? `&project_name=${encodeURIComponent(name)}` : ''
        const expectedExtractCount = Math.ceil(videoMetadata.total_frames / frameStep)
        const extractionStartedAt = Date.now()
        setExtractingProgress({
            current: 0,
            total: videoMetadata.total_frames,
            percent: 0,
            extracted: 0,
            expected_extract_count: expectedExtractCount,
            elapsed_seconds: 0,
            eta_seconds: null,
            frames_per_second: 0,
            status: 'starting'
        })

        // Poll extraction progress
        const progressInterval = setInterval(async () => {
            try {
                const res = await fetch(`http://localhost:8000/video/extract/progress/${encodeURIComponent(videoMetadata.video_id)}`)
                if (res.ok) {
                    const data = await res.json()
                    if (['extracting', 'completed', 'failed'].includes(data.status)) {
                        const percent = data.total > 0 ? Math.min(100, Math.max(0, Math.round((data.current / data.total) * 100))) : 0
                        setExtractingProgress({
                            current: data.current,
                            total: data.total,
                            percent: percent,
                            extracted: data.extracted ?? 0,
                            expected_extract_count: data.expected_extract_count ?? expectedExtractCount,
                            elapsed_seconds: data.elapsed_seconds ?? 0,
                            eta_seconds: data.eta_seconds ?? null,
                            frames_per_second: data.frames_per_second ?? 0,
                            status: data.status
                        })
                    }
                }
            } catch (err) {
                console.error("Failed to fetch extraction progress:", err)
            }
        }, 500)

        try {
            const res = await fetch(`http://localhost:8000/video/extract?video_id=${encodeURIComponent(videoMetadata.video_id)}&frame_step=${frameStep}${projectQuery}`, {
                method: 'POST'
            })
            
            clearInterval(progressInterval)

            if (res.ok) {
                const result = await res.json()
                setExtractingProgress({
                    ...(() => {
                        const elapsedSeconds = (Date.now() - extractionStartedAt) / 1000
                        return {
                            elapsed_seconds: elapsedSeconds,
                            frames_per_second: elapsedSeconds > 0 ? videoMetadata.total_frames / elapsedSeconds : 0
                        }
                    })(),
                    current: videoMetadata.total_frames,
                    total: videoMetadata.total_frames,
                    percent: 100,
                    extracted: result.extracted_count ?? expectedExtractCount,
                    expected_extract_count: expectedExtractCount,
                    eta_seconds: 0,
                    status: 'completed'
                })
                // Fetch updated images
                const data = await fetch(`http://localhost:8000/images${name ? `?project_name=${encodeURIComponent(name)}` : ''}`).then(r => r.json())
                setImages(data)
                // Navigate to workspace
                navigate('/workspace')
            } else {
                const errData = await res.json()
                alert(errData.detail || "Failed to extract frames")
            }
        } catch (err) {
            clearInterval(progressInterval)
            console.error("Error extracting frames:", err)
            alert("Connection error while extracting frames")
        } finally {
            setExtractingFrames(false)
            setExtractingProgress(null)
        }
    }

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
            const query = name ? `?project_name=${encodeURIComponent(name)}` : ''
            const res = await fetch(`http://localhost:8000/upload${query}`, {
                method: 'POST',
                body: formData
            })
            if (res.ok) {
                // Fetch updated images
                const data = await fetch(`http://localhost:8000/images${query}`).then(r => r.json())
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
                        <div className="max-w-2xl mx-auto py-4 space-y-6 animate-fade-in">
                            {/* Source Type Toggle */}
                            <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 w-fit mx-auto mb-6">
                                <button
                                    onClick={() => setSourceType('image')}
                                    disabled={loadingUpload || analyzingVideo || extractingFrames}
                                    className={`px-6 py-2 rounded-md text-sm font-bold transition-all ${sourceType === 'image'
                                        ? 'bg-cyan-600 text-white shadow-lg'
                                        : 'text-slate-400 hover:text-slate-200 disabled:opacity-50'
                                        }`}
                                >
                                    Image Dataset
                                </button>
                                <button
                                    onClick={() => setSourceType('video')}
                                    disabled={loadingUpload || analyzingVideo || extractingFrames}
                                    className={`px-6 py-2 rounded-md text-sm font-bold transition-all ${sourceType === 'video'
                                        ? 'bg-cyan-600 text-white shadow-lg'
                                        : 'text-slate-400 hover:text-slate-200 disabled:opacity-50'
                                        }`}
                                >
                                    Video Source
                                </button>
                            </div>

                            {/* IMAGE SOURCE COMPONENT */}
                            {sourceType === 'image' && (
                                <div className="flex flex-col items-center justify-center py-12 text-center bg-slate-900/30 border-2 border-dashed border-slate-800 rounded-2xl p-8 hover:border-slate-700 transition-colors">
                                    <div className="w-16 h-16 bg-slate-900 rounded-full flex items-center justify-center mb-6 border border-slate-800">
                                        {loadingUpload ? <Loader2 size={28} className="animate-spin text-cyan-500" /> : <HardDrive size={28} className="text-slate-400" />}
                                    </div>
                                    <h3 className="text-lg font-bold mb-2">Upload Images</h3>
                                    <p className="text-sm text-slate-400 mb-8 max-w-sm">
                                        Select one or more images from your computer. Supported formats: PNG, JPG, JPEG, WEBP.
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
                                        <Button size="lg" disabled={loadingUpload} className="px-8 bg-cyan-600 hover:bg-cyan-500 font-bold text-white shadow-lg shadow-cyan-600/25">
                                            {loadingUpload ? 'Uploading...' : 'Browse Images'}
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {/* VIDEO SOURCE COMPONENT */}
                            {sourceType === 'video' && (
                                <div className="space-y-6">
                                    {/* LOADING ANALYZING STATE */}
                                    {analyzingVideo && (
                                        <div className="flex flex-col items-center justify-center py-16 text-center bg-slate-900/30 border border-slate-800 rounded-2xl p-8">
                                            <Loader2 size={40} className="animate-spin text-cyan-500 mb-4" />
                                            <h4 className="text-lg font-bold text-slate-200">Analyzing Video File</h4>
                                            <p className="text-sm text-slate-400 mt-1 max-w-xs">
                                                Reading stream metadata and calculating total frames...
                                            </p>
                                        </div>
                                    )}

                                    {/* LOADING EXTRACTING STATE */}
                                    {extractingFrames && (
                                        <div className="flex flex-col items-center justify-center py-16 text-center bg-slate-900/30 border border-slate-800 rounded-2xl p-8 space-y-6">
                                            <div className="relative flex items-center justify-center">
                                                <Loader2 size={48} className="animate-spin text-cyan-500" />
                                                {extractingProgress && (
                                                    <span className="absolute text-xs font-bold font-mono text-cyan-400">
                                                        {extractingProgress.percent}%
                                                    </span>
                                                )}
                                            </div>
                                            <div className="space-y-2 w-full max-w-md">
                                                <h4 className="text-lg font-bold text-slate-200">Extracting Frame Sequence</h4>
                                                <p className="text-sm text-slate-400 max-w-xs mx-auto">
                                                    Converting frames to PNG images at an interval of every {frameStep} frame(s)...
                                                </p>
                                            </div>

                                            {extractingProgress && (
                                                <div className="w-full max-w-lg space-y-4">
                                                    {/* Progress Bar Container */}
                                                    <div className="w-full h-3 bg-slate-950 rounded-full border border-slate-800 p-0.5 overflow-hidden">
                                                        <div 
                                                            className="h-full bg-gradient-to-r from-cyan-600 to-cyan-400 rounded-full transition-all duration-300 shadow-[0_0_12px_rgba(34,211,238,0.3)]"
                                                            style={{ width: `${extractingProgress.percent}%` }}
                                                        />
                                                    </div>
                                                    
                                                    {/* Progress details */}
                                                    <div className="flex justify-between items-center text-xs font-mono text-slate-500">
                                                        <span>Frame {extractingProgress.current} of {extractingProgress.total}</span>
                                                        <span className="text-cyan-400 font-bold">{extractingProgress.percent}% Complete</span>
                                                    </div>

                                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-left">
                                                        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3">
                                                            <span className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Images</span>
                                                            <span className="font-mono text-sm text-slate-200">
                                                                {extractingProgress.extracted} / {extractingProgress.expected_extract_count}
                                                            </span>
                                                        </div>
                                                        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3">
                                                            <span className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Elapsed</span>
                                                            <span className="font-mono text-sm text-slate-200">
                                                                {formatDuration(extractingProgress.elapsed_seconds)}
                                                            </span>
                                                        </div>
                                                        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3">
                                                            <span className="block text-[10px] uppercase font-bold text-slate-500 mb-1">ETA</span>
                                                            <span className="font-mono text-sm text-cyan-300">
                                                                {formatDuration(extractingProgress.eta_seconds)}
                                                            </span>
                                                        </div>
                                                        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3">
                                                            <span className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Speed</span>
                                                            <span className="font-mono text-sm text-slate-200">
                                                                {formatRate(extractingProgress.frames_per_second)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* UPLOAD FORM (IF NO VIDEO METADATA YET) */}
                                    {!videoMetadata && !analyzingVideo && !extractingFrames && (
                                        <div className="flex flex-col items-center justify-center py-12 text-center bg-slate-900/30 border-2 border-dashed border-slate-800 rounded-2xl p-8 hover:border-slate-700 transition-colors">
                                            <div className="w-16 h-16 bg-slate-900 rounded-full flex items-center justify-center mb-6 border border-slate-800">
                                                <Video size={28} className="text-slate-400" />
                                            </div>
                                            <h3 className="text-lg font-bold mb-2">Upload Video File</h3>
                                            <p className="text-sm text-slate-400 mb-8 max-w-sm">
                                                Select a video file to extract frames. Supported formats: MP4, AVI, MOV, MKV.
                                            </p>

                                            <div className="relative">
                                                <input
                                                    type="file"
                                                    accept="video/mp4,video/avi,video/quicktime,video/x-matroska,.mp4,.avi,.mov,.mkv"
                                                    onChange={handleVideoUpload}
                                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                                    disabled={analyzingVideo}
                                                />
                                                <Button size="lg" className="px-8 bg-cyan-600 hover:bg-cyan-500 font-bold text-white shadow-lg shadow-cyan-600/25">
                                                    Browse Video
                                                </Button>
                                            </div>
                                        </div>
                                    )}

                                    {/* VIDEO METADATA & CONFIG (IF VIDEO ANALYZED) */}
                                    {videoMetadata && !analyzingVideo && !extractingFrames && (
                                        <div className="space-y-6 animate-fade-in">
                                            {/* Metadata Info Card */}
                                            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
                                                <div className="flex items-center gap-3 border-b border-slate-800 pb-3">
                                                    <div className="p-2 bg-cyan-500/10 rounded-lg text-cyan-400 border border-cyan-500/25">
                                                        <Video size={20} />
                                                    </div>
                                                    <div className="text-left">
                                                        <h4 className="font-bold text-slate-200 truncate max-w-md">{videoMetadata.filename}</h4>
                                                        <p className="text-xs text-slate-500">Video analyzed successfully</p>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
                                                    <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-900 text-left">
                                                        <span className="text-[10px] text-slate-500 block uppercase font-bold tracking-wider mb-1">Resolution</span>
                                                        <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-200">
                                                            <Monitor size={14} className="text-cyan-500" />
                                                            {videoMetadata.width} x {videoMetadata.height}
                                                        </div>
                                                    </div>
                                                    <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-900 text-left">
                                                        <span className="text-[10px] text-slate-500 block uppercase font-bold tracking-wider mb-1">Duration</span>
                                                        <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-200">
                                                            <Clock size={14} className="text-cyan-500" />
                                                            {videoMetadata.duration.toFixed(1)}s
                                                        </div>
                                                    </div>
                                                    <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-900 text-left">
                                                        <span className="text-[10px] text-slate-500 block uppercase font-bold tracking-wider mb-1">Frame Rate</span>
                                                        <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-200">
                                                            <Film size={14} className="text-cyan-500" />
                                                            {videoMetadata.fps.toFixed(1)} FPS
                                                        </div>
                                                    </div>
                                                    <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-900 text-left">
                                                        <span className="text-[10px] text-slate-500 block uppercase font-bold tracking-wider mb-1">Total Frames</span>
                                                        <div className="flex items-center gap-1.5 text-sm font-bold text-cyan-400">
                                                            <Layers size={14} className="text-cyan-400" />
                                                            {videoMetadata.total_frames}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Config Card */}
                                            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-left space-y-4">
                                                <div className="flex items-center justify-between">
                                                    <h5 className="font-bold text-slate-200 flex items-center gap-2">
                                                        <Sliders size={18} className="text-cyan-400" /> Configure Extraction
                                                    </h5>
                                                    <span className="bg-slate-950 border border-slate-800 text-[10px] font-bold text-slate-400 px-2 py-1 rounded uppercase tracking-wider">
                                                        Step Limit: 1 - {videoMetadata.total_frames}
                                                    </span>
                                                </div>

                                                <div className="space-y-4 pt-2">
                                                    <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                                                        <div className="flex-1 w-full space-y-2">
                                                            <div className="flex justify-between text-sm text-slate-400">
                                                                <span>Frame Step</span>
                                                                <span className="font-mono text-cyan-400 font-bold">Every {frameStep} frame(s)</span>
                                                            </div>
                                                            <input
                                                                type="range"
                                                                min="1"
                                                                max={Math.min(60, videoMetadata.total_frames)}
                                                                value={frameStep}
                                                                onChange={(e) => setFrameStep(Math.max(1, parseInt(e.target.value) || 1))}
                                                                className="w-full h-1.5 bg-slate-950 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                                                            />
                                                        </div>

                                                        <div className="w-full md:w-32 space-y-2">
                                                            <span className="text-xs text-slate-500 block">Custom Step Value</span>
                                                            <Input
                                                                type="number"
                                                                min="1"
                                                                max={videoMetadata.total_frames}
                                                                value={frameStep}
                                                                onChange={(e) => setFrameStep(Math.max(1, Math.min(videoMetadata.total_frames, parseInt(e.target.value) || 1)))}
                                                                className="bg-slate-950 border-slate-800 font-mono text-right pr-4 text-cyan-400 font-bold"
                                                            />
                                                        </div>
                                                    </div>

                                                    {/* Calculation Banner */}
                                                    <div className="bg-cyan-500/5 border border-cyan-500/10 rounded-xl p-4 flex items-center justify-between gap-4">
                                                        <div className="text-left">
                                                            <span className="text-xs text-slate-400 block mb-0.5">Estimated Output Sequence</span>
                                                            <p className="text-sm font-semibold text-slate-200">
                                                                This will extract <span className="text-cyan-400 font-bold text-base">{Math.ceil(videoMetadata.total_frames / frameStep)}</span> images into the editor.
                                                            </p>
                                                        </div>
                                                        <div className="text-right hidden sm:block">
                                                            <span className="bg-slate-900 border border-slate-800 text-[10px] text-slate-500 px-2.5 py-1 rounded-full font-semibold">
                                                                ~{(videoMetadata.fps / frameStep).toFixed(1)} Hz sample rate
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Action Buttons */}
                                            <div className="flex gap-4 items-center justify-end">
                                                <Button
                                                    variant="ghost"
                                                    onClick={() => setVideoMetadata(null)}
                                                    className="text-slate-400 hover:text-white"
                                                >
                                                    Choose Another Video
                                                </Button>
                                                <Button
                                                    onClick={handleExtractFrames}
                                                    className="bg-cyan-600 hover:bg-cyan-500 font-bold text-white shadow-lg shadow-cyan-600/25 px-6"
                                                >
                                                    Extract Frames & Start Annotating
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
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
