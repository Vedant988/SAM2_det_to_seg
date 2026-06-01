import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, SkipBack, SkipForward, StepBack, StepForward } from 'lucide-react'
import { useStore } from '../store'

const getFrameNumber = (filename) => {
    const match = filename.match(/frame_(\d+)/i)
    return match ? Number(match[1]) : null
}

const sortFrames = (images) => {
    return [...images].sort((a, b) => {
        const frameA = getFrameNumber(a)
        const frameB = getFrameNumber(b)

        if (frameA !== null && frameB !== null) {
            return frameA - frameB
        }

        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    })
}

const loadedFrames = new Set()

const getFrameUrl = (filename, projectName) => {
    const query = projectName ? `?project_name=${encodeURIComponent(projectName)}` : ''
    return `http://localhost:8000/image_file/${encodeURIComponent(filename)}${query}`
}

const preloadFrame = (filename, projectName) => {
    const cacheKey = `${projectName || ''}:${filename || ''}`
    if (!filename || loadedFrames.has(cacheKey)) {
        return Promise.resolve()
    }

    return new Promise((resolve) => {
        const image = new Image()
        image.onload = () => {
            loadedFrames.add(cacheKey)
            resolve()
        }
        image.onerror = () => resolve()
        image.src = getFrameUrl(filename, projectName)
    })
}

export const FrameTimeline = () => {
    const { images, selectedImage, setSelectedImage, projectName } = useStore()
    const [stepSize, setStepSize] = useState(1)
    const [playFps, setPlayFps] = useState(24)
    const [isPlaying, setIsPlaying] = useState(false)
    const playTimerRef = useRef(null)

    const orderedImages = useMemo(() => sortFrames(images), [images])
    const frameCount = orderedImages.length
    const currentIndex = Math.max(0, orderedImages.indexOf(selectedImage))
    const currentFrame = frameCount > 0 ? currentIndex + 1 : 0
    const currentFilename = orderedImages[currentIndex] || ''

    const goToIndex = (index) => {
        if (frameCount === 0) return

        setIsPlaying(false)
        const nextIndex = Math.min(Math.max(index, 0), frameCount - 1)
        setSelectedImage(orderedImages[nextIndex])
    }

    const goByStep = (direction) => {
        goToIndex(currentIndex + direction * stepSize)
    }

    useEffect(() => {
        if (frameCount > 0 && (!selectedImage || !orderedImages.includes(selectedImage))) {
            setSelectedImage(orderedImages[0])
        }
    }, [frameCount, orderedImages, selectedImage, setSelectedImage])

    useEffect(() => {
        setStepSize((currentStep) => Math.min(Math.max(currentStep, 1), Math.max(frameCount, 1)))
    }, [frameCount])

    useEffect(() => {
        if (!isPlaying || frameCount <= 1) return

        let cancelled = false

        const playNextFrame = async () => {
            const latestSelected = useStore.getState().selectedImage
            const latestIndex = Math.max(0, orderedImages.indexOf(latestSelected))
            const nextIndex = latestIndex + stepSize

            if (nextIndex >= frameCount) {
                setIsPlaying(false)
                setSelectedImage(orderedImages[frameCount - 1])
                return
            }

            const nextFrame = orderedImages[nextIndex]
            await preloadFrame(nextFrame, projectName)

            if (cancelled) return

            setSelectedImage(nextFrame)

            for (let offset = 1; offset <= 8; offset += 1) {
                preloadFrame(orderedImages[nextIndex + offset * stepSize], projectName)
            }

            playTimerRef.current = setTimeout(playNextFrame, Math.max(16, 1000 / playFps))
        }

        playTimerRef.current = setTimeout(playNextFrame, Math.max(16, 1000 / playFps))

        return () => {
            cancelled = true
            clearTimeout(playTimerRef.current)
        }
    }, [frameCount, isPlaying, orderedImages, playFps, projectName, setSelectedImage, stepSize])

    useEffect(() => {
        if (frameCount <= 1) {
            setIsPlaying(false)
        }
    }, [frameCount])

    if (frameCount <= 1) {
        return null
    }

    return (
        <div className="absolute bottom-4 left-1/2 z-30 w-[min(960px,calc(100%-2rem))] -translate-x-1/2 rounded-2xl border border-slate-700/70 bg-slate-900/95 shadow-2xl backdrop-blur-xl">
            <div className="flex flex-col gap-3 p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                    <div className="flex items-center gap-1 rounded-xl bg-slate-950/70 p-1">
                        <button
                            type="button"
                            onClick={() => goToIndex(0)}
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-white"
                            title="First frame"
                        >
                            <SkipBack size={18} />
                        </button>
                        <button
                            type="button"
                            onClick={() => goByStep(-1)}
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-white"
                            title={`Back ${stepSize} frame${stepSize === 1 ? '' : 's'}`}
                        >
                            <StepBack size={18} />
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsPlaying((playing) => !playing)}
                            className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-600 text-white shadow-lg shadow-cyan-900/30 transition hover:bg-cyan-500"
                            title={isPlaying ? 'Pause timeline' : 'Play timeline'}
                        >
                            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                        </button>
                        <button
                            type="button"
                            onClick={() => goByStep(1)}
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-white"
                            title={`Forward ${stepSize} frame${stepSize === 1 ? '' : 's'}`}
                        >
                            <StepForward size={18} />
                        </button>
                        <button
                            type="button"
                            onClick={() => goToIndex(frameCount - 1)}
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-white"
                            title="Last frame"
                        >
                            <SkipForward size={18} />
                        </button>
                    </div>

                    <div className="min-w-0 flex-1">
                        <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                            <div className="min-w-0">
                                <span className="font-mono font-bold text-cyan-300">
                                    {currentFrame} / {frameCount}
                                </span>
                                <span className="ml-2 font-mono text-slate-500" title={currentFilename}>
                                    {currentFilename}
                                </span>
                            </div>
                            <span className="hidden shrink-0 font-mono text-slate-500 sm:inline">
                                Timeline
                            </span>
                        </div>
                        <input
                            type="range"
                            min="1"
                            max={frameCount}
                            value={currentFrame}
                            onChange={(event) => goToIndex(Number(event.target.value) - 1)}
                            className="timeline-range h-3 w-full cursor-pointer appearance-none rounded-full"
                            style={{
                                '--timeline-progress': `${((currentFrame - 1) / Math.max(frameCount - 1, 1)) * 100}%`
                            }}
                        />
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 lg:w-44">
                        <label className="text-[10px] font-bold uppercase text-slate-500">Step</label>
                        <input
                            type="number"
                            min="1"
                            max={frameCount}
                            value={stepSize}
                            onChange={(event) => {
                                const value = Number(event.target.value)
                                setStepSize(Math.min(Math.max(value || 1, 1), frameCount))
                            }}
                            className="w-20 rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-right font-mono text-sm font-bold text-cyan-300 outline-none focus:border-cyan-500"
                        />
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 lg:w-44">
                        <label className="text-[10px] font-bold uppercase text-slate-500">FPS</label>
                        <input
                            type="number"
                            min="1"
                            max="60"
                            value={playFps}
                            onChange={(event) => {
                                const value = Number(event.target.value)
                                setPlayFps(Math.min(Math.max(value || 1, 1), 60))
                            }}
                            className="w-20 rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-right font-mono text-sm font-bold text-cyan-300 outline-none focus:border-cyan-500"
                        />
                    </div>
                </div>
            </div>
        </div>
    )
}
