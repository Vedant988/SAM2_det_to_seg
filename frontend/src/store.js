import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useStore = create(
    persist(
        (set, get) => ({
            // Project State
            projectName: '',
            setProjectName: (name) => set({ projectName: name }),

            recentProjects: [],
            addRecentProject: (project) => set((state) => {
                const newProjects = [
                    { ...project, id: crypto.randomUUID(), lastEdited: new Date().toISOString() },
                    ...state.recentProjects.filter(p => p.name !== project.name)
                ].slice(0, 5) // Keep last 5
                return { recentProjects: newProjects }
            }),
            deleteRecentProject: (projectId) => set((state) => ({
                recentProjects: state.recentProjects.filter(project => project.id !== projectId)
            })),
            removeRecentProject: (projectName) => set((state) => ({
                recentProjects: state.recentProjects.filter(project => project.name !== projectName)
            })),

            // Image & Annotation State
            images: [],
            selectedImage: null,
            annotations: [], // Current image annotations
            allAnnotations: {}, // Store annotations for all images: { filename: [...annotations] }

            // Processing State
            isProcessing: false,
            processingProgress: { current: 0, total: 0, message: '' },
            annotationTool: 'pan',

            // Actions
            setImages: (images) => set({ images }),
            setSelectedImage: (image) => set((state) => ({
                selectedImage: image,
                annotations: Array.isArray(state.allAnnotations[image]) ? state.allAnnotations[image] : []
            })),
            setAnnotations: (annotations) => set((state) => {
                const safeAnnotations = Array.isArray(annotations) ? annotations : []
                const newAllAnnotations = { ...state.allAnnotations }
                if (state.selectedImage) {
                    newAllAnnotations[state.selectedImage] = safeAnnotations
                }
                return { annotations: safeAnnotations, allAnnotations: newAllAnnotations }
            }),
            setAllAnnotations: (allAnnotations) => set({ allAnnotations }),
            addAnnotation: (annotation) => set((state) => {
                const currentAnnotations = Array.isArray(state.annotations) ? state.annotations : []
                const annotations = [...currentAnnotations, annotation]
                const allAnnotations = { ...state.allAnnotations }
                if (state.selectedImage) {
                    allAnnotations[state.selectedImage] = annotations
                }
                return { annotations, allAnnotations }
            }),
            updateAnnotation: (id, newProps) => set((state) => {
                const currentAnnotations = Array.isArray(state.annotations) ? state.annotations : []
                const annotations = currentAnnotations.map(ann => ann.id === id ? { ...ann, ...newProps } : ann)
                const allAnnotations = { ...state.allAnnotations }
                if (state.selectedImage) {
                    allAnnotations[state.selectedImage] = annotations
                }
                return { annotations, allAnnotations }
            }),
            removeAnnotation: (id) => set((state) => {
                const currentAnnotations = Array.isArray(state.annotations) ? state.annotations : []
                const annotations = currentAnnotations.filter(ann => ann.id !== id)
                const allAnnotations = { ...state.allAnnotations }
                if (state.selectedImage) {
                    allAnnotations[state.selectedImage] = annotations
                }
                return { annotations, allAnnotations }
            }),
            setProcessing: (status) => set({ isProcessing: status }),
            setProcessingProgress: (progress) => set({ processingProgress: progress }),
            setAnnotationTool: (tool) => set({ annotationTool: tool }),

            // Reset Project
            resetProject: () => set({
                projectName: '',
                images: [],
                selectedImage: null,
                annotations: [],
                allAnnotations: {},
                isProcessing: false,
                processingProgress: { current: 0, total: 0, message: '' },
                annotationTool: 'pan'
            }),

            deleteImage: (filename) => set((state) => {
                const newAllAnnotations = { ...state.allAnnotations }
                delete newAllAnnotations[filename]

                return {
                    images: state.images.filter(img => img !== filename),
                    allAnnotations: newAllAnnotations,
                    selectedImage: state.selectedImage === filename ? null : state.selectedImage,
                    annotations: state.selectedImage === filename ? [] : state.annotations
                }
            })
        }),
        {
            name: 'yolo-sam2-storage', // unique name
            partialize: (state) => ({ recentProjects: state.recentProjects, projectName: state.projectName }),
        }
    )
)
