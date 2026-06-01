import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Stage, Layer, Image as KonvaImage, Rect, Transformer, Text, Label, Tag, Line } from 'react-konva'
import useImage from 'use-image'
import { useStore } from '../store'
import { MousePointer2, Hand, RefreshCw, Trash2, Pencil } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'

const URLImage = ({ src, onImageLoad }) => {
    const [image] = useImage(src)
    const [renderedImage, setRenderedImage] = useState(null)

    useEffect(() => {
        if (image) {
            setRenderedImage(image)
            onImageLoad(image.width, image.height)
        }
    }, [image, onImageLoad])

    // listening={false} ensures the image doesn't intercept mouse events,
    // allowing events to bubble up to the Stage for panning/drawing.
    return renderedImage ? <KonvaImage image={renderedImage} listening={false} /> : null
}

const Rectangle = ({ shapeProps, isSelected, onSelect, onChange, onDblClick, stageScale }) => {
    const shapeRef = useRef();

    // Calculate stroke width based on stage scale to maintain consistent visual thickness
    // If scale is 1, stroke is 2. If scale is 2, stroke is 1.
    const strokeWidth = 2 / stageScale;

    return (
        <>
            <Rect
                onClick={onSelect}
                onTap={onSelect}
                onDblClick={onDblClick}
                onDblTap={onDblClick}
                ref={shapeRef}
                {...shapeProps}
                draggable
                stroke={isSelected ? "#06b6d4" : "#0ea5e9"}
                strokeWidth={isSelected ? strokeWidth * 1.5 : strokeWidth}
                fill="rgba(6,182,212, 0.15)"
                onDragEnd={(e) => {
                    onChange({
                        ...shapeProps,
                        x: e.target.x(),
                        y: e.target.y(),
                    });
                }}
                onTransformEnd={(e) => {
                    const node = shapeRef.current;
                    const scaleX = node.scaleX();
                    const scaleY = node.scaleY();

                    // Reset scale to 1, and apply changes to width and height
                    node.scaleX(1);
                    node.scaleY(1);

                    onChange({
                        ...shapeProps,
                        x: node.x(),
                        y: node.y(),
                        width: Math.max(5, node.width() * scaleX),
                        height: Math.max(5, node.height() * scaleY),
                    });
                }}
            />
            {/* Object Label */}
            <Label
                x={shapeProps.x}
                y={shapeProps.y - (25 / stageScale)} // Scale offset too
                scaleX={1 / stageScale} // Keep label size constant
                scaleY={1 / stageScale}
                opacity={0.9}
            >
                <Tag
                    fill="#0891b2"
                    pointerDirection='down'
                    pointerWidth={6}
                    pointerHeight={6}
                    lineJoin='round'
                    cornerRadius={4}
                />
                <Text
                    text={`${shapeProps.label || 'Object'} ${(shapeProps.confidence ? (shapeProps.confidence * 100).toFixed(0) + '%' : '')}`}
                    fontSize={12}
                    fontStyle="bold"
                    padding={6}
                    fill="white"
                />
            </Label>
        </>
    );
};

const normalizeLabel = (label) => {
    const trimmed = String(label || '').trim()
    return trimmed && trimmed !== 'New Object' ? trimmed : 'Object'
}

const getExplicitLabel = (label) => {
    const trimmed = String(label || '').trim()
    return trimmed && trimmed !== 'New Object' ? trimmed : null
}

const buildLabelClassMap = (allAnnotations) => {
    const labels = new Set()
    const labelToId = new Map()
    const usedIds = new Set()

    Object.values(allAnnotations || {}).forEach((list) => {
        if (!Array.isArray(list)) return
        list.forEach((annotation) => {
            const label = getExplicitLabel(annotation.label)
            if (!label) return
            labels.add(label)

            const classId = Number(annotation.class_id)
            if (
                Number.isInteger(classId) &&
                classId >= 0 &&
                !labelToId.has(label) &&
                !usedIds.has(classId)
            ) {
                labelToId.set(label, classId)
                usedIds.add(classId)
            }
        })
    })

    Array.from(labels).sort((a, b) => a.localeCompare(b)).forEach((label) => {
        if (labelToId.has(label)) return
        let nextId = 0
        while (usedIds.has(nextId)) nextId += 1
        labelToId.set(label, nextId)
        usedIds.add(nextId)
    })

    return labelToId
}

