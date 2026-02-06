import React, { useState, useEffect } from 'react'
import { X, Settings as SettingsIcon, Download, HardDrive, Loader2, CheckCircle2 } from 'lucide-react'

export const SettingsModal = ({ isOpen, onClose }) => {
    const [config, setConfig] = useState(null)
    const [availableModels, setAvailableModels] = useState({ common: [], local: [] })
    const [loading, setLoading] = useState(false)
    const [selectedModel, setSelectedModel] = useState(null)
    const [changingModel, setChangingModel] = useState(false)

    useEffect(() => {
        if (isOpen) {
            loadConfig()
            loadAvailableModels()
        }
    }, [isOpen])

    const loadConfig = async () => {
        try {
            const res = await fetch('http://localhost:8000/settings/config')
            const data = await res.json()
            setConfig(data)
            setSelectedModel(data.current.yolo_model)
        } catch (err) {
            console.error('Failed to load config:', err)
        }
    }

    const loadAvailableModels = async () => {
        setLoading(true)
        try {
            const res = await fetch('http://localhost:8000/settings/models/available')
            const data = await res.json()
            setAvailableModels(data)
        } catch (err) {
            console.error('Failed to load models:', err)
        } finally {
            setLoading(false)
        }
    }

    const handleModelChange = async (modelPath) => {
        setChangingModel(true)
        try {
            const res = await fetch(`http://localhost:8000/settings/model/yolo?model_path=${encodeURIComponent(modelPath)}`, {
                method: 'POST'
            })
            if (res.ok) {
                setSelectedModel(modelPath)
                loadConfig() // Refresh config

                // Show success toast
                const toast = document.createElement('div')
                toast.className = 'fixed top-6 right-6 bg-green-500/90 backdrop-blur-md text-white px-6 py-3 rounded-xl shadow-2xl z-50 animate-fade-in'
                toast.innerHTML = '✓ Model loaded successfully!'
                document.body.appendChild(toast)
                setTimeout(() => toast.remove(), 3000)
            }
        } catch (err) {
            console.error('Failed to change model:', err)
        } finally {
            setChangingModel(false)
        }
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="p-6 border-b border-slate-700 flex items-center justify-between bg-gradient-to-r from-slate-900 to-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-500/10 rounded-lg ring-1 ring-purple-500/20">
                            <SettingsIcon size={24} className="text-purple-400" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-slate-100">Model Settings</h2>
                            <p className="text-sm text-slate-500">Configure YOLO detection models</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
                    >
                        <X size={20} className="text-slate-400" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                    {/* Current Model */}
                    {config && (
                        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-bold text-slate-400 uppercase tracking-wide">Current Model</span>
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                                    <span className="text-xs text-green-400 font-mono">Active</span>
                                </div>
                            </div>
                            <div className="text-lg font-mono text-cyan-400">{config.current.yolo_model || 'None'}</div>
                            <div className="text-xs text-slate-500 mt-1">Device: {config.current.device}</div>
                        </div>
                    )}

                    {/* Common Models */}
                    <div>
                        <div className="flex items-center gap-2 mb-3">
                            <Download size={16} className="text-slate-400" />
                            <h3 className="font-bold text-slate-300">Ultralytics Models</h3>
                            <span className="text-xs text-slate-500">(Auto-download if not present)</span>
                        </div>

                        {loading ? (
                            <div className="flex items-center justify-center py-8 text-slate-500">
                                <Loader2 className="animate-spin mr-2" size={20} />
                                Loading models...
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-3">
                                {availableModels.common.map((model) => (
                                    <button
                                        key={model.path}
                                        onClick={() => handleModelChange(model.path)}
                                        disabled={changingModel}
                                        className={`p-4 rounded-xl border-2 transition-all text-left ${selectedModel === model.path
                                                ? 'border-cyan-500 bg-cyan-500/10 ring-2 ring-cyan-500/20'
                                                : 'border-slate-700 hover:border-slate-600 bg-slate-800/50'
                                            } disabled:opacity-50`}
                                    >
                                        <div className="flex items-start justify-between mb-2">
                                            <span className="font-bold text-slate-200">{model.name}</span>
                                            {selectedModel === model.path && (
                                                <CheckCircle2 size={16} className="text-cyan-400" />
                                            )}
                                        </div>
                                        <div className="text-xs font-mono text-slate-500">{model.path}</div>
                                        <div className="text-xs text-slate-600 mt-1">{model.size}</div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Local Models */}
                    {availableModels.local.length > 0 && (
                        <div>
                            <div className="flex items-center gap-2 mb-3">
                                <HardDrive size={16} className="text-slate-400" />
                                <h3 className="font-bold text-slate-300">Local Models</h3>
                            </div>

                            <div className="space-y-2">
                                {availableModels.local.map((model) => (
                                    <button
                                        key={model.path}
                                        onClick={() => handleModelChange(model.path)}
                                        disabled={changingModel}
                                        className={`w-full p-3 rounded-xl border-2 transition-all text-left ${selectedModel === model.path
                                                ? 'border-purple-500 bg-purple-500/10'
                                                : 'border-slate-700 hover:border-slate-600 bg-slate-800/50'
                                            } disabled:opacity-50`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex-1 min-w-0">
                                                <div className="font-mono text-sm text-slate-300 truncate">{model.name}</div>
                                                <div className="text-xs text-slate-600 truncate">{model.path}</div>
                                            </div>
                                            {selectedModel === model.path && (
                                                <CheckCircle2 size={16} className="text-purple-400 ml-2" />
                                            )}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Custom Path Input */}
                    <div>
                        <div className="flex items-center gap-2 mb-3">
                            <span className="font-bold text-slate-300">Custom Model Path</span>
                        </div>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                placeholder="Enter path to .pt file or model name..."
                                className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                                onKeyPress={(e) => {
                                    if (e.key === 'Enter' && e.target.value) {
                                        handleModelChange(e.target.value)
                                        e.target.value = ''
                                    }
                                }}
                            />
                        </div>
                        <p className="text-xs text-slate-600 mt-2">Press Enter to load model</p>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-700 bg-slate-900/50 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-slate-700 hover:bg-slate-600 rounded-xl text-white font-medium transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    )
}
