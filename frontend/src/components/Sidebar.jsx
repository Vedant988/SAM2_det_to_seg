import React, { useRef } from 'react'
import { useStore } from '../store'
import { Image as ImageIcon, Plus, CheckCircle2, Trash2, X } from 'lucide-react'

export const Sidebar = ({ onClose }) => {
    const { images, setImages, selectedImage, setSelectedImage, allAnnotations, projectName } = useStore()
    const fileInputRef = useRef(null)

    const handleUpload = async (e) => {
        const files = e.target.files
        if (!files || files.length === 0) return;

        const formData = new FormData()
        Array.from(files).forEach(file => {
            formData.append('files', file)
        })

        try {
            const query = projectName ? `?project_name=${encodeURIComponent(projectName)}` : ''
            const res = await fetch(`http://localhost:8000/upload${query}`, {
                method: 'POST',
                body: formData
            })
            if (res.ok) {
                const data = await fetch(`http://localhost:8000/images${query}`).then(r => r.json())
                setImages(data)
            }
        } catch (err) {
            console.error(err)
        } finally {
            // Reset input so the same file can be selected again
            e.target.value = null
        }
    }

    const handleDelete = async (e, filename) => {
        e.stopPropagation()
        if (!confirm(`Are you sure you want to delete ${filename}?`)) return

        try {
            const query = projectName ? `?project_name=${encodeURIComponent(projectName)}` : ''
            const res = await fetch(`http://localhost:8000/images/${encodeURIComponent(filename)}${query}`, {
                method: 'DELETE'
            })
            if (res.ok) {
                useStore.getState().deleteImage(filename)
            }
        } catch (err) {
            console.error("Failed to delete image", err)
        }
    }

    return (
        <div className="w-80 max-w-[90vw] h-full bg-slate-900/95 backdrop-blur-md border-r border-slate-800 flex flex-col shadow-2xl z-20">
            <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-gradient-to-r from-slate-900 to-slate-800">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-cyan-500/10 rounded-lg ring-1 ring-cyan-500/20">
                        <ImageIcon size={20} className="text-cyan-400" />
                    </div>
                    <span className="font-bold text-slate-100 tracking-wide text-lg">Gallery</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-slate-400">{images.length}</span>
                    <div className="text-xs font-mono text-cyan-400 bg-cyan-500/10 px-2 py-1 rounded-full ring-1 ring-cyan-500/20">
                        {Object.keys(allAnnotations).length} annotated
                    </div>
                    {onClose && (
                        <button
                            type="button"
                            onClick={onClose}
                            className="ml-1 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-white"
                            title="Close gallery"
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                {images.length === 0 && (
                    <div className="text-center text-slate-600 mt-10 text-sm space-y-2">
                        <div className="text-4xl opacity-20 mb-4">📁</div>
                        <div>No images found.</div>
                        <div className="text-xs text-slate-700">Upload some to get started.</div>
                    </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                    {images.map(img => {
                        const annotationCount = allAnnotations[img]?.length || 0
                        const hasAnnotations = annotationCount > 0

                        return (
                            <div
                                key={img}
                                onClick={() => setSelectedImage(img)}
                                className={`group relative aspect-square rounded-xl cursor-pointer overflow-hidden border-2 transition-all duration-200 ${selectedImage === img ? 'border-cyan-500 shadow-cyan-500/30 shadow-lg scale-[1.02] ring-2 ring-cyan-500/20' : 'border-transparent hover:border-slate-600 hover:scale-[1.02]'}`}
                            >
                                <img
                                    src={`http://localhost:8000/image_file/${encodeURIComponent(img)}${projectName ? `?project_name=${encodeURIComponent(projectName)}` : ''}`}
                                    alt={img}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                />

                                {/* Annotation badge */}
                                {hasAnnotations && (
                                    <div className="absolute top-2 right-2 bg-cyan-500 text-white text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1 shadow-lg">
                                        <CheckCircle2 size={10} />
                                        {annotationCount}
                                    </div>
                                )}

                                {/* Delete Button (Hover) */}
                                <button
                                    onClick={(e) => handleDelete(e, img)}
                                    className="absolute top-2 left-2 bg-red-500/80 hover:bg-red-600 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-10"
                                    title="Delete Image"
                                >
                                    <Trash2 size={12} />
                                </button>

                                <div className={`absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent flex items-end p-2 transition-opacity ${selectedImage === img ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                                    <div className="w-full">
                                        <span className="text-xs text-slate-200 truncate block font-medium">{img}</span>
                                        {hasAnnotations && (
                                            <span className="text-[10px] text-cyan-300 font-mono">{annotationCount} objects</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>

            <div className="p-6 border-t border-slate-800 bg-slate-900/50">
                <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    onChange={handleUpload}
                    accept="image/*"
                    multiple
                />
                <button
                    onClick={() => fileInputRef.current.click()}
                    className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium p-3 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-cyan-900/30 active:scale-95 ring-1 ring-white/10"
                >
                    <div className="bg-white/20 p-1 rounded">
                        <Plus size={16} strokeWidth={3} />
                    </div>
                    <span className="tracking-wide">Upload Images</span>
                </button>
            </div>
        </div>
    )
}
