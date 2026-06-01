import React, { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { Download, ArrowLeft, Layers, FileCode, Split, HardDrive, Tag } from 'lucide-react'

export const ExportPage = () => {
    const navigate = useNavigate()
    const { projectName, images, allAnnotations, setImages, setAllAnnotations } = useStore()

    // Default States
    const [format, setFormat] = useState('yolo')
    const [task, setTask] = useState('detection')
    const [split, setSplit] = useState(0.8)
    const [isExporting, setIsExporting] = useState(false)

    useEffect(() => {
        if (!projectName) return
        fetch(`http://localhost:8000/project_data?project_name=${encodeURIComponent(projectName)}`)
            .then(res => res.json())
            .then(data => {
                setImages(data.images || [])
                setAllAnnotations(data.annotations || {})
            })
            .catch(err => console.error("Failed to load project data", err))
    }, [projectName, setAllAnnotations, setImages])

    // Calculate Unique Classes
    const uniqueClasses = useMemo(() => {
        const classes = new Set();
        Object.values(allAnnotations).forEach(list => {
            if (Array.isArray(list)) {
                list.forEach(ann => {
                    if (ann.label) classes.add(ann.label);
                });
            }
        });
        return classes.size;
    }, [allAnnotations]);

    const handleExport = async () => {
        // ... (existing export logic)
        setIsExporting(true)
        try {
            const url = `http://localhost:8000/download_dataset?project_name=${encodeURIComponent(projectName)}&format=${format}&task=${task}&split_ratio=${split}`;

            // Trigger download via hidden link
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `${projectName}_${format}_${task}.zip`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            // Small delay to show loading state
            await new Promise(resolve => setTimeout(resolve, 1500));
        } catch (error) {
            console.error("Export failed:", error)
            alert("Export failed. Please try again.")
        } finally {
            setIsExporting(false)
        }
    }

    if (!projectName) {
        return <div className="min-h-screen bg-slate-950 p-10 text-slate-200">Select or create a project first.</div>
    }

    const totalImages = images.length
    const totalAnnotations = Object.values(allAnnotations).reduce((acc, curr) => acc + (Array.isArray(curr) ? curr.length : 0), 0)

    return (
        <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-cyan-500/30">
            {/* Header */}
            <div className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-10">
                <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
                    <button
                        onClick={() => navigate('/workspace')}
                        className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
                    >
                        <ArrowLeft size={18} />
                        <span className="font-medium">Back to Workspace</span>
                    </button>
                    <div className="font-bold text-lg tracking-tight bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
                        Export Dataset
                    </div>
                    <div className="w-24"></div> {/* Spacer for center alignment */}
                </div>
            </div>

            <main className="max-w-4xl mx-auto px-6 py-12">

                {/* Project Summary */}
                <div className="mb-10 text-center">
                    <h1 className="text-3xl font-bold text-white mb-2">{projectName}</h1>
                    <div className="flex items-center justify-center gap-6 text-slate-400 text-sm">
                        <div className="flex items-center gap-2">
                            <HardDrive size={16} />
                            <span>{totalImages} Images</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Layers size={16} />
                            <span>{totalAnnotations} Annotations</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Tag size={16} />
                            <span>{uniqueClasses} Classes</span>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

                    {/* Settings Column */}
                    <div className="space-y-8">

                        {/* Format Selection */}
                        <section>
                            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">
                                <FileCode size={16} /> Export Format
                            </h2>
                            <div className="grid grid-cols-2 gap-4">
                                <button
                                    onClick={() => setFormat('yolo')}
                                    className={`relative p-4 rounded-xl border-2 transition-all ${format === 'yolo' ? 'border-cyan-500 bg-cyan-950/20' : 'border-slate-800 bg-slate-900/50 hover:border-slate-700'}`}
                                >
                                    <div className="font-bold text-lg mb-1">YOLO</div>
                                    <div className="text-xs text-slate-500">Ultralytics TXT format <br /> Structured folders</div>
                                    {format === 'yolo' && <div className="absolute top-3 right-3 w-3 h-3 bg-cyan-500 rounded-full shadow-[0_0_10px_rgba(6,182,212,0.5)]"></div>}
                                </button>
                                <button
                                    onClick={() => setFormat('coco')}
                                    className={`relative p-4 rounded-xl border-2 transition-all ${format === 'coco' ? 'border-cyan-500 bg-cyan-950/20' : 'border-slate-800 bg-slate-900/50 hover:border-slate-700'}`}
                                >
                                    <div className="font-bold text-lg mb-1">COCO</div>
                                    <div className="text-xs text-slate-500">Standard JSON format <br /> Single annotation file</div>
                                    {format === 'coco' && <div className="absolute top-3 right-3 w-3 h-3 bg-cyan-500 rounded-full shadow-[0_0_10px_rgba(6,182,212,0.5)]"></div>}
                                </button>
                            </div>
                        </section>

                        {/* Task Selection */}
                        <section>
                            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">
                                <Layers size={16} /> Task Type
                            </h2>
                            <div className="grid grid-cols-2 gap-4">
                                <button
                                    onClick={() => setTask('detection')}
                                    className={`relative p-4 rounded-xl border-2 transition-all ${task === 'detection' ? 'border-purple-500 bg-purple-950/20' : 'border-slate-800 bg-slate-900/50 hover:border-slate-700'}`}
                                >
                                    <div className="font-bold text-lg mb-1">Detection</div>
                                    <div className="text-xs text-slate-500">Bounding Boxes</div>
                                    {task === 'detection' && <div className="absolute top-3 right-3 w-3 h-3 bg-purple-500 rounded-full shadow-[0_0_10px_rgba(168,85,247,0.5)]"></div>}
                                </button>
                                <button
                                    onClick={() => setTask('segmentation')}
                                    className={`relative p-4 rounded-xl border-2 transition-all ${task === 'segmentation' ? 'border-purple-500 bg-purple-950/20' : 'border-slate-800 bg-slate-900/50 hover:border-slate-700'}`}
                                >
                                    <div className="font-bold text-lg mb-1">Segmentation</div>
                                    <div className="text-xs text-slate-500">Polygons & Masks</div>
                                    {task === 'segmentation' && <div className="absolute top-3 right-3 w-3 h-3 bg-purple-500 rounded-full shadow-[0_0_10px_rgba(168,85,247,0.5)]"></div>}
                                </button>
                            </div>
                        </section>

                    </div>

                    {/* Split & Action Column */}
                    <div className="space-y-8 flex flex-col">

                        {/* Split Ratio */}
                        <section>
                            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">
                                <Split size={16} /> Dataset Split
                            </h2>
                            <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-800">
                                <div className="flex justify-between text-sm font-bold mb-4">
                                    <span className="text-cyan-400">Train: {(split * 100).toFixed(0)}%</span>
                                    <span className="text-amber-400">Valid: {((1 - split) * 100).toFixed(0)}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="0.1"
                                    max="0.9"
                                    step="0.05"
                                    value={split}
                                    onChange={(e) => setSplit(parseFloat(e.target.value))}
                                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500 hover:accent-cyan-400 transition-all"
                                />
                                <div className="flex justify-between text-xs text-slate-500 mt-2">
                                    <span>Less Training Data</span>
                                    <span>More Training Data</span>
                                </div>
                            </div>
                        </section>

                        {/* Summary Card */}
                        <div className="flex-1 bg-gradient-to-b from-slate-900 to-slate-950 rounded-xl p-6 border border-slate-800 flex flex-col justify-between">
                            <div>
                                <h3 className="text-white font-bold mb-4">Export Summary</h3>
                                <div className="space-y-3 text-sm">
                                    <div className="flex justify-between py-2 border-b border-slate-800/50">
                                        <span className="text-slate-400">Format</span>
                                        <span className="text-white font-mono uppercase">{format}</span>
                                    </div>
                                    <div className="flex justify-between py-2 border-b border-slate-800/50">
                                        <span className="text-slate-400">Task</span>
                                        <span className="text-white font-mono capitalize">{task}</span>
                                    </div>
                                    <div className="flex justify-between py-2 border-b border-slate-800/50">
                                        <span className="text-slate-400">Files</span>
                                        <span className="text-white font-mono">{totalImages} images</span>
                                    </div>
                                    <div className="flex justify-between py-2 border-b border-slate-800/50">
                                        <span className="text-slate-400">Split</span>
                                        <span className="text-white font-mono">{(split * 100).toFixed(0)} / {((1 - split) * 100).toFixed(0)}</span>
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={handleExport}
                                disabled={isExporting}
                                className={`mt-8 w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all transform active:scale-95 shadow-lg ${isExporting ? 'bg-slate-700 text-slate-400 cursor-not-allowed' : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-cyan-900/20'}`}
                            >
                                {isExporting ? 'Preparing Archive...' : (
                                    <>
                                        <Download size={24} />
                                        Download Dataset
                                    </>
                                )}
                            </button>
                        </div>

                    </div>
                </div>
            </main>
        </div>
    )
}
