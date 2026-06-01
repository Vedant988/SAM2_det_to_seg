import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { Rocket, ArrowLeft, Brain, Sliders, RefreshCw, Eye, MoveHorizontal, MoveVertical, RotateCw, Sun, Zap, Waves } from 'lucide-react'

// Simple debounce hook
const useDebounce = (value, delay) => {
    const [debouncedValue, setDebouncedValue] = useState(value);
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);
        return () => {
            clearTimeout(handler);
        };
    }, [value, delay]);
    return debouncedValue;
}

const AugControl = ({ label, icon: Icon, enabled, onToggle, children }) => (
    <div className={`rounded-xl border transition-all duration-300 overflow-hidden ${enabled ? 'bg-slate-800/80 border-blue-500/30' : 'bg-slate-900/50 border-slate-800 opacity-70 hover:opacity-100'}`}>
        <div
            className="flex items-center justify-between p-4 cursor-pointer select-none"
            onClick={onToggle}
        >
            <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${enabled ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-800 text-slate-500'}`}>
                    <Icon size={18} />
                </div>
                <span className={`font-medium ${enabled ? 'text-white' : 'text-slate-400'}`}>{label}</span>
            </div>
            <div className={`w-10 h-5 rounded-full relative transition-colors ${enabled ? 'bg-blue-500' : 'bg-slate-700'}`}>
                <div className={`absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </div>
        </div>

        {/* Animated Height Container */}
        <div className={`transition-all duration-300 ease-in-out ${enabled ? 'max-h-48 opacity-100' : 'max-h-0 opacity-0'}`}>
            <div className="p-4 pt-0 border-t border-slate-700/50 space-y-4">
                {children}
            </div>
        </div>
    </div>
)

export const TrainPage = () => {
    const navigate = useNavigate()
    const { projectName, images, setImages, setAllAnnotations } = useStore()

    // Configuration State
    const [splitTrain, setSplitTrain] = useState(70)
    const [splitValid, setSplitValid] = useState(20)

    // Detailed Augmentation State
    const [aug, setAug] = useState({
        flip_horizontal: { enabled: true, p: 0.5 },
        flip_vertical: { enabled: false, p: 0.5 },
        rotate: { enabled: true, p: 0.5, limit: 15 },
        brightness: { enabled: true, p: 0.2 },
        blur: { enabled: false, p: 0.2, blur_limit: 3 },
        noise: { enabled: false, p: 0.2 }
    })

    const [augCount, setAugCount] = useState(2)
    const [isExporting, setIsExporting] = useState(false)
    const [isPreviewLoading, setIsPreviewLoading] = useState(false)
    const [previewData, setPreviewData] = useState(null)

    const splitTest = 100 - splitTrain - splitValid

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

    // Debounced Augmentation State for Preview Fetching
    const debouncedAug = useDebounce(aug, 600) // 600ms delay

    const handleSplitChange = (type, val) => {
        val = parseInt(val)
        if (type === 'train') {
            if (val + splitValid > 100) setSplitValid(100 - val)
            setSplitTrain(val)
        } else if (type === 'valid') {
            if (val + splitTrain > 100) setSplitTrain(100 - val)
            setSplitValid(val)
        }
    }

    const updateAug = (key, param, value) => {
        setAug(prev => ({
            ...prev,
            [key]: { ...prev[key], [param]: value }
        }))
    }

    const toggleAug = (key) => {
        setAug(prev => ({
            ...prev,
            [key]: { ...prev[key], enabled: !prev[key].enabled }
        }))
    }

    const getBackendConfig = (configSource = aug) => {
        const config = {}
        Object.entries(configSource).forEach(([key, val]) => {
            if (val.enabled) {
                config[key] = { ...val }
                delete config[key].enabled
            }
        })
        return config
    }

    const fetchPreview = async () => {
        if (!projectName) return
        setIsPreviewLoading(true)
        try {
            const config = getBackendConfig(debouncedAug) // Use debounced config!
            const res = await fetch(`http://localhost:8000/preview_augmentation?project_name=${encodeURIComponent(projectName)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            })
            if (!res.ok) throw new Error("Preview failed")
            const data = await res.json()
            setPreviewData(data)
        } catch (e) {
            console.error(e)
        } finally {
            setIsPreviewLoading(false)
        }
    }

    // Effect: Trigger Preview on Debounced Config Change
    useEffect(() => {
        // Initial fetch or update
        // Only if we have images
        if (images.length > 0) {
            fetchPreview()
        }
    }, [debouncedAug, projectName])

    const handleExport = async () => {
        setIsExporting(true)
        try {
            const config = getBackendConfig(aug)
            const query = new URLSearchParams({
                project_name: projectName,
                split_train: splitTrain / 100,
                split_valid: splitValid / 100,
                split_test: splitTest / 100,
                aug_count: augCount
            })

            const res = await fetch(`http://localhost:8000/train_export_advanced?${query.toString()}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            })

            if (!res.ok) throw new Error("Export failed")

            const blob = await res.blob()
            const url = window.URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `${projectName}_colab_ready.zip`
            document.body.appendChild(a)
            a.click()
            a.remove()
        } catch (e) {
            console.error(e)
            alert("Export failed")
        } finally {
            setIsExporting(false)
        }
    }

    if (!projectName) return <div className="text-white p-10">Select a project first.</div>

    return (
        <div className="min-h-screen bg-slate-950 text-slate-200 font-sans pb-20">
            {/* Header */}
            <div className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <button onClick={() => navigate('/workspace')} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
                        <ArrowLeft size={18} /> <span className="font-medium">Back</span>
                    </button>
                    <div className="font-bold text-lg bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent flex items-center gap-2">
                        <Rocket size={20} className="text-blue-500" />
                        Advanced Training Config
                    </div>
                </div>
            </div>

            <main className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 relative">

                {/* LEFT: Controls (Scrollable) - Spans 7 cols */}
                <div className="lg:col-span-7 space-y-6">

                    {/* Splits */}
                    <section className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800">
                        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-400 uppercase tracking-wider mb-4"><Sliders size={16} /> Splits</h2>
                        <div className="space-y-6">
                            <div>
                                <div className="flex justify-between text-xs mb-2 font-bold uppercase tracking-wider"><span className="text-blue-400">Train {splitTrain}%</span> <span className="text-slate-500">{Math.round(images.length * splitTrain / 100)} images</span></div>
                                <input type="range" min="10" max="90" value={splitTrain} onChange={(e) => handleSplitChange('train', e.target.value)} className="w-full h-2 bg-slate-800 rounded-lg accent-blue-500 appearance-none cursor-pointer" />
                            </div>
                            <div>
                                <div className="flex justify-between text-xs mb-2 font-bold uppercase tracking-wider"><span className="text-amber-400">Valid {splitValid}%</span> <span className="text-slate-500">{Math.round(images.length * splitValid / 100)} images</span></div>
                                <input type="range" min="5" max="50" value={splitValid} onChange={(e) => handleSplitChange('valid', e.target.value)} className="w-full h-2 bg-slate-800 rounded-lg accent-amber-500 appearance-none cursor-pointer" />
                            </div>
                            <div className="flex justify-between text-xs text-slate-500 font-medium px-1">
                                <span>Test Set (Remaining): <span className="text-emerald-400 font-bold">{splitTest}%</span></span>
                                <span>{Math.round(images.length * splitTest / 100)} images</span>
                            </div>
                        </div>
                    </section>

                    {/* Augmentations */}
                    <section className="space-y-4">
                        <div className="flex items-center justify-between px-2">
                            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-400 uppercase tracking-wider"><Brain size={16} /> Augmentations</h2>
                            <span className="text-xs text-slate-500">Live preview enabled</span>
                        </div>

                        {/* Geometric */}
                        <div className="grid gap-4">
                            <AugControl label="Horizontal Flip" icon={MoveHorizontal} enabled={aug.flip_horizontal.enabled} onToggle={() => toggleAug('flip_horizontal')}>
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <div className="flex justify-between text-xs text-slate-400 font-medium uppercase"><span>Probability</span> <span>{aug.flip_horizontal.p}</span></div>
                                        <input type="range" min="0" max="1" step="0.1" value={aug.flip_horizontal.p} onChange={(e) => updateAug('flip_horizontal', 'p', parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-700 rounded-lg accent-blue-400 appearance-none cursor-pointer" />
                                    </div>
                                </div>
                            </AugControl>

                            <AugControl label="Vertical Flip" icon={MoveVertical} enabled={aug.flip_vertical.enabled} onToggle={() => toggleAug('flip_vertical')}>
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <div className="flex justify-between text-xs text-slate-400 font-medium uppercase"><span>Probability</span> <span>{aug.flip_vertical.p}</span></div>
                                        <input type="range" min="0" max="1" step="0.1" value={aug.flip_vertical.p} onChange={(e) => updateAug('flip_vertical', 'p', parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-700 rounded-lg accent-blue-400 appearance-none cursor-pointer" />
                                    </div>
                                </div>
                            </AugControl>

                            <AugControl label="Rotation" icon={RotateCw} enabled={aug.rotate.enabled} onToggle={() => toggleAug('rotate')}>
                                <div className="space-y-6">
                                    <div className="space-y-2">
                                        <div className="flex justify-between text-xs text-slate-400 font-medium uppercase"><span>Probability</span> <span>{aug.rotate.p}</span></div>
                                        <input type="range" min="0" max="1" step="0.1" value={aug.rotate.p} onChange={(e) => updateAug('rotate', 'p', parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-700 rounded-lg accent-blue-400 appearance-none cursor-pointer" />
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex justify-between text-xs text-slate-400 font-medium uppercase"><span>Limit (Degrees)</span> <span>+/- {aug.rotate.limit}°</span></div>
                                        <input type="range" min="5" max="180" value={aug.rotate.limit} onChange={(e) => updateAug('rotate', 'limit', parseInt(e.target.value))} className="w-full h-1.5 bg-slate-700 rounded-lg accent-blue-400 appearance-none cursor-pointer" />
                                        <div className="flex justify-between text-[10px] text-slate-600 px-1"><span>Subtle (5°)</span> <span>Extreme (180°)</span></div>
                                    </div>
                                </div>
                            </AugControl>

                            {/* Pixel Level */}
                            <AugControl label="Brightness" icon={Sun} enabled={aug.brightness.enabled} onToggle={() => toggleAug('brightness')}>
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <div className="flex justify-between text-xs text-slate-400 font-medium uppercase"><span>Probability</span> <span>{aug.brightness.p}</span></div>
                                        <input type="range" min="0" max="1" step="0.1" value={aug.brightness.p} onChange={(e) => updateAug('brightness', 'p', parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-700 rounded-lg accent-blue-400 appearance-none cursor-pointer" />
                                    </div>
                                </div>
                            </AugControl>

                            <AugControl label="Gaussian Blur" icon={Waves} enabled={aug.blur.enabled} onToggle={() => toggleAug('blur')}>
                                <div className="space-y-6">
                                    <div className="space-y-2">
                                        <div className="flex justify-between text-xs text-slate-400 font-medium uppercase"><span>Probability</span> <span>{aug.blur.p}</span></div>
                                        <input type="range" min="0" max="1" step="0.1" value={aug.blur.p} onChange={(e) => updateAug('blur', 'p', parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-700 rounded-lg accent-blue-400 appearance-none cursor-pointer" />
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex justify-between text-xs text-slate-400 font-medium uppercase"><span>Blur Limit</span> <span>{aug.blur.blur_limit}px</span></div>
                                        <input type="range" min="3" max="15" step="2" value={aug.blur.blur_limit} onChange={(e) => updateAug('blur', 'blur_limit', parseInt(e.target.value))} className="w-full h-1.5 bg-slate-700 rounded-lg accent-blue-400 appearance-none cursor-pointer" />
                                    </div>
                                </div>
                            </AugControl>

                            <AugControl label="Gaussian Noise" icon={Zap} enabled={aug.noise.enabled} onToggle={() => toggleAug('noise')}>
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <div className="flex justify-between text-xs text-slate-400 font-medium uppercase"><span>Probability</span> <span>{aug.noise.p}</span></div>
                                        <input type="range" min="0" max="1" step="0.1" value={aug.noise.p} onChange={(e) => updateAug('noise', 'p', parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-700 rounded-lg accent-blue-400 appearance-none cursor-pointer" />
                                    </div>
                                </div>
                            </AugControl>
                        </div>

                        {/* Global Settings */}
                        <div className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800 mt-6">
                            <div className="flex justify-between items-center mb-4">
                                <span className="text-sm font-bold text-slate-300 uppercase tracking-wider">Augmentation Versions</span>
                                <span className="bg-blue-500 text-white px-3 py-1 rounded-lg text-sm font-bold">{augCount}x</span>
                            </div>
                            <input type="range" min="1" max="10" value={augCount} onChange={(e) => setAugCount(parseInt(e.target.value))} className="w-full h-2 bg-slate-800 rounded-lg accent-indigo-500 appearance-none cursor-pointer" />
                            <p className="text-xs text-slate-500 mt-3 text-center">
                                Each training image will be augmented <strong>{augCount}</strong> times.
                            </p>
                        </div>
                    </section>

                    <button
                        onClick={handleExport}
                        disabled={isExporting}
                        className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 shadow-lg transition-all transform active:scale-[0.98] ${isExporting ? 'bg-slate-800 text-slate-500 cursor-wait' : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-blue-500/20 hover:shadow-blue-500/40'}`}
                    >
                        {isExporting ? <RefreshCw className="animate-spin" /> : <Rocket />}
                        {isExporting ? 'Packaging Dataset...' : 'Generate Training Zip'}
                    </button>

                </div>

                {/* RIGHT: Live Preview (Sticky) - Spans 5 cols */}
                <div className="lg:col-span-5 relative">
                    <div className="sticky top-24 space-y-6">

                        <section className="bg-slate-900/80 backdrop-blur-md p-6 rounded-2xl border border-slate-700 shadow-2xl overflow-hidden relative group">
                            <div className="flex items-center justify-between mb-6">
                                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-300 uppercase tracking-wider"><Eye size={16} /> Live Preview</h2>
                                <button onClick={fetchPreview} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 transition-colors border border-slate-700" title="Refresh Random Sample">
                                    <RefreshCw size={16} className={isPreviewLoading ? 'animate-spin text-blue-400' : ''} />
                                </button>
                            </div>

                            {previewData ? (
                                <div className="space-y-6">
                                    {/* Original */}
                                    <div className="space-y-2 relative">
                                        <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm text-white text-[10px] font-bold uppercase px-2 py-0.5 rounded border border-white/10 z-10">Original</div>
                                        <div className="aspect-video bg-slate-950 rounded-xl overflow-hidden border border-slate-800 relative shadow-inner">
                                            <img src={`data:image/jpeg;base64,${previewData.original}`} className="w-full h-full object-contain" />
                                        </div>
                                    </div>

                                    {/* Arrow Down */}
                                    <div className="flex justify-center -my-2 opacity-50">
                                        <div className="w-0.5 h-8 bg-gradient-to-b from-slate-700 to-blue-500/50"></div>
                                    </div>

                                    {/* Augmented */}
                                    <div className="space-y-2 relative">
                                        <div className="absolute top-3 left-3 bg-blue-600/90 backdrop-blur-sm text-white text-[10px] font-bold uppercase px-2 py-0.5 rounded border border-blue-400/30 z-10 shadow-lg shadow-blue-900/50">Augmented Result</div>
                                        <div className="aspect-video bg-slate-950 rounded-xl overflow-hidden border-2 border-dashed border-blue-500/30 relative shadow-[0_0_30px_rgba(59,130,246,0.1)] group-hover:border-blue-500/50 transition-colors">
                                            <img src={`data:image/jpeg;base64,${previewData.augmented}`} className="w-full h-full object-contain" />
                                            {/* Scanline Effect */}
                                            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none animate-scan"></div>
                                        </div>
                                    </div>

                                    <div className="text-center">
                                        <span className="text-[10px] font-mono text-slate-500 bg-slate-950 px-2 py-1 rounded inline-block border border-slate-800 truncate max-w-[200px]">
                                            {previewData.filename}
                                        </span>
                                    </div>

                                </div>
                            ) : (
                                <div className="aspect-[9/16] flex flex-col items-center justify-center text-slate-600 gap-4 min-h-[400px]">
                                    <div className="p-4 rounded-full bg-slate-800/50 animate-pulse">
                                        <RefreshCw size={32} className="opacity-20 animate-spin" />
                                    </div>
                                    <p className="text-sm">Generating preview...</p>
                                </div>
                            )}
                        </section>

                        {/* Export Summary */}
                        <div className="bg-gradient-to-br from-indigo-900/20 to-blue-900/20 p-5 rounded-2xl border border-indigo-500/20 backdrop-blur-sm">
                            <h3 className="text-xs font-bold text-indigo-300 uppercase tracking-wider mb-2">Estimated Volume</h3>
                            <div className="flex justify-between items-end">
                                <div>
                                    <div className="text-3xl font-bold text-white mb-1">{Math.round((images.length * splitTrain / 100) * (1 + augCount))}</div>
                                    <div className="text-[10px] text-indigo-400">Total Training Samples</div>
                                </div>
                                <div className="text-right">
                                    <div className="text-slate-400 text-xs text-right mb-0.5">{images.length} original</div>
                                    <div className="text-blue-400 text-xs text-right font-bold">+ {Math.round((images.length * splitTrain / 100) * augCount)} generated</div>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>

            </main>
        </div>
    )
}
