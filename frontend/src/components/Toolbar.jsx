import React, { useState } from 'react'
import { useStore } from '../store'
import { Scan, Wand2, Save, Zap, Loader2 } from 'lucide-react'

export const Toolbar = () => {
    const {
        selectedImage,
        images,
        annotations,
        setAnnotations,
        setAllAnnotations,
        isProcessing,
        setProcessing,
        processingProgress,
        setProcessingProgress
    } = useStore()

    const handleDetect = async () => {
        if (!selectedImage) return;
        setProcessing(true)
        setProcessingProgress({ current: 0, total: 1, message: 'Detecting objects...' })
        try {
            const res = await fetch(`http://localhost:8000/detect?filename=${selectedImage}`, {
                method: 'POST'
            })

            if (!res.ok) {
                throw new Error(`Server error: ${res.status}`);
            }

            const data = await res.json()

            // PRESERVE MANUAL ANNOTATIONS:
            // Append new detections to existing ones instead of overwriting.
            setAnnotations([...annotations, ...(data.detections || [])])

            // Success feedback
            if (data.detections && data.detections.length > 0) {
                const toast = document.createElement('div')
                toast.className = 'fixed top-6 right-6 bg-green-500/90 backdrop-blur-md text-white px-6 py-3 rounded-xl shadow-2xl z-50 animate-fade-in'
                toast.innerHTML = `✓ Added ${data.detections.length} new objects!`
                document.body.appendChild(toast)
                setTimeout(() => toast.remove(), 2000)
            }
        } catch (err) {
            console.error('Detection error:', err)

            const toast = document.createElement('div')
            toast.className = 'fixed top-6 right-6 bg-red-500/90 backdrop-blur-md text-white px-6 py-3 rounded-xl shadow-2xl z-50 animate-fade-in'
            toast.innerHTML = `✗ Detection failed: ${err.message}`
            document.body.appendChild(toast)
            setTimeout(() => toast.remove(), 3000)
        } finally {
            setProcessing(false)
            setProcessingProgress({ current: 0, total: 0, message: '' })
        }
    }

    // REFACTORED: Frontend-controlled batch processing
    const handleDetectAll = async () => {
        if (images.length === 0) {
            alert('No images to process. Please upload images first.');
            return;
        }

        setProcessing(true);
        // Initialize progress
        setProcessingProgress({ current: 0, total: images.length, message: 'Starting batch detection...' });

        const batchResults = {};
        const currentAllAnnotations = useStore.getState().allAnnotations;
        let successCount = 0;
        let failCount = 0;
        let skippedCount = 0;

        try {
            // Loop through images one by one
            for (let i = 0; i < images.length; i++) {
                const filename = images[i];

                // CHECK FOR EXISTING ANNOTATIONS
                // If the user has manually annotated (or we have saved annotations), skip this image
                if (currentAllAnnotations[filename] && currentAllAnnotations[filename].length > 0) {
                    setProcessingProgress({
                        current: i + 1,
                        total: images.length,
                        message: `Skipping ${filename} (Already annotated)`
                    });
                    skippedCount++;
                    continue;
                }

                // Update progress message for current file
                setProcessingProgress({
                    current: i + 1,
                    total: images.length,
                    message: `Processing ${filename}...`
                });

                try {
                    // Call the single detect endpoint
                    const res = await fetch(`http://localhost:8000/detect?filename=${filename}`, {
                        method: 'POST'
                    });

                    if (res.ok) {
                        const data = await res.json();
                        const detections = data.detections || [];
                        batchResults[filename] = detections;
                        successCount++;

                        // Live Update: If we are currently looking at this image, update the canvas immediately
                        if (selectedImage === filename) {
                            // For the current image, we also prefer to merge if it happened to be empty before but user is watching
                            // But logic above says we only run if empty. So setAnnotations is safe.
                            setAnnotations(detections);
                        }
                    } else {
                        throw new Error(`Status ${res.status}`);
                    }
                } catch (err) {
                    console.error(`Failed to process ${filename}:`, err);
                    batchResults[filename] = []; // Empty on failure
                    failCount++;
                }
            }

            // Update the global store with all gathered results
            // NOTE: setAllAnnotations does not support functional updates (prev => ...), 
            // so we must merge manually with the current state.
            const updatedAllAnnotations = { ...currentAllAnnotations, ...batchResults };
            setAllAnnotations(updatedAllAnnotations);

            setProcessingProgress({ current: images.length, total: images.length, message: 'Complete!' });

            // Final Summary Notification
            const toast = document.createElement('div');
            toast.className = 'fixed top-6 right-6 bg-green-500/90 backdrop-blur-md text-white px-6 py-3 rounded-xl shadow-2xl z-50 animate-fade-in';
            toast.innerHTML = `✓ Batch complete! ${successCount + skippedCount} processed (${skippedCount} skipped), ${failCount} failed.`;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 4000);

        } catch (err) {
            console.error('Batch loop error:', err);
            const toast = document.createElement('div');
            toast.className = 'fixed top-6 right-6 bg-red-500/90 backdrop-blur-md text-white px-6 py-3 rounded-xl shadow-2xl z-50 animate-fade-in';
            toast.innerHTML = `✗ Batch processing stopped: ${err.message}`;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 4000);
        } finally {
            // Small delay before hiding progress bar so user sees "Complete!"
            setTimeout(() => {
                setProcessing(false);
                setProcessingProgress({ current: 0, total: 0, message: '' });
            }, 1000);
        }
    }

    const handleSegment = async () => {
        if (!selectedImage) return;
        // Only send boxes that don't have segmentation yet (optimization)
        const boxes = annotations.filter(a => !a.points);

        if (boxes.length === 0) {
            const toast = document.createElement('div');
            toast.className = 'fixed top-6 right-6 bg-blue-500/90 backdrop-blur-md text-white px-6 py-3 rounded-xl shadow-2xl z-50 animate-fade-in';
            toast.innerHTML = 'ℹ️ No new boxes to segment.';
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 2000);
            return;
        }

        setProcessing(true);
        setProcessingProgress({ current: 0, total: 1, message: 'Running SAM2 Segmentation...' });

        try {
            const res = await fetch(`http://localhost:8000/segment?filename=${selectedImage}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(boxes)
            });

            if (!res.ok) {
                throw new Error(`Server error: ${res.status}`);
            }

            const data = await res.json();
            const { masks } = data;

            // Update annotations with new masks
            // We map through existing annotations and if we find a matching mask, we add 'points'
            const updatedAnnotations = annotations.map(ant => {
                const mask = masks.find(m => m.box_id === ant.id);
                if (mask) {
                    return { ...ant, points: mask.points };
                }
                return ant;
            });

            setAnnotations(updatedAnnotations);

            const toast = document.createElement('div');
            toast.className = 'fixed top-6 right-6 bg-green-500/90 backdrop-blur-md text-white px-6 py-3 rounded-xl shadow-2xl z-50 animate-fade-in';
            toast.innerHTML = `✓ Segmented ${masks.length} objects!`;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);

        } catch (err) {
            console.error('Segmentation error:', err);
            const toast = document.createElement('div');
            toast.className = 'fixed top-6 right-6 bg-red-500/90 backdrop-blur-md text-white px-6 py-3 rounded-xl shadow-2xl z-50 animate-fade-in';
            toast.innerHTML = `✗ Segmentation failed: ${err.message}`;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 4000);
        } finally {
            setProcessing(false);
            setProcessingProgress({ current: 0, total: 0, message: '' });
        }
    }

    const handleSave = async () => {
        if (!selectedImage) return;
        try {
            const res = await fetch(`http://localhost:8000/save?filename=${selectedImage}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(annotations)
            })
            if (res.ok) {
                const toast = document.createElement('div')
                toast.className = 'fixed top-6 right-6 bg-green-500/90 backdrop-blur-md text-white px-6 py-3 rounded-xl shadow-2xl z-50 animate-fade-in'
                toast.innerHTML = '✓ Annotations saved successfully!'
                document.body.appendChild(toast)
                setTimeout(() => toast.remove(), 3000)
            }
        } catch (err) {
            console.error(err)
        }
    }

    return (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl shadow-2xl z-30 overflow-hidden">

            {/* Progress Bar */}
            {isProcessing && processingProgress.total > 0 && (
                <div className="absolute top-0 left-0 right-0 h-1 bg-slate-800">
                    <div
                        className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300"
                        style={{ width: `${(processingProgress.current / processingProgress.total) * 100}%` }}
                    />
                </div>
            )}

            <div className="flex items-center px-2 py-2 gap-2">
                {!selectedImage && <div className="text-slate-500 px-4 text-sm whitespace-nowrap">Select an image to start</div>}

                {selectedImage && (
                    <>
                        <div className="px-4 border-r border-slate-700/50 mr-2 flex flex-col justify-center py-1">
                            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Current Image</span>
                            <span className="text-sm font-mono text-cyan-400 max-w-[180px] truncate" title={selectedImage}>{selectedImage}</span>
                        </div>

                        <button
                            onClick={handleDetect}
                            disabled={isProcessing}
                            className="group relative flex flex-col items-center justify-center gap-1 px-4 py-2 rounded-xl text-slate-400 hover:text-cyan-400 hover:bg-cyan-950/30 disabled:opacity-50 transition-all active:scale-95"
                        >
                            {isProcessing && processingProgress.total === 1 ? (
                                <Loader2 size={20} className="animate-spin text-cyan-400" />
                            ) : (
                                <Scan size={20} className="group-hover:scale-110 transition-transform" />
                            )}
                            <span className="text-[10px] font-bold uppercase tracking-wide">Detect</span>
                        </button>

                        <button
                            onClick={handleDetectAll}
                            disabled={isProcessing || images.length === 0}
                            className="group relative flex flex-col items-center justify-center gap-1 px-4 py-2 rounded-xl text-slate-400 hover:text-purple-400 hover:bg-purple-950/30 disabled:opacity-50 transition-all active:scale-95"
                        >
                            {isProcessing && processingProgress.total > 1 ? (
                                <Loader2 size={20} className="animate-spin text-purple-400" />
                            ) : (
                                <Zap size={20} className="group-hover:scale-110 transition-transform" />
                            )}
                            <span className="text-[10px] font-bold uppercase tracking-wide">Detect All</span>
                            <div className="absolute -top-1 -right-1 w-4 h-4 bg-purple-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
                                {images.length}
                            </div>
                        </button>

                        <button
                            onClick={handleSegment}
                            disabled={isProcessing}
                            className="group flex flex-col items-center justify-center gap-1 px-4 py-2 rounded-xl text-slate-400 hover:text-green-400 hover:bg-green-950/30 disabled:opacity-50 transition-all active:scale-95"
                        >
                            <Wand2 size={20} className="group-hover:rotate-12 transition-transform" />
                            <span className="text-[10px] font-bold uppercase tracking-wide">Segment</span>
                        </button>

                        <div className="w-px h-10 bg-slate-700/50 mx-1"></div>

                        <button
                            onClick={handleSave}
                            disabled={isProcessing}
                            className="group flex flex-col items-center justify-center gap-1 px-4 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-50 transition-all active:scale-95"
                        >
                            <Save size={20} />
                            <span className="text-[10px] font-bold uppercase tracking-wide">Save</span>
                        </button>
                    </>
                )}
            </div>

            {/* Processing message */}
            {isProcessing && processingProgress.message && (
                <div className="px-4 py-2 border-t border-slate-700/50 bg-slate-800/50">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                        <Loader2 size={12} className="animate-spin" />
                        <span>{processingProgress.message}</span>
                        {processingProgress.total > 1 && (
                            <span className="ml-auto font-mono text-cyan-400">
                                {processingProgress.current}/{processingProgress.total}
                            </span>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}