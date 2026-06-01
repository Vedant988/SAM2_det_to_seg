import { useEffect, useState } from 'react'
import { Sidebar } from '../components/Sidebar'
import { Canvas } from '../components/WorkspaceCanvas'
import { FrameTimeline } from '../components/FrameTimeline'
import { Toolbar } from '../components/Toolbar'
import { useStore } from '../store'
import { ArrowLeft, Images } from 'lucide-react'
import { Link } from 'react-router-dom'

export const Workspace = () => {
    const { setImages, projectName } = useStore()
    const [showGallery, setShowGallery] = useState(false)
    const API_URL = "http://localhost:8000"

    useEffect(() => {
        fetch(`${API_URL}/images`)
            .then(res => res.json())
            .then(data => setImages(data))
            .catch(err => console.error("Failed to load images", err))
    }, [])

    return (
        <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 font-sans selection:bg-cyan-500/30">
            {showGallery && (
                <>
                    <div
                        className="absolute inset-0 z-30 bg-slate-950/40 backdrop-blur-[2px]"
                        onClick={() => setShowGallery(false)}
                    />
                    <div className="absolute left-0 top-0 bottom-0 z-40">
                        <Sidebar onClose={() => setShowGallery(false)} />
                    </div>
                </>
            )}
            <div className="flex-1 flex flex-col relative bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-900 to-slate-950">
                {/* Header Overlay */}
                <div className="absolute top-0 left-0 right-0 p-4 z-10 pointer-events-none flex justify-between items-start">
                    <div className="pointer-events-auto flex items-center gap-2">
                        <Link to="/dashboard" className="p-2 bg-slate-900/50 hover:bg-slate-900/80 rounded-full backdrop-blur-md transition-colors text-slate-400 hover:text-white">
                            <ArrowLeft size={20} />
                        </Link>
                        <button
                            type="button"
                            onClick={() => setShowGallery(true)}
                            className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm font-bold text-slate-300 backdrop-blur-md transition-colors hover:bg-slate-900 hover:text-cyan-300"
                        >
                            <Images size={18} />
                            <span>Gallery</span>
                        </button>
                    </div>
                    <div className="pointer-events-auto px-4 py-1 bg-slate-900/50 rounded-full backdrop-blur-md border border-slate-800">
                        <span className="text-xs font-mono text-slate-400">Project: </span>
                        <span className="text-sm font-bold text-cyan-400">{projectName || 'Untitled'}</span>
                    </div>
                </div>

                <Canvas />
                <FrameTimeline />
                <Toolbar />
            </div>
        </div>
    )
}
