import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { Bot, Scan, Wand2, Save, Zap, Loader2, Square } from 'lucide-react'

export const Toolbar = () => {
    const {
        selectedImage,
        images,
        annotations,
        allAnnotations,
        projectName,
        setAnnotations,
        setAllAnnotations,
        isProcessing,
        setProcessing,
        processingProgress,
        setProcessingProgress,
        setAnnotationTool
    } = useStore()
    const [showAiTools, setShowAiTools] = useState(false)
    const [trackFrameCount, setTrackFrameCount] = useState(30)
    const [currentTrackingTaskId, setCurrentTrackingTaskId] = useState(null)
    const [rangeStartFrame, setRangeStartFrame] = useState(1)
    const [rangeEndFrame, setRangeEndFrame] = useState(1)
    const projectQuery = projectName ? `&project_name=${encodeURIComponent(projectName)}` : ''
    const leadingProjectQuery = projectName ? `?project_name=${encodeURIComponent(projectName)}` : ''

    const toolButtonClass = "group relative flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 transition-all hover:bg-slate-800 hover:text-white disabled:opacity-50 active:scale-95"
    const tooltipClass = "pointer-events-none absolute right-full mr-3 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] font-bold text-slate-200 opacity-0 shadow-xl transition-opacity group-hover:opacity-100 whitespace-nowrap"
    const selectedFrameIndex = images.indexOf(selectedImage)
    const selectedFrameStep = selectedFrameIndex >= 0 ? selectedFrameIndex + 1 : 1

    useEffect(() => {
        if (selectedFrameIndex < 0) return
        const start = selectedFrameIndex + 1
        setRangeStartFrame(start)
        setRangeEndFrame(Math.min(images.length, start + trackFrameCount))
    }, [selectedFrameIndex, images.length])

    const getTrackRootId = (annotation) => annotation?.source_id || annotation?.id
    const getCleanLabel = (annotation) => {
        const label = String(annotation?.label || '').trim()
        return label && label !== 'New Object' ? label : 'object'
    }
    const clampFrameStep = (value) => Math.max(1, Math.min(images.length || 1, Number(value) || 1))
    const rangeStartIndex = clampFrameStep(rangeStartFrame) - 1
    const rangeEndIndex = clampFrameStep(rangeEndFrame) - 1
    const rangeStartFilename = images[rangeStartIndex]
    const rangeEndFilename = images[rangeEndIndex]
    const getAnnotationsForFrame = (filename) => {
        if (!filename) return []
        if (filename === selectedImage) return annotations
        return Array.isArray(allAnnotations[filename]) ? allAnnotations[filename] : []
    }

    const trackedObjects = useMemo(() => {
        const objectMap = new Map()

        images.forEach((filename, frameIndex) => {
            const frameAnnotations = Array.isArray(allAnnotations[filename]) ? allAnnotations[filename] : []
            frameAnnotations.forEach((annotation) => {
                const rootId = getTrackRootId(annotation)
                if (!rootId) return

                const label = getCleanLabel(annotation)
                const existing = objectMap.get(rootId)
                if (!existing) {
                    objectMap.set(rootId, {
                        rootId,
                        label,
                        firstFrame: filename,
                        firstIndex: frameIndex,
                        lastFrame: filename,
                        lastIndex: frameIndex,
                        lastAnnotation: annotation,
                        count: 1
                    })
                    return
                }

                existing.label = existing.label === 'object' ? label : existing.label
                existing.count += 1
                if (frameIndex >= existing.lastIndex) {
                    existing.lastFrame = filename
                    existing.lastIndex = frameIndex
                    existing.lastAnnotation = annotation
                }
            })
        })

        const labelCounts = {}
        return Array.from(objectMap.values())
            .sort((first, second) => first.firstIndex - second.firstIndex || first.label.localeCompare(second.label))
            .map((item) => {
                labelCounts[item.label] = (labelCounts[item.label] || 0) + 1
                return {
                    ...item,
                    name: `${item.label}${labelCounts[item.label]}`
                }
            })
    }, [allAnnotations, images])

    const mergeTrackedAnnotations = (trackedResults, boxesToTrack) => {
        const rootIds = new Set(boxesToTrack.map(getTrackRootId).filter(Boolean))
        const currentAllAnnotations = useStore.getState().allAnnotations
        const updatedAllAnnotations = { ...currentAllAnnotations }

        Object.entries(trackedResults).forEach(([filename, trackedAnnotations]) => {
            const existingAnnotations = Array.isArray(updatedAllAnnotations[filename])
                ? updatedAllAnnotations[filename]
                : []
            updatedAllAnnotations[filename] = [
                ...existingAnnotations.filter((annotation) => !rootIds.has(getTrackRootId(annotation))),
                ...trackedAnnotations
            ]
        })

        return updatedAllAnnotations
    }

    const getTrackObjectOnFrame = (trackObject, filename = selectedImage) => {
        const frameAnnotations = Array.isArray(allAnnotations[filename]) ? allAnnotations[filename] : []
        return frameAnnotations.find((annotation) => getTrackRootId(annotation) === trackObject.rootId)
    }

    const pruneTrackAfterFrame = (allAnnotationMap, trackObject, frameIndex) => {
        const updatedAllAnnotations = { ...allAnnotationMap }
        images.forEach((filename, index) => {
            if (index <= frameIndex) return
            const frameAnnotations = Array.isArray(updatedAllAnnotations[filename])
                ? updatedAllAnnotations[filename]
                : []
            updatedAllAnnotations[filename] = frameAnnotations.filter(
                (annotation) => getTrackRootId(annotation) !== trackObject.rootId
            )
        })
        return updatedAllAnnotations
    }

    const pruneTrackFrameRange = (allAnnotationMap, trackObject, startIndex, endIndex) => {
        const updatedAllAnnotations = { ...allAnnotationMap }
        images.forEach((filename, index) => {
            if (index <= startIndex || index > endIndex) return
            const frameAnnotations = Array.isArray(updatedAllAnnotations[filename])
                ? updatedAllAnnotations[filename]
                : []
            updatedAllAnnotations[filename] = frameAnnotations.filter(
                (annotation) => getTrackRootId(annotation) !== trackObject.rootId
            )
        })
        return updatedAllAnnotations
    }

    const handleDetect = async () => {
        if (!selectedImage) return;
        setProcessing(true)
        setProcessingProgress({ current: 0, total: 1, message: 'Detecting objects...' })
        try {
            const res = await fetch(`http://localhost:8000/detect?filename=${encodeURIComponent(selectedImage)}${projectQuery}`, {
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
                    const res = await fetch(`http://localhost:8000/detect?filename=${encodeURIComponent(filename)}${projectQuery}`, {
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
            const res = await fetch(`http://localhost:8000/segment?filename=${encodeURIComponent(selectedImage)}${projectQuery}`, {
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

    const handleTrack = async (mode, trackObject = null, options = {}) => {
        const startFilename = options.startFilename || trackObject?.lastFrame || selectedImage;
        if (!startFilename) return;

        const boxesToTrack = options.boxesToTrack || (trackObject?.lastAnnotation ? [trackObject.lastAnnotation] : annotations);
        const currentIndex = images.indexOf(startFilename);
        if (currentIndex < 0) {
            alert('The selected track frame is not in the current timeline.');
            return;
        }
        const remainingFrames = Math.max(images.length - currentIndex - 1, 0);
        const explicitEndIndex = Number.isInteger(options.endIndex) ? options.endIndex : null;
        const frameCount = explicitEndIndex !== null
            ? Math.max(0, Math.min(explicitEndIndex - currentIndex, remainingFrames))
            : mode === 'next'
            ? 1
            : mode === 'range'
                ? Math.min(trackFrameCount, remainingFrames)
                : 0;
        const progressTotal = mode === 'all' ? remainingFrames : frameCount;
        const targetName = trackObject?.name || `${boxesToTrack.length} object(s)`;

        if (boxesToTrack.length === 0) {
            alert('Draw or detect at least one bounding box before tracking.');
            return;
        }

        if (remainingFrames === 0) {
            alert('There are no later frames to track into.');
            return;
        }

        if (mode !== 'all' && frameCount < 1) {
            alert('Track frame count must be at least 1.');
            return;
        }

        const isRepair = Boolean(options.pruneTrackObject);
        const needsConfirmation = mode === 'all' || isRepair || progressTotal > 120;
        if (needsConfirmation) {
            const actionName = isRepair ? 'repair and re-track' : 'track';
            const message = [
                `${actionName.toUpperCase()} ${targetName}`,
                '',
                `Start frame: ${startFilename}`,
                `Frames to process: ${progressTotal}`,
                '',
                isRepair
                    ? 'This will keep the corrected box on the current frame, delete this object from later frames, then create a fresh continuation.'
                    : 'This will add/replace future boxes for this object until the selected range is complete.',
                '',
                'You can press Stop while it runs, but frames already completed will remain.'
            ].join('\n');

            if (!window.confirm(message)) {
                return;
            }
        }

        setProcessing(true);
        setProcessingProgress({
            current: 0,
            total: progressTotal,
            message: mode === 'all'
                ? `AI tracking ${targetName} through remaining video...`
                : `AI tracking ${targetName} for ${progressTotal} frame(s)...`
        });

        const taskId = window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
        let progressTimer = null;
        setCurrentTrackingTaskId(taskId);

        const pollTrackingProgress = async () => {
            try {
                const progressRes = await fetch(`http://localhost:8000/track/progress/${encodeURIComponent(taskId)}`);
                if (!progressRes.ok) return;

                const progress = await progressRes.json();
                const current = Number(progress.current || 0);
                const total = Number(progress.total || progressTotal);
                const percent = Number(progress.percent || 0);
                const fps = Number(progress.frames_per_second || 0);
                const eta = Number(progress.eta_seconds || 0);
                const parts = [
                    progress.message || `Tracking ${current}/${total} frame(s)`,
                    total > 0 ? `${percent.toFixed(1)}%` : null,
                    fps > 0 ? `${fps.toFixed(1)} fps` : null,
                    eta > 0 ? `ETA ${Math.ceil(eta)}s` : null
                ].filter(Boolean);

                setProcessingProgress({
                    current,
                    total,
                    message: parts.join(' • ')
                });
            } catch (err) {
                console.debug('Tracking progress poll failed:', err);
            }
        };

        try {
            progressTimer = window.setInterval(pollTrackingProgress, 250);
            pollTrackingProgress();

            const res = await fetch('http://localhost:8000/track', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    task_id: taskId,
                    start_filename: startFilename,
                    boxes: boxesToTrack,
                    frame_count: frameCount,
                    project_name: projectName || null
                })
            });

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.detail || `Server error: ${res.status}`);
            }

            const data = await res.json();
            const trackedResults = data.results || {};
            let updatedAllAnnotations = mergeTrackedAnnotations(trackedResults, boxesToTrack);
            if (options.pruneTrackObject) {
                updatedAllAnnotations = Number.isInteger(options.pruneEndIndex)
                    ? pruneTrackFrameRange(
                        useStore.getState().allAnnotations,
                        options.pruneTrackObject,
                        currentIndex,
                        options.pruneEndIndex
                    )
                    : pruneTrackAfterFrame(
                        useStore.getState().allAnnotations,
                        options.pruneTrackObject,
                        currentIndex
                    )
                Object.entries(trackedResults).forEach(([filename, trackedAnnotations]) => {
                    const existingAnnotations = Array.isArray(updatedAllAnnotations[filename])
                        ? updatedAllAnnotations[filename].filter((annotation) => getTrackRootId(annotation) !== options.pruneTrackObject.rootId)
                        : []
                    updatedAllAnnotations[filename] = [...existingAnnotations, ...trackedAnnotations]
                })
            }

            setAllAnnotations(updatedAllAnnotations);
            setProcessingProgress({
                current: data.tracked_frames || progressTotal,
                total: progressTotal,
                message: data.cancelled
                    ? `AI tracking stopped for ${targetName}: ${data.tracked_frames || 0} frame(s)`
                    : `AI tracking complete for ${targetName}: ${data.tracked_frames || 0} frame(s)`
            });

            const toast = document.createElement('div');
            toast.className = 'fixed top-6 right-6 bg-green-500/90 backdrop-blur-md text-white px-6 py-3 rounded-xl shadow-2xl z-50 animate-fade-in';
            const trackerDetails = Array.isArray(data.methods_used) && data.methods_used.length > 0
                ? data.methods_used.join(', ')
                : (data.tracker || 'tracker');
            toast.innerHTML = data.cancelled
                ? `Stopped ${targetName} after ${data.tracked_frames || 0} frame(s).`
                : `Tracked ${targetName} into ${data.tracked_frames || 0} frame(s) using ${trackerDetails}.`;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
        } catch (err) {
            console.error('Tracking error:', err);
            const toast = document.createElement('div');
            toast.className = 'fixed top-6 right-6 bg-red-500/90 backdrop-blur-md text-white px-6 py-3 rounded-xl shadow-2xl z-50 animate-fade-in';
            toast.innerHTML = `AI tracking failed: ${err.message}`;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 4000);
        } finally {
            setTimeout(() => {
                setProcessing(false);
                setProcessingProgress({ current: 0, total: 0, message: '' });
                setCurrentTrackingTaskId(null);
            }, 800);
            if (progressTimer) {
                window.clearInterval(progressTimer);
            }
        }
    }

    const handleCancelTracking = async () => {
        if (!currentTrackingTaskId) return;
        try {
            await fetch(`http://localhost:8000/track/cancel/${encodeURIComponent(currentTrackingTaskId)}`, {
                method: 'POST'
            });
            setProcessingProgress({
                ...processingProgress,
                message: 'Stopping tracker after the current frame...'
            });
        } catch (err) {
            console.error('Cancel tracking failed:', err);
        }
    }

    const handleRepairTrackFromCurrentFrame = (trackObject) => {
        const selectedIndex = images.indexOf(selectedImage)
        const correctedAnnotation = getTrackObjectOnFrame(trackObject)

        if (selectedIndex < 0 || !correctedAnnotation) {
            alert(`Open the frame where ${trackObject.name} is corrected first.`)
            return
        }

        if (selectedIndex >= images.length - 1) {
            alert('There are no later frames to repair.')
            return
        }

        const repairedBox = {
            ...correctedAnnotation,
            source_id: trackObject.rootId
        }

        handleTrack('all', trackObject, {
            startFilename: selectedImage,
            boxesToTrack: [repairedBox],
            pruneTrackObject: trackObject
        })
    }

    const handleTrackCurrentRange = () => {
        if (!rangeStartFilename || !rangeEndFilename || rangeEndIndex <= rangeStartIndex) {
            alert('Choose a valid Start and End frame. End must be after Start.')
            return
        }

        const boxesToTrack = getAnnotationsForFrame(rangeStartFilename)
        if (boxesToTrack.length === 0) {
            alert(`No boxes found on frame ${rangeStartIndex + 1}. Draw and name the object on the Start frame first.`)
            return
        }

        handleTrack('range', null, {
            startFilename: rangeStartFilename,
            boxesToTrack,
            endIndex: rangeEndIndex
        })
    }

    const handleRepairTrackRange = (trackObject) => {
        if (!rangeStartFilename || !rangeEndFilename || rangeEndIndex <= rangeStartIndex) {
            alert('Choose a valid repair range. End must be after Start.')
            return
        }

        const correctedAnnotation = getTrackObjectOnFrame(trackObject, rangeStartFilename)
        if (!correctedAnnotation) {
            alert(`No ${trackObject.name} box found on Start frame ${rangeStartIndex + 1}. Open that frame and correct/draw it first.`)
            return
        }

        handleTrack('range', trackObject, {
            startFilename: rangeStartFilename,
            boxesToTrack: [{ ...correctedAnnotation, source_id: trackObject.rootId }],
            endIndex: rangeEndIndex,
            pruneTrackObject: trackObject,
            pruneEndIndex: rangeEndIndex
        })
    }

    const handleSave = async () => {
        if (!selectedImage) return;
        try {
            const batchAnnotations = { ...allAnnotations, [selectedImage]: annotations }
            const res = await fetch(`http://localhost:8000/save_batch${leadingProjectQuery}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(batchAnnotations)
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
        <div className="absolute right-4 top-1/2 z-30 -translate-y-1/2">
            {showAiTools && selectedImage && (
                <div className="absolute right-full top-1/2 mr-3 w-[420px] -translate-y-1/2 rounded-2xl border border-slate-700/60 bg-slate-900/95 px-3 py-3 shadow-2xl backdrop-blur-xl">
                    <div className="flex flex-wrap items-center justify-center gap-2">
                        <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2">
                            <Bot size={16} className="text-cyan-300" />
                            <span className="text-xs font-bold uppercase text-slate-400">Tracker</span>
                        </div>
                        <div className="w-full rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-100">
                            Draw or correct boxes on Start, then track or repair only the selected frame range.
                        </div>

                        <div className="w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-3">
                            <div className="mb-2 flex items-center justify-between">
                                <span className="text-[10px] font-bold uppercase text-slate-500">Frame Range</span>
                                <span className="font-mono text-[10px] text-slate-500">Current {selectedFrameStep}/{images.length}</span>
                            </div>
                            <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                                <label className="text-[10px] font-bold uppercase text-slate-500">
                                    Start
                                    <input
                                        type="number"
                                        min="1"
                                        max={Math.max(images.length, 1)}
                                        value={rangeStartFrame}
                                        onChange={(event) => setRangeStartFrame(clampFrameStep(event.target.value))}
                                        className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-right font-mono text-xs text-cyan-200 outline-none focus:border-cyan-500"
                                    />
                                </label>
                                <label className="text-[10px] font-bold uppercase text-slate-500">
                                    End
                                    <input
                                        type="number"
                                        min="1"
                                        max={Math.max(images.length, 1)}
                                        value={rangeEndFrame}
                                        onChange={(event) => setRangeEndFrame(clampFrameStep(event.target.value))}
                                        className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-right font-mono text-xs text-cyan-200 outline-none focus:border-cyan-500"
                                    />
                                </label>
                                <button
                                    onClick={() => {
                                        const start = selectedFrameStep
                                        setRangeStartFrame(start)
                                        setRangeEndFrame(Math.min(images.length, start + trackFrameCount))
                                    }}
                                    className="self-end rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-bold text-slate-300 transition hover:border-cyan-500 hover:text-cyan-200"
                                >
                                    Use Current
                                </button>
                            </div>
                            <button
                                onClick={handleTrackCurrentRange}
                                disabled={isProcessing || !rangeStartFilename || rangeEndIndex <= rangeStartIndex || getAnnotationsForFrame(rangeStartFilename).length === 0}
                                className="mt-2 w-full rounded-lg bg-cyan-700 px-3 py-2 text-xs font-bold text-white transition hover:bg-cyan-500 disabled:opacity-40"
                                title="Track every box on the Start frame through End frame"
                            >
                                Track Boxes From {rangeStartIndex + 1} To {rangeEndIndex + 1}
                            </button>
                        </div>

                        <div className="w-full rounded-xl border border-slate-800 bg-slate-950/70">
                            <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
                                <span className="text-[10px] font-bold uppercase text-slate-500">Object Tracks</span>
                                <span className="font-mono text-[10px] text-cyan-400">{trackedObjects.length}</span>
                            </div>
                            <div className="max-h-52 overflow-y-auto">
                                {trackedObjects.length === 0 ? (
                                    <div className="px-3 py-4 text-center text-xs text-slate-500">
                                        No named tracks yet.
                                    </div>
                                ) : (
                                    <table className="w-full table-fixed text-left text-xs">
                                        <thead className="sticky top-0 bg-slate-950 text-[10px] uppercase text-slate-500">
                                            <tr>
                                                <th className="w-24 px-3 py-2">Object</th>
                                                <th className="w-16 px-2 py-2 text-right">Frames</th>
                                                <th className="px-2 py-2">Last</th>
                                                <th className="w-52 px-2 py-2 text-right">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {trackedObjects.map((track) => {
                                                const remaining = Math.max(images.length - track.lastIndex - 1, 0)
                                                const selectedFrameIndex = images.indexOf(selectedImage)
                                                const canRepair = Boolean(getTrackObjectOnFrame(track)) && selectedFrameIndex < images.length - 1
                                                return (
                                                    <tr key={track.rootId} className="border-t border-slate-900 text-slate-300">
                                                        <td className="px-3 py-2 font-bold text-cyan-200" title={track.rootId}>
                                                            {track.name}
                                                        </td>
                                                        <td className="px-2 py-2 text-right font-mono text-slate-400">
                                                            {track.count}
                                                        </td>
                                                        <td className="truncate px-2 py-2 font-mono text-[10px] text-slate-500" title={track.lastFrame}>
                                                            {track.lastIndex + 1}/{images.length}
                                                        </td>
                                                        <td className="px-2 py-2">
                                                            <div className="flex justify-end gap-1">
                                                                <button
                                                                    onClick={() => handleRepairTrackRange(track)}
                                                                    disabled={isProcessing || rangeEndIndex <= rangeStartIndex || !getTrackObjectOnFrame(track, rangeStartFilename)}
                                                                    className="rounded-md bg-amber-700 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-amber-500 disabled:opacity-40"
                                                                    title="Replace this object only inside the Start-End range using the corrected box on Start"
                                                                >
                                                                    Fix X-Y
                                                                </button>
                                                                <button
                                                                    onClick={() => handleRepairTrackFromCurrentFrame(track)}
                                                                    disabled={isProcessing || !canRepair}
                                                                    className="rounded-md bg-amber-700 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-amber-500 disabled:opacity-40"
                                                                    title="Delete this object's later boxes and continue from the corrected box on the current frame"
                                                                >
                                                                    Fix Rest
                                                                </button>
                                                                <button
                                                                    onClick={() => handleTrack('range', track)}
                                                                    disabled={isProcessing || remaining === 0}
                                                                    className="rounded-md bg-slate-800 px-2 py-1 text-[10px] font-bold text-slate-200 transition hover:bg-cyan-600 disabled:opacity-40"
                                                                >
                                                                    +{Math.min(trackFrameCount, remaining)}
                                                                </button>
                                                                <button
                                                                    onClick={() => handleTrack('all', track)}
                                                                    disabled={isProcessing || remaining === 0}
                                                                    className="rounded-md bg-cyan-700 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-cyan-500 disabled:opacity-40"
                                                                    title="Continue this object from its latest frame to the end of the video"
                                                                >
                                                                    Rest
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>

                        <button
                            onClick={() => handleTrack('next')}
                            disabled={isProcessing || annotations.length === 0}
                            className="rounded-xl bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 transition hover:bg-cyan-600 hover:text-white disabled:opacity-50"
                        >
                            Track Current Next
                        </button>
                        <div className="flex items-center gap-2 rounded-xl bg-slate-800 px-2 py-1.5">
                            <input
                                type="number"
                                min="1"
                                max={Math.max(images.length - images.indexOf(selectedImage) - 1, 1)}
                                value={trackFrameCount}
                                onChange={(event) => setTrackFrameCount(Math.max(1, Number(event.target.value) || 1))}
                                className="w-16 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-right font-mono text-xs font-bold text-cyan-300 outline-none focus:border-cyan-500"
                            />
                            <button
                                onClick={() => handleTrack('range')}
                                disabled={isProcessing || annotations.length === 0}
                                className="rounded-lg px-2 py-1 text-xs font-bold text-slate-200 transition hover:bg-cyan-600 hover:text-white disabled:opacity-50"
                            >
                                Track Current
                            </button>
                        </div>
                        <button
                            onClick={() => handleTrack('all')}
                            disabled={isProcessing || annotations.length === 0}
                            className="rounded-xl bg-cyan-600 px-3 py-2 text-xs font-bold text-white shadow-lg shadow-cyan-900/30 transition hover:bg-cyan-500 disabled:opacity-50"
                            title="Track all boxes currently visible from this frame to the end of the video"
                        >
                            Track Current Rest
                        </button>
                    </div>
                </div>
            )}

            <div className="relative flex flex-col items-center gap-2 rounded-2xl border border-slate-700/50 bg-slate-900/90 p-2 shadow-2xl backdrop-blur-xl">
                {isProcessing && processingProgress.total > 0 && (
                    <div className="absolute bottom-2 right-0 top-2 w-1 overflow-hidden rounded-full bg-slate-800">
                        <div
                            className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-cyan-500 to-blue-500 transition-all duration-300"
                            style={{ height: `${(processingProgress.current / processingProgress.total) * 100}%` }}
                        />
                    </div>
                )}

                {!selectedImage && (
                    <div className="max-w-16 px-1 py-2 text-center text-[10px] font-bold uppercase text-slate-500">
                        Select frame
                    </div>
                )}

                {selectedImage && (
                    <>
                        <button
                            onClick={handleDetect}
                            disabled={isProcessing}
                            className={`${toolButtonClass} hover:text-cyan-300`}
                        >
                            <span className={tooltipClass}>Detect</span>
                            {isProcessing && processingProgress.total === 1 ? (
                                <Loader2 size={19} className="animate-spin text-cyan-400" />
                            ) : (
                                <Scan size={19} />
                            )}
                        </button>

                        <button
                            onClick={handleDetectAll}
                            disabled={isProcessing || images.length === 0}
                            className={`${toolButtonClass} hover:text-purple-300`}
                        >
                            <span className={tooltipClass}>Detect all</span>
                            {isProcessing && processingProgress.total > 1 ? (
                                <Loader2 size={19} className="animate-spin text-purple-400" />
                            ) : (
                                <Zap size={19} />
                            )}
                            <div className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-purple-500 px-1 text-[8px] font-bold text-white">
                                {images.length}
                            </div>
                        </button>

                        <button
                            onClick={handleSegment}
                            disabled={isProcessing}
                            className={`${toolButtonClass} hover:text-green-300`}
                        >
                            <span className={tooltipClass}>Segment</span>
                            <Wand2 size={19} />
                        </button>

                        <button
                            onClick={() => {
                                setShowAiTools((visible) => {
                                    const nextVisible = !visible
                                    if (nextVisible) {
                                        setAnnotationTool('draw')
                                    }
                                    return nextVisible
                                })
                            }}
                            disabled={isProcessing}
                            className={`${toolButtonClass} ${showAiTools ? 'bg-cyan-950/50 text-cyan-300' : 'hover:text-cyan-300'}`}
                        >
                            <span className={tooltipClass}>AI tracker</span>
                            <Bot size={19} />
                        </button>

                        <div className="h-px w-8 bg-slate-700/60"></div>

                        <button
                            onClick={handleSave}
                            disabled={isProcessing}
                            className={toolButtonClass}
                        >
                            <span className={tooltipClass}>Save</span>
                            <Save size={19} />
                        </button>
                    </>
                )}
            </div>

            {isProcessing && processingProgress.message && (
                <div className="absolute right-full top-full mt-2 mr-3 w-80 rounded-xl border border-slate-700/60 bg-slate-900/95 px-3 py-2 shadow-2xl backdrop-blur-xl">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                        <Loader2 size={12} className="animate-spin" />
                        <span className="min-w-0 flex-1 truncate">{processingProgress.message}</span>
                        {processingProgress.total > 1 && (
                            <span className="font-mono text-cyan-400">
                                {processingProgress.current}/{processingProgress.total}
                            </span>
                        )}
                        {currentTrackingTaskId && (
                            <button
                                onClick={handleCancelTracking}
                                className="flex items-center gap-1 rounded-md bg-red-950/60 px-2 py-1 text-[10px] font-bold text-red-200 transition hover:bg-red-700 hover:text-white"
                                title="Stop the current tracking job after the frame currently being processed"
                            >
                                <Square size={10} />
                                Stop
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