const LabelPopup = ({ annotation, stagePosition, stageScale, onClose, containerRef }) => {
    const { updateAnnotation, allAnnotations } = useStore()
    const [inputValue, setInputValue] = useState(annotation.label === 'New Object' ? '' : annotation.label || '')
    const inputRef = useRef(null)

    const recentLabels = useMemo(() => {
        const labels = new Set()
        Object.values(allAnnotations || {}).forEach((list) => {
            if (!Array.isArray(list)) return
            list.forEach((item) => {
                const label = normalizeLabel(item.label)
                if (label !== 'Object') labels.add(label)
            })
        })
        return Array.from(labels).sort((a, b) => a.localeCompare(b))
    }, [allAnnotations])

    const commitLabel = (rawLabel) => {
        const label = normalizeLabel(rawLabel || recentLabels[0])
        const labelClassMap = buildLabelClassMap({
            ...allAnnotations,
            __editing__: [{ ...annotation, label }]
        })

        updateAnnotation(annotation.id, {
            label,
            class_id: labelClassMap.get(label) ?? 0,
            confidence: annotation.confidence ?? 1.0
        })
        onClose()
    }

    useEffect(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
    }, [])

    const containerRect = containerRef.current?.getBoundingClientRect() || { left: 0, top: 0 }
    const left = containerRect.left + (annotation.x * stageScale + stagePosition.x)
    const top = containerRect.top + ((annotation.y + annotation.height) * stageScale + stagePosition.y + 10)

    return createPortal(
        <div
            className="fixed z-[100] w-64 rounded-xl border border-slate-700/70 bg-slate-900/95 p-3 shadow-2xl backdrop-blur-xl"
            style={{ left, top, transform: 'translateX(-50%)' }}
        >
            <form
                className="flex flex-col gap-2"
                onSubmit={(event) => {
                    event.preventDefault()
                    commitLabel(inputValue)
                }}
            >
                <div className="flex items-center justify-between text-[10px] font-bold uppercase text-slate-500">
                    <span>Name object</span>
                    <button type="button" onClick={onClose} className="text-base leading-none text-slate-400 hover:text-white">
                        &times;
                    </button>
                </div>

                <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={(event) => setInputValue(event.target.value)}
                    placeholder="customer, staff..."
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-medium text-white outline-none placeholder:text-slate-600 focus:border-cyan-500"
                />

                {recentLabels.length > 0 && (
                    <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
                        {recentLabels.map((label, index) => (
                            <button
                                key={label}
                                type="button"
                                onClick={() => commitLabel(label)}
                                className={`rounded-md border px-2 py-1 text-xs font-bold transition ${index === 0
                                    ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200'
                                    : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-cyan-500/50 hover:text-cyan-200'
                                    }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                )}

                <button
                    type="submit"
                    className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-cyan-500"
                >
                    Save Label
                </button>
            </form>
        </div>,
        document.body
    )
}

export const Canvas = () => {
    const {
        selectedImage,
        annotations,
        setAnnotations,
        updateAnnotation,
        removeAnnotation,
        projectName,
        annotationTool,
        setAnnotationTool
    } = useStore()
    const [selectedId, selectShape] = useState(null)
    const [stageSize, setStageSize] = useState({ width: window.innerWidth, height: window.innerHeight })
    const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
    const [scale, setScale] = useState(1)
    const [position, setPosition] = useState({ x: 0, y: 0 })

    const tool = annotationTool

    // Interaction States
    const [isPanning, setIsPanning] = useState(false)
    const [isDrawing, setIsDrawing] = useState(false)
    const [newAnnotation, setNewAnnotation] = useState(null)
    const [cursorGuide, setCursorGuide] = useState(null)
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
    const [editingAnnotationId, setEditingAnnotationId] = useState(null)

    const stageRef = useRef(null)
    const transformerRef = useRef(null)
    const lastLoadedImageRef = useRef(null)
    const guideFrameRef = useRef(null)
    const canvasContainerRef = useRef(null)

    useEffect(() => {
        const handleResize = () => {
            setStageSize({ width: window.innerWidth, height: window.innerHeight })
        }
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [])

    // Keyboard Shortcuts (Delete)
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
                if (editingAnnotationId) return;
                removeAnnotation(selectedId);
                selectShape(null); // Deselect after deleting
            }
            if (e.key === 'Escape' && editingAnnotationId) {
                setEditingAnnotationId(null);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedId, removeAnnotation, editingAnnotationId]);

    useEffect(() => {
        return () => {
            if (guideFrameRef.current) {
                cancelAnimationFrame(guideFrameRef.current);
            }
        }
    }, []);

    // Update Transformer nodes when selection changes
    useEffect(() => {
        if (selectedId && transformerRef.current) {
            // We need to find the node. 
            // Since we don't have direct refs to children here easily without forwardRef callback hell,
            // we rely on Konva finding the node by some ID or we trust Rect's ref logic?
            // Actually, best way in React-Konva with dynamic list is searching by name/id.
            // Let's ensure Rects have a name prop same as their ID.

            const stage = transformerRef.current.getStage();
            const selectedNode = stage.findOne('.' + selectedId);

            if (selectedNode) {
                transformerRef.current.nodes([selectedNode]);
                transformerRef.current.getLayer().batchDraw();
            } else {
                transformerRef.current.nodes([]);
            }
        } else if (transformerRef.current) {
            transformerRef.current.nodes([]);
            transformerRef.current.getLayer().batchDraw();
        }
    }, [selectedId, annotations]) // Re-run if annotations re-render

    // Reset lastLoadedImageRef when selectedImage changes
    useEffect(() => {
        lastLoadedImageRef.current = null;
        setCursorGuide(null);
        setAnnotationTool('pan'); // Reset tool to pan on image change safely
        selectShape(null); // Clear selection on image change
        setEditingAnnotationId(null);
    }, [selectedImage, setAnnotationTool])

    const handleImageLoad = useCallback((imgWidth, imgHeight) => {
        if (lastLoadedImageRef.current === selectedImage) return;
        lastLoadedImageRef.current = selectedImage;

        if (imgWidth <= 0 || imgHeight <= 0) return;
        setImageSize({ width: imgWidth, height: imgHeight });

        const padding = 50;
        const availableWidth = stageSize.width - padding * 2;
        const availableHeight = stageSize.height - padding * 2;

        const scaleX = availableWidth / imgWidth;
        const scaleY = availableHeight / imgHeight;

        let newScale = Math.min(scaleX, scaleY);
        if (!isFinite(newScale) || newScale <= 0) newScale = 0.1;

        const centerX = (stageSize.width - imgWidth * newScale) / 2;
        const centerY = (stageSize.height - imgHeight * newScale) / 2;

        setScale(newScale);
        setPosition({ x: centerX, y: centerY });
    }, [stageSize.width, stageSize.height, selectedImage])

    const checkDeselect = (e) => {
        // Deselect if clicked on empty stage
        const clickedOnEmpty = e.target === e.target.getStage() || e.target.getLayer() === e.target;
        if (clickedOnEmpty) {
            selectShape(null);
            setEditingAnnotationId(null);
        }
    };

    const clampGuidePosition = (pos) => ({
        x: Math.max(0, Math.min(imageSize.width || pos.x, pos.x)),
        y: Math.max(0, Math.min(imageSize.height || pos.y, pos.y))
    });

    const handleMouseDown = (e) => {
        const stage = e.target.getStage();
        const pos = stage.getPointerPosition();

        if (editingAnnotationId) {
            setEditingAnnotationId(null);
        }

        // Calculate relative position to the image (removing pan/zoom offset)
        const relativePos = {
            x: (pos.x - position.x) / scale,
            y: (pos.y - position.y) / scale
        };

        if (tool === 'pan') {
            // Only pan if clicking on empty space (not shapes)
            // But if we are in pan mode, maybe we want to pan EVERYWHERE? 
            // Usually editors allow dragging shapes even in pan mode if you click them.
            // But background drag pans.
            if (e.target === stage) {
                setIsPanning(true);
                setDragStart({
                    x: pos.x - position.x,
                    y: pos.y - position.y
                });
            }
        } else if (tool === 'draw') {
            // Start drawing
            // Deselect processing
            if (e.target === stage) {
                selectShape(null);
                setIsDrawing(true);
                setCursorGuide(clampGuidePosition(relativePos));
                const id = uuidv4();
                const newRect = {
                    id: id,
                    x: relativePos.x,
                    y: relativePos.y,
                    width: 0,
                    height: 0,
                    label: 'New Object',
                    confidence: 1.0,
                    class_id: 0
                };
                setNewAnnotation(newRect);
            }
        }
    };

    const handleMouseMove = (e) => {
        const stage = stageRef.current;
        const pointer = stage?.getPointerPosition();
        if (!pointer) return;

        const relativePos = pointer ? {
            x: (pointer.x - position.x) / scale,
            y: (pointer.y - position.y) / scale
        } : null;

        if (tool === 'draw' && relativePos) {
            if (guideFrameRef.current) {
                cancelAnimationFrame(guideFrameRef.current);
            }
            guideFrameRef.current = requestAnimationFrame(() => {
                setCursorGuide(clampGuidePosition(relativePos));
            });
        }

        if (tool === 'pan' && isPanning) {
            setPosition({
                x: pointer.x - dragStart.x,
                y: pointer.y - dragStart.y
            });
        } else if (tool === 'draw' && isDrawing && newAnnotation) {
            const newWidth = relativePos.x - newAnnotation.x;
            const newHeight = relativePos.y - newAnnotation.y;

            setNewAnnotation({
                ...newAnnotation,
                width: newWidth,
                height: newHeight
            });
        }
    };

    const handleMouseUp = () => {
        if (tool === 'pan') {
            setIsPanning(false);
        } else if (tool === 'draw') {
            if (isDrawing && newAnnotation) {
                // Normalize rect (width/height can be negative if dragged backwards)
                const finalRect = {
                    ...newAnnotation,
                    x: newAnnotation.width < 0 ? newAnnotation.x + newAnnotation.width : newAnnotation.x,
                    y: newAnnotation.height < 0 ? newAnnotation.y + newAnnotation.height : newAnnotation.y,
                    width: Math.abs(newAnnotation.width),
                    height: Math.abs(newAnnotation.height)
                };

                // Only add if it has some size
                if (finalRect.width > 5 && finalRect.height > 5) {
                    setAnnotations([...annotations, finalRect]);
                    selectShape(finalRect.id); // Select the new one
                    setEditingAnnotationId(finalRect.id);
                }

                setNewAnnotation(null);
                setIsDrawing(false);
            }
        }
    };

    const handleWheel = (e) => {
        e.evt.preventDefault();
        const stage = stageRef.current;
        const oldScale = scale;
        const pointer = stage.getPointerPosition();

        const scaleBy = 1.1;
        const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
        if (newScale < 0.05 || newScale > 20) return;

        const mousePointTo = {
            x: (pointer.x - position.x) / oldScale,
            y: (pointer.y - position.y) / oldScale,
        };

        const newPos = {
            x: pointer.x - mousePointTo.x * newScale,
            y: pointer.y - mousePointTo.y * newScale,
        };

        setScale(newScale);
        setPosition(newPos);
    }

    const handleMouseLeave = () => {
        if (guideFrameRef.current) {
            cancelAnimationFrame(guideFrameRef.current);
            guideFrameRef.current = null;
        }
        handleMouseUp();
        setCursorGuide(null);
    }

    // Delete Logic
    const handleDeleteSelected = () => {
        if (selectedId) {
            removeAnnotation(selectedId);
            selectShape(null);
            setEditingAnnotationId(null);
        }
    }

    // Reset View Logic
    const imageUrl = selectedImage ? `http://localhost:8000/image_file/${encodeURIComponent(selectedImage)}${projectName ? `?project_name=${encodeURIComponent(projectName)}` : ''}` : '';
    const handleResetView = () => {
        lastLoadedImageRef.current = null;
        const image = new Image();
        image.src = imageUrl;
        image.onload = () => {
            handleImageLoad(image.width, image.height);
        }
    }

    const handleEditSelected = () => {
        if (selectedId) {
            setEditingAnnotationId(selectedId)
        }
    }

    const editingAnnotation = annotations.find((annotation) => annotation.id === editingAnnotationId)

    if (!selectedImage) {
        return (
            <div className="flex-1 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col items-center justify-center text-slate-500">
                <div className="text-6xl mb-4 opacity-20">📷</div>
                <div className="text-lg font-medium">Select an image to start annotating</div>
                <div className="text-sm text-slate-600 mt-2">Upload images from the sidebar</div>
            </div>
        )
    }

    return (
        <div ref={canvasContainerRef} className={`flex-1 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 overflow-hidden relative ${tool === 'pan' && isPanning ? 'cursor-grabbing' : tool === 'pan' ? 'cursor-grab' : 'cursor-crosshair'}`}>
            {editingAnnotation && (
                <LabelPopup
                    annotation={editingAnnotation}
                    stagePosition={position}
                    stageScale={scale}
                    onClose={() => setEditingAnnotationId(null)}
                    containerRef={canvasContainerRef}
                />
            )}

            {/* Annotation count & Tool Info */}
            <div className="absolute top-6 right-6 z-20 flex flex-col gap-2 items-end">
                {annotations.length > 0 && (
                    <div className="bg-cyan-500/20 backdrop-blur-md border border-cyan-500/50 rounded-xl px-4 py-2 flex items-center gap-2">
                        <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></div>
                        <span className="text-sm font-bold text-cyan-300">{annotations.length} objects</span>
                    </div>
                )}
            </div>

            {/* Bottom Controls Bar */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 bg-slate-900/80 backdrop-blur-md px-4 py-2 rounded-2xl border border-slate-700/50 shadow-xl">
                {/* Tool Toggle */}
                <div className="flex items-center bg-slate-800 rounded-lg p-1 border border-slate-700">
                    <button
                        onClick={() => setAnnotationTool('pan')}
                        className={`p-2 rounded-md transition-all ${tool === 'pan' ? 'bg-slate-700 text-cyan-400 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                        title="Pan Tool"
                    >
                        <Hand size={18} />
                    </button>
                    <button
                        onClick={() => setAnnotationTool('draw')}
                        className={`p-2 rounded-md transition-all ${tool === 'draw' ? 'bg-slate-700 text-cyan-400 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                        title="Draw Tool"
                    >
                        <MousePointer2 size={18} />
                    </button>
                </div>

                <div className="w-px h-6 bg-slate-700 mx-1"></div>

                <div className="text-slate-400 text-xs font-medium px-2">
                    {tool === 'pan' ? 'Drag to Pan • Scroll to Zoom' : 'Drag to Draw • Click to Select'}
                </div>

                <div className="w-px h-6 bg-slate-700 mx-1"></div>

                {/* Delete Button (Visible only when selected) */}
                {selectedId && (
                    <>
                        <button
                            onClick={handleEditSelected}
                            className="p-2 text-cyan-400 hover:text-white bg-cyan-950/30 hover:bg-cyan-600 rounded-lg transition-colors border border-cyan-900/50 hover:border-cyan-500"
                            title="Edit Label"
                        >
                            <Pencil size={18} />
                        </button>
                        <button
                            onClick={handleDeleteSelected}
                            className="p-2 text-red-400 hover:text-white bg-red-950/30 hover:bg-red-600 rounded-lg transition-colors border border-red-900/50 hover:border-red-500"
                            title="Delete Selected (Del)"
                        >
                            <Trash2 size={18} />
                        </button>
                        <div className="w-px h-6 bg-slate-700 mx-1"></div>
                    </>
                )}

                <button
                    onClick={handleResetView}
                    className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors border border-slate-700"
                    title="Reset View"
                >
                    <RefreshCw size={18} />
                </button>
            </div>

            <Stage
                ref={stageRef}
                width={stageSize.width}
                height={stageSize.height}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
                onTouchStart={checkDeselect}
                onWheel={handleWheel}
                scaleX={scale}
                scaleY={scale}
                x={position.x}
                y={position.y}
            >
                <Layer>
                    <URLImage src={imageUrl} onImageLoad={handleImageLoad} />

                    {tool === 'draw' && cursorGuide && imageSize.width > 0 && imageSize.height > 0 && (
                        <>
                            <Line
                                points={[0, cursorGuide.y, imageSize.width, cursorGuide.y]}
                                stroke="#c30010"
                                strokeWidth={0.6 / scale}
                                dash={[10 / scale, 7 / scale]}
                                listening={false}
                            />
                            <Line
                                points={[cursorGuide.x, 0, cursorGuide.x, imageSize.height]}
                                stroke="#c30010"
                                strokeWidth={0.6 / scale}
                                dash={[10 / scale, 7 / scale]}
                                listening={false}
                            />
                            <Line
                                points={[
                                    cursorGuide.x - (10 / scale), cursorGuide.y,
                                    cursorGuide.x + (10 / scale), cursorGuide.y
                                ]}
                                stroke="#c30010"
                                strokeWidth={0.8 / scale}
                                listening={false}
                            />
                            <Line
                                points={[
                                    cursorGuide.x, cursorGuide.y - (10 / scale),
                                    cursorGuide.x, cursorGuide.y + (10 / scale)
                                ]}
                                stroke="#c30010"
                                strokeWidth={0.8 / scale}
                                listening={false}
                            />
                        </>
                    )}

                    {/* Existing Annotations */}
                    {annotations.map((ann) => {
                        return (
                            <Rectangle
                                key={ann.id}
                                shapeProps={{ ...ann, name: ann.id }} // Name prop is CRITICAL for transformer lookup
                                isSelected={ann.id === selectedId}
                                onSelect={() => {
                                    if (tool === 'pan' || tool === 'draw') selectShape(ann.id)
                                }}
                                onDblClick={() => {
                                    selectShape(ann.id)
                                    setEditingAnnotationId(ann.id)
                                }}
                                onChange={(newAttrs) => {
                                    updateAnnotation(ann.id, newAttrs);
                                }}
                                stageScale={scale}
                            />
                        );
                    })}

                    {/* New Annotation being drawn */}
                    {newAnnotation && (
                        <Rect
                            x={newAnnotation.x}
                            y={newAnnotation.y}
                            width={newAnnotation.width}
                            height={newAnnotation.height}
                            stroke="#06b6d4"
                            strokeWidth={2 / scale}
                            fill="rgba(6,182,212, 0.3)"
                        />
                    )}

                    {/* Global Transformer (On top of everything) */}
                    <Transformer
                        ref={transformerRef}
                        boundBoxFunc={(oldBox, newBox) => {
                            if (newBox.width < 5 || newBox.height < 5) {
                                return oldBox;
                            }
                            return newBox;
                        }}
                        anchorSize={8}
                        borderColor="#06b6d4"
                        anchorFill="#06b6d4"
                        keepRatio={false} // Allow free transforming
                    />
                </Layer>
            </Stage>
        </div>
    )
}
