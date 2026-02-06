import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Stage, Layer, Image as KonvaImage, Rect, Transformer, Text, Label, Tag } from 'react-konva'
import useImage from 'use-image'
import { useStore } from '../store'
import { MousePointer2, Hand, RefreshCw, Trash2 } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'

const URLImage = ({ src, onImageLoad }) => {
    const [image] = useImage(src)

    useEffect(() => {
        if (image) {
            onImageLoad(image.width, image.height)
        }
    }, [image, onImageLoad])

    // listening={false} ensures the image doesn't intercept mouse events,
    // allowing events to bubble up to the Stage for panning/drawing.
    return <KonvaImage image={image} listening={false} />
}

const Rectangle = ({ shapeProps, isSelected, onSelect, onChange, stageScale }) => {
    const shapeRef = useRef();

    // Calculate stroke width based on stage scale to maintain consistent visual thickness
    // If scale is 1, stroke is 2. If scale is 2, stroke is 1.
    const strokeWidth = 2 / stageScale;

    return (
        <>
            <Rect
                onClick={onSelect}
                onTap={onSelect}
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

export const Canvas = () => {
    const { selectedImage, annotations, setAnnotations, updateAnnotation, removeAnnotation } = useStore()
    const [selectedId, selectShape] = useState(null)
    const [stageSize, setStageSize] = useState({ width: window.innerWidth - 288, height: window.innerHeight })
    const [scale, setScale] = useState(1)
    const [position, setPosition] = useState({ x: 0, y: 0 })

    // Tools: 'pan' | 'draw'
    const [tool, setTool] = useState('pan')

    // Interaction States
    const [isPanning, setIsPanning] = useState(false)
    const [isDrawing, setIsDrawing] = useState(false)
    const [newAnnotation, setNewAnnotation] = useState(null)
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 })

    const stageRef = useRef(null)
    const transformerRef = useRef(null)
    const lastLoadedImageRef = useRef(null)

    useEffect(() => {
        const handleResize = () => {
            setStageSize({ width: window.innerWidth - 288, height: window.innerHeight })
        }
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [])

    // Keyboard Shortcuts (Delete)
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
                removeAnnotation(selectedId);
                selectShape(null); // Deselect after deleting
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedId, removeAnnotation]);

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
        setTool('pan'); // Reset tool to pan on image change safely
        selectShape(null); // Clear selection on image change
    }, [selectedImage])

    const handleImageLoad = useCallback((imgWidth, imgHeight) => {
        if (lastLoadedImageRef.current === selectedImage) return;
        lastLoadedImageRef.current = selectedImage;

        if (imgWidth <= 0 || imgHeight <= 0) return;

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
        }
    };

    const handleMouseDown = (e) => {
        const stage = e.target.getStage();
        const pos = stage.getPointerPosition();

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
        if (tool === 'pan' && isPanning) {
            const stage = stageRef.current;
            const pointer = stage.getPointerPosition();
            setPosition({
                x: pointer.x - dragStart.x,
                y: pointer.y - dragStart.y
            });
        } else if (tool === 'draw' && isDrawing && newAnnotation) {
            const stage = stageRef.current;
            const pointer = stage.getPointerPosition();
            const relativePos = {
                x: (pointer.x - position.x) / scale,
                y: (pointer.y - position.y) / scale
            };

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

    // Delete Logic
    const handleDeleteSelected = () => {
        if (selectedId) {
            removeAnnotation(selectedId);
            selectShape(null);
        }
    }

    // Reset View Logic
    const imageUrl = selectedImage ? `http://localhost:8000/images_static/${selectedImage}` : '';
    const handleResetView = () => {
        lastLoadedImageRef.current = null;
        const image = new Image();
        image.src = imageUrl;
        image.onload = () => {
            handleImageLoad(image.width, image.height);
        }
    }

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
        <div className={`flex-1 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 overflow-hidden relative ${tool === 'pan' && isPanning ? 'cursor-grabbing' : tool === 'pan' ? 'cursor-grab' : 'cursor-crosshair'}`}>
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
                        onClick={() => setTool('pan')}
                        className={`p-2 rounded-md transition-all ${tool === 'pan' ? 'bg-slate-700 text-cyan-400 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                        title="Pan Tool"
                    >
                        <Hand size={18} />
                    </button>
                    <button
                        onClick={() => setTool('draw')}
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
                onMouseLeave={handleMouseUp}
                onTouchStart={checkDeselect}
                onWheel={handleWheel}
                scaleX={scale}
                scaleY={scale}
                x={position.x}
                y={position.y}
            >
                <Layer>
                    <URLImage src={imageUrl} onImageLoad={handleImageLoad} />

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
